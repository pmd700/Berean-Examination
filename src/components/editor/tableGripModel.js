/**
 * The geometry behind the table's column and row grips.
 *
 * A grip is the little pill that appears on a table's top or left border when
 * the pointer is over a column or row: click it to select that band and open
 * its menu, drag it to move the band somewhere else.
 *
 * All of it is arithmetic over rectangles, so it lives here rather than in the
 * ProseMirror plugin — where every one of these decisions would otherwise only
 * be checkable by hand, against a real table, with a real mouse.
 */

export const GRIP_AXIS = Object.freeze({ COLUMN: 'column', ROW: 'row' });

/** The pill's thickness across the border, and the least it can be along it. */
export const GRIP_THICKNESS = 9;
// Enough for three rows of dots, so the grip still reads as something to grab.
const GRIP_MIN_LENGTH = 18;
// A share of the band rather than the whole of it: a pill running the full
// width reads as a bar capping the column instead of a handle on it.
const GRIP_LENGTH_RATIO = 0.8;

/**
 * Where the pill for one band is drawn, in viewport coordinates.
 *
 * The pill sits centred ON the table's border, straddling it, rather than
 * floating beside it in the margin — which is what makes it read as a handle
 * belonging to that edge instead of a stray button next to the table.
 *
 * Along the border it spans its band, clamped so a narrow one still gets a pill
 * big enough to aim at: a 20px column would otherwise be given a grip nobody
 * can hit.
 */
export function gripRect(axis, bandRect, tableRect) {
  if (!bandRect || !tableRect) return null;

  if (axis === GRIP_AXIS.COLUMN) {
    const width = Math.max(GRIP_MIN_LENGTH, bandRect.width * GRIP_LENGTH_RATIO);
    return {
      left: bandRect.left + (bandRect.width - width) / 2,
      top: tableRect.top - GRIP_THICKNESS / 2,
      width,
      height: GRIP_THICKNESS,
    };
  }

  const height = Math.max(GRIP_MIN_LENGTH, bandRect.height * GRIP_LENGTH_RATIO);
  return {
    left: tableRect.left - GRIP_THICKNESS / 2,
    top: bandRect.top + (bandRect.height - height) / 2,
    width: GRIP_THICKNESS,
    height,
  };
}

/**
 * The band a pointer is over, or null when it is past the last one.
 *
 * `bands` are the columns' or rows' extents along the dragged axis, in order.
 */
export function bandIndexAt(bands, position) {
  if (!Array.isArray(bands)) return null;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    if (position >= band.start && position <= band.end) return index;
  }
  return null;
}

/**
 * Where a band being dragged would land if it were released now.
 *
 * The pointer has to pass a neighbour's MIDPOINT before that neighbour gives up
 * its place. Swapping the moment the bands merely touch makes a slow drag
 * flicker between two positions, because the swap immediately moves the band
 * back under the pointer and re-triggers itself.
 */
export function dropIndexForPointer(bands, from, position) {
  if (!Array.isArray(bands) || !bands.length) return from;
  if (!Number.isInteger(from) || from < 0 || from >= bands.length) return from;

  let target = from;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const middle = band.start + (band.end - band.start) / 2;
    if (index < from && position < middle) return index;
    if (index > from && position > middle) target = index;
  }
  return target;
}

/**
 * The line showing where a dragged band will drop.
 *
 * Drawn on the leading edge of the target when moving forward and the trailing
 * edge when moving back, which is the edge the band will end up against.
 */
export function dropMarkerRect(axis, bands, from, to, tableRect) {
  if (!tableRect || from === to) return null;
  const band = bands?.[to];
  if (!band) return null;

  const edge = to > from ? band.end : band.start;
  if (axis === GRIP_AXIS.COLUMN) {
    return { left: edge - 1, top: tableRect.top, width: 2, height: tableRect.height };
  }
  return { left: tableRect.left, top: edge - 1, width: tableRect.width, height: 2 };
}

/** Reads a DOMRect-shaped object into the axis it is being dragged along. */
export function bandFromRect(axis, rect) {
  return axis === GRIP_AXIS.COLUMN
    ? { start: rect.left, end: rect.right }
    : { start: rect.top, end: rect.bottom };
}
