import { htmlToMarkdown } from '../components/knowledgeweb/markdownFileFormat.jsx';

const RICH_NOTE_BEGIN = '<!-- BEX-RICH-NOTE-V1:BEGIN -->';
const RICH_NOTE_END = '<!-- BEX-RICH-NOTE-V1:END -->';
const RICH_NOTE_TOKEN = 'BEX-RICH-NOTE-V1';
const LEGACY_RICH_HTML_TOKEN = 'BEX-RICH-NOTE-HTML';
const BASE64_LINE_LENGTH = 120;

function toBase64Utf8(value) {
  const text = String(value ?? '');
  if (typeof Buffer !== 'undefined') return Buffer.from(text, 'utf8').toString('base64');
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function fromBase64Utf8(value) {
  const base64 = String(value ?? '').replace(/\s+/g, '');
  if (typeof Buffer !== 'undefined') return Buffer.from(base64, 'base64').toString('utf8');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

function wrapBase64(value) {
  const lines = [];
  for (let index = 0; index < value.length; index += BASE64_LINE_LENGTH) {
    lines.push(value.slice(index, index + BASE64_LINE_LENGTH));
  }
  return lines.join('\n');
}

/**
 * Produces a normal, readable Markdown note while carrying the exact TipTap
 * HTML in an inert Markdown comment. Tables, images, collapsibles, comments,
 * embeds and future custom nodes therefore survive even when the human-facing
 * Markdown projection does not understand them yet.
 */
export function buildNoteBackupMarkdown({ title, content } = {}) {
  const exactTitle = String(title || 'Untitled Note');
  const cleanTitle = exactTitle.replace(/[\r\n]+/g, ' ').trim() || 'Untitled Note';
  const heading = /^\s*#\s+(.+?)\s*#*\s*$/.exec(`# ${cleanTitle}`);
  const projectedTitle = String(heading?.[1] || '')
    .replace(/[*_`~]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
  const richHtml = String(content || '');
  const readable = htmlToMarkdown(richHtml);
  const sections = [`# ${cleanTitle}`];
  if (readable) sections.push(readable);
  if (richHtml || exactTitle !== projectedTitle) {
    const envelope = JSON.stringify({
      version: 1,
      title: exactTitle,
      html: richHtml,
    });
    sections.push([
      RICH_NOTE_BEGIN,
      wrapBase64(toBase64Utf8(envelope)),
      RICH_NOTE_END,
    ].join('\n'));
  }
  return `${sections.join('\n\n')}\n`;
}

function decodePayload(payload, label) {
  const normalized = String(payload || '').replace(/\s+/g, '');
  if (
    !normalized
    || normalized.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)
  ) {
    throw new Error(`The ${label} payload is invalid.`);
  }
  return fromBase64Utf8(normalized);
}

function escapedPattern(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function scanEncodedBlocks(text, markerToken, decode) {
  const token = escapedPattern(markerToken);
  const markerPattern = new RegExp(`<!--\\s*${token}:(?:BEGIN|END)\\s*-->`, 'gi');
  const blockPattern = new RegExp(
    `<!--\\s*${token}:BEGIN\\s*-->([\\s\\S]*?)<!--\\s*${token}:END\\s*-->`,
    'gi',
  );
  const foundMarker = markerPattern.test(text);
  const validBlocks = [];
  let lastError = null;
  let match;
  while ((match = blockPattern.exec(text)) !== null) {
    try {
      validBlocks.push({
        end: blockPattern.lastIndex,
        start: match.index,
        value: decode(match[1].trim()),
      });
    } catch (error) {
      lastError = error;
    }
  }
  if (validBlocks.length > 0) {
    return {
      foundMarker: true,
      ranges: validBlocks.map(({ start, end }) => ({ start, end })),
      value: validBlocks.at(-1).value,
    };
  }
  if (foundMarker) {
    throw lastError || new Error('The BEX rich-note backup payload is incomplete.');
  }
  return { foundMarker: false, ranges: [], value: null };
}

function decodeCurrentPayload(payload) {
  const decoded = decodePayload(payload, 'BEX rich-note backup');
  let envelope;
  try {
    envelope = JSON.parse(decoded);
  } catch {
    throw new Error('The BEX rich-note backup payload is invalid.');
  }
  if (
    !envelope
    || typeof envelope !== 'object'
    || Array.isArray(envelope)
    || envelope.version !== 1
    || typeof envelope.title !== 'string'
    || typeof envelope.html !== 'string'
  ) {
    throw new Error('The BEX rich-note backup payload is invalid.');
  }
  return Object.freeze({ title: envelope.title, html: envelope.html, version: 1 });
}

function decodeLegacyPayload(payload) {
  return Object.freeze({
    title: null,
    html: decodePayload(payload, 'BEX rich-note backup'),
    version: 0,
  });
}

/** Test/import seam for proving that a library export retains the exact note. */
export function extractNoteBackupPayload(markdown) {
  const text = String(markdown || '');
  const current = scanEncodedBlocks(text, RICH_NOTE_TOKEN, decodeCurrentPayload);
  if (current.foundMarker) return current.value;

  const legacy = scanEncodedBlocks(text, LEGACY_RICH_HTML_TOKEN, decodeLegacyPayload);
  return legacy.value;
}

export function extractNoteBackupHtml(markdown) {
  return extractNoteBackupPayload(markdown)?.html ?? null;
}

export function stripNoteBackupPayload(markdown) {
  const text = String(markdown || '');
  const validatedRanges = (markerToken, decode) => {
    try {
      return scanEncodedBlocks(text, markerToken, decode).ranges;
    } catch {
      // Never erase a block we could not validate. Import calls extraction
      // first and will surface corruption; standalone stripping remains
      // loss-safe even when user-authored text resembles an internal marker.
      return [];
    }
  };
  const ranges = [
    ...validatedRanges(RICH_NOTE_TOKEN, decodeCurrentPayload),
    ...validatedRanges(LEGACY_RICH_HTML_TOKEN, decodeLegacyPayload),
  ]
    .sort((left, right) => right.start - left.start);
  let stripped = text;
  for (const range of ranges) {
    stripped = `${stripped.slice(0, range.start)}${stripped.slice(range.end)}`;
  }
  return stripped;
}
