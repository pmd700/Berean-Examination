/**
 * Insert zero-width note markers at publisher offsets without adding tokens.
 * A marker can split a punctuation-bearing word; both pieces retain the same
 * stored highlight/annotation token index. Legacy notes without offsets retain
 * their original end-of-verse placement rather than guessing a relevant word.
 */
export function buildInlineVerseParts(text, notes = []) {
  const markers = notes.map((note, index) => ({ note, index,
    offset: Number.isInteger(note.offset) ? Math.max(0, Math.min(text.length, note.offset)) : text.length,
  })).sort((a, b) => a.offset - b.offset || a.index - b.index);
  const parts = [];
  let cursor = 0, markerIndex = 0;
  text.split(/(\s+)/).forEach((token, tokenIndex) => {
    const end = cursor + token.length;
    let start = cursor, firstPiece = true;
    const pushText = stop => {
      if (stop > start) {
        parts.push({ type: 'text', text: text.slice(start, stop), tokenIndex, firstPiece, key: `text-${tokenIndex}-${start}` });
        firstPiece = false;
      }
      start = stop;
    };
    while (markerIndex < markers.length && markers[markerIndex].offset <= end) {
      const marker = markers[markerIndex++];
      pushText(marker.offset);
      parts.push({ type: 'note', note: marker.note, key: `note-${marker.index}` });
    }
    pushText(end);
    cursor = end;
  });
  return parts;
}
