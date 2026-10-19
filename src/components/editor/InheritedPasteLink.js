import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Fragment, Slice } from '@tiptap/pm/model';

// Only inherit when both sides of the insertion share the exact same link.
// A paste beside a link, or between different links, must remain independent.
export function surroundingPasteLink(selection) {
  const { $from, $to } = selection;
  if (!$from.sameParent($to)) return null;
  const left = $from.nodeBefore?.marks.find(mark => mark.type.name === 'link');
  const right = $to.nodeAfter?.marks.find(mark => mark.type.name === 'link');
  return left && right && left.eq(right) ? left : null;
}

export function inheritPastedLink(slice, link) {
  if (!link) return slice;
  const visit = (fragment, allowed = true) => {
    const nodes = [];
    fragment.forEach(node => {
      if (node.isText && allowed) {
        nodes.push(node.mark(link.addToSet(node.marks)));
      } else if (node.content.size) {
        nodes.push(node.copy(visit(node.content, node.type.allowsMarkType(link.type))));
      } else nodes.push(node);
    });
    return Fragment.fromArray(nodes);
  };
  return new Slice(visit(slice.content), slice.openStart, slice.openEnd);
}

// The Markdown/table capture handler inserts content directly, bypassing
// ProseMirror's clipboard pipeline. Apply the same rule in its transaction.
export function inheritInsertedLink(transaction, from, to, link) {
  if (!link || to <= from) return;
  transaction.doc.nodesBetween(from, to, (node, position, parent) => {
    if (node.isText && parent.type.allowsMarkType(link.type)) {
      transaction.addMark(Math.max(from, position), Math.min(to, position + node.nodeSize), link);
    }
  });
}

export const InheritedPasteLink = Extension.create({
  name: 'inheritedPasteLink',
  addProseMirrorPlugins() {
    return [new Plugin({ props: {
      transformPasted: (slice, view) => inheritPastedLink(slice, surroundingPasteLink(view.state.selection)),
    } })];
  },
});
