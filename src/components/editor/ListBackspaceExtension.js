import { Extension } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

const LIST_TYPES = new Set(['bulletList', 'orderedList']);

/** Join a paragraph after a list with its final paragraph, without minting an item. */
function joinPreviousListParagraph(editor) {
  const { state } = editor;
  const { $from } = state.selection;
  const paragraphStart = $from.before();
  const $cut = state.doc.resolve(paragraphStart);
  let previous = $cut.nodeBefore;
  if (!LIST_TYPES.has(previous?.type.name)) return false;

  // Descend only through list structure. Do not reach through images, closed
  // dropdowns or other blocks to find text that isn't the preceding line.
  let end = paragraphStart;
  while (LIST_TYPES.has(previous.type.name) || previous.type.name === 'listItem') {
    previous = previous.lastChild;
    end -= 1;
    if (!previous) return false;
  }
  const paragraph = $from.parent;
  if (previous.type.name !== 'paragraph'
    || !previous.canReplace(previous.childCount, previous.childCount, paragraph.content)) return false;

  const joinPos = end - 1;
  const tr = state.tr
    .delete(paragraphStart, paragraphStart + paragraph.nodeSize)
    .insert(joinPos, paragraph.content);
  tr.setSelection(TextSelection.create(tr.doc, joinPos));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Remove a marker first; the next Backspace joins text instead of restoring it. */
export const ListBackspace = Extension.create({
  name: 'listBackspace',
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { selection } = this.editor.state;
        const { $from } = selection;
        if (!(selection instanceof TextSelection) || !selection.empty || $from.parentOffset !== 0) {
          return false;
        }

        // Only the first paragraph owns the marker. Later paragraphs and
        // nested blocks keep their usual Backspace behavior.
        const itemDepth = $from.depth - 1;
        if ($from.parent.type.name !== 'paragraph') return false;
        if (itemDepth >= 1
          && $from.node(itemDepth).type.name === 'listItem'
          && $from.index(itemDepth) === 0
          && LIST_TYPES.has($from.node(itemDepth - 1).type.name)) {
          // Lifting preserves marks and child blocks, and outdents a nested
          // item by one level instead of flattening the entire list.
          return this.editor.commands.liftListItem('listItem');
        }

        // ProseMirror's default join wraps this paragraph in a new list item.
        // That reverses the previous keypress and traps the writer in a loop.
        return joinPreviousListParagraph(this.editor);
      },
    };
  },
});
