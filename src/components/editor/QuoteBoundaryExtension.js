import { Extension } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { filterSlashCommands, getSlashState } from './slashCommands';

function slashMenuOwnsEnter(editor) {
  const { menu } = getSlashState(editor.state);
  return menu && filterSlashCommands(menu.query).length > 0;
}

function paragraphCaret(editor) {
  const { selection } = editor.state;
  const { $from } = selection;
  if (!editor.isEditable || editor.view.composing
    || !(selection instanceof TextSelection) || !selection.empty
    || $from.parent.type.name !== 'paragraph') return null;
  return $from;
}

function quotedParagraph(editor) {
  const $from = paragraphCaret(editor);
  return $from?.depth >= 2 && $from.node($from.depth - 1).type.name === 'blockquote' ? $from : null;
}

/** Only change explicit typing at a quote boundary, never saved/pasted prose. */
export const QuoteBoundaries = Extension.create({
  name: 'quoteBoundaries',
  // Run before generic Backspace joins an empty quoted line to its predecessor.
  priority: 1100,

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        if (slashMenuOwnsEnter(this.editor)) return false;
        const $from = quotedParagraph(this.editor);
        if (!$from || $from.parentOffset !== $from.parent.content.size) return false;
        const quoteDepth = $from.depth - 1;
        if ($from.index(quoteDepth) !== $from.node(quoteDepth).childCount - 1) return false;

        // The next paragraph belongs outside the quote. Split + lift is one
        // transaction, so Undo restores the quote and caret in one step.
        return $from.parent.content.size === 0
          ? this.editor.commands.lift('blockquote')
          : this.editor.chain().splitBlock().lift('blockquote').run();
      },
      'Shift-Enter': () => {
        if (slashMenuOwnsEnter(this.editor)) return false;
        if (!quotedParagraph(this.editor)) return false;
        // The shared editor intentionally has no hardBreak node. A paragraph
        // inside the same quote keeps its existing multiline representation.
        return this.editor.commands.splitBlock();
      },
      Backspace: () => {
        const $from = paragraphCaret(this.editor);
        if (!$from || $from.parentOffset !== 0) return false;
        // Lift just this paragraph: keep the line, its text/marks, and any
        // quoted paragraphs before/after it. Nested lists retain their keymap.
        if (quotedParagraph(this.editor)) return this.editor.commands.lift('blockquote');

        // joinBackward otherwise moves this empty paragraph INTO the preceding
        // quote, bringing its rule back. Delete the blank line instead and put
        // the caret at the end of the existing quote, as Backspace normally does.
        if ($from.parent.content.size !== 0) return false;
        const start = $from.before();
        if (this.editor.state.doc.resolve(start).nodeBefore?.type.name !== 'blockquote') return false;
        const tr = this.editor.state.tr.delete(start, start + $from.parent.nodeSize);
        tr.setSelection(TextSelection.near(tr.doc.resolve(start), -1));
        this.editor.view.dispatch(tr.scrollIntoView());
        return true;
      },
    };
  },
});
