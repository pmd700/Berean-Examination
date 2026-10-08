export const ESTIMATED_COMMENT_CARD_HEIGHT = 152;

const finite = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

/**
 * Bundle comment cards whose natural anchor positions would make them overlap.
 * Each returned group stays anchored to its first parent-text position.
 */
export function bundleNearbyComments(
  items,
  { gap = 8, fallbackHeight = ESTIMATED_COMMENT_CARD_HEIGHT } = {},
) {
  const ordered = [...(items || [])].sort((left, right) => (
    finite(left.anchorTop) - finite(right.anchorTop)
  ));
  const groups = [];

  ordered.forEach((item) => {
    const anchorTop = finite(item.anchorTop);
    const height = Math.max(1, finite(item.height, fallbackHeight));
    const previous = groups[groups.length - 1];

    if (previous && anchorTop < previous.occupiedBottom + gap) {
      previous.ids.push(item.id);
      previous.occupiedBottom = Math.max(previous.occupiedBottom, anchorTop + height);
      return;
    }

    groups.push({
      ids: [item.id],
      anchorTop,
      occupiedBottom: anchorTop + height,
    });
  });

  return groups.map(({ ids, anchorTop }) => ({ ids, anchorTop }));
}

