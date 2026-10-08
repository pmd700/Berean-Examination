import { toPlainSearchText } from '../localBrainSearch.js';
/**
 * The Timegraph document and its events.
 *
 * A Timegraph is one reusable record. Notes, cards, keywords and study pages
 * embed it *by id*, so there is exactly one copy of the data and editing it once
 * updates every place it appears. Nothing in here touches storage or React —
 * `timegraphStore` owns that — which keeps the shape rules and the undo history
 * testable on their own.
 */

import {
  PRECISION,
  formatDateRange,
  fromYearValue,
  normalizeTimePoint,
  parseTimeInput,
  toYearValue,
  todayPoint,
} from './timegraphDate.js';

/** Event colours, drawn from the app's own tokens rather than a new palette. */
export const EVENT_COLORS = Object.freeze([
  { id: 'violet', label: 'Violet', fill: '#7C5CB7', ink: '#FFFFFF' },
  { id: 'indigo', label: 'Indigo', fill: '#4F46E5', ink: '#FFFFFF' },
  { id: 'teal', label: 'Teal', fill: '#0F766E', ink: '#FFFFFF' },
  { id: 'green', label: 'Green', fill: '#15803D', ink: '#FFFFFF' },
  { id: 'gold', label: 'Gold', fill: '#C9A94E', ink: '#1B1205' },
  { id: 'amber', label: 'Amber', fill: '#B45309', ink: '#FFFFFF' },
  { id: 'rose', label: 'Rose', fill: '#BE123C', ink: '#FFFFFF' },
  { id: 'slate', label: 'Slate', fill: '#475569', ink: '#FFFFFF' },
]);

const COLOR_BY_ID = new Map(EVENT_COLORS.map((color) => [color.id, color]));
export const DEFAULT_COLOR_ID = 'violet';

export function resolveColor(colorId) {
  return COLOR_BY_ID.get(colorId) || COLOR_BY_ID.get(DEFAULT_COLOR_ID);
}

/** Marker drawn where the event meets the axis. */
export const MARKER_STYLES = Object.freeze(['dot', 'ring', 'diamond', 'square', 'pin', 'none']);
export const TEXT_ALIGNMENTS = Object.freeze(['left', 'center', 'right']);
export const POSITIONS = Object.freeze(['above', 'below']);

/** What an event may be linked to — the four places a Timegraph can live. */
export const LINK_KINDS = Object.freeze({
  NOTE: 'note',
  KEYWORD: 'keyword',
  WEB_CARD: 'web-card',
  STUDY_CHAPTER: 'study-chapter',
});

const LINK_KIND_VALUES = new Set(Object.values(LINK_KINDS));

const MAX_TITLE = 300;
const MAX_DESCRIPTION = 8000;
const MAX_EVENT_DESCRIPTION = 512 * 1024;
const MAX_TAGS = 24;
const MAX_TAG_LENGTH = 48;
const MAX_MEDIA = 12;
const MAX_LINKS = 32;
const MAX_EVENTS = 20000;

let eventSequence = 0;

/** Ids only have to be unique inside one Timegraph. */
export function nextEventId() {
  eventSequence += 1;
  return `tge-${Date.now().toString(36)}-${eventSequence.toString(36)}`;
}

function clampText(value, limit) {
  if (typeof value !== 'string') return '';
  // Control characters would corrupt SVG and CSV export.
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, limit);
}

export function tagKey(value) {
  return String(value ?? '').trim().normalize('NFC').toLowerCase();
}

function normalizeTags(value) {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string' ? value.split(',') : [];
  const seen = new Set();
  const tags = [];
  for (const entry of source) {
    const tag = clampText(String(entry ?? ''), MAX_TAG_LENGTH).trim();
    if (!tag) continue;
    const key = tagKey(tag);
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

function normalizeMedia(value) {
  if (!Array.isArray(value)) return [];
  const media = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const url = clampText(String(entry.url ?? ''), 2000).trim();
    if (!url) continue;
    // Only kinds the renderer can actually display, and only safe schemes:
    // a javascript: or data: URL in an embedded graph would be an injection.
    if (!/^(https?:|bex-media:|\/)/i.test(url)) continue;
    media.push({
      kind: entry.kind === 'video' || entry.kind === 'link' ? entry.kind : 'image',
      url,
      caption: clampText(String(entry.caption ?? ''), 300),
    });
    if (media.length >= MAX_MEDIA) break;
  }
  return media;
}

function normalizeLinks(value) {
  if (!Array.isArray(value)) return [];
  const links = [];
  const seen = new Set();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    if (!LINK_KIND_VALUES.has(entry.kind)) continue;
    const id = clampText(String(entry.id ?? ''), 200).trim();
    if (!id) continue;
    const key = `${entry.kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({
      kind: entry.kind,
      id,
      label: clampText(String(entry.label ?? ''), 200),
    });
    if (links.length >= MAX_LINKS) break;
  }
  return links;
}

/**
 * Coerces any input into a valid event. Anything without a readable start date
 * is rejected outright — an event with no point on the axis cannot be drawn, and
 * silently defaulting it to year zero would quietly falsify the data.
 */
export function normalizeEvent(input) {
  if (!input || typeof input !== 'object') return null;

  const start = normalizeTimePoint(input.start ?? input.date ?? null);
  if (!start) return null;

  let end = normalizeTimePoint(input.end ?? null);
  // A range that ends before it starts is stored the way it was typed but drawn
  // ordered; see eventSpan. An end equal to the start is just a point.
  if (end && toYearValue(end) === toYearValue(start)) end = null;

  return {
    id: typeof input.id === 'string' && input.id ? clampText(input.id, 200) : nextEventId(),
    title: clampText(input.title, MAX_TITLE),
    description: clampText(input.description, MAX_EVENT_DESCRIPTION),
    start,
    end,
    color: COLOR_BY_ID.has(input.color) ? input.color : DEFAULT_COLOR_ID,
    position: POSITIONS.includes(input.position) ? input.position : 'above',
    align: TEXT_ALIGNMENTS.includes(input.align) ? input.align : 'center',
    marker: MARKER_STYLES.includes(input.marker) ? input.marker : 'dot',
    scale: clampScale(input.scale),
    tags: normalizeTags(input.tags),
    media: normalizeMedia(input.media),
    links: normalizeLinks(input.links),
  };
}

function clampScale(value) {
  const scale = Number(value);
  if (!Number.isFinite(scale)) return 1;
  return Math.min(2.5, Math.max(0.6, Math.round(scale * 100) / 100));
}

export function createEvent(patch = {}) {
  return normalizeEvent({
    start: todayPoint(),
    title: '',
    ...patch,
  });
}

/** Coerces a whole stored Timegraph, dropping events that cannot be placed. */
export function normalizeTimegraph(input) {
  const source = input && typeof input === 'object' ? input : {};
  const events = [];
  for (const raw of Array.isArray(source.events) ? source.events : []) {
    const event = normalizeEvent(raw);
    if (event) events.push(event);
    if (events.length >= MAX_EVENTS) break;
  }
  return {
    id: source.id ?? null,
    title: clampText(source.title, 200),
    description: clampText(source.description, MAX_DESCRIPTION),
    events: sortEvents(events),
    // Where the view sat when it was last saved, so reopening feels continuous.
    view: normalizeSavedView(source.view),
    folder_id: source.folder_id ?? null,
    sort_order: source.sort_order ?? null,
    created_date: source.created_date ?? null,
    updated_date: source.updated_date ?? null,
  };
}

function normalizeSavedView(view) {
  if (!view || typeof view !== 'object') return null;
  const centerYear = Number(view.centerYear);
  const yearsPerPixel = Number(view.yearsPerPixel);
  if (!Number.isFinite(centerYear) || !Number.isFinite(yearsPerPixel) || yearsPerPixel <= 0) {
    return null;
  }
  return { centerYear, yearsPerPixel };
}

/** Chronological order, with a stable tiebreak so redraws don't shuffle. */
export function sortEvents(events) {
  return [...events].sort((a, b) => {
    const diff = (toYearValue(a.start) ?? 0) - (toYearValue(b.start) ?? 0);
    if (diff !== 0) return diff;
    return String(a.id).localeCompare(String(b.id));
  });
}

export function upsertEvent(timegraph, event) {
  const normalized = normalizeEvent(event);
  if (!normalized) return timegraph;
  const exists = timegraph.events.some((candidate) => candidate.id === normalized.id);
  const events = exists
    ? timegraph.events.map((candidate) => (candidate.id === normalized.id ? normalized : candidate))
    : [...timegraph.events, normalized];
  return { ...timegraph, events: sortEvents(events) };
}

export function removeEvent(timegraph, eventId) {
  return {
    ...timegraph,
    events: timegraph.events.filter((event) => event.id !== eventId),
  };
}

export function duplicateEvent(timegraph, eventId) {
  const original = timegraph.events.find((event) => event.id === eventId);
  if (!original) return { timegraph, event: null };
  const copy = normalizeEvent({
    ...original,
    id: nextEventId(),
    title: `${original.title || 'New event'} copy`,
  });
  return { timegraph: upsertEvent(timegraph, copy), event: copy };
}

/** Moves an event to a new year, keeping its duration and its precision. */
export function moveEventToYear(event, yearValue) {
  const startValue = toYearValue(event.start);
  const endValue = toYearValue(event.end);
  const precision = event.start?.precision || PRECISION.YEAR;
  const start = fromYearValue(yearValue, precision);
  if (!start) return event;
  if (endValue == null || startValue == null) return { ...event, start };
  const duration = endValue - startValue;
  return {
    ...event,
    start,
    end: fromYearValue(yearValue + duration, event.end?.precision || precision),
  };
}

/**
 * Filtering. A query matches title, description or tag; tag and colour filters
 * are ANDed with it so "show me only gold events tagged reformation" works.
 * `hiddenTags` powers the always-visible toolbar switches: if any tag on an
 * event is switched off, that event is omitted without changing its data.
 * `hideUntagged` does the same for events whose tag list is empty.
 */
export function filterEvents(events, {
  query = '', tags = [], hiddenTags = [], hideUntagged = false, colors = [],
} = {}) {
  const needle = String(query || '').trim().toLowerCase();
  const tagSet = new Set((tags || []).map((tag) => tagKey(tag)));
  const hiddenTagSet = new Set((hiddenTags || []).map((tag) => tagKey(tag)));
  const colorSet = new Set(colors || []);

  return (events || []).filter((event) => {
    if (colorSet.size && !colorSet.has(event.color)) return false;
    if (hideUntagged && event.tags.length === 0) return false;
    if (hiddenTagSet.size && event.tags.some((tag) => hiddenTagSet.has(tagKey(tag)))) {
      return false;
    }
    if (tagSet.size) {
      const has = event.tags.some((tag) => tagSet.has(tagKey(tag)));
      if (!has) return false;
    }
    if (!needle) return true;
    if (event.title.toLowerCase().includes(needle)) return true;
    if (toPlainSearchText(event.description).toLowerCase().includes(needle)) return true;
    if (event.tags.some((tag) => tag.toLowerCase().includes(needle))) return true;
    return formatDateRange(event.start, event.end).toLowerCase().includes(needle);
  });
}

/** Every tag in use, for the filter menu. */
export function collectTags(events) {
  const counts = new Map();
  for (const event of events || []) {
    const seen = new Set();
    for (const tag of event.tags || []) {
      const key = tagKey(tag);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (!counts.has(key)) counts.set(key, { tag: String(tag).trim(), count: 0 });
      counts.get(key).count += 1;
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

// ── Undo / redo ─────────────────────────────────────────────────────────────
// A bounded past/future pair of whole documents. Snapshots rather than diffs:
// a Timegraph is small enough that the simplicity is worth more than the bytes,
// and it makes undo exact even for a change that touches many events at once.

const HISTORY_LIMIT = 60;

export function createHistory(present) {
  return { past: [], present, future: [] };
}

export function pushHistory(history, next) {
  if (next === history.present) return history;
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: next,
    future: [],
  };
}

export function undoHistory(history) {
  if (!history.past.length) return history;
  const previous = history.past[history.past.length - 1];
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future].slice(0, HISTORY_LIMIT),
  };
}

export function redoHistory(history) {
  if (!history.future.length) return history;
  const [next, ...rest] = history.future;
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: next,
    future: rest,
  };
}

export { parseTimeInput, formatDateRange };
