/**
 * The Timegraph viewport: how a year becomes an x coordinate, and what the axis
 * should be ticked in at the current zoom.
 *
 * Zoom is stored as `yearsPerPixel` rather than a zoom "level". Across a span of
 * 200 billion years a level number would need a wildly non-linear mapping,
 * whereas years-per-pixel is the quantity every calculation here actually wants
 * and it stays meaningful at both extremes: minute-level UTC near the present
 * and 1e9 (the age of the universe across the screen).
 */

import { MIN_YEAR, MAX_YEAR, daysInMonth, formatLargeYear } from './timegraphDate.js';

const APPROX_DAYS_PER_YEAR = 365.2425;
const MINUTES_PER_DAY = 24 * 60;
const APPROX_MINUTES_PER_YEAR = APPROX_DAYS_PER_YEAR * MINUTES_PER_DAY;

/** Finest zoom: one UTC minute is a full, readable axis interval. */
export const MIN_YEARS_PER_PIXEL = 1 / (APPROX_MINUTES_PER_YEAR * 140);
/** Coarsest zoom: the whole legal range fits a 1000px viewport. */
export const MAX_YEARS_PER_PIXEL = (MAX_YEAR - MIN_YEAR) / 1000;

/** Roughly how far apart axis ticks should sit, in pixels. */
const TARGET_TICK_SPACING = 130;

// A Mac trackpad pinch reaches Chromium as a Ctrl-modified wheel gesture with
// much smaller deltas than ordinary two-finger scrolling. Keep the established
// wheel feel, but amplify only pinch gestures so both inputs feel responsive.
const WHEEL_ZOOM_STRENGTH = 0.0016;
const PINCH_ZOOM_STRENGTH = 0.005;

export function zoomFactorFromWheel(deltaY, { pinch = false } = {}) {
  const delta = Number(deltaY);
  if (Number.isFinite(delta) === false) return 1;
  return Math.exp(delta * (pinch ? PINCH_ZOOM_STRENGTH : WHEEL_ZOOM_STRENGTH));
}

export function clampYearsPerPixel(value) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(MAX_YEARS_PER_PIXEL, Math.max(MIN_YEARS_PER_PIXEL, value));
}

export function createViewport({ centerYear = 0, yearsPerPixel = 1, width = 1000, height = 520 } = {}) {
  return {
    centerYear: Number.isFinite(centerYear) ? centerYear : 0,
    yearsPerPixel: clampYearsPerPixel(yearsPerPixel),
    width: Math.max(1, width),
    height: Math.max(1, height),
  };
}

export function yearToX(viewport, year) {
  return viewport.width / 2 + (year - viewport.centerYear) / viewport.yearsPerPixel;
}

export function xToYear(viewport, x) {
  return viewport.centerYear + (x - viewport.width / 2) * viewport.yearsPerPixel;
}

/** The inclusive year span currently on screen. */
export function visibleRange(viewport) {
  return {
    from: xToYear(viewport, 0),
    to: xToYear(viewport, viewport.width),
  };
}

/** Slide the view by a pixel delta — the panning primitive. */
export function panByPixels(viewport, deltaX) {
  return clampViewport({
    ...viewport,
    centerYear: viewport.centerYear - deltaX * viewport.yearsPerPixel,
  });
}

/**
 * Zoom about a fixed screen x, so the year under the cursor stays under the
 * cursor. `factor` < 1 zooms in.
 */
export function zoomAt(viewport, anchorX, factor) {
  const anchorYear = xToYear(viewport, anchorX);
  const yearsPerPixel = clampYearsPerPixel(viewport.yearsPerPixel * factor);
  // Re-derive the centre so anchorYear still lands on anchorX.
  const centerYear = anchorYear + (viewport.width / 2 - anchorX) * yearsPerPixel;
  return clampViewport({ ...viewport, yearsPerPixel, centerYear });
}

/** Keeps the centre inside the legal range so you can't pan into nowhere. */
export function clampViewport(viewport) {
  const next = createViewport(viewport);
  const halfSpan = (next.width / 2) * next.yearsPerPixel;
  // Allow the edges to overshoot by half a screen so the limits don't feel like
  // a wall, but never let the centre leave the range entirely.
  const min = MIN_YEAR - halfSpan;
  const max = MAX_YEAR + halfSpan;
  next.centerYear = Math.min(max, Math.max(min, next.centerYear));
  return next;
}

/**
 * A viewport framing the given year span with padding, used by "Fit all events"
 * and by export scopes.
 */
export function viewportForRange(from, to, { width, height, padding = 0.08 } = {}) {
  const safeWidth = Math.max(1, width || 1000);
  let start = Math.min(from, to);
  let end = Math.max(from, to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return createViewport({ width: safeWidth, height });
  }
  if (start === end) {
    // A single instant has no width; show a decade around it.
    start -= 5;
    end += 5;
  }
  const span = (end - start) * (1 + padding * 2);
  return createViewport({
    centerYear: (start + end) / 2,
    yearsPerPixel: span / safeWidth,
    width: safeWidth,
    height,
  });
}

/**
 * "Nice" tick steps in years: 1, 2, 5 × 10^n. Below a year the axis switches to
 * calendar and UTC clock steps, which are not powers of ten.
 */
const SUB_YEAR_STEPS = Object.freeze([
  { years: 1 / APPROX_MINUTES_PER_YEAR, unit: 'minute', count: 1 },
  { years: 5 / APPROX_MINUTES_PER_YEAR, unit: 'minute', count: 5 },
  { years: 15 / APPROX_MINUTES_PER_YEAR, unit: 'minute', count: 15 },
  { years: 30 / APPROX_MINUTES_PER_YEAR, unit: 'minute', count: 30 },
  { years: 60 / APPROX_MINUTES_PER_YEAR, unit: 'hour', count: 1 },
  { years: 3 * 60 / APPROX_MINUTES_PER_YEAR, unit: 'hour', count: 3 },
  { years: 6 * 60 / APPROX_MINUTES_PER_YEAR, unit: 'hour', count: 6 },
  { years: 12 * 60 / APPROX_MINUTES_PER_YEAR, unit: 'hour', count: 12 },
  { years: 1 / APPROX_DAYS_PER_YEAR, unit: 'day', count: 1 },
  { years: 2 / APPROX_DAYS_PER_YEAR, unit: 'day', count: 2 },
  { years: 7 / APPROX_DAYS_PER_YEAR, unit: 'week', count: 1 },
  { years: 1 / 12, unit: 'month', count: 1 },
  { years: 3 / 12, unit: 'quarter', count: 3 },
]);

function niceYearStep(rawStep) {
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  for (const multiple of [1, 2, 5, 10]) {
    const step = magnitude * multiple;
    if (step >= rawStep) return step;
  }
  return magnitude * 10;
}

/** The step the axis should be ticked in at this zoom. */
export function tickStep(viewport) {
  const rawStep = viewport.yearsPerPixel * TARGET_TICK_SPACING;
  if (rawStep < 1) {
    const match = SUB_YEAR_STEPS.find((candidate) => candidate.years >= rawStep);
    if (match) return { ...match };
    return { years: 1, unit: 'year' };
  }
  return { years: niceYearStep(rawStep), unit: 'year' };
}

/**
 * Axis ticks for the current view.
 *
 * Year zero is always emitted when it is on screen and marked `isZero`, so the
 * axis shows an explicit origin between BCE and CE rather than an unmarked seam.
 */
export function axisTicks(viewport, { maxTicks = 240 } = {}) {
  const { from, to } = visibleRange(viewport);
  const step = tickStep(viewport);
  return ticksForRange(viewport, { from, to, step, maxTicks, includeZero: true });
}

/**
 * A finer, local layer of ticks around the point being zoomed.
 *
 * This is deliberately a level-of-detail lens, not a second coordinate system:
 * every returned x still comes from the real viewport. Dates and event positions
 * therefore remain perfectly linear while the area under the pointer reveals
 * its subdivisions one zoom tier before the rest of the axis does.
 */
export function focusedAxisTicks(
  viewport,
  focusX,
  { radiusPx = 220, detailBoost = 4, maxTicks = 120 } = {},
) {
  if (!Number.isFinite(focusX) || !Number.isFinite(radiusPx) || radiusPx <= 0) return [];

  const x = Math.min(viewport.width, Math.max(0, focusX));
  const radius = Math.min(Math.max(48, radiusPx), Math.max(48, viewport.width / 2));
  const left = Math.max(0, x - radius);
  const right = Math.min(viewport.width, x + radius);
  const globalStep = tickStep(viewport);
  const detailStep = tickStep({
    ...viewport,
    yearsPerPixel: clampYearsPerPixel(viewport.yearsPerPixel / Math.max(1, detailBoost)),
  });

  // At the finest supported scale there is no honest extra resolution to show.
  if (detailStep.unit === globalStep.unit && detailStep.years === globalStep.years) return [];

  const globalTicks = axisTicks(viewport);
  const localTicks = ticksForRange(viewport, {
    from: xToYear(viewport, left),
    to: xToYear(viewport, right),
    step: detailStep,
    maxTicks,
    includeZero: false,
    compactSubYearLabels: true,
  });

  return localTicks
    // Keep the established ticks visually dominant and prevent labels from
    // colliding at the edge of the focus zone.
    .filter((tick) => globalTicks.every((globalTick) => Math.abs(globalTick.x - tick.x) >= 24))
    .map((tick) => ({
      ...tick,
      isFocusDetail: true,
      focusWeight: Math.max(0, 1 - Math.abs(tick.x - x) / radius),
    }));
}

function ticksForRange(
  viewport,
  {
    from,
    to,
    step,
    maxTicks,
    includeZero,
    compactSubYearLabels = false,
  },
) {
  const ticks = [];

  if (step.unit === 'year') {
    const first = Math.ceil(from / step.years) * step.years;
    for (let year = first; year <= to; year += step.years) {
      if (ticks.length >= maxTicks) break;
      // Floating steps accumulate error over thousands of iterations; rounding
      // to the step keeps labels like "1500" from becoming "1499.9999".
      const value = step.years >= 1 ? Math.round(year / step.years) * step.years : year;
      ticks.push({
        year: value,
        x: yearToX(viewport, value),
        label: axisLabel(value, step),
        isZero: value === 0,
        isMajor: isMajorTick(value, step.years),
      });
    }
  } else if (step.unit === 'month' || step.unit === 'quarter') {
    // Sub-year zoom: walk real calendar boundaries so labels land on the 1st.
    const startYear = Math.floor(from);
    for (let year = startYear; year <= Math.ceil(to); year += 1) {
      for (let month = 1; month <= 12; month += 1) {
        const monthsPerStep = step.count || Math.max(1, Math.round(step.years * 12));
        if ((month - 1) % monthsPerStep !== 0) continue;
        let elapsed = 0;
        for (let m = 1; m < month; m += 1) elapsed += daysInMonth(year, m);
        const yearLength = daysInMonth(year, 2) === 29 ? 366 : 365;
        const value = year + elapsed / yearLength;
        if (value < from || value > to) continue;
        if (ticks.length >= maxTicks) break;
        ticks.push({
          year: value,
          x: yearToX(viewport, value),
          label: compactSubYearLabels
            ? MONTH_ABBR[month - 1]
            : `${MONTH_ABBR[month - 1]} ${axisYearText(year)}`,
          isZero: false,
          isMajor: month === 1,
        });
      }
    }
  } else {
    ticks.push(...calendarClockTicks(viewport, {
      from,
      to,
      step,
      maxTicks,
      compactLabels: compactSubYearLabels,
    }));
  }

  // Year zero deserves a tick even when the step skips it.
  if (includeZero && from < 0 && to > 0 && !ticks.some((tick) => tick.year === 0)) {
    ticks.push({
      year: 0,
      x: yearToX(viewport, 0),
      label: '0',
      isZero: true,
      isMajor: true,
    });
    ticks.sort((a, b) => a.year - b.year);
  }

  return ticks;
}

const MONTH_ABBR = Object.freeze([
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]);

function daysInYear(year) {
  return daysInMonth(year, 2) === 29 ? 366 : 365;
}

function minuteStepFor(step) {
  if (step.unit === 'minute') return step.count;
  if (step.unit === 'hour') return step.count * 60;
  if (step.unit === 'day') return step.count * MINUTES_PER_DAY;
  if (step.unit === 'week') return step.count * 7 * MINUTES_PER_DAY;
  return null;
}

function calendarPartsAtMinute(year, minuteOfYear) {
  let dayOfYear = Math.floor(minuteOfYear / MINUTES_PER_DAY);
  const minuteOfDay = minuteOfYear - dayOfYear * MINUTES_PER_DAY;
  let month = 1;
  while (month <= 12 && dayOfYear >= daysInMonth(year, month)) {
    dayOfYear -= daysInMonth(year, month);
    month += 1;
  }
  return {
    year,
    month: Math.min(12, month),
    day: dayOfYear + 1,
    hour: Math.floor(minuteOfDay / 60),
    minute: minuteOfDay % 60,
  };
}

function padClockPart(value) {
  return String(value).padStart(2, '0');
}

function calendarTickLabel(parts, step, compact) {
  const date = `${parts.day} ${MONTH_ABBR[parts.month - 1]}`;
  if (step.unit === 'day' || step.unit === 'week') {
    return compact ? date : `${date} ${axisYearText(parts.year)}`;
  }

  const clock = `${padClockPart(parts.hour)}:${padClockPart(parts.minute)}`;
  // The focal-detail layer is temporary context under the pointer, so repeating
  // the date on every local subdivision creates noise. Established axis ticks
  // retain the date, while every clock label omits the redundant UTC suffix.
  return compact ? clock : `${date} · ${clock}`;
}

/**
 * Real proleptic-Gregorian day and UTC clock boundaries. A day ends at 24:00,
 * which is represented once—as the following day's 00:00—so two labels never
 * occupy the same instant. Seconds are intentionally absent from this model.
 */
function calendarClockTicks(
  viewport,
  { from, to, step, maxTicks, compactLabels },
) {
  const stepMinutes = minuteStepFor(step);
  if (!stepMinutes) return [];

  const ticks = [];
  const firstYear = Math.floor(from);
  const lastYear = Math.ceil(to);
  for (let year = firstYear; year <= lastYear && ticks.length < maxTicks; year += 1) {
    const totalMinutes = daysInYear(year) * MINUTES_PER_DAY;
    const localFrom = Math.max(0, (from - year) * totalMinutes);
    const localTo = Math.min(totalMinutes, (to - year) * totalMinutes);
    if (localTo < 0 || localFrom >= totalMinutes) continue;

    // Subtracting a microscopic epsilon retains a boundary that should be
    // visible but picked up floating-point dust during year-fraction arithmetic.
    let minuteOfYear = Math.ceil((localFrom - 1e-7) / stepMinutes) * stepMinutes;
    minuteOfYear = Math.max(0, minuteOfYear);
    for (
      ; minuteOfYear < totalMinutes && minuteOfYear <= localTo + 1e-7;
      minuteOfYear += stepMinutes
    ) {
      if (ticks.length >= maxTicks) break;
      const value = year + minuteOfYear / totalMinutes;
      if (value < from - Number.EPSILON || value > to + Number.EPSILON) continue;
      const parts = calendarPartsAtMinute(year, minuteOfYear);
      ticks.push({
        year: value,
        x: yearToX(viewport, value),
        label: calendarTickLabel(parts, step, compactLabels),
        isZero: false,
        isMajor: step.unit === 'minute'
          ? parts.minute === 0
          : step.unit === 'hour'
            ? parts.hour === 0
            : parts.day === 1,
        calendar: parts,
        unit: step.unit,
      });
    }
  }
  return ticks;
}

/** Every fifth step reads as major, which the renderer draws heavier. */
function isMajorTick(year, stepYears) {
  if (stepYears <= 0) return false;
  const index = Math.round(year / stepYears);
  return index % 5 === 0;
}

/**
 * Only genuinely huge years are written in words. The threshold has to be this
 * high: at a one-year tick step, scaling from 1000 upward rendered 1517, 1518 and
 * 1519 all as "1.5 thousand", so the axis showed four identical labels.
 */
const AXIS_LONG_SCALE_FROM = 100_000;

function axisYearText(year) {
  const magnitude = Math.abs(year);
  if (magnitude >= AXIS_LONG_SCALE_FROM) {
    const scaled = formatLargeYear(magnitude);
    // "13.8 billion" is already compact; keep the sign for BCE.
    return year < 0 ? `-${scaled}` : scaled;
  }
  return String(year);
}

/**
 * Axis labels stay numeric and signed, matching how a timeline axis normally
 * reads: … -2000, -1000, 0, 1000, 2000 …. Era words belong on event cards,
 * where there is room for them.
 */
function axisLabel(year, step) {
  if (year === 0) return '0';
  if (step.years >= 1) return axisYearText(Math.round(year));
  return axisYearText(Math.round(year));
}

/**
 * The readout that follows the cursor: which year it is over, and how far that
 * is from a reference year (today by default).
 */
export function cursorReadout(year, referenceYear) {
  const target = Math.round(year);
  const diff = target - Math.round(referenceYear);
  const magnitude = Math.abs(diff);
  // Counts stay literal well past a thousand — "10883 years later" is precise and
  // still readable, where "10.9 thousand years later" only loses information.
  // Words are reserved for deep time, where the digits become unreadable.
  const amount = magnitude >= 100_000 ? formatLargeYear(magnitude) : String(magnitude);
  let relative;
  if (magnitude === 0) relative = 'this year';
  else if (diff < 0) relative = `${amount} year${magnitude === 1 ? '' : 's'} ago`;
  else relative = `${amount} year${magnitude === 1 ? '' : 's'} later`;
  return { year: target, relative, isPast: diff < 0, label: readoutYearLabel(target) };
}

/**
 * How the year under the cursor is written. Ordinary years stay literal, matching
 * the axis; deep time switches to words and an era, because "-2496454496 year" is
 * a number nobody can read at a glance.
 */
function readoutYearLabel(year) {
  if (Math.abs(year) < 100_000) return `${year} year`;
  return year > 0
    ? `${formatLargeYear(year)} CE`
    : `${formatLargeYear(1 - year)} BCE`;
}
