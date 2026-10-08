import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { findMatches } from './findInEditor';
import {
  createSpotlightTrip, motionPause, prefersReducedMotion, scrollSpotlightTarget,
  SPOTLIGHT_FADE_MS, SPOTLIGHT_HOLD_MS,
} from '@/lib/spotlightMotion';

export const spotlightJourneyKey = new PluginKey('spotlightJourney');

// Separate from Cmd+F: one ephemeral destination, never a saved formatting mark.
export const SpotlightJourney = Extension.create({
  name: 'spotlightJourney',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: spotlightJourneyKey,
      state: {
        init: () => DecorationSet.empty,
        apply(tr, previous) {
          const meta = tr.getMeta(spotlightJourneyKey);
          if (meta?.clear) return DecorationSet.empty;
          if (meta?.match) return DecorationSet.create(tr.doc, (meta.match.ranges || [meta.match]).map(range => Decoration.inline(range.from, range.to, {
            class: `bex-spotlight-hit${meta.fading ? ' bex-spotlight-hit--fading' : ''}`,
          })));
          return previous.map(tr.mapping, tr.doc);
        },
      },
      props: { decorations: state => spotlightJourneyKey.getState(state) },
    })];
  },
});

export function spotlightMatch(doc, query) {
  for (const term of [query, ...query.split(/\s+/)]) {
    const match = term && findMatches(doc, term)[0];
    if (match) return match;
  }
  return null;
}

/** Only ancestors hiding the match's body; a matched summary stays closed. */
export function closedSpotlightSections(doc, position) {
  const $pos = doc.resolve(position);
  const sections = [];
  for (let depth = 1; depth < $pos.depth; depth += 1) {
    const node = $pos.node(depth);
    if (node.type.name === 'details' && !node.attrs.open && $pos.node(depth + 1).type.name === 'detailsContent') {
      sections.push($pos.before(depth));
    }
  }
  return sections;
}

function matchRange(editor, match) {
  const from = editor.view.domAtPos(match.from);
  const to = editor.view.domAtPos(match.to);
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}

export function startEditorSpotlight(editor, query) {
  return startEditorRangeSpotlight(editor, doc => spotlightMatch(doc, query));
}

/** Navigate to an exact saved anchor, even when the same words appear elsewhere. */
export function startEditorRangeSpotlight(editor, resolveMatch, { highlight = true } = {}) {
  const trip = createSpotlightTrip();
  const send = meta => {
    if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr
      .setMeta(spotlightJourneyKey, meta).setMeta('addToHistory', false));
  };
  const onTransaction = ({ transaction }) => {
    if (transaction.docChanged && !transaction.getMeta(spotlightJourneyKey)) trip.cancel();
  };
  editor.on('transaction', onTransaction);
  const finished = (async () => {
    try {
      // Let editor children, closed-state node views and layout mount first.
      if (!await motionPause(32, trip.signal) || editor.isDestroyed) return false;
      const match = resolveMatch(editor.state.doc);
      if (!match) return false;
      for (const position of closedSpotlightSections(editor.state.doc, match.from)) {
        const section = editor.view.nodeDOM(position);
        const summary = section?.querySelector('summary') || section;
        if (!await scrollSpotlightTarget(summary, trip.signal)) return false;
        // Arrive FIRST. Updating open then invokes the existing dropdown's
        // height/opacity animation; we don't duplicate its rendering engine.
        editor.view.dispatch(editor.state.tr.setNodeAttribute(position, 'open', true)
          .setMeta(spotlightJourneyKey, { reveal: true }).setMeta('addToHistory', false));
        // Even with reduced motion, the existing view releases its temporary
        // pixel height at 220ms. Wait until nested text is no longer clipped.
        if (!await motionPause(240, trip.signal)) return false;
      }
      if (!await scrollSpotlightTarget(matchRange(editor, match), trip.signal)) return false;
      if (!highlight) return !trip.signal.aborted;
      send({ match });
      if (!await motionPause(SPOTLIGHT_HOLD_MS, trip.signal)) return false;
      send({ match, fading: true });
      await motionPause(prefersReducedMotion() ? 0 : SPOTLIGHT_FADE_MS, trip.signal);
      return !trip.signal.aborted;
    } finally {
      send({ clear: true });
      editor.off('transaction', onTransaction);
      trip.dispose();
    }
  })();
  return { cancel: trip.cancel, finished };
}
