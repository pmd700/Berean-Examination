import { Fragment, Slice } from '@tiptap/pm/model';

/** A text selection includes open ancestor nodes so ProseMirror can restore its
 * context. A dropdown's summary is isolating, so restoring that context pastes
 * new dropdowns instead of just the selected words. Strip only those open
 * wrappers; a completely selected dropdown remains an intact, closed slice. */
export function textOnlyToggleContext(slice, schema) {
  let changed = false;
  function fragment(content, openStart, openEnd) {
    const nodes = [];
    let start = 0, end = 0;
    content.forEach((node, _offset, index) => {
      const left = index === 0 ? openStart : 0;
      const right = index === content.childCount - 1 ? openEnd : 0;
      const name = node.type.name;
      let result;
      if (name === 'detailsSummary') {
        changed = true;
        result = { content: Fragment.from(schema.nodes.paragraph.create(null, node.content)), openStart: left, openEnd: right };
      } else if (name === 'detailsContent' || (name === 'details' && (left > 0 || right > 0))) {
        changed = true;
        result = fragment(node.content, Math.max(0, left - 1), Math.max(0, right - 1));
      } else if (!node.isLeaf && (left > 0 || right > 0)) {
        const child = fragment(node.content, Math.max(0, left - 1), Math.max(0, right - 1));
        result = { content: Fragment.from(node.copy(child.content)), openStart: left > 0 ? child.openStart + 1 : 0, openEnd: right > 0 ? child.openEnd + 1 : 0 };
      } else result = { content: Fragment.from(node), openStart: 0, openEnd: 0 };
      if (index === 0) start = result.openStart;
      if (index === content.childCount - 1) end = result.openEnd;
      result.content.forEach(child => nodes.push(child));
    });
    return { content: Fragment.fromArray(nodes), openStart: start, openEnd: end };
  }
  const result = fragment(slice.content, slice.openStart, slice.openEnd);
  return changed ? new Slice(result.content, result.openStart, result.openEnd) : slice;
}
