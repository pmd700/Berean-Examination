import { Extension } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

/**
 * ⌘⇧C — put the selection into capitals, and press again to bring it back down.
 *
 * The state is read from the text rather than remembered: a selection that is
 * already entirely upper case goes down to lower case, and anything else goes
 * up. Nothing has to be tracked between presses, so it still does the obvious
 * thing after the writer has edited the words, moved the selection, or come
 * back to the note a day later.
 */

/** Has at least one letter whose case can actually change. */
export function hasCasedLetter(text) {
  const value = String(text ?? '');
  return value.toLowerCase() !== value.toUpperCase();
}

/** All caps already? Then the next press is the way back down. */
export function isAllUpperCase(text) {
  const value = String(text ?? '');
  return hasCasedLetter(value) && value === value.toUpperCase();
}

/** Which way ⌘⇧C should take this text. */
export function nextCaseTransform(text) {
  if (!hasCasedLetter(text)) return null;
  return isAllUpperCase(text)
    ? (value) => value.toLowerCase()
    : (value) => value.toUpperCase();
}

export const TextCase = Extension.create({
  name: 'textCase',

  addCommands() {
    return {
      /**
       * Recase the selection without disturbing anything else in it.
       *
       * Each run of text is rewritten separately, carrying its own marks, so a
       * bold word stays bold and a link stays a link. Anything that is not text
       * — an image, a footnote marker — is stepped over rather than flattened,
       * which replacing the whole range with a plain string would do.
       */
      toggleSelectedCase: () => ({ state, tr, dispatch }) => {
        const { from, to, empty } = state.selection;
        if (empty) return false;

        const transform = nextCaseTransform(state.doc.textBetween(from, to, '\n'));
        if (!transform) return false;

        const edits = [];
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (!node.isText) return true;
          const start = Math.max(pos, from);
          const end = Math.min(pos + node.nodeSize, to);
          if (start >= end) return true;

          const original = node.text.slice(start - pos, end - pos);
          const recased = transform(original);
          if (recased !== original) edits.push({ start, end, recased, marks: node.marks });
          return true;
        });

        if (edits.length === 0) return false;
        if (dispatch) {
          // Back to front: recasing can change a string's length — German ß
          // becomes SS — and working backwards means no later edit has moved.
          for (let index = edits.length - 1; index >= 0; index -= 1) {
            const edit = edits[index];
            tr.replaceWith(edit.start, edit.end, state.schema.text(edit.recased, edit.marks));
          }
          // Keep the words selected, so pressing again reverses what just
          // happened instead of acting on nothing.
          dispatch(tr.setSelection(TextSelection.create(tr.doc, from, tr.mapping.map(to))));
        }
        return true;
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-c': () => this.editor.commands.toggleSelectedCase(),
    };
  },
});

export default TextCase;
