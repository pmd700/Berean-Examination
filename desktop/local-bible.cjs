'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const LEGACY_SOURCE_FILES = Object.freeze({
  LSV: 'lsv_1775867344760.txt',
});

const IMPORTED_BIBLE_VERSIONS = Object.freeze([
  'AKJV', 'ASV', 'BAB', 'BGB', 'BIB', 'BLB', 'BRB', 'BSB', 'CPDV', 'DBT',
  'DRB', 'ERV', 'JPS', 'KJV', 'MSB', 'SLT', 'WBT', 'WEB', 'YLT',
]);
const IMPORTED_BIBLE_VERSION_SET = new Set(IMPORTED_BIBLE_VERSIONS);
const LOCAL_BIBLE_VERSION_SET = new Set([...IMPORTED_BIBLE_VERSIONS, 'LSV']);

const LSV_BOOK_NAMES = Object.freeze({
  Gen: 'Genesis', Exo: 'Exodus', Lev: 'Leviticus', Num: 'Numbers', Deu: 'Deuteronomy',
  Jos: 'Joshua', Jdg: 'Judges', Rth: 'Ruth', '1Sa': '1 Samuel', '2Sa': '2 Samuel',
  '1Ki': '1 Kings', '2Ki': '2 Kings', '1Ch': '1 Chronicles', '2Ch': '2 Chronicles',
  Ezr: 'Ezra', Neh: 'Nehemiah', Est: 'Esther', Job: 'Job', Psa: 'Psalms',
  Pro: 'Proverbs', Ecc: 'Ecclesiastes', Sol: 'Song of Solomon', Isa: 'Isaiah',
  Jer: 'Jeremiah', Lam: 'Lamentations', Eze: 'Ezekiel', Dan: 'Daniel', Hos: 'Hosea',
  Joe: 'Joel', Amo: 'Amos', Oba: 'Obadiah', Jon: 'Jonah', Mic: 'Micah', Nah: 'Nahum',
  Hab: 'Habakkuk', Zep: 'Zephaniah', Hag: 'Haggai', Zec: 'Zechariah', Mal: 'Malachi',
  Mat: 'Matthew', Mar: 'Mark', Luk: 'Luke', Joh: 'John', Act: 'Acts', Rom: 'Romans',
  '1Co': '1 Corinthians', '2Co': '2 Corinthians', Gal: 'Galatians', Eph: 'Ephesians',
  Php: 'Philippians', Col: 'Colossians', '1Th': '1 Thessalonians',
  '2Th': '2 Thessalonians', '1Ti': '1 Timothy', '2Ti': '2 Timothy', Tit: 'Titus',
  Phm: 'Philemon', Heb: 'Hebrews', Jas: 'James', '1Pe': '1 Peter', '2Pe': '2 Peter',
  '1Jn': '1 John', '2Jn': '2 John', '3Jn': '3 John', Jud: 'Jude', Rev: 'Revelation',
  Son: 'Song of Solomon',
});

const LSV_SPECIAL_SECTIONS = Object.freeze(['Copyright', 'Preface', 'Introduction']);

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function chapterKey(book, chapter) {
  return `${book}\u0000${chapter}`;
}

function repairBsbTypography(text) {
  return text
    .replaceAll('â€œ', '“')
    .replaceAll('â€\u009D', '”')
    .replaceAll('â€™', '’')
    .replaceAll('â€”', '—')
    .replaceAll('â€˜', '‘')
    .replaceAll('â€¦', '…');
}

function addVerse(index, book, chapter, verse, text) {
  const key = chapterKey(book, chapter);
  const verses = index.get(key) || [];
  verses.push(`~${verse} ${text.trim()}`);
  index.set(key, verses);
}

function buildBsbIndex(sourceText) {
  const index = new Map();
  for (const line of repairBsbTypography(sourceText).split(/\r?\n/)) {
    const match = line.match(/^(.+?) (\d+):(\d+)\t(.*)$/);
    if (!match) continue;
    const [, sourceBook, chapter, verse, verseText] = match;
    const book = sourceBook === 'Psalm' ? 'Psalms' : sourceBook;
    addVerse(index, book, Number(chapter), Number(verse), verseText);
  }
  return new Map([...index].map(([key, verses]) => [key, verses.join('\n')]));
}

function formatSpecialSection(lines, sectionName) {
  const heading = sectionName === 'Copyright'
    ? 'COPYRIGHT INFORMATION'
    : sectionName === 'Preface'
      ? 'PREFACE TO THE LSV'
      : 'INTRODUCTION TO THE LSV';
  const headingIndex = lines.findIndex((line) => line.trim() === heading);
  if (headingIndex < 0) return '';

  let start = headingIndex + 1;
  while (start < lines.length && (!lines[start].trim() || /^-{5,}$/.test(lines[start].trim()))) {
    start += 1;
  }
  let end = start;
  while (end < lines.length && !/^-{5,}$/.test(lines[end].trim())) end += 1;

  const blocks = lines.slice(start, end).join('\n').trim().split(/\n\s*\n/);
  const prepared = [];
  let paragraphNumber = 1;
  for (const block of blocks) {
    const cleaned = block.replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;
    if (cleaned.startsWith('---') && cleaned.endsWith('---')) {
      prepared.push(`### ${cleaned.replace(/^-+\s*/, '').replace(/\s*-+$/, '')}`);
    } else {
      prepared.push(`~${paragraphNumber} ${cleaned}`);
      paragraphNumber += 1;
    }
  }
  return prepared.join('\n');
}

function buildLsvIndex(sourceText) {
  const lines = sourceText.split(/\r?\n/);
  const index = new Map();
  for (const line of lines) {
    const match = line.match(/^([A-Za-z0-9]+)\s+(\d+):(\d+)\s+(.+)$/);
    if (!match) continue;
    const [, abbreviation, chapter, verse, verseText] = match;
    const book = LSV_BOOK_NAMES[abbreviation];
    if (!book) continue;
    addVerse(index, book, Number(chapter), Number(verse), verseText);
  }
  for (const sectionName of LSV_SPECIAL_SECTIONS) {
    index.set(chapterKey(sectionName, 0), formatSpecialSection(lines, sectionName));
  }
  return new Map([...index].map(([key, value]) => [
    key,
    Array.isArray(value) ? value.join('\n') : value,
  ]));
}

function buildImportedIndex(payload, version) {
  if (
    payload?.schemaVersion !== 1
    || payload?.code !== version
    || !payload.chapters
    || typeof payload.chapters !== 'object'
  ) {
    throw codedError('BEX_BIBLE_INVALID', `${version} has an invalid local Bible index.`);
  }
  return new Map(Object.entries(payload.chapters));
}

class LocalBibleLibrary {
  constructor({ sourceFolder = path.resolve(__dirname, '..', 'attached_assets') } = {}) {
    this.sourceFolder = sourceFolder;
    this.indexPromises = new Map();
  }

  async loadIndex(version) {
    if (!LOCAL_BIBLE_VERSION_SET.has(version)) {
      throw codedError('BEX_BIBLE_INVALID', 'That local Bible translation is not available.');
    }
    if (!this.indexPromises.has(version)) {
      const promise = IMPORTED_BIBLE_VERSION_SET.has(version)
        ? fs.readFile(path.join(this.sourceFolder, 'bibles', `${version}.json`), 'utf8')
          .then((text) => buildImportedIndex(JSON.parse(text), version))
        : fs.readFile(path.join(this.sourceFolder, LEGACY_SOURCE_FILES[version]), 'utf8')
          .then(buildLsvIndex);
      this.indexPromises.set(version, promise);
      promise.catch(() => this.indexPromises.delete(version));
    }
    return this.indexPromises.get(version);
  }

  async readChapter(request) {
    const version = typeof request?.version === 'string' ? request.version.trim().toUpperCase() : '';
    const book = typeof request?.book === 'string' ? request.book.trim() : '';
    const chapter = Number(request?.chapter);
    const isSpecial = version === 'LSV' && LSV_SPECIAL_SECTIONS.includes(book);
    if (!LOCAL_BIBLE_VERSION_SET.has(version) || !book || book.length > 100) {
      throw codedError('BEX_BIBLE_INVALID', 'Choose a valid local Bible translation and book.');
    }
    if ((!isSpecial && (!Number.isSafeInteger(chapter) || chapter < 1 || chapter > 150))
      || (isSpecial && chapter !== 0)) {
      throw codedError('BEX_BIBLE_INVALID', 'Choose a valid chapter.');
    }
    const index = await this.loadIndex(version);
    const text = index.get(chapterKey(book, chapter));
    if (!text) {
      throw codedError('BEX_BIBLE_NOT_FOUND', `${version} ${book} ${chapter} was not found locally.`);
    }
    return Object.freeze({ book, chapter, text, version });
  }
}

const localBibleLibrary = new LocalBibleLibrary();

module.exports = {
  buildBsbIndex,
  buildImportedIndex,
  buildLsvIndex,
  IMPORTED_BIBLE_VERSIONS,
  LocalBibleLibrary,
  LSV_SPECIAL_SECTIONS,
  readLocalBibleChapter: (request) => localBibleLibrary.readChapter(request),
  repairBsbTypography,
};
