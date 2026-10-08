// MAM (Miqra according to the Masorah) — Hebrew Tanakh source text.
//
// Source: Hebrew Wikisource (MAM "plus" parsed JSON, under data/sources/mam-parsed/plus).
// License: CC-BY-SA 4.0 — https://creativecommons.org/licenses/by-sa/4.0/
//
// This module reads the local parsed MAM JSON files on demand, extracts plain
// (cantillated) Hebrew verse text for a requested Old-Testament book + chapter,
// and caches the per-book result in memory. It is read-only and OT-only.
//
// The "plus" format stores each verse as an array of paragraph-lines; every line
// is an array mixing plain Hebrew strings with template objects (cantillation /
// markup markers). We walk that tree and keep only the readable Hebrew, mapping a
// small set of known markup templates to their displayed glyph/word.

import fs from "fs";
import path from "path";

export const MAM_ATTRIBUTION = {
  source: "Hebrew Wikisource",
  license: "CC-BY-SA 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
} as const;

// English book name (as used in the app's OLD_TESTAMENT list) → MAM "plus" file
// + the index of the sub-book inside that file's `book39s` array.
//
// Single-book files always use index 0. Combined files bundle several sub-books
// in canonical order; their `book39s` array order was verified directly against
// each file's `header.sub_book_names`:
//   BA-Samuel.json            [0]=1 Samuel   [1]=2 Samuel
//   BC-Kings.json             [0]=1 Kings    [1]=2 Kings
//   FC-Chronicles.json        [0]=1 Chron.   [1]=2 Chron.
//   FA-Ezra-Nexemiah.json     [0]=Ezra       [1]=Nehemiah
//   CA-The-12-Minor-Prophets.json  [0..11] = Hosea, Joel, Amos, Obadiah, Jonah,
//      Micah, Nahum, Habakkuk, Zephaniah, Haggai, Zechariah, Malachi
interface MamBookRef {
  file: string;
  index: number;
}
const MAM_BOOK_FILES: Record<string, MamBookRef> = {
  Genesis: { file: "A1-Genesis.json", index: 0 },
  Exodus: { file: "A2-Exodus.json", index: 0 },
  Leviticus: { file: "A3-Levit.json", index: 0 },
  Numbers: { file: "A4-Numbers.json", index: 0 },
  Deuteronomy: { file: "A5-Deuter.json", index: 0 },
  Joshua: { file: "B1-Joshua.json", index: 0 },
  Judges: { file: "B2-Judges.json", index: 0 },
  "1 Samuel": { file: "BA-Samuel.json", index: 0 },
  "2 Samuel": { file: "BA-Samuel.json", index: 1 },
  "1 Kings": { file: "BC-Kings.json", index: 0 },
  "2 Kings": { file: "BC-Kings.json", index: 1 },
  Isaiah: { file: "C1-Isaiah.json", index: 0 },
  Jeremiah: { file: "C2-Jeremiah.json", index: 0 },
  Ezekiel: { file: "C3-Ezekiel.json", index: 0 },
  Hosea: { file: "CA-The-12-Minor-Prophets.json", index: 0 },
  Joel: { file: "CA-The-12-Minor-Prophets.json", index: 1 },
  Amos: { file: "CA-The-12-Minor-Prophets.json", index: 2 },
  Obadiah: { file: "CA-The-12-Minor-Prophets.json", index: 3 },
  Jonah: { file: "CA-The-12-Minor-Prophets.json", index: 4 },
  Micah: { file: "CA-The-12-Minor-Prophets.json", index: 5 },
  Nahum: { file: "CA-The-12-Minor-Prophets.json", index: 6 },
  Habakkuk: { file: "CA-The-12-Minor-Prophets.json", index: 7 },
  Zephaniah: { file: "CA-The-12-Minor-Prophets.json", index: 8 },
  Haggai: { file: "CA-The-12-Minor-Prophets.json", index: 9 },
  Zechariah: { file: "CA-The-12-Minor-Prophets.json", index: 10 },
  Malachi: { file: "CA-The-12-Minor-Prophets.json", index: 11 },
  Psalms: { file: "D1-Psalms.json", index: 0 },
  Proverbs: { file: "D2-Proverbs.json", index: 0 },
  Job: { file: "D3-Job.json", index: 0 },
  "Song of Solomon": { file: "E1-Song of Songs.json", index: 0 },
  Ruth: { file: "E2-Ruth.json", index: 0 },
  Lamentations: { file: "E3-Lamentations.json", index: 0 },
  Ecclesiastes: { file: "E4-Ecclesiastes.json", index: 0 },
  Esther: { file: "E5-Esther.json", index: 0 },
  Daniel: { file: "F1-Daniel.json", index: 0 },
  Ezra: { file: "FA-Ezra-Nexemiah.json", index: 0 },
  Nehemiah: { file: "FA-Ezra-Nexemiah.json", index: 1 },
  "1 Chronicles": { file: "FC-Chronicles.json", index: 0 },
  "2 Chronicles": { file: "FC-Chronicles.json", index: 1 },
};

const MAM_DIR = path.join(process.cwd(), "data", "sources", "mam-parsed", "plus");

type MamNode = string | { tmpl_name?: string; tmpl_params?: Record<string, unknown> } | MamNode[] | null;

// Structural / metadata templates that carry NO readable verse text (book
// heading, verse marker, chapter marker, …). Their params hold book/chapter/
// verse identifiers, so they must be dropped rather than flattened.
const IGNORE_TEMPLATES = new Set(["מ:ספר חדש", "מ:פסוק", "מ:פרק", "מ:תת ספר חדש"]);

// Recursively flatten a MAM "plus" node into plain Hebrew text.
function extractNode(node: MamNode): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractNode).join("");
  if (typeof node === "object") {
    const name = node.tmpl_name || "";
    const p = node.tmpl_params;
    // drop structural/metadata markers (book/chapter/verse identifiers)
    if (IGNORE_TEMPLATES.has(name)) return "";
    // legarmeih / paseq → vertical bar separator
    if (name.startsWith("מ:לגרמיה")) return " ׀ ";
    // spacing markers (e.g. "מ:רווח בתרי עשר בפסוק הראשון") carry NO readable
    // text — their param holds a sub-book name used only for layout. Treat as
    // whitespace so the sub-book title never leaks into the first verse.
    if (name.startsWith("מ:רווח")) return " ";
    // resh+digit poetic spacing markers → space
    if (/^ר\d+$/.test(name)) return " ";
    if (!p) return "";
    // dehi (ga'ya variant) → contextual full word in param "1"
    if (name === "מ:דחי") return extractNode(p["1"] as MamNode);
    // special letter inside a word → param "2" holds the assembled full word
    if (name === "מ:אות-מיוחדת-במילה") return extractNode(p["2"] as MamNode);
    // single special letters → param "1" holds the glyph
    if (name.startsWith("מ:אות")) return extractNode(p["1"] as MamNode);
    // text/version wrapper → recurse into param "1"
    if (name === "נוסח") return extractNode(p["1"] as MamNode);
    // default: prefer a plain string param "2", then "1", else recurse first
    if (typeof p["2"] === "string") return p["2"] as string;
    if (p["1"] !== undefined) return extractNode(p["1"] as MamNode);
    return "";
  }
  return "";
}

function verseText(verseArr: MamNode): string {
  return extractNode(verseArr).replace(/\s+/g, " ").trim();
}

// Parsed per-book cache: book name → { chapter → { verse → text } }.
const bookCache = new Map<string, Record<string, Record<string, string>>>();

function loadBook(book: string): Record<string, Record<string, string>> | null {
  if (bookCache.has(book)) return bookCache.get(book)!;
  const ref = MAM_BOOK_FILES[book];
  if (!ref) return null;
  const fullPath = path.join(MAM_DIR, ref.file);
  if (!fs.existsSync(fullPath)) {
    console.error(`[mam] file missing for ${book}: ${fullPath}`);
    return null;
  }
  let data: any;
  try {
    data = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch (err: any) {
    console.error(`[mam] failed to parse ${ref.file}:`, err?.message || err);
    return null;
  }
  const chapters = data?.book39s?.[ref.index]?.chapters;
  if (!chapters || typeof chapters !== "object") {
    console.error(`[mam] no chapters found in ${ref.file} (book39s[${ref.index}] for ${book})`);
    return null;
  }
  const out: Record<string, Record<string, string>> = {};
  for (const [chapNum, verses] of Object.entries<any>(chapters)) {
    const vmap: Record<string, string> = {};
    for (const [vNum, vArr] of Object.entries<any>(verses)) {
      const text = verseText(vArr as MamNode);
      if (text) vmap[vNum] = text;
    }
    out[chapNum] = vmap;
  }
  bookCache.set(book, out);
  return out;
}

export function isMamAvailable(book: string): boolean {
  return !!MAM_BOOK_FILES[book];
}

export interface MamChapterResult {
  ok: boolean;
  available: boolean;
  book: string;
  chapter: number;
  verses: Record<string, string>;
  attribution: typeof MAM_ATTRIBUTION;
  error?: string;
}

export function getMamChapter(book: string, chapter: number): MamChapterResult {
  const base = {
    available: isMamAvailable(book),
    book,
    chapter,
    verses: {} as Record<string, string>,
    attribution: MAM_ATTRIBUTION,
  };
  if (!base.available) {
    return { ok: false, ...base, error: `MAM Hebrew source is not available for "${book}".` };
  }
  const parsed = loadBook(book);
  if (!parsed) {
    return { ok: false, ...base, error: `MAM source data for "${book}" could not be loaded.` };
  }
  const verses = parsed[String(chapter)];
  if (!verses || Object.keys(verses).length === 0) {
    return { ok: false, ...base, error: `MAM ${book} chapter ${chapter} not found.` };
  }
  return { ok: true, ...base, verses };
}
