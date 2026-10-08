import { displayCardTitle } from './cardTitle.js';

export const DEFAULT_CARD_WIDTH = 200;
export const DEFAULT_CARD_HEIGHT = 120;

const GEOMETRY_VERSION = 2;
const SMART_CORNER_RADIUS = 10;
const CORNER_STEPS = 12;
const TITLE_CHAR_WIDTH = 8.25;
const TITLE_LINE_HEIGHT = 20;
const TITLE_PADDING_X = 10;
const TITLE_PADDING_TOP = 10;
const TITLE_PADDING_BOTTOM = 10;
const MIN_BAND_RIGHT = 36;
const MERGE_RIGHT_EPSILON = 1;
const NUMBER_EPSILON = 1e-6;

function finiteNumber(value, fallback) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveNumber(value, fallback) {
  const parsed = finiteNumber(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function cleanNumber(value) {
  // DOM measurements frequently contain long sub-pixel tails. Keeping three
  // decimal places makes SVG/CSS output stable without visibly changing it.
  return Math.round(value * 1000) / 1000;
}

function hashString(value) {
  // A small deterministic FNV-1a hash keeps signatures cheap even when a card
  // has a long rich-text description.
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function cardLayoutMode(card) {
  return card?.layout_mode === 'manual' ? 'manual' : 'smart';
}

/**
 * Return a cache signature for every value that can affect a card's measured
 * geometry. Missing/legacy layout modes deliberately resolve to smart mode.
 */
export function getCardGeometrySignature(card = {}) {
  const mode = cardLayoutMode(card);
  const width = positiveNumber(card?.width, DEFAULT_CARD_WIDTH);
  const height = mode === 'manual'
    ? positiveNumber(card?.height, DEFAULT_CARD_HEIGHT)
    : null;
  const payload = JSON.stringify({
    version: GEOMETRY_VERSION,
    mode,
    title: displayCardTitle(card?.title),
    width: cleanNumber(width),
    height: height == null ? null : cleanNumber(height),
    // Hidden content cannot affect a smart card's size or invalidate its
    // measurement cache. Manual cards retain their ordinary preview layout.
    ...(mode === 'manual' ? {
      description: typeof card?.description === 'string' ? card.description : '',
      tags: Array.isArray(card?.tags) ? card.tags.map((tag) => String(tag)) : [],
      imageUrl: typeof card?.image_url === 'string' ? card.image_url : '',
    } : {}),
  });

  return `smart-card-v${GEOMETRY_VERSION}:${hashString(payload)}`;
}

function rectangleGeometry(width, height, signature, mode = 'smart') {
  const safeWidth = positiveNumber(width, DEFAULT_CARD_WIDTH);
  const safeHeight = positiveNumber(height, DEFAULT_CARD_HEIGHT);
  return buildGeometry(
    [{ top: 0, bottom: safeHeight, right: safeWidth }],
    signature,
    mode,
  );
}

function buildPolygon(bands) {
  const points = [
    { x: 0, y: 0 },
    { x: bands[0].right, y: 0 },
  ];

  bands.forEach((band, index) => {
    points.push({ x: band.right, y: band.bottom });
    const nextBand = bands[index + 1];
    if (nextBand && Math.abs(nextBand.right - band.right) > NUMBER_EPSILON) {
      points.push({ x: nextBand.right, y: band.bottom });
    }
  });

  points.push({ x: 0, y: bands[bands.length - 1].bottom });
  return points.map(({ x, y }) => ({ x: cleanNumber(x), y: cleanNumber(y) }));
}

/** Round outer corners AND the inward notches without erasing the steps. */
function roundOutline(polygon) {
  const contour = [];
  const commands = [];
  const coordinate = point => `${cleanNumber(point.x)} ${cleanNumber(point.y)}`;
  polygon.forEach((corner, index) => {
    const previous = polygon[(index + polygon.length - 1) % polygon.length];
    const next = polygon[(index + 1) % polygon.length];
    const incoming = Math.hypot(previous.x - corner.x, previous.y - corner.y);
    const outgoing = Math.hypot(next.x - corner.x, next.y - corner.y);
    // Half-edge caps keep neighbouring curves from crossing on tiny steps.
    const radius = Math.min(SMART_CORNER_RADIUS, incoming / 2, outgoing / 2);
    const toward = (point, distance) => ({
      x: corner.x + (point.x - corner.x) * radius / (distance || 1),
      y: corner.y + (point.y - corner.y) * radius / (distance || 1),
    });
    const entry = toward(previous, incoming);
    const exit = toward(next, outgoing);
    commands.push(`${index ? 'L' : 'M'} ${coordinate(entry)} Q ${coordinate(corner)} ${coordinate(exit)}`);
    contour.push(entry);
    // A sub-pixel contour of the same quadratic is used by canvas hit tests
    // and connection ports (maximum deviation < 0.03px at this radius).
    for (let step = 1; step <= CORNER_STEPS; step++) {
      const t = step / CORNER_STEPS;
      contour.push({
        x: (1 - t) ** 2 * entry.x + 2 * (1 - t) * t * corner.x + t ** 2 * exit.x,
        y: (1 - t) ** 2 * entry.y + 2 * (1 - t) * t * corner.y + t ** 2 * exit.y,
      });
    }
  });
  return { path: `${commands.join(' ')} Z`, contour };
}

function buildGeometry(bands, signature, mode) {
  const width = Math.max(...bands.map((band) => band.right));
  const height = bands[bands.length - 1].bottom;
  const polygon = buildPolygon(bands);
  const coordinateList = polygon.map(({ x, y }) => `${cleanNumber(x)} ${cleanNumber(y)}`);
  const clipCoordinates = polygon.map(({ x, y }) => `${cleanNumber(x)}px ${cleanNumber(y)}px`);
  const rounded = mode === 'smart' ? roundOutline(polygon) : null;

  return {
    mode,
    width: cleanNumber(width),
    height: cleanNumber(height),
    bands: bands.map(({ top, bottom, right }) => ({
      top: cleanNumber(top),
      bottom: cleanNumber(bottom),
      right: cleanNumber(right),
    })),
    polygon,
    path: rounded?.path || `M ${coordinateList.join(' L ')} Z`,
    clipPath: rounded ? `path("${rounded.path}")` : `polygon(${clipCoordinates.join(', ')})`,
    contour: rounded?.contour,
    center: { x: cleanNumber(width / 2), y: cleanNumber(height / 2) },
    bottomRight: {
      x: cleanNumber(bands[bands.length - 1].right),
      y: cleanNumber(height),
    },
    signature: String(signature || ''),
  };
}

function normalizeLineBands(lineBands) {
  if (!Array.isArray(lineBands)) return [];

  const validBands = lineBands
    .map((band) => ({
      top: finiteNumber(band?.top, NaN),
      bottom: finiteNumber(band?.bottom, NaN),
      right: finiteNumber(band?.right, NaN),
    }))
    .filter((band) => (
      Number.isFinite(band.top)
      && Number.isFinite(band.bottom)
      && Number.isFinite(band.right)
      && band.bottom > band.top
      && band.right > 0
    ))
    .map((band) => ({
      top: Math.max(0, band.top),
      bottom: band.bottom,
      right: band.right,
    }))
    .filter((band) => band.bottom > band.top)
    .sort((left, right) => left.top - right.top || left.bottom - right.bottom);

  const contiguous = [];
  validBands.forEach((band) => {
    if (contiguous.length === 0) {
      // The first text line may begin below the card's padding. Its edge owns
      // that top padding too, keeping the silhouette closed at y=0.
      contiguous.push({ ...band, top: 0 });
      return;
    }

    const previous = contiguous[contiguous.length - 1];
    if (band.top > previous.bottom) {
      // Fill inter-line leading with the preceding line's profile rather than
      // creating a zero-width slit in the card.
      previous.bottom = band.top;
    }

    const top = Math.max(previous.bottom, band.top);
    if (band.bottom > top) contiguous.push({ ...band, top });
  });

  const merged = [];
  contiguous.forEach((band) => {
    const previous = merged[merged.length - 1];
    if (
      previous
      && Math.abs(previous.bottom - band.top) <= NUMBER_EPSILON
      && Math.abs(previous.right - band.right) <= MERGE_RIGHT_EPSILON
    ) {
      // Preserve the larger edge so sub-pixel merging can never clip text.
      previous.right = Math.max(previous.right, band.right);
      previous.bottom = Math.max(previous.bottom, band.bottom);
      return;
    }
    merged.push({ ...band });
  });

  return merged;
}

/**
 * Build authoritative local card geometry from measured horizontal line
 * bands. Bands are the filled intervals from x=0 through `right` between
 * `top` and `bottom`; their right edges form the stepped silhouette.
 */
export function geometryFromLineBands(lineBands, options = {}) {
  const signature = options.signature || '';
  const mode = options.mode === 'manual' ? 'manual' : 'smart';
  const fallbackWidth = positiveNumber(options.fallbackWidth, DEFAULT_CARD_WIDTH);
  const fallbackHeight = positiveNumber(options.fallbackHeight, DEFAULT_CARD_HEIGHT);
  const bands = normalizeLineBands(lineBands);

  if (bands.length === 0) {
    return rectangleGeometry(fallbackWidth, fallbackHeight, signature, mode);
  }

  return buildGeometry(bands, signature, mode);
}

function wrapParagraph(paragraph, maximumCharacters) {
  if (!paragraph.trim()) return [''];

  const words = paragraph.trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';

  words.forEach((word) => {
    let remainder = word;
    while (remainder.length > maximumCharacters) {
      if (current) {
        lines.push(current);
        current = '';
      }
      lines.push(remainder.slice(0, maximumCharacters));
      remainder = remainder.slice(maximumCharacters);
    }

    if (!remainder) return;
    const candidate = current ? `${current} ${remainder}` : remainder;
    if (candidate.length <= maximumCharacters) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = remainder;
    }
  });

  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

function wrapTitle(title, maximumCharacters) {
  return String(title)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .flatMap((paragraph) => wrapParagraph(paragraph, maximumCharacters));
}

/**
 * Produce a deterministic geometry before/without a browser measurement.
 * Manual cards remain rectangles. Smart/legacy cards estimate the same
 * stepped title silhouette that the renderer will later refine from glyphs.
 */
export function estimateSmartCardGeometry(card = {}) {
  const signature = getCardGeometrySignature(card);
  const mode = cardLayoutMode(card);
  const wrapWidth = positiveNumber(card?.width, DEFAULT_CARD_WIDTH);

  if (mode === 'manual') {
    return rectangleGeometry(
      wrapWidth,
      positiveNumber(card?.height, DEFAULT_CARD_HEIGHT),
      signature,
      'manual',
    );
  }

  const title = displayCardTitle(card?.title);
  const availableTextWidth = Math.max(TITLE_CHAR_WIDTH, wrapWidth - TITLE_PADDING_X * 2);
  const maximumCharacters = Math.max(1, Math.floor(availableTextWidth / TITLE_CHAR_WIDTH));
  const lines = wrapTitle(title, maximumCharacters);

  const bands = lines.map((line, index) => {
    const estimatedTextWidth = Math.max(TITLE_CHAR_WIDTH, line.length * TITLE_CHAR_WIDTH);
    const right = Math.min(
      wrapWidth,
      Math.max(MIN_BAND_RIGHT, estimatedTextWidth + TITLE_PADDING_X * 2),
    );
    const top = index === 0
      ? 0
      : TITLE_PADDING_TOP + index * TITLE_LINE_HEIGHT;
    const bottom = TITLE_PADDING_TOP
      + (index + 1) * TITLE_LINE_HEIGHT
      + (index === lines.length - 1 ? TITLE_PADDING_BOTTOM : 0);
    return { top, bottom, right };
  });

  return geometryFromLineBands(bands, {
    signature,
    fallbackWidth: wrapWidth,
    fallbackHeight: DEFAULT_CARD_HEIGHT,
  });
}

/** Return the local x-coordinate of the stepped right edge at local y. */
export function getGeometryRightAtY(geometry, localY) {
  const bands = Array.isArray(geometry?.bands) ? geometry.bands : [];
  if (bands.length === 0) return positiveNumber(geometry?.width, DEFAULT_CARD_WIDTH);

  const height = positiveNumber(geometry?.height, bands[bands.length - 1].bottom);
  const y = clamp(finiteNumber(localY, height / 2), 0, height);
  const boundary = contourSpan(geometry, 'y', y);
  if (boundary) return boundary.max;
  if (Math.abs(y - height) <= NUMBER_EPSILON) return bands[bands.length - 1].right;

  const band = bands.find((candidate) => y >= candidate.top && y < candidate.bottom);
  if (band) return band.right;
  if (y < bands[0].top) return bands[0].right;
  return bands[bands.length - 1].right;
}

/** Intersect the rounded contour with a horizontal/vertical line. */
function contourSpan(geometry, axis, value) {
  const points = geometry?.contour;
  if (!points?.length) return null;
  const other = axis === 'y' ? 'x' : 'y';
  let min = Infinity; let max = -Infinity;
  const include = coordinate => { min = Math.min(min, coordinate); max = Math.max(max, coordinate); };
  points.forEach((a, index) => {
    const b = points[(index + 1) % points.length];
    if (value < Math.min(a[axis], b[axis]) - NUMBER_EPSILON || value > Math.max(a[axis], b[axis]) + NUMBER_EPSILON) return;
    if (Math.abs(a[axis] - b[axis]) <= NUMBER_EPSILON) {
      if (Math.abs(value - a[axis]) <= NUMBER_EPSILON) { include(a[other]); include(b[other]); }
    } else {
      const t = clamp((value - a[axis]) / (b[axis] - a[axis]), 0, 1);
      include(a[other] + t * (b[other] - a[other]));
    }
  });
  return Number.isFinite(min) ? { min, max } : null;
}

/** Return the usable length of one of the four canonical connection sides. */
export function getGeometrySideSpan(geometry, side) {
  const bands = Array.isArray(geometry?.bands) && geometry.bands.length > 0
    ? geometry.bands
    : [{
        top: 0,
        bottom: positiveNumber(geometry?.height, DEFAULT_CARD_HEIGHT),
        right: positiveNumber(geometry?.width, DEFAULT_CARD_WIDTH),
      }];
  if (side === 'top') return positiveNumber(bands[0].right, geometry?.width || DEFAULT_CARD_WIDTH);
  if (side === 'bottom') {
    return positiveNumber(bands[bands.length - 1].right, geometry?.width || DEFAULT_CARD_WIDTH);
  }
  return positiveNumber(geometry?.height, bands[bands.length - 1].bottom);
}

/**
 * Convert a local click/drag point into the nearest canonical edge anchor.
 * Top and bottom ratios use the width of that actual band—not the silhouette's
 * maximum width—so a stored anchor round-trips to the point the user chose.
 */
export function getClosestGeometryAnchor(geometry, localX, localY) {
  const height = positiveNumber(geometry?.height, DEFAULT_CARD_HEIGHT);
  const x = finiteNumber(localX, 0);
  const y = clamp(finiteNumber(localY, height / 2), 0, height);
  const topSpan = getGeometrySideSpan(geometry, 'top');
  const bottomSpan = getGeometrySideSpan(geometry, 'bottom');
  const candidates = [
    { side: 'left', ratio: y / height },
    { side: 'right', ratio: y / height },
    { side: 'top', ratio: x / topSpan },
    { side: 'bottom', ratio: x / bottomSpan },
  ].map(candidate => {
    const point = getGeometryPort(geometry, candidate.side, candidate.ratio);
    return { ...candidate, distance: Math.hypot(x - point.x, y - point.y) };
  });
  const closest = candidates.reduce((best, candidate) => (
    candidate.distance < best.distance ? candidate : best
  ));
  return {
    side: closest.side,
    ratio: cleanNumber(clamp(closest.ratio, 0, 1)),
  };
}

/** Return a local connection point on the requested silhouette boundary. */
export function getGeometryPort(geometry, side, ratio = 0.5) {
  const bands = Array.isArray(geometry?.bands) && geometry.bands.length > 0
    ? geometry.bands
    : [{ top: 0, bottom: positiveNumber(geometry?.height, DEFAULT_CARD_HEIGHT), right: positiveNumber(geometry?.width, DEFAULT_CARD_WIDTH) }];
  const height = positiveNumber(geometry?.height, bands[bands.length - 1].bottom);
  const safeRatio = clamp(finiteNumber(ratio, 0.5), 0, 1);
  const normalizedSide = ['top', 'right', 'bottom', 'left'].includes(side) ? side : 'right';
  const y = height * safeRatio;

  if (normalizedSide === 'top') {
    const x = bands[0].right * safeRatio;
    return { x: cleanNumber(x), y: cleanNumber(contourSpan(geometry, 'x', x)?.min || 0), side: 'top', ratio: safeRatio };
  }
  if (normalizedSide === 'bottom') {
    return {
      x: cleanNumber(bands[bands.length - 1].right * safeRatio),
      y: cleanNumber(contourSpan(geometry, 'x', bands[bands.length - 1].right * safeRatio)?.max ?? height),
      side: 'bottom',
      ratio: safeRatio,
    };
  }
  if (normalizedSide === 'left') {
    return { x: cleanNumber(contourSpan(geometry, 'y', y)?.min || 0), y: cleanNumber(y), side: 'left', ratio: safeRatio };
  }
  return {
    x: cleanNumber(getGeometryRightAtY(geometry, y)),
    y: cleanNumber(y),
    side: 'right',
    ratio: safeRatio,
  };
}

/** Test a point against the actual stepped fill, not its bounding rectangle. */
export function pointInCardGeometry(geometry, localX, localY) {
  const x = finiteNumber(localX, NaN);
  const y = finiteNumber(localY, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

  const height = positiveNumber(geometry?.height, DEFAULT_CARD_HEIGHT);
  if (x < -NUMBER_EPSILON || y < -NUMBER_EPSILON || y > height + NUMBER_EPSILON) return false;
  const span = contourSpan(geometry, 'y', y);
  if (span) return x >= span.min - NUMBER_EPSILON && x <= span.max + NUMBER_EPSILON;
  return x <= getGeometryRightAtY(geometry, y) + NUMBER_EPSILON;
}

function normalizeRect(rect) {
  if (!rect || typeof rect !== 'object') return null;
  const rawLeft = finiteNumber(rect.left, finiteNumber(rect.x, NaN));
  const rawTop = finiteNumber(rect.top, finiteNumber(rect.y, NaN));
  const rawRight = finiteNumber(rect.right, rawLeft + finiteNumber(rect.width, NaN));
  const rawBottom = finiteNumber(rect.bottom, rawTop + finiteNumber(rect.height, NaN));
  if (![rawLeft, rawTop, rawRight, rawBottom].every(Number.isFinite)) return null;
  return {
    left: Math.min(rawLeft, rawRight),
    right: Math.max(rawLeft, rawRight),
    top: Math.min(rawTop, rawBottom),
    bottom: Math.max(rawTop, rawBottom),
  };
}

function segmentIntersectsRect(a, b, rect) {
  // Clip a segment against the four rectangle sides, retaining corner touches.
  let near = 0; let far = 1;
  for (const [delta, distance] of [
    [a.x - b.x, a.x - rect.left], [b.x - a.x, rect.right - a.x],
    [a.y - b.y, a.y - rect.top], [b.y - a.y, rect.bottom - a.y],
  ]) {
    if (Math.abs(delta) <= NUMBER_EPSILON) { if (distance < -NUMBER_EPSILON) return false; }
    else if (delta < 0) near = Math.max(near, distance / delta);
    else far = Math.min(far, distance / delta);
    if (near > far + NUMBER_EPSILON) return false;
  }
  return true;
}

/** Test a marquee against the painted shape, including its rounded notches. */
export function rectIntersectsCardGeometry(geometry, rect) {
  const normalized = normalizeRect(rect);
  if (!normalized) return false;

  if (
    Math.abs(normalized.right - normalized.left) <= NUMBER_EPSILON
    && Math.abs(normalized.bottom - normalized.top) <= NUMBER_EPSILON
  ) {
    return pointInCardGeometry(geometry, normalized.left, normalized.top);
  }

  if (geometry?.contour?.length) {
    if ([[normalized.left, normalized.top], [normalized.right, normalized.top],
      [normalized.left, normalized.bottom], [normalized.right, normalized.bottom]]
      .some(([x, y]) => pointInCardGeometry(geometry, x, y))) return true;
    return geometry.contour.some((a, index, points) => segmentIntersectsRect(a, points[(index + 1) % points.length], normalized));
  }

  const bands = Array.isArray(geometry?.bands) && geometry.bands.length > 0
    ? geometry.bands
    : [{
        top: 0,
        bottom: positiveNumber(geometry?.height, DEFAULT_CARD_HEIGHT),
        right: positiveNumber(geometry?.width, DEFAULT_CARD_WIDTH),
      }];

  return bands.some((band) => {
    const verticallyOverlaps = normalized.bottom >= band.top - NUMBER_EPSILON
      && normalized.top <= band.bottom + NUMBER_EPSILON;
    const horizontallyOverlaps = normalized.right >= -NUMBER_EPSILON
      && normalized.left <= band.right + NUMBER_EPSILON;
    return verticallyOverlaps && horizontallyOverlaps;
  });
}
