import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// Google-Docs-style "find in document" for the rich text editor.
//
// Everything lives in ProseMirror plugin state rather than React state so the
// highlights survive re-renders and stay in sync with the document as it is
// edited: any transaction that changes the doc re-runs the search. The React
// find bar (EditorFindBar) only reads this state and pushes the search term /
// active index back in through transaction metadata.

export const findInEditorKey = new PluginKey('findInEditor');

export const FIND_HIT_CLASS = 'bex-find-hit';
export const FIND_HIT_ACTIVE_CLASS = 'bex-find-hit-active';

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** How a search is being run. Diacritics are ignored by default, as in Docs. */
export const DEFAULT_FIND_OPTIONS = Object.freeze({
  matchCase: false,
  regex: false,
  ignoreDiacritics: true,
});

const COMBINING_MARK = /\p{M}/u;

/**
 * Flatten a run's text for searching, and record where each folded character
 * came from.
 *
 * The map is the whole reason this exists. Ignoring diacritics changes the
 * length of the string — an accent written as its own combining mark disappears
 * entirely, a precomposed letter may decompose into two — so a match found in
 * the folded text cannot be measured back into document positions by index
 * alone. Every folded character remembers the original index it came from, and
 * the match is measured through that.
 */
function foldRunText(text, options) {
  if (!options.ignoreDiacritics) {
    // Nothing to fold: the text is its own searchable form, and every index
    // already lines up with the original.
    return { folded: text, map: text.split('').map((_, index) => index) };
  }

  let folded = '';
  const map = [];

  for (let index = 0; index < text.length; index += 1) {
    // A standalone combining mark folds away to nothing and is simply not part
    // of the searchable text: "אַ" is searched as "א".
    if (COMBINING_MARK.test(text[index])) continue;
    const piece = text[index].normalize('NFD').replace(/\p{M}/gu, '');
    if (!piece) continue;

    for (const character of piece) {
      folded += character;
      map.push(index);
    }
  }

  return { folded, map };
}

/**
 * The same folding, for the term being looked for.
 *
 * Case is deliberately left alone here and handled by the pattern's own `i`
 * flag instead. Folding the haystack to lower case as well would work for
 * matching, but it would hand back lower-cased capture groups — so replacing
 * "Maimon, Moses" with "$2 $1" produced "moses maimon".
 */
function foldTerm(term, options) {
  if (!options.ignoreDiacritics) return term;
  return term.normalize('NFD').replace(/\p{M}/gu, '');
}

/**
 * The pattern to run, or null if the user is midway through typing one.
 *
 * An unfinished regular expression — "(" on its own — is a normal thing to see
 * while typing, not an error worth throwing over.
 */
export function compileFindPattern(term, options = DEFAULT_FIND_OPTIONS) {
  const settings = { ...DEFAULT_FIND_OPTIONS, ...options };
  if (!term) return null;
  const source = settings.regex ? term : escapeRegExp(foldTerm(term, settings));
  try {
    // Case is the flag's job alone; see foldTerm.
    return new RegExp(source, settings.matchCase ? 'g' : 'gi');
  } catch {
    return null;
  }
}

/**
 * Collect the document's text as a list of runs, one per block-ish container.
 *
 * A run joins consecutive text nodes so a phrase that spans several of them
 * ("the living word" where "living" is bold) still matches. Consecutive text
 * nodes inside one block occupy contiguous document positions, so a run can
 * map any index in its joined string straight back to a doc position.
 *
 * Each run: `{ text, parts: [{ from, start, end }] }` where `start`/`end` are
 * offsets into `text` and `from` is the doc position of that part's first char.
 */
function collectRuns(doc) {
  const runs = [];
  let current = null;
  const flush = () => {
    if (current && current.text) runs.push(current);
    current = null;
  };
  doc.descendants((node, pos) => {
    if (node.isText) {
      if (!current) current = { text: '', parts: [] };
      const start = current.text.length;
      current.text += node.text;
      current.parts.push({ from: pos, start, end: current.text.length });
      return false;
    }
    // Any non-text node (paragraph, image, table cell, …) ends the run so
    // matches never bleed across a block boundary.
    flush();
    return true;
  });
  flush();
  return runs;
}

/** Doc position of character `index` within a run's joined text. */
function positionAt(run, index) {
  for (const part of run.parts) {
    if (index >= part.start && index < part.end) {
      return part.from + (index - part.start);
    }
  }
  return null;
}

/**
 * Every occurrence of `term` in the document, in reading order.
 *
 * Returns `[{ from, to, groups }]` in document positions. `groups` carries the
 * regular expression's capture groups so a replacement can refer back to them.
 *
 * Matching happens inside one block at a time, so a pattern can never run
 * across a paragraph boundary — including `\n`, which no run contains.
 */
export function findMatches(doc, term, options = DEFAULT_FIND_OPTIONS) {
  const settings = { ...DEFAULT_FIND_OPTIONS, ...options };
  const regex = compileFindPattern(term, settings);
  if (!regex) return [];

  const matches = [];
  for (const run of collectRuns(doc)) {
    const { folded, map } = foldRunText(run.text, settings);
    regex.lastIndex = 0;
    let hit;
    while ((hit = regex.exec(folded)) !== null) {
      if (!hit[0].length) {
        regex.lastIndex += 1;
        continue;
      }
      // Measured through the map, never by index: folding can add or remove
      // characters, so the folded offsets mean nothing to the document.
      const firstIndex = map[hit.index];
      const lastIndex = map[hit.index + hit[0].length - 1];
      if (firstIndex === undefined || lastIndex === undefined) continue;

      const from = positionAt(run, firstIndex);
      const lastCharPos = positionAt(run, lastIndex);
      if (from === null || lastCharPos === null) continue;
      matches.push({ from, to: lastCharPos + 1, groups: hit.slice(1) });
    }
  }
  return matches;
}

/**
 * Work `$1`–`$9` and `$&` into a replacement, the way Docs does in regex mode.
 *
 * `$$` is a literal dollar. A group that did not take part in the match becomes
 * nothing rather than the text "undefined".
 */
export function expandReplacement(replacement, match, matchedText = '') {
  const groups = match?.groups || [];
  return String(replacement ?? '').replace(/\$(\$|&|[1-9])/g, (_, token) => {
    if (token === '$') return '$';
    if (token === '&') return matchedText;
    return groups[Number(token) - 1] ?? '';
  });
}

function buildDecorations(doc, matches, activeIndex, navigationId, retainedReveals = null) {
  // Keep an editing section visible even if its last match was just erased.
  // The next explicit find command clears or replaces these temporary reveals.
  const revealed = retainedReveals || [];
  const active = matches[activeIndex];
  if (active && retainedReveals === null) {
    const $from = doc.resolve(active.from);
    for (let depth = 1; depth < $from.depth; depth += 1) {
      const node = $from.node(depth);
      // A hit in a summary doesn't require opening that summary's own body.
      if (node.type.name !== 'details' || $from.node(depth + 1).type.name !== 'detailsContent') continue;
      const from = $from.before(depth);
      revealed.push(Decoration.node(from, from + node.nodeSize, {}, { findReveal: navigationId }));
    }
  }
  return DecorationSet.create(
    doc,
    [...revealed, ...matches.map((match, i) =>
      Decoration.inline(match.from, match.to, {
        class: i === activeIndex ? `${FIND_HIT_CLASS} ${FIND_HIT_ACTIVE_CLASS}` : FIND_HIT_CLASS,
      })
    )]
  );
}

const EMPTY_STATE = {
  term: '',
  navigationId: 0,
  matches: [],
  activeIndex: 0,
  options: DEFAULT_FIND_OPTIONS,
  decorations: DecorationSet.empty,
};

/** Read the current find state for an editor (never null). */
export function getFindState(editorState) {
  return findInEditorKey.getState(editorState) || EMPTY_STATE;
}

/** The caret guard must use the same temporary visibility as the NodeView. */
export function isFindRevealed(editorState, nodePos) {
  return getFindState(editorState).decorations.find(nodePos, nodePos)
    .some(decoration => decoration.from === nodePos
      && decoration.spec.findReveal && !decoration.spec.findDismissed);
}

export const FindInEditor = Extension.create({
  name: 'findInEditor',

  addCommands() {
    const send = (meta) => ({ tr, dispatch }) => {
      // A metadata-only transaction: no steps, so it never marks the document
      // dirty, never fires onUpdate, and never lands in the undo stack.
      if (dispatch) dispatch(tr.setMeta(findInEditorKey, meta).setMeta('addToHistory', false));
      return true;
    };
    return {
      setFindTerm: (term) => send({ term: term || '' }),
      setFindActiveIndex: (index) => send({ activeIndex: index }),
      setFindOptions: (options) => send({ options: options || {} }),
      clearFind: () => send({ term: '', activeIndex: 0 }),

      /**
       * Replace the match the reader is standing on.
       *
       * A real document change, unlike everything else here: it goes through
       * the editor so it is undoable in one step and the note saves. The active
       * index is left where it is, so the following match takes its place and a
       * second press carries on down the document.
       */
      replaceFindMatch: (replacement) => ({ state, dispatch }) => {
        const { matches, activeIndex } = getFindState(state);
        const match = matches[activeIndex];
        if (!match) return false;
        if (dispatch) {
          const text = expandReplacement(
            replacement,
            match,
            state.doc.textBetween(match.from, match.to, ''),
          );
          // insertText, not a slice replacement: it inherits the marks already
          // at that position, so replacing a word inside a bold run stays bold.
          dispatch(state.tr.insertText(text, match.from, match.to));
        }
        return true;
      },

      /** Replace every match, in one undoable step. */
      replaceAllFindMatches: (replacement) => ({ state, dispatch }) => {
        const { matches } = getFindState(state);
        if (!matches.length) return false;
        if (dispatch) {
          const tr = state.tr;
          // Back to front: replacing shifts every position after the match, and
          // working backwards means none of the remaining ones move.
          for (let index = matches.length - 1; index >= 0; index -= 1) {
            const match = matches[index];
            const text = expandReplacement(
              replacement,
              match,
              state.doc.textBetween(match.from, match.to, ''),
            );
            tr.insertText(text, match.from, match.to);
          }
          dispatch(tr);
        }
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: findInEditorKey,
        state: {
          init: () => EMPTY_STATE,
          apply(tr, prev, _oldState, newState) {
            const meta = tr.getMeta(findInEditorKey);
            // Nothing to do: no find command, and either the doc is untouched
            // or there is no active search to keep up to date.
            if (!meta && (!tr.docChanged || !prev.term)) return prev;

            let { term, activeIndex, options } = prev;
            let matches = prev.matches;
            let recompute = tr.docChanged;

            if (meta) {
              if (meta.term !== undefined && meta.term !== term) {
                term = meta.term;
                activeIndex = 0;
                recompute = true;
              }
              if (meta.options !== undefined) {
                const next = { ...options, ...meta.options };
                if (
                  next.matchCase !== options.matchCase
                  || next.regex !== options.regex
                  || next.ignoreDiacritics !== options.ignoreDiacritics
                ) {
                  options = next;
                  recompute = true;
                }
              }
              if (meta.activeIndex !== undefined) activeIndex = meta.activeIndex;
            }

            if (recompute) matches = term ? findMatches(newState.doc, term, options) : [];

            // Wrap around at both ends so next/prev cycle like Google Docs.
            activeIndex = matches.length
              ? ((activeIndex % matches.length) + matches.length) % matches.length
              : 0;

            const navigating = !!meta && meta.dismissReveal === undefined;
            const navigationId = prev.navigationId + (navigating ? 1 : 0);
            // Editing refreshes highlights, but never reveals another result.
            // Keep the previously revealed ancestors mapped through the edit.
            const retainedReveals = navigating ? null : prev.decorations
              .map(tr.mapping, newState.doc).find().filter(decoration => decoration.spec.findReveal)
              .map(decoration => decoration.from === meta?.dismissReveal
                ? Decoration.node(decoration.from, decoration.to, {}, { ...decoration.spec, findDismissed: true })
                : decoration);
            return {
              navigationId,
              term,
              matches,
              activeIndex,
              options,
              decorations: buildDecorations(newState.doc, matches, activeIndex, navigationId, retainedReveals),
            };
          },
        },
        props: {
          decorations(state) {
            return getFindState(state).decorations;
          },
        },
      }),
    ];
  },
});

export default FindInEditor;
