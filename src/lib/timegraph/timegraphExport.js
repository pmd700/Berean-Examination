import { toPlainSearchText } from '../localBrainSearch.js';
/**
 * Turning a Timegraph into a file, and reading one back.
 *
 * The serialization here is deliberately dependency-free and DOM-free so it can
 * be tested directly and so JSON round-trips can be proven exactly. The pieces
 * that genuinely need a browser — rasterizing to PNG, wrapping in a PDF — live in
 * the export dialog, which hands this module a serialized SVG string.
 *
 * Scope selection matters as much as format: exporting "the current view" must
 * capture what the user is looking at, while "everything" must widen the frame
 * until no card or date label is cut off. Both go through `resolveScope`.
 */

import { eventSpan, formatDateRange, formatTimePoint } from './timegraphDate.js';
import { normalizeTimegraph } from './timegraphModel.js';
import { eventsBounds, layoutEvents } from './timegraphLayout.js';
import { viewportForRange, visibleRange } from './timegraphScale.js';

/** Bumped only on a breaking change to the file shape. */
export const TIMEGRAPH_FILE_VERSION = 1;
export const TIMEGRAPH_FILE_KIND = 'bex.timegraph';

export const EXPORT_SCOPES = Object.freeze({
  ALL: 'all',
  VIEW: 'view',
  SELECTION: 'selection',
  RANGE: 'range',
});

export const EXPORT_FORMATS = Object.freeze(['png', 'svg', 'pdf', 'docx', 'csv', 'json']);

/**
 * Which events an export covers, and the frame they need.
 *
 * Returns `{ events, from, to }`. An empty result is reported rather than
 * silently producing a blank file.
 */
export function resolveScope(timegraph, {
  scope = EXPORT_SCOPES.ALL,
  viewport = null,
  selectedIds = [],
  from = null,
  to = null,
} = {}) {
  const all = timegraph?.events || [];

  if (scope === EXPORT_SCOPES.SELECTION) {
    const wanted = new Set(selectedIds);
    const events = all.filter((event) => wanted.has(event.id));
    return withBounds(events);
  }

  if (scope === EXPORT_SCOPES.VIEW) {
    if (!viewport) return withBounds(all);
    const range = visibleRange(viewport);
    // An event counts as in view if any part of it is, so a range that starts
    // off-screen and continues into view is still included.
    const events = all.filter((event) => {
      const span = eventSpan(event);
      return span && span.end >= range.from && span.start <= range.to;
    });
    return { events, from: range.from, to: range.to };
  }

  if (scope === EXPORT_SCOPES.RANGE) {
    const start = Number(from);
    const end = Number(to);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return withBounds(all);
    const low = Math.min(start, end);
    const high = Math.max(start, end);
    const events = all.filter((event) => {
      const span = eventSpan(event);
      return span && span.end >= low && span.start <= high;
    });
    return { events, from: low, to: high };
  }

  return withBounds(all);
}

function withBounds(events) {
  const bounds = eventsBounds(events);
  if (!bounds) return { events, from: 0, to: 0 };
  return { events, from: bounds.from, to: bounds.to };
}

/**
 * The frame an image export should use.
 *
 * Laying the events out once, measuring how many lanes they need and then
 * growing the height is what guarantees the promise that nothing is cropped: the
 * image is sized to its content instead of the content being squeezed into a
 * fixed image. The extra `labelPadding` keeps the axis date labels, which hang
 * below the last lane, inside the frame too.
 */
export function exportFrame(events, { from, to, width = 1600, measureWidth, labelPadding = 32 } = {}) {
  const probe = viewportForRange(from, to, { width, height: 600 });
  const layout = layoutEvents(events, probe, measureWidth ? { measureWidth } : undefined);
  const height = layout.neededHeight + labelPadding * 2;
  return viewportForRange(from, to, { width, height });
}

// ── JSON ────────────────────────────────────────────────────────────────────

/**
 * The lossless format. Everything needed to reconstruct the Timegraph exactly,
 * which is what makes Import a true inverse of Export.
 */
export function toJson(timegraph, { events = null, pretty = true } = {}) {
  const document = {
    kind: TIMEGRAPH_FILE_KIND,
    version: TIMEGRAPH_FILE_VERSION,
    exported_at: new Date().toISOString(),
    timegraph: {
      title: timegraph?.title ?? 'Untitled timegraph',
      description: timegraph?.description ?? '',
      view: timegraph?.view ?? null,
      events: events ?? timegraph?.events ?? [],
    },
  };
  return JSON.stringify(document, null, pretty ? 2 : 0);
}

/**
 * Reads an exported file back. Throws a message meant for a human rather than
 * returning something half-formed, because a silently-empty import is worse than
 * a refusal.
 */
export function fromJson(text) {
  let parsed;
  try {
    parsed = typeof text === 'string' ? JSON.parse(text) : text;
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('That file does not contain a timegraph.');
  }

  // Accept both the wrapper and a bare timegraph object, since users do hand-edit
  // these and pasting just the inner object is an easy mistake to make.
  const body = parsed.kind === TIMEGRAPH_FILE_KIND || parsed.timegraph
    ? parsed.timegraph
    : parsed;

  if (!body || typeof body !== 'object') {
    throw new Error('That file does not contain a timegraph.');
  }
  if (parsed.version != null && Number(parsed.version) > TIMEGRAPH_FILE_VERSION) {
    throw new Error('That timegraph was exported by a newer version of BEX.');
  }
  if (!Array.isArray(body.events)) {
    throw new Error('That timegraph has no events list.');
  }

  const normalized = normalizeTimegraph(body);
  const dropped = body.events.length - normalized.events.length;
  return { timegraph: normalized, dropped };
}

// ── CSV ─────────────────────────────────────────────────────────────────────

const CSV_COLUMNS = Object.freeze([
  'title', 'description', 'start', 'end', 'start_year', 'end_year', 'precision',
  'color', 'position', 'align', 'marker', 'scale', 'tags', 'links', 'media',
]);

function csvCell(value) {
  const text = value == null ? '' : String(value);
  // A leading =, +, - or @ is treated as a formula by spreadsheet apps; prefixing
  // an apostrophe keeps an exported title from executing when the file is opened.
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function toCsv(events) {
  const rows = [CSV_COLUMNS.join(',')];
  for (const event of events || []) {
    const span = eventSpan(event);
    rows.push([
      event.title,
      toPlainSearchText(event.description),
      formatTimePoint(event.start),
      event.end ? formatTimePoint(event.end) : '',
      span ? span.start : '',
      span && span.isRange ? span.end : '',
      event.start?.precision ?? '',
      event.color,
      event.position,
      event.align,
      event.marker,
      event.scale,
      (event.tags || []).join('; '),
      (event.links || []).map((link) => `${link.kind}:${link.id}`).join('; '),
      (event.media || []).map((item) => item.url).join('; '),
    ].map(csvCell).join(','));
  }
  // CRLF, because Excel treats a bare LF file as a single line on Windows.
  return `${rows.join('\r\n')}\r\n`;
}

// ── DOCX ────────────────────────────────────────────────────────────────────

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * The parts of a minimal but genuinely valid .docx. Word rejects a zip that is
 * missing any of these, so they are all written even though only document.xml
 * carries content. The caller zips them (jszip) — assembling the parts here keeps
 * the XML testable without a zip library.
 */
export function docxParts(timegraph, events) {
  const paragraph = (text, { bold = false, size = 22, spacing = 120 } = {}) => `
    <w:p>
      <w:pPr><w:spacing w:after="${spacing}"/></w:pPr>
      <w:r>
        <w:rPr>${bold ? '<w:b/>' : ''}<w:sz w:val="${size}"/></w:rPr>
        <w:t xml:space="preserve">${xmlEscape(text)}</w:t>
      </w:r>
    </w:p>`;

  const body = [
    paragraph(timegraph?.title || 'Untitled timegraph', { bold: true, size: 36 }),
    timegraph?.description ? paragraph(timegraph.description, { size: 20 }) : '',
    ...(events || []).map((event) => [
      paragraph(`${formatDateRange(event.start, event.end)} — ${event.title}`, { bold: true, size: 24, spacing: 40 }),
      event.description ? paragraph(toPlainSearchText(event.description), { size: 20, spacing: 40 }) : '',
      event.tags?.length ? paragraph(`Tags: ${event.tags.join(', ')}`, { size: 18 }) : '',
    ].join('')),
  ].join('');

  return {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`,
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>
  </w:body>
</w:document>`,
  };
}

// ── SVG ─────────────────────────────────────────────────────────────────────

/**
 * Wraps a serialized `<svg>` from the live canvas so it stands alone as a file:
 * an XML prolog, an explicit background (an SVG with no background renders
 * transparent, which looks broken in most viewers). Text keeps the portable
 * serif fallback already present in the live SVG.
 */
export function wrapSvg(svgMarkup, { width, height, background = '#12151B' }) {
  const withoutXmlDecl = String(svgMarkup || '').replace(/^<\?xml[^>]*\?>\s*/i, '');
  const sized = withoutXmlDecl
    .replace(/\swidth="[^"]*"/i, ` width="${width}"`)
    .replace(/\sheight="[^"]*"/i, ` height="${height}"`);
  const backgroundRect = `<rect x="0" y="0" width="${width}" height="${height}" fill="${background}"/>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n${
    sized.replace(/(<svg[^>]*>)/i, `$1${backgroundRect}`)
  }`;
}

/** A safe, descriptive file name. */
export function exportFileName(title, format, scope) {
  const base = String(title || 'timegraph')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60) || 'timegraph';
  const stamp = new Date().toISOString().slice(0, 10);
  const scopePart = scope && scope !== EXPORT_SCOPES.ALL ? `-${scope}` : '';
  return `${base}${scopePart}-${stamp}.${format}`;
}
