// Resolve the selected text, rather than assuming browser Range boundaries
// always sit inside word spans. Spaces and whole-verse selections do not.
export function selectedScriptureTokens(range, root) {
  if (!range || range.collapsed || !root?.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const tokens = [];
  for (const element of root.querySelectorAll('[data-token-key]')) {
    if (!range.intersectsNode(element)) continue;
    const intersection = element.ownerDocument.createRange();
    intersection.selectNodeContents(element);
    if (intersection.compareBoundaryPoints(0, range) < 0) intersection.setStart(range.startContainer, range.startOffset);
    if (intersection.compareBoundaryPoints(2, range) > 0) intersection.setEnd(range.endContainer, range.endOffset);
    if (!intersection.toString().trim()) continue;
    const match = element.getAttribute('data-token-key')?.match(/^token-(\d+)-(\d+)(?:-|$)/);
    if (match) tokens.push({ verse: Number(match[1]), token: Number(match[2]),
      chapterId: element.closest('[data-study-chapter-id]')?.getAttribute('data-study-chapter-id') });
  }
  if (!tokens.length) return null;
  const first = tokens[0], last = tokens[tokens.length - 1];
  if (tokens.some(token => token.chapterId !== first.chapterId)) return { crossChapter: true };
  return { chapterId: first.chapterId, startVerse: first.verse, startToken: first.token, endVerse: last.verse, endToken: last.token };
}
