/**
 * Bible rich-text segment engine (source-agnostic, shared by server + client).
 *
 * A verse is stored as an ordered array of SEGMENTS instead of a flat string.
 * The renderer reconstructs the verse by walking the segments in order. The
 * same code derives the verse's "plain text" so that the per-word
 * highlight/annotation system (which keys off `plainText.split(/(\s+)/)` token
 * indices) stays perfectly aligned no matter whether footnote markers are
 * shown or hidden.
 *
 * KEY INVARIANT: only reading-text segments ("text" | "italic" | "smallCaps")
 * and "lineBreak" contribute characters to the plain text. "verseNumber" and
 * "noteMarker" segments contribute ZERO characters, so toggling textual notes
 * can never shift a single token index.
 */

export type SegmentType =
  | "text"
  | "italic"
  | "smallCaps"
  | "verseNumber"
  | "noteMarker"
  | "lineBreak";

/** One ordered piece of a verse. */
export interface BibleSegment {
  type: SegmentType;
  /** Reading text (text/italic/smallCaps) or the marker label (noteMarker, e.g. "a"). */
  text?: string;
  // ── noteMarker-only fields ──────────────────────────────────────────────
  /** Anchor id of the marker inside the source chapter, e.g. "source7-1". */
  markerId?: string;
  /** Id of the resolved footnote target, e.g. "f7-1". */
  noteTargetId?: string;
  /** Original href from the source, e.g. "part0003_split_017.html#f7-1". */
  href?: string;
  /** Verse reference shown in the popover, e.g. "9:1". */
  noteRef?: string;
  /** First token of the note ("Lit", "Or", "I.e."...) — a convenience hint. */
  noteType?: string;
  /** Flattened plain-text note body (used for aria-labels & fallbacks). */
  noteBody?: string;
  /** Rich note body (text/italic runs) so the popover can italicize words. */
  noteSegments?: BibleSegment[];
  // ── debug-only fields ───────────────────────────────────────────────────
  sourceHtml?: string;
  cssClasses?: string;
}

const READING_TYPES = new Set<SegmentType>(["text", "italic", "smallCaps"]);

/** Per-character formatting flags. */
export interface CharFormat {
  italic: boolean;
  smallCaps: boolean;
}

/** A contiguous run of identically-formatted characters inside one token. */
export interface FormatRun {
  text: string;
  italic: boolean;
  smallCaps: boolean;
}

/** Result of laying out a verse's segments for rendering. */
export interface SegmentLayout {
  /** Canonical plain text for tokenization / storage. */
  plainText: string;
  /** Tokens exactly as `plainText.split(/(\s+)/)` would produce them. */
  tokens: string[];
  /** Character offset where each token begins in `plainText`. */
  tokenStartOffsets: number[];
  /** Per-token formatting runs (sub-token spans), keyed by token index. */
  tokenRuns: FormatRun[][];
  /** noteMarker segments keyed by the character offset they sit at. */
  markersByOffset: Map<number, BibleSegment[]>;
  /** Character offsets where a lineBreak should be rendered. */
  breakOffsets: Set<number>;
}

/**
 * Derive the canonical plain text from a segment array. Must match exactly
 * what `buildSegmentLayout` produces (they share the same walk rules).
 */
export function segmentsToPlainText(segments: BibleSegment[]): string {
  let out = "";
  for (const seg of segments) {
    if (READING_TYPES.has(seg.type)) {
      out += seg.text ?? "";
    } else if (seg.type === "lineBreak") {
      out += " ";
    }
    // verseNumber + noteMarker contribute nothing.
  }
  return out;
}

/**
 * Walk a verse's segments and produce everything the renderer needs while
 * guaranteeing the token stream is identical to the highlight system's
 * `plainText.split(/(\s+)/)`.
 */
export function buildSegmentLayout(segments: BibleSegment[]): SegmentLayout {
  let plainText = "";
  const charFormat: CharFormat[] = [];
  const markersByOffset = new Map<number, BibleSegment[]>();
  const breakOffsets = new Set<number>();

  const pushChars = (str: string, fmt: CharFormat) => {
    for (const ch of str) {
      plainText += ch;
      charFormat.push(fmt);
    }
  };

  for (const seg of segments) {
    if (seg.type === "text") {
      pushChars(seg.text ?? "", { italic: false, smallCaps: false });
    } else if (seg.type === "italic") {
      pushChars(seg.text ?? "", { italic: true, smallCaps: false });
    } else if (seg.type === "smallCaps") {
      pushChars(seg.text ?? "", { italic: false, smallCaps: true });
    } else if (seg.type === "lineBreak") {
      breakOffsets.add(plainText.length);
      pushChars(" ", { italic: false, smallCaps: false });
    } else if (seg.type === "noteMarker") {
      const offset = plainText.length;
      const list = markersByOffset.get(offset) ?? [];
      list.push(seg);
      markersByOffset.set(offset, list);
    }
    // verseNumber: handled at the verse level, not inside the body flow.
  }

  // Tokenize identically to the highlight system.
  const tokens = plainText.split(/(\s+)/);
  const tokenStartOffsets: number[] = [];
  const tokenRuns: FormatRun[][] = [];
  let cursor = 0;
  for (const token of tokens) {
    tokenStartOffsets.push(cursor);
    tokenRuns.push(sliceRuns(token, charFormat, cursor));
    cursor += token.length;
  }

  return {
    plainText,
    tokens,
    tokenStartOffsets,
    tokenRuns,
    markersByOffset,
    breakOffsets,
  };
}

/** Split a token into contiguous runs of identical formatting. */
function sliceRuns(token: string, charFormat: CharFormat[], start: number): FormatRun[] {
  if (!token) return [];
  const runs: FormatRun[] = [];
  const chars = Array.from(token);
  let i = 0;
  while (i < chars.length) {
    const fmt = charFormat[start + i] ?? { italic: false, smallCaps: false };
    let text = "";
    while (
      i < chars.length &&
      (charFormat[start + i]?.italic ?? false) === fmt.italic &&
      (charFormat[start + i]?.smallCaps ?? false) === fmt.smallCaps
    ) {
      text += chars[i];
      i += 1;
    }
    runs.push({ text, italic: fmt.italic, smallCaps: fmt.smallCaps });
  }
  return runs;
}
