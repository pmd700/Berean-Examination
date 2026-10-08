/** Database-free parsers retained for licensed local Bible source files. */

export interface ParsedVerseRow {
  translation: string;
  book: string;
  chapter: number;
  verse: number;
  text: string;
}

export const LSV_BOOK_MAP: Record<string, string> = {
  Gen: "Genesis", Exo: "Exodus", Lev: "Leviticus", Num: "Numbers",
  Deu: "Deuteronomy", Jos: "Joshua", Jdg: "Judges", Rth: "Ruth",
  "1Sa": "1 Samuel", "2Sa": "2 Samuel", "1Ki": "1 Kings", "2Ki": "2 Kings",
  "1Ch": "1 Chronicles", "2Ch": "2 Chronicles", Ezr: "Ezra", Neh: "Nehemiah",
  Est: "Esther", Job: "Job", Psa: "Psalms", Pro: "Proverbs",
  Ecc: "Ecclesiastes", Son: "Song of Solomon", Sol: "Song of Solomon",
  Isa: "Isaiah", Jer: "Jeremiah", Lam: "Lamentations", Eze: "Ezekiel",
  Dan: "Daniel", Hos: "Hosea", Joe: "Joel", Amo: "Amos", Oba: "Obadiah",
  Jon: "Jonah", Mic: "Micah", Nah: "Nahum", Hab: "Habakkuk",
  Zep: "Zephaniah", Hag: "Haggai", Zec: "Zechariah", Mal: "Malachi",
  Mat: "Matthew", Mar: "Mark", Luk: "Luke", Joh: "John", Act: "Acts",
  Rom: "Romans", "1Co": "1 Corinthians", "2Co": "2 Corinthians", Gal: "Galatians",
  Eph: "Ephesians", Php: "Philippians", Col: "Colossians",
  "1Th": "1 Thessalonians", "2Th": "2 Thessalonians",
  "1Ti": "1 Timothy", "2Ti": "2 Timothy", Tit: "Titus", Phm: "Philemon",
  Heb: "Hebrews", Jas: "James", "1Pe": "1 Peter", "2Pe": "2 Peter",
  "1Jn": "1 John", "2Jn": "2 John", "3Jn": "3 John", Jud: "Jude",
  Rev: "Revelation",
};

const WIN1252_REVERSE: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84,
  0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
  0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

export function fixBsbEncoding(text: string): string {
  const bytes: number[] = [];
  for (const char of text) {
    const codePoint = char.codePointAt(0)!;
    if (codePoint in WIN1252_REVERSE) {
      bytes.push(WIN1252_REVERSE[codePoint]);
    } else if (codePoint <= 0xff) {
      bytes.push(codePoint);
    } else {
      bytes.push(...Buffer.from(char, "utf8"));
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

/** Parse the tab-separated BSB source format. The first three lines are headers. */
export function parseBsbText(content: string): ParsedVerseRow[] {
  const rows: ParsedVerseRow[] = [];
  const lines = content.split(/\r?\n/);
  for (let index = 3; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const tabIndex = line.indexOf("\t");
    if (!line || tabIndex < 0) continue;

    const reference = line.slice(0, tabIndex).trim();
    const rawText = line.slice(tabIndex + 1).trim();
    const colonIndex = reference.lastIndexOf(":");
    if (!rawText || colonIndex < 0) continue;

    const beforeColon = reference.slice(0, colonIndex);
    const chapterSpace = beforeColon.lastIndexOf(" ");
    const verse = Number.parseInt(reference.slice(colonIndex + 1), 10);
    if (chapterSpace < 0 || !Number.isSafeInteger(verse)) continue;

    const book = beforeColon.slice(0, chapterSpace).trim();
    const chapter = Number.parseInt(beforeColon.slice(chapterSpace + 1), 10);
    if (!book || !Number.isSafeInteger(chapter)) continue;

    rows.push({
      translation: "BSB",
      book,
      chapter,
      verse,
      text: fixBsbEncoding(rawText),
    });
  }
  return rows;
}

/** Parse the space-separated LSV source format. */
export function parseLsvText(content: string): ParsedVerseRow[] {
  const rows: ParsedVerseRow[] = [];
  const versePattern = /^([A-Z0-9][a-zA-Z]+)\s+(\d+):(\d+)\s+(.+)$/;
  for (const rawLine of content.split(/\r?\n/)) {
    const match = versePattern.exec(rawLine.trim());
    if (!match) continue;
    const book = LSV_BOOK_MAP[match[1]];
    const text = match[4].trim();
    if (!book || !text) continue;
    rows.push({
      translation: "LSV",
      book,
      chapter: Number.parseInt(match[2], 10),
      verse: Number.parseInt(match[3], 10),
      text,
    });
  }
  return rows;
}

/** Parse the historical NASB1995 plain-text layout if licensed again later. */
export function parseNasb1995Text(content: string): ParsedVerseRow[] {
  const rows: ParsedVerseRow[] = [];
  const chapterPattern = /^(.+?)\s+(\d+)\s+New American Standard Bible\s*$/i;
  const versePattern = /^(\d+)\s+(.+)$/;
  const seenChapters = new Set<string>();
  let currentBook = "";
  let currentChapter = 0;
  let currentVerse = 0;
  let currentText = "";

  const flushVerse = () => {
    if (currentBook && currentChapter > 0 && currentVerse > 0 && currentText.trim()) {
      rows.push({
        translation: "NASB1995",
        book: currentBook,
        chapter: currentChapter,
        verse: currentVerse,
        text: currentText.replace(/\s+/g, " ").trim(),
      });
    }
    currentVerse = 0;
    currentText = "";
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    const chapterMatch = chapterPattern.exec(line);
    if (chapterMatch) {
      const nextBook = chapterMatch[1].trim();
      const nextChapter = Number.parseInt(chapterMatch[2], 10);
      const key = `${nextBook}:${nextChapter}`;
      if (!seenChapters.has(key)) {
        flushVerse();
        seenChapters.add(key);
        currentBook = nextBook;
        currentChapter = nextChapter;
      }
      continue;
    }
    if (!currentBook) continue;
    if (!line) {
      if (currentVerse > 0 && currentText.trim()) flushVerse();
      continue;
    }
    const verseMatch = versePattern.exec(line);
    if (verseMatch) {
      flushVerse();
      currentVerse = Number.parseInt(verseMatch[1], 10);
      currentText = verseMatch[2];
    } else if (currentVerse > 0) {
      currentText += ` ${line}`;
    }
  }
  flushVerse();
  return rows;
}
