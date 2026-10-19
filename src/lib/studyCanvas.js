export const studyVerseKey = (book, chapter, verse) => `${String(book).trim().toLowerCase()}|${Number(chapter)}|${Number(verse)}`;
export function studyEndpointKey(endpoint) {
  return endpoint?.kind === 'verse' ? `verse:${studyVerseKey(endpoint.book, endpoint.chapter, endpoint.verse)}` : `${endpoint?.kind}:${endpoint?.id}`;
}
export function studyEndpointFromElement(element) {
  const target = element?.closest?.('[data-study-object-id], [data-annotation-card-id], [data-study-verse-key]');
  if (!target) return null;
  if (target.dataset.studyObjectId) return { kind: 'object', id: Number(target.dataset.studyObjectId) };
  if (target.dataset.annotationCardId) return { kind: 'annotation', id: Number(target.dataset.annotationCardId) };
  const [book, chapter, verse] = target.dataset.studyVerseKey.split('|');
  return { kind: 'verse', book, chapter: Number(chapter), verse: Number(verse) };
}
export function studyConnectionPath(from, to, style = 'curvy') {
  const dx = to.x - from.x, dy = to.y - from.y;
  const edge = (a, b) => {
    const x = b.x - a.x, y = b.y - a.y;
    const scale = Math.min(x ? (a.width || 0) / 2 / Math.abs(x) : Infinity, y ? (a.height || 0) / 2 / Math.abs(y) : Infinity);
    return { x: a.x + x * (Number.isFinite(scale) ? Math.min(1, scale) : 0), y: a.y + y * (Number.isFinite(scale) ? Math.min(1, scale) : 0) };
  };
  const a = edge(from, to), b = edge(to, from);
  return style === 'straight' ? `M ${a.x} ${a.y} L ${b.x} ${b.y}`
    : `M ${a.x} ${a.y} C ${a.x + dx * .45} ${a.y + dy * .05}, ${b.x - dx * .45} ${b.y - dy * .05}, ${b.x} ${b.y}`;
}
