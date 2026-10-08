/**
 * Timegraph dates.
 *
 * A Timegraph has to place "1 January 1521", "c. 1514", "776 BCE" and
 * "13.8 billion BCE" on the same axis, so a JS `Date` is no use here — it tops
 * out around ±275,760 years and has no concept of an approximate date.
 *
 * A point in time is therefore a plain record:
 *
 *   { year, month, day, precision }
 *
 * `year` is the *astronomical* year: … -2, -1, 0, 1, 2 … where year 0 is the
 * year known historically as 1 BCE. That is what gives the axis a real zero to
 * label instead of a gap between 1 BCE and 1 CE, and it makes arithmetic across
 * the era boundary ordinary subtraction rather than a special case.
 *
 * Everything sorts and positions by `toYearValue()`, a single float. float64
 * holds integers exactly to 2^53, so at the ±100,000,000,000 year limit the
 * resolution is still ~1e-5 of a year — far finer than the month/day fractions
 * ever added to it, and those only carry meaning near the present anyway.
 */

/** Hard limits on the axis: 100 billion years either side of year zero. */
export const MIN_YEAR = -100_000_000_000;
export const MAX_YEAR = 100_000_000_000;

export const PRECISION = Object.freeze({
  EXACT: 'exact',           // 1 January 1521
  MONTH: 'month',           // January 1521
  YEAR: 'year',             // 1521
  APPROXIMATE: 'approximate', // c. 1514
});

const PRECISIONS = new Set(Object.values(PRECISION));

const MONTH_NAMES = Object.freeze([
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]);

const MONTH_LOOKUP = (() => {
  const lookup = new Map();
  MONTH_NAMES.forEach((name, index) => {
    lookup.set(name.toLowerCase(), index + 1);
    lookup.set(name.slice(0, 3).toLowerCase(), index + 1);
  });
  lookup.set('sept', 9);
  return lookup;
})();

/** Days per month, with a proleptic-Gregorian leap rule for February. */
export function daysInMonth(year, month) {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 30;
}

function clampYear(year) {
  if (!Number.isFinite(year)) return 0;
  return Math.min(MAX_YEAR, Math.max(MIN_YEAR, Math.trunc(year)));
}

/**
 * Coerces anything into a valid time point, or null when there is nothing
 * usable. Callers can hand this raw user input, stored JSON, or a partial
 * object and get back something safe to render and sort.
 */
export function normalizeTimePoint(input) {
  if (input == null) return null;
  if (typeof input === 'number') {
    return { year: clampYear(input), month: null, day: null, precision: PRECISION.YEAR };
  }
  if (typeof input === 'string') return parseTimeInput(input);
  if (typeof input !== 'object') return null;

  const year = clampYear(Number(input.year));
  if (!Number.isFinite(Number(input.year))) return null;

  let precision = PRECISIONS.has(input.precision) ? input.precision : PRECISION.YEAR;

  let month = Number.isFinite(Number(input.month)) ? Math.trunc(Number(input.month)) : null;
  if (month != null && (month < 1 || month > 12)) month = null;

  let day = Number.isFinite(Number(input.day)) ? Math.trunc(Number(input.day)) : null;
  if (month == null) day = null;
  if (day != null && (day < 1 || day > daysInMonth(year, month))) day = null;

  // A stated precision can't outrun the parts actually present, or formatting
  // would claim a day it doesn't have.
  if (precision === PRECISION.EXACT && (month == null || day == null)) {
    precision = month == null ? PRECISION.YEAR : PRECISION.MONTH;
  }
  if (precision === PRECISION.MONTH && month == null) precision = PRECISION.YEAR;

  return { year, month, day, precision };
}

/**
 * The sortable, positionable value of a time point: the astronomical year plus
 * the fraction of the year already elapsed. Month-only and year-only points sit
 * at the start of their period, which keeps ordering stable and predictable.
 */
export function toYearValue(point) {
  const normalized = normalizeTimePoint(point);
  if (!normalized) return null;
  const { year, month, day } = normalized;
  if (month == null) return year;

  let elapsed = 0;
  for (let m = 1; m < month; m += 1) elapsed += daysInMonth(year, m);
  if (day != null) elapsed += day - 1;

  const yearLength = daysInMonth(year, 2) === 29 ? 366 : 365;
  return year + elapsed / yearLength;
}

/** Builds a time point from a floating year value — the inverse of the above. */
export function fromYearValue(value, precision = PRECISION.YEAR) {
  if (!Number.isFinite(value)) return null;
  const year = clampYear(Math.floor(value));
  if (precision === PRECISION.YEAR || precision === PRECISION.APPROXIMATE) {
    return { year, month: null, day: null, precision };
  }

  const yearLength = daysInMonth(year, 2) === 29 ? 366 : 365;
  let dayOfYear = Math.round((value - year) * yearLength);
  dayOfYear = Math.min(yearLength - 1, Math.max(0, dayOfYear));

  let month = 1;
  while (month <= 12 && dayOfYear >= daysInMonth(year, month)) {
    dayOfYear -= daysInMonth(year, month);
    month += 1;
  }
  month = Math.min(12, month);
  return {
    year,
    month,
    day: precision === PRECISION.EXACT ? dayOfYear + 1 : null,
    precision,
  };
}

/**
 * Very large years read as "13.8 billion" rather than "13800000000", which is
 * unreadable on an axis label or an event card.
 */
export function formatLargeYear(magnitude) {
  const scales = [
    [1e9, 'billion'],
    [1e6, 'million'],
    [1e3, 'thousand'],
  ];
  for (const [size, word] of scales) {
    if (magnitude >= size) {
      const scaled = magnitude / size;
      // One decimal only while it says something; 13.8 billion, but 500 million.
      const text = scaled >= 100 || Number.isInteger(scaled)
        ? String(Math.round(scaled))
        : scaled.toFixed(1).replace(/\.0$/, '');
      return `${text} ${word}`;
    }
  }
  return String(magnitude);
}

/**
 * Above this, a year is written in words. Ordinary historical years must stay
 * literal — 1514 reads "1514 CE", never "1.5 thousand CE" — so the threshold sits
 * well past any date a person would write out digit by digit, and only deep time
 * gets the scaled form.
 */
const LONG_SCALE_FROM = 100_000;

/**
 * The era-aware label for a year: astronomical year 0 is "1 BCE", -1 is "2 BCE".
 */
export function formatYear(year, { longScale = true } = {}) {
  const astro = clampYear(year);
  const scaled = longScale && Math.abs(astro) >= LONG_SCALE_FROM;
  if (astro > 0) {
    return scaled ? `${formatLargeYear(astro)} CE` : `${astro} CE`;
  }
  const bce = 1 - astro;
  return scaled ? `${formatLargeYear(bce)} BCE` : `${bce} BCE`;
}

/** Human label for a single point, honouring its precision. */
export function formatTimePoint(point) {
  const normalized = normalizeTimePoint(point);
  if (!normalized) return '';
  const { year, month, day, precision } = normalized;

  if (precision === PRECISION.APPROXIMATE) return `c. ${formatYear(year)}`;
  if (precision === PRECISION.YEAR || month == null) return formatYear(year);

  const monthName = MONTH_NAMES[month - 1];
  if (precision === PRECISION.MONTH || day == null) return `${monthName} ${formatYear(year)}`;
  return `${day} ${monthName} ${formatYear(year)}`;
}

/** Label for a whole event: a point, or a range with an en dash. */
export function formatDateRange(start, end) {
  const startText = formatTimePoint(start);
  if (!end) return startText;
  const endText = formatTimePoint(end);
  if (!endText || endText === startText) return startText;
  return `${startText} – ${endText}`;
}

const APPROX_PREFIX = /^\s*(?:c|ca|circa|approx|approximately|about|around)\.?\s+/i;
const ERA_SUFFIX = /\s*\b(bce|bc|ce|ad)\b\.?\s*$/i;
const ERA_PREFIX = /^\s*\b(ad)\b\.?\s*/i;
const SCALE_WORDS = Object.freeze({
  thousand: 1e3, k: 1e3,
  million: 1e6, m: 1e6, mya: 1e6,
  billion: 1e9, b: 1e9, bya: 1e9, ga: 1e9,
});

/**
 * Parses what a person actually types into a date field.
 *
 * Understood: "1521", "1 jan 1521", "jan 1521", "1521-03-04", "c. 1514",
 * "776 BCE", "AD 33", "13.8 billion BCE", "-4000". An empty or unreadable
 * string gives null rather than a wrong date.
 */
export function parseTimeInput(raw) {
  if (typeof raw !== 'string') return normalizeTimePoint(raw);
  let text = raw.trim();
  if (!text) return null;

  let precision = null;
  if (APPROX_PREFIX.test(text)) {
    precision = PRECISION.APPROXIMATE;
    text = text.replace(APPROX_PREFIX, '');
  }

  // Era markers, taken off either end before the numbers are read.
  let era = null;
  const suffixMatch = text.match(ERA_SUFFIX);
  if (suffixMatch) {
    era = suffixMatch[1].toLowerCase();
    text = text.replace(ERA_SUFFIX, '');
  } else if (ERA_PREFIX.test(text)) {
    era = 'ad';
    text = text.replace(ERA_PREFIX, '');
  }
  const isBce = era === 'bce' || era === 'bc';

  // "13.8 billion", "4.5 bya"
  const scaleMatch = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*([a-z]+)\s*$/i);
  if (scaleMatch && SCALE_WORDS[scaleMatch[2].toLowerCase()]) {
    const magnitude = Number(scaleMatch[1]) * SCALE_WORDS[scaleMatch[2].toLowerCase()];
    const year = isBce ? 1 - magnitude : magnitude;
    return normalizeTimePoint({
      year,
      precision: precision || PRECISION.APPROXIMATE,
    });
  }

  // ISO-ish: 1521-03-04 / 1521-03 / -4000-01-01
  const isoMatch = text.match(/^\s*(-?\d{1,12})-(\d{1,2})(?:-(\d{1,2}))?\s*$/);
  if (isoMatch) {
    const rawYear = Number(isoMatch[1]);
    const year = isBce ? 1 - Math.abs(rawYear) : rawYear;
    return normalizeTimePoint({
      year,
      month: Number(isoMatch[2]),
      day: isoMatch[3] ? Number(isoMatch[3]) : null,
      precision: precision || (isoMatch[3] ? PRECISION.EXACT : PRECISION.MONTH),
    });
  }

  // Word months: "3 jan 1521", "jan 1521", "January 3, 1521"
  const words = text.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  let month = null;
  const numbers = [];
  for (const word of words) {
    const asMonth = MONTH_LOOKUP.get(word.toLowerCase().replace(/\.$/, ''));
    if (asMonth && month == null) { month = asMonth; continue; }
    const cleaned = word.replace(/(?:st|nd|rd|th)$/i, '');
    const numeric = Number(cleaned);
    if (cleaned !== '' && Number.isFinite(numeric)) numbers.push({ text: cleaned, value: numeric });
  }
  if (!numbers.length) return null;

  // Pick the year first, by finding the token that *can only* be a year: three
  // or more digits, negative, or larger than any day of the month. Only then is
  // whatever remains considered for the day. Deciding day-first is what made
  // "3 jan 1521" parse as the year 3.
  let yearIndex = numbers.findIndex(
    (entry) => entry.text.replace('-', '').length >= 3 || entry.value > 31 || entry.value < 0,
  );
  if (yearIndex === -1) yearIndex = numbers.length - 1;

  const year = numbers[yearIndex].value;
  const day = numbers
    .filter((_, index) => index !== yearIndex)
    .find((entry) => entry.value >= 1 && entry.value <= 31)?.value ?? null;
  const signedYear = isBce ? 1 - Math.abs(year) : year;
  const resolved = precision
    || (day != null ? PRECISION.EXACT : month != null ? PRECISION.MONTH : PRECISION.YEAR);
  return normalizeTimePoint({ year: signedYear, month, day, precision: resolved });
}

/**
 * The device's local calendar date, read afresh for New event and Jump to today.
 * Local getters avoid UTC shifting the day near midnight; no location is needed.
 */
export function todayPoint(now = new Date()) {
  return normalizeTimePoint({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
    precision: PRECISION.EXACT,
  });
}

/**
 * The span an event occupies, always start <= end. A point event gets a zero
 * width span; the renderer gives it a marker instead of a bar.
 */
export function eventSpan(event) {
  const start = toYearValue(event?.start);
  if (start == null) return null;
  const end = toYearValue(event?.end);
  if (end == null) return { start, end: start, isRange: false };
  return end < start
    ? { start: end, end: start, isRange: true }
    : { start, end, isRange: end !== start };
}
