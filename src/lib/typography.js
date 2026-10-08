// Global typographic substitutions applied at render time only.
// We never rewrite stored content, so toggling these rules later is
// safe and applies retroactively.
//
//   --   →  —   (em dash)
//   ->   →  →   (right arrow)
//
// Both substitutions are skipped inside <code>/<pre> blocks (and inside
// markdown fenced/inline code) so source examples are preserved verbatim.

// `--` becomes an em dash only when NOT followed by a word character —
// this preserves CLI flag tokens like `--help`, `--dry-run`, etc., while
// still converting prose usages like `word -- word` or `something--end`.
const PLAIN_RULES = [
  { re: /--(?![A-Za-z0-9])/g, to: "\u2014" },
  { re: /->/g, to: "\u2192" },
];

// Apply substitutions to a plain string (no HTML / no markdown awareness).
function applyPlain(s) {
  if (!s) return s;
  let out = s;
  for (const r of PLAIN_RULES) out = out.replace(r.re, r.to);
  return out;
}

// Apply substitutions to a Markdown string, but skip fenced (```…```)
// and inline (`…`) code regions. Returns the transformed markdown.
export function applyTypographyToMarkdown(md) {
  if (!md) return md;
  const parts = md.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) parts[i] = applyPlain(parts[i]);
  }
  return parts.join("");
}

// Apply substitutions to an HTML string, skipping the contents of any
// <code> or <pre> element. Tag boundaries are preserved verbatim.
export function applyTypographyToHtml(html) {
  if (!html) return html;
  // Split into segments: code/pre blocks (kept verbatim) and everything else.
  const segments = html.split(/(<(?:pre|code)\b[^>]*>[\s\S]*?<\/(?:pre|code)>)/gi);
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (/^<(?:pre|code)\b/i.test(seg)) continue; // verbatim
    // Walk this segment and substitute outside of tag delimiters.
    const tagParts = seg.split(/(<[^>]+>)/g);
    for (let j = 0; j < tagParts.length; j++) {
      if (!tagParts[j].startsWith("<")) tagParts[j] = applyPlain(tagParts[j]);
    }
    segments[i] = tagParts.join("");
  }
  return segments.join("");
}
