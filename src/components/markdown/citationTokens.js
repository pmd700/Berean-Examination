// Parsing utilities for ChatGPT-style citation tokens embedded in AI markdown.
//
// ChatGPT research/search output wraps citations in invisible Private-Use-Area
// delimiter characters that are NOT normal markdown:
//
//   U+E200  start of a citation run
//   U+E202  internal separator (e.g. between the "cite" tag and each ref)
//   U+E201  end of a citation run
//
// A run looks like:  \uE200cite\uE202turn31search7\uE202turn6search10\uE201
// We extract the `turn...` reference ids inside each run.
//
// File citations use a different, visible form:
//   :contentReference[oaicite:5]{index=5}
//
// We normalize both into a sanitizer-safe inline sentinel that the markdown
// pipeline renders as a citation bubble:
//
//   <span class="berean-cite">turn31search7,turn6search10</span>

export const CITE_START = '\uE200';
export const CITE_END = '\uE201';
export const CITE_SEP = '\uE202';

// Any run delimited by the PUA start/end markers (non-greedy).
const CITE_RUN_RE = new RegExp(`${CITE_START}[\\s\\S]*?${CITE_END}`, 'g');
// Reference ids inside a run, e.g. turn31search7, turn6news10, turn0view2.
const TURN_RE = /turn[0-9a-z]+/gi;
// File / contentReference tokens.
const CONTENT_REF_RE = /:contentReference\[oaicite:(\d+)\]\{index=(\d+)\}/g;
// Any remaining stray PUA control chars (defensive cleanup).
const STRAY_PUA_RE = /[\uE200-\uE20F]/g;

function escapeForAttr(s) {
  return String(s).replace(/"/g, '').replace(/</g, '').replace(/>/g, '');
}

function makeSentinel(refs) {
  const clean = refs.map(escapeForAttr).filter(Boolean);
  if (clean.length === 0) return '';
  return `<span class="berean-cite">${clean.join(',')}</span>`;
}

// Replace all citation tokens in a markdown string with inline sentinels.
// Returns the transformed markdown (raw PUA tokens are never left visible).
export function preprocessCitations(md) {
  if (!md || typeof md !== 'string') return md;

  let out = md.replace(CITE_RUN_RE, (run) => {
    const refs = run.match(TURN_RE) || [];
    return makeSentinel(refs);
  });

  out = out.replace(CONTENT_REF_RE, (_m, _idx, index) => makeSentinel([`file:${index}`]));

  // Drop any leftover lone delimiters so users never see invisible artifacts.
  out = out.replace(STRAY_PUA_RE, '');

  return out;
}

// Parse a sentinel's comma-separated ref string into a clean array.
export function parseRefList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Best-effort human label for a raw ref id when no source metadata exists.
export function describeRef(ref) {
  if (!ref) return { kind: 'source', label: 'Source' };
  if (ref.startsWith('file:')) {
    return { kind: 'file', label: `File ${ref.slice(5)}` };
  }
  // turn31search7 -> { kind: 'web', label: 'Web result' } etc.
  const m = /^turn\d+([a-z]+)\d+$/i.exec(ref);
  if (m) {
    const t = m[1].toLowerCase();
    const map = { search: 'Web result', news: 'News', view: 'Page', image: 'Image', video: 'Video' };
    return { kind: t, label: map[t] || 'Source' };
  }
  return { kind: 'source', label: 'Source' };
}
