/** Database-free orchestration for parsing a complete Bible EPUB archive. */

import JSZip from "jszip";
import {
  assembleChapters,
  extractEvents,
  NASB2020_PROFILE,
  parseFootnoteAsides,
  type BibleEvent,
  type EpubProfile,
  type ParsedChapter,
  type ResolvedNote,
} from "./epubBibleParser";

const CANONICAL_BOOKS = [
  "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua",
  "Judges", "Ruth", "1 Samuel", "2 Samuel", "1 Kings", "2 Kings",
  "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah", "Esther", "Job",
  "Psalms", "Proverbs", "Ecclesiastes", "Song of Solomon", "Isaiah",
  "Jeremiah", "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos",
  "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai",
  "Zechariah", "Malachi", "Matthew", "Mark", "Luke", "John", "Acts",
  "Romans", "1 Corinthians", "2 Corinthians", "Galatians", "Ephesians",
  "Philippians", "Colossians", "1 Thessalonians", "2 Thessalonians",
  "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews", "James",
  "1 Peter", "2 Peter", "1 John", "2 John", "3 John", "Jude", "Revelation",
] as const;

const BOOK_LOOKUP = new Map<string, string>(
  CANONICAL_BOOKS.map((book) => [book.toUpperCase(), book]),
);
BOOK_LOOKUP.set("PSALM", "Psalms");

export function mapEpubBook(rawBook: string): string | null {
  return BOOK_LOOKUP.get(rawBook.trim().toUpperCase()) ?? null;
}

function resolveSpine(opf: string): string[] {
  const manifest: Record<string, string> = {};
  for (const match of opf.matchAll(/<item\b[^>]*>/g)) {
    const tag = match[0];
    const id = /id="([^"]+)"/.exec(tag)?.[1];
    const href = /href="([^"]+)"/.exec(tag)?.[1];
    if (id && href) manifest[id] = href;
  }

  const order: string[] = [];
  for (const match of opf.matchAll(/idref="([^"]+)"/g)) {
    const href = manifest[match[1]];
    if (href) order.push(href.replace(/^\.\//, ""));
  }
  return order;
}

export interface EpubBibleParseResult {
  chapters: ParsedChapter[];
  footnoteCount: number;
  docCount: number;
}

export async function parseEpubBibleArchive(
  buffer: Buffer,
  profile: EpubProfile = NASB2020_PROFILE,
): Promise<EpubBibleParseResult> {
  const zip = await JSZip.loadAsync(buffer);
  const opfFile = zip.file("content.opf");
  const opf = opfFile ? await opfFile.async("string") : "";
  const spine = opf ? resolveSpine(opf) : [];
  const documentPaths = spine.length > 0
    ? spine
    : Object.keys(zip.files).filter((name) => /text\/.*\.html?$/.test(name)).sort();

  const footnotes = new Map<string, ResolvedNote>();
  for (const documentPath of documentPaths) {
    const file = zip.file(documentPath) || zip.file(`OEBPS/${documentPath}`);
    if (!file) continue;
    const html = await file.async("string");
    if (!html.includes('epub:type="footnote"') && !html.includes("<aside")) continue;
    for (const [id, note] of parseFootnoteAsides(html, profile)) {
      if (!footnotes.has(id)) footnotes.set(id, note);
    }
  }

  const events: BibleEvent[] = [];
  let docCount = 0;
  for (const documentPath of documentPaths) {
    const file = zip.file(documentPath) || zip.file(`OEBPS/${documentPath}`);
    if (!file) continue;
    const html = await file.async("string");
    if (
      !html.includes(`class="${profile.smallWrapClass}"`)
      && !html.includes(`class="${profile.chapterHeadClass}"`)
    ) {
      continue;
    }
    docCount += 1;
    events.push(...extractEvents(html, footnotes, profile));
  }

  return {
    chapters: assembleChapters(events),
    footnoteCount: footnotes.size,
    docCount,
  };
}
