import { Fragment, Slice } from '@tiptap/pm/model';
import { Transform } from '@tiptap/pm/transform';
import { POINTER_MARK, collectPointers, completePointer } from './pointerModel';

// Keep paragraph boundaries (including blank paragraphs), but never pull in
// unselected prose between separately selected blocks.
function groups(doc, ranges) {
  const result = [];
  for (const range of ranges) {
    const last = result.at(-1);
    if (last && !doc.textBetween(last.to, range.from, '', '\uFFFC')) last.to = range.to;
    else result.push({ ...range });
  }
  return result;
}
function withoutPointers(fragment) {
  return Fragment.fromArray(fragment.content.map(node =>
    (node.isLeaf ? node : node.copy(withoutPointers(node.content)))
      .mark(node.marks.filter(mark => mark.type.name !== POINTER_MARK))));
}

/** Expand Echo Copy only in a clipboard snapshot, never in the live document.
 * The source is the placeholder; the target is the passage it points to.
 * Use the original passage once, so chains/cycles cannot recursively expand.
 */
export function expandPointerEcho(slice, doc) {
  const enabled = collectPointers(doc).filter(pointer => pointer.echoCopy && completePointer(pointer));
  if (!enabled.length) return slice;
  const copied = collectPointers(slice.content);
  const snapshot = doc.type.create(doc.attrs, slice.content);
  const replacements = [];
  const occupied = [];
  for (const pointer of enabled) {
    const placeholder = copied.find(item => item.id === pointer.id)?.source;
    // Partial words/passages should still copy exactly the selected text.
    if (!placeholder?.ranges.length || placeholder.text !== pointer.source.text) continue;
    const spans = groups(snapshot, placeholder.ranges);
    if (spans.some(span => occupied.some(other => span.from < other.to && other.from < span.to))) continue;
    let passage = Fragment.empty;
    const targetGroups = groups(doc, pointer.target.ranges);
    for (const range of targetGroups) {
      let content = withoutPointers(doc.slice(range.from, range.to).content);
      // Disjoint block selections need their own paragraph wrappers; appending
      // two inline fragments would silently join their words together.
      if (targetGroups.length > 1 && content.firstChild?.isInline) {
        content = Fragment.from(doc.resolve(range.from).parent.copy(content));
      }
      passage = passage.append(content);
    }
    const insertion = Slice.maxOpen(passage);
    spans.forEach((span, index) => replacements.push({ ...span, slice: index === 0 ? insertion : Slice.empty }));
    occupied.push(...spans);
  }
  if (!replacements.length) return slice;
  const transform = new Transform(snapshot);
  for (const replacement of replacements.sort((a, b) => b.from - a.from)) {
    transform.replaceRange(replacement.from, replacement.to, replacement.slice);
  }
  const maxOpen = Slice.maxOpen(transform.doc.content);
  return new Slice(transform.doc.content, Math.min(slice.openStart, maxOpen.openStart), Math.min(slice.openEnd, maxOpen.openEnd));
}
