// Marquee-selected points are a separate selection from individually clicked
// objects. Keep them together with any cards selected by the same marquee.
export function canvasDeleteSelection({ cardIds = [], pointIds = [], cardId, objectId, connectionId }) {
  if (cardIds.length || pointIds.length) {
    return { cardIds: [...new Set(cardIds)], objectIds: [...new Set(pointIds)] };
  }
  if (cardId != null) return { cardIds: [cardId], objectIds: [] };
  if (objectId != null) return { cardIds: [], objectIds: [objectId] };
  return connectionId != null ? { connectionId } : null;
}
