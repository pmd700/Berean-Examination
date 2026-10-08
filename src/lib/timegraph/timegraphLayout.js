/**
 * Placing event cards on the axis without them colliding.
 *
 * Two events a year apart are hundreds of pixels apart when zoomed in and on the
 * same pixel when zoomed out, so overlap can't be resolved once at authoring
 * time — it has to be recomputed for the current viewport on every frame. This
 * module does that as interval packing: each card claims a horizontal span, and
 * lanes are stacked outward from the axis until nothing overlaps.
 *
 * Kept free of React and of the DOM so the stacking rules can be tested
 * directly, and so the exporter lays out identically to the screen.
 */

import { eventSpan } from './timegraphDate.js';
import { yearToX } from './timegraphScale.js';

/** Vertical size of one stacked row, including the gap to the next. */
export const LANE_HEIGHT = 42;
/** Clear space between two cards in the same lane before they count as colliding. */
export const CARD_GAP = 12;
/** Height of a card, less than LANE_HEIGHT so lanes breathe. */
export const CARD_HEIGHT = 30;
/** Extra lower strip reserved when a card has tags. */
export const CARD_TAG_BAND_HEIGHT = 7;
/** Breathing room between vertically stacked cards, regardless of their size. */
export const CARD_VERTICAL_GAP = LANE_HEIGHT - CARD_HEIGHT;
/** How far the first lane sits from the axis, leaving room for the stem. */
export const AXIS_CLEARANCE = 34;

const MIN_CARD_WIDTH = 54;
const MAX_CARD_WIDTH = 320;

/**
 * Width a card needs for its title. The default is a metric estimate; the canvas
 * passes a real text measurer so what is packed matches what is painted.
 */
export function cardTagFontSize(scale = 1) {
  const safeScale = Number.isFinite(Number(scale)) ? Math.max(0.6, Number(scale)) : 1;
  return Math.max(7, Math.min(10, 8 * safeScale));
}

/** Keep a long tag list inside its card while still signalling that more exist. */
export function cardTagText(tags, maxLength = 44) {
  const text = (Array.isArray(tags) ? tags : [])
    .map((tag) => String(tag || '').trim())
    .filter(Boolean)
    .join(' · ');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

export function estimateCardWidth(title, {
  charWidth = 7.1, padding = 26, scale = 1, tags = [],
} = {}) {
  const text = String(title || 'Untitled').trim() || 'Untitled';
  const safeScale = Number.isFinite(Number(scale)) ? Math.max(0.6, Number(scale)) : 1;
  const titleWidth = (text.length * charWidth + padding) * safeScale;
  const tagText = cardTagText(tags);
  const tagWidth = tagText
    ? tagText.length * charWidth * (cardTagFontSize(safeScale) / 12.5) + padding * safeScale
    : 0;
  return Math.min(
    MAX_CARD_WIDTH * safeScale,
    Math.max(MIN_CARD_WIDTH * safeScale, titleWidth, tagWidth),
  );
}

/**
 * The amount each lane sits away from the axis. A fixed row height works only
 * while every card is 1x; sized-up cards need sized-up vertical reservations or
 * their visible boxes overlap even though the layout believes they do not.
 */
function measureLaneStack(items, gap = CARD_VERTICAL_GAP) {
  const heights = [];
  for (const item of items) {
    heights[item.lane] = Math.max(heights[item.lane] || 0, item.cardHeight || CARD_HEIGHT);
  }

  const offsets = [];
  let extent = 0;
  for (let lane = 0; lane < heights.length; lane += 1) {
    offsets[lane] = extent;
    extent += (heights[lane] || CARD_HEIGHT) + gap;
  }
  if (heights.length) extent -= gap;
  return { offsets, extent };
}

/**
 * Packs items into the fewest lanes such that no two in a lane overlap.
 *
 * Items must arrive sorted by `left`. Each lane remembers only its rightmost
 * edge, which is all a left-to-right sweep needs, making this O(n · lanes)
 * rather than O(n²) — the difference that keeps 1,000 events smooth.
 */
export function packIntoLanes(items, { gap = CARD_GAP, maxLanes = 64 } = {}) {
  const laneEdges = [];
  return items.map((item) => {
    let lane = laneEdges.findIndex((edge) => item.left >= edge + gap);
    if (lane === -1) {
      if (laneEdges.length >= maxLanes) {
        // Past the cap, pile onto the last lane rather than growing without
        // bound — a thousand events on one pixel must not produce 1,000 lanes.
        lane = maxLanes - 1;
        laneEdges[lane] = Math.max(laneEdges[lane] ?? -Infinity, item.right);
        return { ...item, lane };
      }
      lane = laneEdges.length;
    }
    laneEdges[lane] = item.right;
    return { ...item, lane };
  });
}

/**
 * Turns events into positioned, stacked cards for a viewport.
 *
 * Returns `{ placements, laneCount }` where a placement carries everything the
 * renderer and the exporter need: the axis anchor, the card box, the lane, and
 * the range bar when the event spans time.
 */
export function layoutEvents(events, viewport, {
  measureWidth = estimateCardWidth,
  laneHeight = LANE_HEIGHT,
  gap = CARD_GAP,
  overscanPx = 400,
  textScale = 1,
} = {}) {
  const safeTextScale = Number.isFinite(Number(textScale)) ? Math.max(0.5, Number(textScale)) : 1;
  const above = [];
  const below = [];

  for (const event of events || []) {
    const span = eventSpan(event);
    if (!span) continue;

    const startX = yearToX(viewport, span.start);
    const endX = span.isRange ? yearToX(viewport, span.end) : startX;

    // A card is centred on its anchor; a range's card sits over the bar's start
    // so long bars stay readable rather than drifting off with the midpoint.
    const width = measureWidth(event.title, event);
    const scale = event.scale || 1;
    const tagBandHeight = event.tags?.length
      ? CARD_TAG_BAND_HEIGHT * Math.min(scale, 1.5) * safeTextScale
      : 0;
    const cardHeight = CARD_HEIGHT * scale * safeTextScale + tagBandHeight;
    const anchorX = startX;
    const left = anchorX - width / 2;
    const right = Math.max(left + width, endX);

    // Skip what is far off screen, but keep an overscan margin so a card whose
    // anchor is just outside still contributes its lane — otherwise cards would
    // visibly re-stack as you pan.
    if (right < -overscanPx || left > viewport.width + overscanPx) continue;

    const item = {
      event,
      id: event.id,
      anchorX,
      startX,
      endX,
      left,
      right,
      width,
      cardHeight,
      tagBandHeight,
      isRange: span.isRange,
      span,
    };
    (event.position === 'below' ? below : above).push(item);
  }

  const byLeft = (a, b) => a.left - b.left || a.right - b.right;
  above.sort(byLeft);
  below.sort(byLeft);

  const packedAbove = packIntoLanes(above, { gap });
  const packedBelow = packIntoLanes(below, { gap });
  const verticalGap = Math.max(0, laneHeight - CARD_HEIGHT);
  const aboveStack = measureLaneStack(packedAbove, verticalGap);
  const belowStack = measureLaneStack(packedBelow, verticalGap);

  const axisY = viewport.height / 2;
  const placements = [];

  for (const item of packedAbove) {
    const cardBottom = axisY - AXIS_CLEARANCE - aboveStack.offsets[item.lane];
    placements.push({
      ...item,
      position: 'above',
      cardTop: cardBottom - item.cardHeight,
      cardBottom,
      stemFrom: cardBottom,
      stemTo: axisY,
    });
  }
  for (const item of packedBelow) {
    const cardTop = axisY + AXIS_CLEARANCE + belowStack.offsets[item.lane];
    placements.push({
      ...item,
      position: 'below',
      cardTop,
      cardBottom: cardTop + item.cardHeight,
      stemFrom: axisY,
      stemTo: cardTop,
    });
  }

  const laneCount = {
    above: packedAbove.reduce((max, item) => Math.max(max, item.lane + 1), 0),
    below: packedBelow.reduce((max, item) => Math.max(max, item.lane + 1), 0),
  };
  const laneExtents = { above: aboveStack.extent, below: belowStack.extent };

  return {
    placements,
    laneCount,
    laneExtents,
    neededHeight: requiredHeight(laneCount, { laneHeight, laneExtents }),
    axisY,
  };
}

/**
 * The height the graph needs so no lane is clipped. The editor uses this to grow
 * the canvas, and the exporter to size the image — which is what stops a PNG
 * from cutting off the top row of cards.
 */
export function requiredHeight(laneCount, {
  laneHeight = LANE_HEIGHT,
  laneExtents = null,
  minHeight = 320,
} = {}) {
  if (laneExtents) {
    const extent = Math.max(laneExtents.above || 0, laneExtents.below || 0);
    const half = AXIS_CLEARANCE + extent + 24;
    return Math.max(minHeight, half * 2);
  }
  const tallest = Math.max(laneCount?.above || 0, laneCount?.below || 0);
  const half = AXIS_CLEARANCE + tallest * laneHeight + CARD_HEIGHT + 24;
  return Math.max(minHeight, half * 2);
}

/** Hit-test: the topmost placement under a point, or null. */
export function placementAt(placements, x, y) {
  for (let i = placements.length - 1; i >= 0; i -= 1) {
    const placement = placements[i];
    if (
      x >= placement.left && x <= placement.left + placement.width
      && y >= placement.cardTop && y <= placement.cardBottom
    ) {
      return placement;
    }
  }
  return null;
}

/** The full year span covered by a set of events, for "Fit all events". */
export function eventsBounds(events) {
  let min = Infinity;
  let max = -Infinity;
  for (const event of events || []) {
    const span = eventSpan(event);
    if (!span) continue;
    min = Math.min(min, span.start);
    max = Math.max(max, span.end);
  }
  if (min === Infinity) return null;
  return { from: min, to: max };
}
