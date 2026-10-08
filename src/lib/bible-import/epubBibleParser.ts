/**
 * Profile-driven EPUB Bible parser (source-agnostic, reusable).
 *
 * Turns the calibre-generated XHTML of a Bible EPUB into ordered rich-text
 * verse SEGMENTS (see shared/bibleSegments.ts). It is deliberately split into
 * small pure functions so a future EPUB of any translation can be onboarded by
 * tweaking the `EpubProfile` (the CSS-class conventions calibre emits) rather
 * than rewriting the walker:
 *
 *   parseFootnoteAsides(html, profile)  → Map<targetId, ResolvedNote>
 *   extractEvents(html, footnoteMap, profile) → BibleEvent[]   (per spine doc)
 *   assembleChapters(events)            → ParsedChapter[]       (pure)
 *
 * The event stream is intentionally flat so a database-free archive parser can concatenate the
 * events of every spine document belonging to a book (in spine order) and call
 * `assembleChapters` once — this transparently handles chapters that span
 * multiple split files.
 */

import { parse, HTMLElement, NodeType } from "node-html-parser";
import {
  type BibleSegment,
  segmentsToPlainText,
} from "@shared/bibleSegments";

// ─── Profile ────────────────────────────────────────────────────────────────

export interface EpubProfile {
  /** `<p>` class that introduces a "BOOK N" chapter head. */
  chapterHeadClass: string;
  /** `<p>` class for section headings. */
  sectionHeadClass: string;
  /** Class on the small-caps / superscript wrapper (calibre: "small1"). */
  smallWrapClass: string;
  /** Class on supplied-word italics (calibre: "calibre12"). */
  italicClass: string;
  /** Footnote-definition label span class (calibre: "footnote1"). */
  footnoteLabelClass: string;
  /** Footnote-definition body span class (calibre: "footnote2"). */
  footnoteBodyClass: string;
}

export const NASB2020_PROFILE: EpubProfile = {
  chapterHeadClass: "head",
  sectionHeadClass: "head2",
  smallWrapClass: "small1",
  italicClass: "calibre12",
  footnoteLabelClass: "footnote1",
  footnoteBodyClass: "footnote2",
};

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ResolvedNote {
  /** Footnote target id, e.g. "f5244-5". */
  targetId: string;
  /** Label letter, e.g. "g". */
  label: string;
  /** Verse reference "chapter:verse", e.g. "12:5". */
  verseRef: string;
  /** Classifier hint ("Lit" | "Or" | "Heb" | ...) when present. */
  noteType?: string;
  /** Flattened plain text of the note body. */
  noteBody: string;
  /** Rich note body (text + italic runs) for the popover. */
  noteSegments: BibleSegment[];
}

export type BibleEvent =
  | { kind: "chapter"; book: string; chapter: number }
  | { kind: "heading"; text: string }
  | { kind: "verseStart"; num: number; startsParagraph: boolean }
  | { kind: "seg"; seg: BibleSegment };

export interface ParsedVerse {
  verse: number;
  segments: BibleSegment[];
  plainText: string;
  heading?: string;
  startsParagraph: boolean;
}

export interface ParsedChapter {
  book: string;
  chapter: number;
  verses: ParsedVerse[];
}

const READING = new Set<BibleSegment["type"]>(["text", "italic", "smallCaps"]);

// ─── Entity decoding & whitespace ─────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named !== undefined ? named : whole;
  });
}

/** Collapse all whitespace (incl. newlines & nbsp) to single ASCII spaces. */
function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ");
}

// ─── Low-level node helpers ───────────────────────────────────────────────────

function isElement(node: any): node is HTMLElement {
  return node && node.nodeType === NodeType.ELEMENT_NODE;
}
function isText(node: any): boolean {
  return node && node.nodeType === NodeType.TEXT_NODE;
}
function tag(el: HTMLElement): string {
  return (el.rawTagName || "").toLowerCase();
}
function hasClass(el: HTMLElement, cls: string): boolean {
  return el.classList?.contains(cls) ?? false;
}

/** Decoded, whitespace-normalized concatenation of all descendant text. */
function deepText(node: any): string {
  if (isText(node)) return decodeEntities(node.rawText ?? "");
  if (isElement(node)) {
    let out = "";
    for (const child of node.childNodes) out += deepText(child);
    return out;
  }
  return "";
}

function findDescendant(
  el: HTMLElement,
  predicate: (e: HTMLElement) => boolean,
): HTMLElement | null {
  for (const child of el.childNodes) {
    if (isElement(child)) {
      if (predicate(child)) return child;
      const nested = findDescendant(child, predicate);
      if (nested) return nested;
    }
  }
  return null;
}

function isNoterefAnchor(el: HTMLElement): boolean {
  return (
    tag(el) === "a" &&
    (el.getAttribute("epub:type") === "noteref" ||
      (el.getAttribute("id") || "").startsWith("source"))
  );
}

// ─── Footnote aside parsing ───────────────────────────────────────────────────

/**
 * Parse an aside-bearing document into a map of footnote target id → resolved
 * note (label, verse ref, rich body). Aside shape:
 *
 *   <aside id="fX-Y" epub:type="footnote">
 *     <a ...><span class="footnote1">a</span>
 *            <span class="footnote2">9:1   Lit <i>host</i></span></a>
 *   </aside>
 */
export function parseFootnoteAsides(
  html: string,
  profile: EpubProfile = NASB2020_PROFILE,
): Map<string, ResolvedNote> {
  const map = new Map<string, ResolvedNote>();
  const root = parse(html);
  const asides = root.querySelectorAll("aside");
  for (const aside of asides) {
    const targetId = aside.getAttribute("id");
    if (!targetId) continue;

    const labelEl = aside.querySelector(`.${profile.footnoteLabelClass}`);
    const bodyEl = aside.querySelector(`.${profile.footnoteBodyClass}`);
    if (!bodyEl) continue;

    const label = labelEl ? normalizeWs(deepText(labelEl)).trim() : "";

    // Build rich body segments + extract the leading "ch:v" reference.
    const noteSegments: BibleSegment[] = [];
    let verseRef = "";
    let first = true;
    for (const child of bodyEl.childNodes) {
      if (isText(child)) {
        let txt = decodeEntities(child.rawText ?? "");
        if (first) {
          const m = txt.match(/^\s*(\d+:\d+[a-z]?)[\s\u00a0]+/);
          if (m) {
            verseRef = m[1];
            txt = txt.slice(m[0].length);
          }
          first = false;
        }
        txt = normalizeWs(txt);
        if (txt) noteSegments.push({ type: "text", text: txt });
      } else if (isElement(child)) {
        const t = tag(child);
        const inner = normalizeWs(deepText(child));
        if (!inner) continue;
        if (t === "i" || hasClass(child, profile.italicClass)) {
          noteSegments.push({ type: "italic", text: inner });
        } else {
          noteSegments.push({ type: "text", text: inner });
        }
        first = false;
      }
    }

    // Trim edges of the rich body.
    trimReadingEdges(noteSegments);
    const noteBody = noteSegments.map((s) => s.text ?? "").join("").trim();
    const noteType = noteBody.split(/\s+/)[0] || undefined;

    map.set(targetId, {
      targetId,
      label,
      verseRef,
      noteType,
      noteBody,
      noteSegments,
    });
  }
  return map;
}

// ─── Event extraction (per spine document) ────────────────────────────────────

/**
 * Walk one spine document and emit a flat ordered event stream. `footnoteMap`
 * resolves note markers inline so events are self-contained.
 */
export function extractEvents(
  html: string,
  footnoteMap: Map<string, ResolvedNote>,
  profile: EpubProfile = NASB2020_PROFILE,
): BibleEvent[] {
  const events: BibleEvent[] = [];
  const root = parse(html);
  const body = root.querySelector("body") || root;

  const emitSeg = (seg: BibleSegment) => events.push({ kind: "seg", seg });

  const walk = (node: any) => {
    if (isText(node)) {
      const txt = normalizeWs(decodeEntities(node.rawText ?? ""));
      if (txt) emitSeg({ type: "text", text: txt });
      return;
    }
    if (!isElement(node)) return;
    const el = node as HTMLElement;
    const t = tag(el);

    // Block-level: chapter head / section heading.
    if (t === "p" && hasClass(el, profile.chapterHeadClass)) {
      const parsed = parseChapterHead(deepText(el));
      if (parsed) events.push({ kind: "chapter", ...parsed });
      return;
    }
    if (t === "p" && hasClass(el, profile.sectionHeadClass)) {
      const text = normalizeWs(deepText(el)).trim();
      if (text) events.push({ kind: "heading", text });
      return;
    }

    // Line break.
    if (t === "br") {
      emitSeg({ type: "lineBreak" });
      return;
    }

    // Bare note-marker anchor.
    if (isNoterefAnchor(el)) {
      emitSeg(buildMarker(el, footnoteMap));
      return;
    }

    // Italic supplied words.
    if (t === "i" || hasClass(el, profile.italicClass)) {
      const text = normalizeWs(deepText(el));
      if (text) emitSeg({ type: "italic", text });
      return;
    }

    // small1 wrappers: verse numbers, note markers, or small-caps divine name.
    if (hasClass(el, profile.smallWrapClass)) {
      const handled = handleSmallWrap(el, footnoteMap, emitSeg, events);
      if (handled) return;
    }

    // Bare <sup> (rare, unwrapped).
    if (t === "sup") {
      const anchor = findDescendant(el, isNoterefAnchor);
      if (anchor) {
        emitSeg(buildMarker(anchor, footnoteMap));
        return;
      }
      const num = parseInt(normalizeWs(deepText(el)).trim(), 10);
      if (Number.isFinite(num)) {
        events.push({ kind: "verseStart", num, startsParagraph: false });
        return;
      }
    }

    // Default: recurse into container children.
    for (const child of el.childNodes) walk(child);
  };

  for (const child of body.childNodes) walk(child);
  return events;
}

/**
 * Interpret an element carrying the small-caps/superscript wrapper class.
 * Returns true if it produced an event (and recursion should stop).
 */
function handleSmallWrap(
  el: HTMLElement,
  footnoteMap: Map<string, ResolvedNote>,
  emitSeg: (s: BibleSegment) => void,
  events: BibleEvent[],
): boolean {
  // Note marker: contains a noteref anchor.
  const anchor = findDescendant(el, isNoterefAnchor);
  if (anchor) {
    emitSeg(buildMarker(anchor, footnoteMap));
    return true;
  }

  // Bold number → paragraph-starting verse.
  const bold = findDescendant(el, (e) => tag(e) === "b");
  if (bold) {
    const num = parseInt(normalizeWs(deepText(bold)).trim(), 10);
    if (Number.isFinite(num)) {
      events.push({ kind: "verseStart", num, startsParagraph: true });
      return true;
    }
  }

  // Superscript number → mid-paragraph verse.
  const sup = findDescendant(el, (e) => tag(e) === "sup");
  if (sup) {
    const num = parseInt(normalizeWs(deepText(sup)).trim(), 10);
    if (Number.isFinite(num)) {
      events.push({ kind: "verseStart", num, startsParagraph: false });
      return true;
    }
  }

  // Otherwise plain text inside the wrapper → small-caps (divine name).
  const text = normalizeWs(deepText(el));
  if (text) {
    emitSeg({ type: "smallCaps", text });
    return true;
  }
  return false;
}

function buildMarker(
  anchor: HTMLElement,
  footnoteMap: Map<string, ResolvedNote>,
): BibleSegment {
  const href = anchor.getAttribute("href") || "";
  const markerId = anchor.getAttribute("id") || "";
  const targetId = href.includes("#") ? href.split("#").pop()! : "";
  const anchorLabel = normalizeWs(deepText(anchor)).trim();
  const note = targetId ? footnoteMap.get(targetId) : undefined;
  return {
    type: "noteMarker",
    text: note?.label || anchorLabel,
    markerId,
    noteTargetId: targetId,
    href,
    noteRef: note?.verseRef,
    noteType: note?.noteType,
    noteBody: note?.noteBody,
    noteSegments: note?.noteSegments,
  };
}

/** Parse "EZEKIEL 12 [Books]" → { book: "EZEKIEL", chapter: 12 }. */
export function parseChapterHead(
  raw: string,
): { book: string; chapter: number } | null {
  let text = normalizeWs(raw).trim();
  text = text.replace(/\[Books\]\s*$/i, "").trim();
  const m = text.match(/^(.+?)\s+(\d+)$/);
  if (!m) return null;
  return { book: m[1].trim(), chapter: parseInt(m[2], 10) };
}

// ─── Assembly (pure) ──────────────────────────────────────────────────────────

/** Trim leading/trailing whitespace on the edge reading segments in place. */
function trimReadingEdges(segs: BibleSegment[]): void {
  while (segs.length && segs[0].type === "lineBreak") segs.shift();
  while (segs.length && segs[segs.length - 1].type === "lineBreak") segs.pop();

  for (let i = 0; i < segs.length; i++) {
    if (READING.has(segs[i].type)) {
      segs[i].text = (segs[i].text || "").replace(/^\s+/, "");
      if (segs[i].text === "") {
        segs.splice(i, 1);
        i--;
        continue;
      }
      break;
    }
  }
  for (let i = segs.length - 1; i >= 0; i--) {
    if (READING.has(segs[i].type)) {
      segs[i].text = (segs[i].text || "").replace(/\s+$/, "");
      if (segs[i].text === "") {
        segs.splice(i, 1);
        continue;
      }
      break;
    }
  }
}

/**
 * Turn a flat event stream (possibly spanning many spine docs of one book) into
 * structured chapters → verses, building plain text and attaching headings.
 */
export function assembleChapters(events: BibleEvent[]): ParsedChapter[] {
  const chapters: ParsedChapter[] = [];
  let chapter: ParsedChapter | null = null;
  let verse: ParsedVerse | null = null;
  let pendingHeading: string | undefined;

  const flushVerse = () => {
    if (!verse) return;
    trimReadingEdges(verse.segments);
    verse.plainText = segmentsToPlainText(verse.segments);
    if (verse.segments.length > 0) chapter?.verses.push(verse);
    verse = null;
  };

  for (const ev of events) {
    if (ev.kind === "chapter") {
      flushVerse();
      chapter = { book: ev.book, chapter: ev.chapter, verses: [] };
      chapters.push(chapter);
      pendingHeading = undefined;
    } else if (ev.kind === "heading") {
      // A heading after the last verse of a chapter still attaches to the next
      // verse (which may open the following chapter via a chapter event first).
      pendingHeading = pendingHeading
        ? `${pendingHeading} — ${ev.text}`
        : ev.text;
    } else if (ev.kind === "verseStart") {
      flushVerse();
      verse = {
        verse: ev.num,
        segments: [],
        plainText: "",
        heading: pendingHeading,
        startsParagraph: ev.startsParagraph,
      };
      pendingHeading = undefined;
    } else if (ev.kind === "seg") {
      if (verse) verse.segments.push({ ...ev.seg });
    }
  }
  flushVerse();
  return chapters;
}
