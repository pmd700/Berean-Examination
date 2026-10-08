'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAM_ATTRIBUTION = Object.freeze({
  source: 'Hebrew Wikisource',
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
});

const MAM_BOOK_FILES = Object.freeze({
  Genesis: ['A1-Genesis.json', 0], Exodus: ['A2-Exodus.json', 0],
  Leviticus: ['A3-Levit.json', 0], Numbers: ['A4-Numbers.json', 0],
  Deuteronomy: ['A5-Deuter.json', 0], Joshua: ['B1-Joshua.json', 0],
  Judges: ['B2-Judges.json', 0], '1 Samuel': ['BA-Samuel.json', 0],
  '2 Samuel': ['BA-Samuel.json', 1], '1 Kings': ['BC-Kings.json', 0],
  '2 Kings': ['BC-Kings.json', 1], Isaiah: ['C1-Isaiah.json', 0],
  Jeremiah: ['C2-Jeremiah.json', 0], Ezekiel: ['C3-Ezekiel.json', 0],
  Hosea: ['CA-The-12-Minor-Prophets.json', 0], Joel: ['CA-The-12-Minor-Prophets.json', 1],
  Amos: ['CA-The-12-Minor-Prophets.json', 2], Obadiah: ['CA-The-12-Minor-Prophets.json', 3],
  Jonah: ['CA-The-12-Minor-Prophets.json', 4], Micah: ['CA-The-12-Minor-Prophets.json', 5],
  Nahum: ['CA-The-12-Minor-Prophets.json', 6], Habakkuk: ['CA-The-12-Minor-Prophets.json', 7],
  Zephaniah: ['CA-The-12-Minor-Prophets.json', 8], Haggai: ['CA-The-12-Minor-Prophets.json', 9],
  Zechariah: ['CA-The-12-Minor-Prophets.json', 10], Malachi: ['CA-The-12-Minor-Prophets.json', 11],
  Psalms: ['D1-Psalms.json', 0], Proverbs: ['D2-Proverbs.json', 0], Job: ['D3-Job.json', 0],
  'Song of Solomon': ['E1-Song of Songs.json', 0], Ruth: ['E2-Ruth.json', 0],
  Lamentations: ['E3-Lamentations.json', 0], Ecclesiastes: ['E4-Ecclesiastes.json', 0],
  Esther: ['E5-Esther.json', 0], Daniel: ['F1-Daniel.json', 0],
  Ezra: ['FA-Ezra-Nexemiah.json', 0], Nehemiah: ['FA-Ezra-Nexemiah.json', 1],
  '1 Chronicles': ['FC-Chronicles.json', 0], '2 Chronicles': ['FC-Chronicles.json', 1],
});

const IGNORE_TEMPLATES = new Set(['מ:ספר חדש', 'מ:פסוק', 'מ:פרק', 'מ:תת ספר חדש']);

function extractNode(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(extractNode).join('');
  if (typeof node !== 'object') return '';
  const name = node.tmpl_name || '';
  const params = node.tmpl_params;
  if (IGNORE_TEMPLATES.has(name)) return '';
  if (name.startsWith('מ:לגרמיה')) return ' ׀ ';
  if (name.startsWith('מ:רווח') || /^ר\d+$/.test(name)) return ' ';
  if (!params) return '';
  if (name === 'מ:דחי') return extractNode(params['1']);
  if (name === 'מ:אות-מיוחדת-במילה') return extractNode(params['2']);
  if (name.startsWith('מ:אות')) return extractNode(params['1']);
  if (name === 'נוסח') return extractNode(params['1']);
  if (typeof params['2'] === 'string') return params['2'];
  return params['1'] === undefined ? '' : extractNode(params['1']);
}

function verseText(value) {
  return extractNode(value).replace(/\s+/g, ' ').trim();
}

class LocalMamLibrary {
  constructor({ sourceFolder = path.resolve(__dirname, '..', 'data', 'sources', 'mam-parsed', 'plus') } = {}) {
    this.sourceFolder = sourceFolder;
    this.bookCache = new Map();
  }

  loadBook(book) {
    if (this.bookCache.has(book)) return this.bookCache.get(book);
    const reference = MAM_BOOK_FILES[book];
    if (!reference) return null;
    const [fileName, bookIndex] = reference;
    const data = JSON.parse(fs.readFileSync(path.join(this.sourceFolder, fileName), 'utf8'));
    const chapters = data?.book39s?.[bookIndex]?.chapters;
    if (!chapters || typeof chapters !== 'object') return null;
    const parsed = {};
    for (const [chapter, verses] of Object.entries(chapters)) {
      parsed[chapter] = {};
      for (const [verse, value] of Object.entries(verses)) {
        const text = verseText(value);
        if (text) parsed[chapter][verse] = text;
      }
    }
    this.bookCache.set(book, parsed);
    return parsed;
  }

  readChapter(request) {
    const book = typeof request?.book === 'string' ? request.book.trim() : '';
    const chapter = Number(request?.chapter);
    if (!MAM_BOOK_FILES[book] || !Number.isSafeInteger(chapter) || chapter < 1 || chapter > 150) {
      const error = new Error('Choose a valid local MAM chapter.');
      error.code = 'BEX_MAM_INVALID';
      throw error;
    }
    const verses = this.loadBook(book)?.[String(chapter)];
    if (!verses || Object.keys(verses).length === 0) {
      const error = new Error(`MAM ${book} ${chapter} was not found locally.`);
      error.code = 'BEX_MAM_NOT_FOUND';
      throw error;
    }
    return Object.freeze({ attribution: MAM_ATTRIBUTION, book, chapter, verses });
  }
}

const localMamLibrary = new LocalMamLibrary();

module.exports = {
  extractNode,
  LocalMamLibrary,
  MAM_ATTRIBUTION,
  readLocalMamChapter: (request) => localMamLibrary.readChapter(request),
};
