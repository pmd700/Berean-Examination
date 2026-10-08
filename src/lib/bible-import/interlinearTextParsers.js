/** Database-free parsers retained for future legally reviewed local source packages. */

export const SBLGNT_BOOK_CODES = Object.freeze({
  Matt: 'Matthew', Mark: 'Mark', Luke: 'Luke', John: 'John', Acts: 'Acts',
  Rom: 'Romans', '1Cor': '1 Corinthians', '2Cor': '2 Corinthians', Gal: 'Galatians',
  Eph: 'Ephesians', Phil: 'Philippians', Col: 'Colossians', '1Thess': '1 Thessalonians',
  '2Thess': '2 Thessalonians', '1Tim': '1 Timothy', '2Tim': '2 Timothy',
  Titus: 'Titus', Phlm: 'Philemon', Heb: 'Hebrews', Jas: 'James',
  '1Pet': '1 Peter', '2Pet': '2 Peter', '1John': '1 John', '2John': '2 John',
  '3John': '3 John', Jude: 'Jude', Rev: 'Revelation',
});

export const UXLC_BOOK_CODES = Object.freeze({
  Gen: 'Genesis', Ex: 'Exodus', Lev: 'Leviticus', Num: 'Numbers', Deut: 'Deuteronomy',
  Josh: 'Joshua', Judg: 'Judges', Ruth: 'Ruth', '1Sam': '1 Samuel', '2Sam': '2 Samuel',
  '1Kings': '1 Kings', '2Kings': '2 Kings', '1Chr': '1 Chronicles',
  '2Chr': '2 Chronicles', Ezra: 'Ezra', Neh: 'Nehemiah', Esth: 'Esther', Job: 'Job',
  Ps: 'Psalms', Prov: 'Proverbs', Eccl: 'Ecclesiastes', Song: 'Song of Solomon',
  Isa: 'Isaiah', Jer: 'Jeremiah', Lam: 'Lamentations', Ezek: 'Ezekiel', Dan: 'Daniel',
  Hos: 'Hosea', Joel: 'Joel', Am: 'Amos', Ob: 'Obadiah', Jon: 'Jonah', Mic: 'Micah',
  Nah: 'Nahum', Hab: 'Habakkuk', Zeph: 'Zephaniah', Hag: 'Haggai', Zech: 'Zechariah',
  Mal: 'Malachi',
});

const SBLGNT_VERSE = /^([1-3]?[A-Za-z]+)\s+(\d+):(\d+)\s*(.*)$/;
const UXLC_CHAPTER = /^xxxx\s+Chapter\s+(\d+)/i;
const UXLC_VERSE = /^(\d+)\s*׃\s*(\d+)\s+(.*)$/;
const DIRECTIONAL_CONTROLS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

export function parseSblgntText(text) {
  const records = [];
  for (const rawLine of String(text || '').replace(/^\uFEFF/, '').split('\n')) {
    const match = rawLine.replace(/\r$/, '').trimEnd().match(SBLGNT_VERSE);
    if (!match) continue;
    const [, code, chapterText, verseText, sourceText] = match;
    const book = SBLGNT_BOOK_CODES[code];
    if (!book) continue;
    const chapter = Number.parseInt(chapterText, 10);
    const verse = Number.parseInt(verseText, 10);
    records.push({
      source_text: 'SBLGNT',
      book,
      chapter,
      verse,
      greek_text: sourceText.trim(),
      ref_key: `SBLGNT:${book}:${chapter}:${verse}`,
    });
  }
  return records;
}

function cleanUxlcLine(line) {
  return line
    .replace(DIRECTIONAL_CONTROLS, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeHebrewText(text) {
  return text
    .replace(DIRECTIONAL_CONTROLS, '')
    .replace(/\[[^\]]+\]/g, '')
    .replace(/\*[^*\s]+\s+\*\*([^\s]+)/g, '$1')
    .replace(/\s+[ספ]$/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseUxlcText(text, canonicalBook) {
  if (!canonicalBook || typeof canonicalBook !== 'string') {
    throw new Error('A canonical book name is required for UXLC parsing.');
  }
  const records = [];
  let currentChapter = null;
  for (const rawLine of String(text || '').replace(/^\uFEFF/, '').split('\n')) {
    const line = cleanUxlcLine(rawLine.replace(/\r$/, ''));
    if (!line) continue;
    const chapterMatch = line.match(UXLC_CHAPTER);
    if (chapterMatch) {
      currentChapter = Number.parseInt(chapterMatch[1], 10);
      continue;
    }
    const verseMatch = line.match(UXLC_VERSE);
    if (!verseMatch) continue;
    const verse = Number.parseInt(verseMatch[1], 10);
    const chapter = currentChapter || Number.parseInt(verseMatch[2], 10);
    const hebrewText = normalizeHebrewText(verseMatch[3]);
    if (!hebrewText) continue;
    records.push({
      source_text: 'UXLC',
      book: canonicalBook,
      chapter,
      verse,
      hebrew_text: hebrewText,
      ref_key: `UXLC:${canonicalBook}:${chapter}:${verse}`,
    });
  }
  return records;
}
