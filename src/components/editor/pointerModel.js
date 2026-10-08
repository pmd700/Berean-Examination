/** Pointer identities live on the text, never at saved character offsets. */
export const POINTER_MARK = 'pointerAnchor';
export const validPointerId = id => typeof id === 'string' && /^[\w-]{1,100}$/.test(id);
export const newPointerId = () => `ptr-${globalThis.crypto.randomUUID()}`;

export function collectPointers(doc) {
  const pointers = new Map();
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      const { id, role } = mark.attrs;
      if (mark.type.name !== POINTER_MARK || !validPointerId(id) || !['source', 'target'].includes(role)) continue;
      if (!pointers.has(id)) pointers.set(id, { id, source: { ranges: [], text: '' }, target: { ranges: [], text: '' } });
      const pointer = pointers.get(id);
      if (mark.attrs.echoCopy) pointer.echoCopy = true;
      const endpoint = pointer[role];
      const last = endpoint.ranges.at(-1);
      const contiguous = last?.to === pos;
      if (contiguous) last.to = pos + node.nodeSize;
      else endpoint.ranges.push({ from: pos, to: pos + node.nodeSize });
      endpoint.text += `${last && !contiguous ? ' ' : ''}${node.text}`;
    }
  });
  return [...pointers.values()];
}

export function textRanges(doc, ranges) {
  const result = [];
  for (const range of ranges) {
    doc.nodesBetween(range.from, range.to, (node, pos) => {
      if (!node.isText) return;
      const from = Math.max(range.from, pos);
      const to = Math.min(range.to, pos + node.nodeSize);
      if (from >= to) return;
      const last = result.at(-1);
      if (last && from <= last.to) last.to = Math.max(last.to, to);
      else result.push({ from, to });
    });
  }
  return result;
}

export const rangesOverlap = (a, b) => a.some(x => b.some(y => x.from < y.to && y.from < x.to));
export const completePointer = pointer => pointer.source.ranges.length > 0 && pointer.target.ranges.length > 0;

/** Choose the gutter with the shortest combined travel from both text anchors. */
export function pointerGutterSide(source, target, { left, right }) {
  const leftDistance = source.left + target.left - 2 * left;
  const rightDistance = 2 * right - source.right - target.right;
  if (Math.abs(leftDistance - rightDistance) < 0.5) {
    return (source.left + source.right) / 2 > (left + right) / 2 ? 'right' : 'left';
  }
  return rightDistance < leftDistance ? 'right' : 'left';
}

/** Coordinates are local to the SVG, which scrolls and zooms with the text. */
export function pointerPath(source, target, { gutter, side = 'left', lane = 0, forceGutter = false } = {}) {
  const sx = (source.left + source.right) / 2;
  const tx = (target.left + target.right) / 2;
  const lineHeight = Math.max(14, source.bottom - source.top, target.bottom - target.top);
  const sameLine = Math.abs(source.top - target.top) < lineHeight * 0.4;
  if (!forceGutter && sameLine) {
    const sy = Math.min(source.top, target.top) - 2;
    const bounce = Math.min(25, Math.max(12, Math.abs(tx - sx) * 0.18));
    return { kind: 'bounce', d: `M ${sx} ${sy} Q ${(sx + tx) / 2} ${sy - bounce * 2} ${tx} ${sy}`, start: { x: sx, y: sy } };
  }
  if (!forceGutter && Math.abs(target.top - source.top) <= lineHeight * 4) {
    const downward = target.top > source.top;
    const sy = downward ? source.bottom + 2 : source.top - 2;
    const ty = downward ? target.top - 2 : target.bottom + 2;
    return { kind: 'diagonal', d: `M ${sx} ${sy} L ${tx} ${ty}`, start: { x: sx, y: sy } };
  }
  const outward = side === 'right' ? 1 : -1;
  const x = gutter + outward * lane * 9;
  const startX = side === 'right' ? source.right : source.left;
  const endX = (side === 'right' ? target.right : target.left) + (target.caret ? 0 : outward * 3);
  const sy = source.caret ? (source.top + source.bottom) / 2 : source.bottom + 3;
  const ty = target.caret ? (target.top + target.bottom) / 2 : target.bottom + 3;
  const direction = ty >= sy ? 1 : -1;
  const radius = Math.min(10, Math.abs(ty - sy) / 2);
  return {
    kind: 'gutter', side, start: { x: startX, y: sy },
    d: `M ${startX} ${sy} H ${x - outward * radius} Q ${x} ${sy} ${x} ${sy + radius * direction} V ${ty - radius * direction} Q ${x} ${ty} ${x - outward * radius} ${ty} H ${endX}`,
  };
}
