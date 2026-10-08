import { useMemo } from 'react';

// Endpoints can be cards or routing points; key them by `${kind}:${id}` so
// numeric collisions across the two sequences never confuse each other.
const endpointKey = (kind, id) => `${kind || 'card'}:${id}`;
const fromKey = (c) => endpointKey(c.from_kind, c.from_card_id);
const toKey = (c) => endpointKey(c.to_kind, c.to_card_id);

// Compute cards within N steps from a focus card. Walks across both card and
// point endpoints — a point in the path counts as a hop, but only cards end
// up in the returned visible set (points are always rendered when visible).
function getNeighborhood(focusCardId, allConnections, depth) {
  const focusKey = endpointKey('card', focusCardId);
  const visited = new Set([focusKey]);
  let frontier = new Set([focusKey]);

  for (let step = 0; step < depth; step++) {
    const nextFrontier = new Set();
    for (const key of frontier) {
      for (const conn of allConnections) {
        const fk = fromKey(conn);
        const tk = toKey(conn);
        if (fk === key && !visited.has(tk)) { nextFrontier.add(tk); visited.add(tk); }
        if (tk === key && !visited.has(fk)) { nextFrontier.add(fk); visited.add(fk); }
      }
    }
    frontier = nextFrontier;
  }
  return visited;
}

export default function useFilteredGraph(cards, connections, filters, focusState) {
  return useMemo(() => {
    let visibleEndpointKeys = null; // null = all visible

    // Apply focus first — neighborhood walk uses kind-aware endpoint keys.
    if (focusState.active && focusState.cardId) {
      visibleEndpointKeys = getNeighborhood(focusState.cardId, connections, focusState.depth);
    }

    // Apply tag filter
    const hasTagFilter = filters.tags && filters.tags.length > 0;

    let filteredCards = cards;

    if (visibleEndpointKeys) {
      filteredCards = filteredCards.filter(c => visibleEndpointKeys.has(endpointKey('card', c.id)));
    }

    if (hasTagFilter) {
      filteredCards = filteredCards.filter(c =>
        (c.tags || []).some(t => filters.tags.includes(t))
      );
    }

    const visibleCardKeys = new Set(filteredCards.map(c => endpointKey('card', c.id)));

    // A connection survives if every endpoint is either a card that's still
    // visible, or a point (points aren't filtered by tag/type/focus). We
    // don't have the points list here, so trust point endpoints implicitly.
    const isEndpointVisible = (kind, id) => {
      const k = kind || 'card';
      if (k === 'card') return visibleCardKeys.has(endpointKey('card', id));
      return true;
    };
    const filteredConnections = connections.filter(
      c => isEndpointVisible(c.from_kind, c.from_card_id) && isEndpointVisible(c.to_kind, c.to_card_id)
    );

    return { filteredCards, filteredConnections, visibleCardIds: new Set(filteredCards.map(c => c.id)) };
  }, [cards, connections, filters, focusState]);
}