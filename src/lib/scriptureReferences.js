/**
 * Scripture Reference Parser and Interpreter for API.Bible
 *
 * Supports single and mixed references such as:
 *   "Jn1:1-3, mark 5:1,3-4, revelation 2-3, 4:4"
 *
 * Converts references into canonical USFM IDs and request plans:
 * - passages: "JHN.1.1-JHN.1.3"
 * - verses:   "MRK.5.1"
 * - chapters: "REV.2"
 */

export const USFM_BOOKS = {
  // Law / Pentateuch
  GEN: { id: 'GEN', name: 'Genesis', chapters: 50 },
  EXO: { id: 'EXO', name: 'Exodus', chapters: 40 },
  LEV: { id: 'LEV', name: 'Leviticus', chapters: 27 },
  NUM: { id: 'NUM', name: 'Numbers', chapters: 36 },
  DEU: { id: 'DEU', name: 'Deuteronomy', chapters: 34 },

  // History
  JOS: { id: 'JOS', name: 'Joshua', chapters: 24 },
  JDG: { id: 'JDG', name: 'Judges', chapters: 21 },
  RUT: { id: 'RUT', name: 'Ruth', chapters: 4 },
  '1SA': { id: '1SA', name: '1 Samuel', chapters: 31 },
  '2SA': { id: '2SA', name: '2 Samuel', chapters: 24 },
  '1KI': { id: '1KI', name: '1 Kings', chapters: 22 },
  '2KI': { id: '2KI', name: '2 Kings', chapters: 25 },
  '1CH': { id: '1CH', name: '1 Chronicles', chapters: 29 },
  '2CH': { id: '2CH', name: '2 Chronicles', chapters: 36 },
  EZR: { id: 'EZR', name: 'Ezra', chapters: 10 },
  NEH: { id: 'NEH', name: 'Nehemiah', chapters: 13 },
  EST: { id: 'EST', name: 'Esther', chapters: 10 },

  // Poetry / Wisdom
  JOB: { id: 'JOB', name: 'Job', chapters: 42 },
  PSA: { id: 'PSA', name: 'Psalms', chapters: 150 },
  PRO: { id: 'PRO', name: 'Proverbs', chapters: 31 },
  ECC: { id: 'ECC', name: 'Ecclesiastes', chapters: 12 },
  SNG: { id: 'SNG', name: 'Song of Solomon', chapters: 8 },

  // Major Prophets
  ISA: { id: 'ISA', name: 'Isaiah', chapters: 66 },
  JER: { id: 'JER', name: 'Jeremiah', chapters: 52 },
  LAM: { id: 'LAM', name: 'Lamentations', chapters: 5 },
  EZK: { id: 'EZK', name: 'Ezekiel', chapters: 48 },
  DAN: { id: 'DAN', name: 'Daniel', chapters: 12 },

  // Minor Prophets
  HOS: { id: 'HOS', name: 'Hosea', chapters: 14 },
  JOL: { id: 'JOL', name: 'Joel', chapters: 3 },
  AMO: { id: 'AMO', name: 'Amos', chapters: 9 },
  OBA: { id: 'OBA', name: 'Obadiah', chapters: 1, singleChapter: true },
  JON: { id: 'JON', name: 'Jonah', chapters: 4 },
  MIC: { id: 'MIC', name: 'Micah', chapters: 7 },
  NAM: { id: 'NAM', name: 'Nahum', chapters: 3 },
  HAB: { id: 'HAB', name: 'Habakkuk', chapters: 3 },
  ZEP: { id: 'ZEP', name: 'Zephaniah', chapters: 3 },
  HAG: { id: 'HAG', name: 'Haggai', chapters: 2 },
  ZEC: { id: 'ZEC', name: 'Zechariah', chapters: 14 },
  MAL: { id: 'MAL', name: 'Malachi', chapters: 4 },

  // Gospels & Acts
  MAT: { id: 'MAT', name: 'Matthew', chapters: 28 },
  MRK: { id: 'MRK', name: 'Mark', chapters: 16 },
  LUK: { id: 'LUK', name: 'Luke', chapters: 24 },
  JHN: { id: 'JHN', name: 'John', chapters: 21 },
  ACT: { id: 'ACT', name: 'Acts', chapters: 28 },

  // Epistles
  ROM: { id: 'ROM', name: 'Romans', chapters: 16 },
  '1CO': { id: '1CO', name: '1 Corinthians', chapters: 16 },
  '2CO': { id: '2CO', name: '2 Corinthians', chapters: 13 },
  GAL: { id: 'GAL', name: 'Galatians', chapters: 6 },
  EPH: { id: 'EPH', name: 'Ephesians', chapters: 6 },
  PHP: { id: 'PHP', name: 'Philippians', chapters: 4 },
  COL: { id: 'COL', name: 'Colossians', chapters: 4 },
  '1TH': { id: '1TH', name: '1 Thessalonians', chapters: 5 },
  '2TH': { id: '2TH', name: '2 Thessalonians', chapters: 3 },
  '1TI': { id: '1TI', name: '1 Timothy', chapters: 6 },
  '2TI': { id: '2TI', name: '2 Timothy', chapters: 4 },
  TIT: { id: 'TIT', name: 'Titus', chapters: 3 },
  PHM: { id: 'PHM', name: 'Philemon', chapters: 1, singleChapter: true },
  HEB: { id: 'HEB', name: 'Hebrews', chapters: 13 },
  JAS: { id: 'JAS', name: 'James', chapters: 5 },
  '1PE': { id: '1PE', name: '1 Peter', chapters: 5 },
  '2PE': { id: '2PE', name: '2 Peter', chapters: 3 },
  '1JN': { id: '1JN', name: '1 John', chapters: 5 },
  '2JN': { id: '2JN', name: '2 John', chapters: 1, singleChapter: true },
  '3JN': { id: '3JN', name: '3 John', chapters: 1, singleChapter: true },
  JUD: { id: 'JUD', name: 'Jude', chapters: 1, singleChapter: true },
  REV: { id: 'REV', name: 'Revelation', chapters: 22 },
};

const ALIAS_MAP = {
  // Genesis
  gen: 'GEN', genesis: 'GEN', ge: 'GEN',
  // Exodus
  ex: 'EXO', exo: 'EXO', exodus: 'EXO',
  // Leviticus
  lev: 'LEV', le: 'LEV', leviticus: 'LEV',
  // Numbers
  num: 'NUM', nu: 'NUM', numbers: 'NUM',
  // Deuteronomy
  deut: 'DEU', de: 'DEU', dt: 'DEU', deuteronomy: 'DEU',
  // Joshua
  josh: 'JOS', joshua: 'JOS',
  // Judges
  judg: 'JDG', jdg: 'JDG', judges: 'JDG',
  // Ruth
  ruth: 'RUT', rth: 'RUT', ru: 'RUT',
  // Samuels
  '1sam': '1SA', '1 sam': '1SA', '1samuel': '1SA', '1 samuel': '1SA', '1s': '1SA',
  '2sam': '2SA', '2 sam': '2SA', '2samuel': '2SA', '2 samuel': '2SA', '2s': '2SA',
  // Kings
  '1kings': '1KI', '1 kings': '1KI', '1k': '1KI', '1ki': '1KI',
  '2kings': '2KI', '2 kings': '2KI', '2k': '2KI', '2ki': '2KI',
  // Chronicles
  '1chron': '1CH', '1 chron': '1CH', '1chronicles': '1CH', '1 chronicles': '1CH', '1ch': '1CH',
  '2chron': '2CH', '2 chron': '2CH', '2chronicles': '2CH', '2 chronicles': '2CH', '2ch': '2CH',
  // Ezra, Nehemiah, Esther
  ezra: 'EZR', ezr: 'EZR',
  neh: 'NEH', nehemiah: 'NEH',
  esth: 'EST', esther: 'EST', est: 'EST',
  // Job, Psalms, Proverbs, Eccl, Song
  job: 'JOB', jb: 'JOB',
  ps: 'PSA', psalm: 'PSA', psalms: 'PSA', psa: 'PSA',
  prov: 'PRO', proverbs: 'PRO', pr: 'PRO', pro: 'PRO',
  eccl: 'ECC', ecclesiastes: 'ECC', ecc: 'ECC', qoh: 'ECC',
  song: 'SNG', 'song of solomon': 'SNG', 'song of songs': 'SNG', sng: 'SNG', sos: 'SNG', canticles: 'SNG',
  // Prophets
  isa: 'ISA', isaiah: 'ISA', is: 'ISA',
  jer: 'JER', jeremiah: 'JER',
  lam: 'LAM', lamentations: 'LAM',
  ezk: 'EZK', ezek: 'EZK', ezekiel: 'EZK',
  dan: 'DAN', daniel: 'DAN', da: 'DAN',
  hos: 'HOS', hosea: 'HOS',
  joel: 'JOL', jol: 'JOL',
  amos: 'AMO', amo: 'AMO',
  obad: 'OBA', obadiah: 'OBA', oba: 'OBA',
  jonah: 'JON', jon: 'JON',
  mic: 'MIC', micah: 'MIC',
  nah: 'NAM', nahum: 'NAM', nam: 'NAM',
  hab: 'HAB', habakkuk: 'HAB',
  zeph: 'ZEP', zephaniah: 'ZEP', zep: 'ZEP',
  hag: 'HAG', haggai: 'HAG',
  zech: 'ZEC', zechariah: 'ZEC', zec: 'ZEC',
  mal: 'MAL', malachi: 'MAL',
  // Gospels & Acts
  mat: 'MAT', matt: 'MAT', matthew: 'MAT', mt: 'MAT',
  mrk: 'MRK', mark: 'MRK', mk: 'MRK',
  luk: 'LUK', luke: 'LUK', lk: 'LUK',
  jhn: 'JHN', john: 'JHN', jn: 'JHN',
  act: 'ACT', acts: 'ACT',
  // Epistles
  rom: 'ROM', romans: 'ROM', ro: 'ROM',
  '1cor': '1CO', '1 cor': '1CO', '1corinthians': '1CO', '1 corinthians': '1CO', '1co': '1CO',
  '2cor': '2CO', '2 cor': '2CO', '2corinthians': '2CO', '2 corinthians': '2CO', '2co': '2CO',
  gal: 'GAL', galatians: 'GAL', ga: 'GAL',
  eph: 'EPH', ephesians: 'EPH',
  phil: 'PHP', php: 'PHP', philippians: 'PHP',
  col: 'COL', colossians: 'COL',
  '1thess': '1TH', '1 thess': '1TH', '1thessalonians': '1TH', '1 thessalonians': '1TH', '1th': '1TH',
  '2thess': '2TH', '2 thess': '2TH', '2thessalonians': '2TH', '2 thessalonians': '2TH', '2th': '2TH',
  '1tim': '1TI', '1 tim': '1TI', '1timothy': '1TI', '1 timothy': '1TI', '1ti': '1TI',
  '2tim': '2TI', '2 tim': '2TI', '2timothy': '2TI', '2 timothy': '2TI', '2ti': '2TI',
  tit: 'TIT', titus: 'TIT',
  phlm: 'PHM', phm: 'PHM', philemon: 'PHM',
  heb: 'HEB', hebrews: 'HEB',
  jas: 'JAS', james: 'JAS', jm: 'JAS',
  '1pet': '1PE', '1 pet': '1PE', '1peter': '1PE', '1 peter': '1PE', '1pe': '1PE',
  '2pet': '2PE', '2 pet': '2PE', '2peter': '2PE', '2 peter': '2PE', '2pe': '2PE',
  '1jn': '1JN', '1 jn': '1JN', '1john': '1JN', '1 john': '1JN',
  '2jn': '2JN', '2 jn': '2JN', '2john': '2JN', '2 john': '2JN',
  '3jn': '3JN', '3 jn': '3JN', '3john': '3JN', '3 john': '3JN',
  jude: 'JUD', jud: 'JUD', jd: 'JUD',
  rev: 'REV', revelation: 'REV', revelations: 'REV',
};

// Normalize dash variations to standard hyphen
function cleanDashes(str) {
  return str.replace(/[–—−]/g, '-');
}

/**
 * Resolves a book token (e.g. "Jn", "1 John", "mark", "rev") to USFM book object
 */
export function resolveBook(token) {
  if (!token) return null;
  const clean = token.toLowerCase().replace(/[^a-z0-9]/g, '');
  const id = ALIAS_MAP[clean] || (USFM_BOOKS[clean.toUpperCase()] ? clean.toUpperCase() : null);
  return id ? USFM_BOOKS[id] : null;
}

/**
 * Checks if a string looks like a reference (e.g. starts with book name or number + book name)
 */
export function isLikelyReference(input) {
  if (!input || typeof input !== 'string') return false;
  const trimmed = cleanDashes(input.trim());
  // Matches book name pattern (letters optionally prefixed by 1-3) followed by digits
  const match = trimmed.match(/^([1-3]?\s*[a-zA-Z]+)\s*\d/);
  if (!match) return false;
  return Boolean(resolveBook(match[1]));
}

/**
 * Main parser: Parses an input string into presentation groups and retrieval units.
 */
export function parseScriptureQuery(input) {
  if (!input || typeof input !== 'string') {
    return { isReference: false, groups: [], requests: [], summary: '' };
  }

  const raw = cleanDashes(input.trim());
  if (!raw) {
    return { isReference: false, groups: [], requests: [], summary: '' };
  }

  // Tokenize clauses by semicolon or by comma that precedes a book name
  // To handle clauses like "Jn1:1-3, mark 5:1,3-4, revelation 2-3, 4:4"
  const tokens = splitIntoClauses(raw);
  if (tokens.length === 0) {
    return { isReference: false, groups: [], requests: [], summary: '' };
  }

  const groups = [];
  let currentBook = null;
  let currentChapter = null;

  for (const token of tokens) {
    const parsed = parseClause(token, currentBook, currentChapter);
    if (!parsed || parsed.length === 0) continue;

    for (const item of parsed) {
      currentBook = item.book;
      currentChapter = item.lastChapter || currentChapter;
      groups.push(item);
    }
  }

  if (groups.length === 0) {
    return { isReference: false, groups: [], requests: [], summary: '' };
  }

  // Flatten all requests across groups
  const requests = [];
  for (const group of groups) {
    for (const req of group.requests) {
      requests.push(req);
    }
  }

  const summary = groups.map((g) => g.label).join('; ');

  return {
    isReference: true,
    groups,
    requests,
    summary,
  };
}

/**
 * Splits input string by semicolon ';' or commas that precede book names.
 * Commas that separate verses (e.g. "5:1,3-4") are retained in the clause.
 */
function splitIntoClauses(raw) {
  const parts = [];
  // Split by semicolon first
  const semiBlocks = raw.split(';').map((s) => s.trim()).filter(Boolean);

  for (const block of semiBlocks) {
    // Inside a block, split by comma, but check if the chunk after comma starts a new book or has a colon
    const commaParts = block.split(',').map((s) => s.trim()).filter(Boolean);
    let accumulator = '';

    for (let i = 0; i < commaParts.length; i++) {
      const part = commaParts[i];
      if (!accumulator) {
        accumulator = part;
        continue;
      }

      // Check if `part` has a book name at the start
      const bookMatch = part.match(/^([1-3]?\s*[a-zA-Z]+)/);
      const isNewBook = bookMatch && resolveBook(bookMatch[1]);

      // Or if `part` has chapter:verse structure like "4:4" after a chapter range
      const isNewChapterVerse = /^\d+:\d+/.test(part);

      if (isNewBook || isNewChapterVerse) {
        parts.push(accumulator);
        accumulator = part;
      } else {
        // It's a continuation like "3-4" in "mark 5:1,3-4"
        accumulator += `, ${part}`;
      }
    }
    if (accumulator) {
      parts.push(accumulator);
    }
  }

  return parts;
}

/**
 * Parses a single clause like "Jn1:1-3", "mark 5:1, 3-4", "revelation 2-3", or "4:4"
 */
function parseClause(clauseText, inheritedBook, inheritedChapter) {
  const text = clauseText.trim();
  if (!text) return [];

  // Check if text starts with a book name
  let book = inheritedBook;
  let remainder = text;

  const bookMatch = text.match(/^([1-3]?\s*[a-zA-Z]+)\s*(.*)$/);
  if (bookMatch) {
    const resolved = resolveBook(bookMatch[1]);
    if (resolved) {
      book = resolved;
      remainder = bookMatch[2].trim();
    }
  }

  if (!book) return [];

  // If book is a single-chapter book (e.g. Jude) and remainder is just "5", treat as "1:5"
  if (book.singleChapter && /^\d+/.test(remainder) && !remainder.includes(':')) {
    remainder = `1:${remainder}`;
  }

  // Remainder could be:
  // 1) "5:1, 3-4" (chapter 5, verses 1 and 3-4)
  // 2) "1:1-3" (chapter 1, verses 1-3)
  // 3) "2-3" (chapters 2 to 3)
  // 4) "8" (whole chapter 8)
  // 5) "3:16-4:2" (cross-chapter passage)

  // Sub-split by comma for verse lists like "5:1, 3-4"
  const subItems = remainder.split(',').map((s) => s.trim()).filter(Boolean);
  const results = [];
  let currentChapter = inheritedChapter;

  for (const item of subItems) {
    // Cross-chapter range check: "3:16-4:2"
    const crossChapterMatch = item.match(/^(\d+):(\d+)-(\d+):(\d+)$/);
    if (crossChapterMatch) {
      const chStart = crossChapterMatch[1];
      const vStart = crossChapterMatch[2];
      const chEnd = crossChapterMatch[3];
      const vEnd = crossChapterMatch[4];
      const passageId = `${book.id}.${chStart}.${vStart}-${book.id}.${chEnd}.${vEnd}`;
      results.push({
        label: `${book.name} ${chStart}:${vStart}–${chEnd}:${vEnd}`,
        book,
        lastChapter: parseInt(chEnd, 10),
        requests: [{
          type: 'passage',
          id: passageId,
          bookId: book.id,
          label: `${book.name} ${chStart}:${vStart}–${chEnd}:${vEnd}`,
        }],
      });
      continue;
    }

    // Verse range with chapter: "1:1-3" or "5:3-4"
    const chRangeMatch = item.match(/^(\d+):(\d+)-(\d+)$/);
    if (chRangeMatch) {
      const ch = chRangeMatch[1];
      const vStart = chRangeMatch[2];
      const vEnd = chRangeMatch[3];
      currentChapter = parseInt(ch, 10);
      const passageId = `${book.id}.${ch}.${vStart}-${book.id}.${ch}.${vEnd}`;
      results.push({
        label: `${book.name} ${ch}:${vStart}–${vEnd}`,
        book,
        lastChapter: currentChapter,
        requests: [{
          type: 'passage',
          id: passageId,
          bookId: book.id,
          label: `${book.name} ${ch}:${vStart}–${vEnd}`,
        }],
      });
      continue;
    }

    // Single verse with chapter: "5:1" or "4:4"
    const chSingleMatch = item.match(/^(\d+):(\d+)$/);
    if (chSingleMatch) {
      const ch = chSingleMatch[1];
      const v = chSingleMatch[2];
      currentChapter = parseInt(ch, 10);
      const verseId = `${book.id}.${ch}.${v}`;
      results.push({
        label: `${book.name} ${ch}:${v}`,
        book,
        lastChapter: currentChapter,
        requests: [{
          type: 'verse',
          id: verseId,
          bookId: book.id,
          label: `${book.name} ${ch}:${v}`,
        }],
      });
      continue;
    }

    // Bare verse range inheriting chapter: "3-4"
    const bareRangeMatch = item.match(/^(\d+)-(\d+)$/);
    if (bareRangeMatch && currentChapter !== null) {
      // Could this be chapter range or verse range?
      // If we previously had a chapter:verse in this book, it's a verse range!
      // If no verse was seen, e.g. "revelation 2-3", it's a chapter range!
      const isAfterVerse = results.some((r) => r.requests[0]?.type === 'verse' || r.requests[0]?.type === 'passage');
      if (isAfterVerse) {
        const vStart = bareRangeMatch[1];
        const vEnd = bareRangeMatch[2];
        const passageId = `${book.id}.${currentChapter}.${vStart}-${book.id}.${currentChapter}.${vEnd}`;
        results.push({
          label: `${book.name} ${currentChapter}:${vStart}–${vEnd}`,
          book,
          lastChapter: currentChapter,
          requests: [{
            type: 'passage',
            id: passageId,
            bookId: book.id,
            label: `${book.name} ${currentChapter}:${vStart}–${vEnd}`,
          }],
        });
        continue;
      } else {
        // Chapter range like "revelation 2-3"
        const chStart = parseInt(bareRangeMatch[1], 10);
        const chEnd = parseInt(bareRangeMatch[2], 10);
        const chapterRequests = [];
        for (let c = chStart; c <= chEnd; c++) {
          chapterRequests.push({
            type: 'chapter',
            id: `${book.id}.${c}`,
            bookId: book.id,
            label: `${book.name} ${c}`,
          });
        }
        results.push({
          label: `${book.name} ${chStart}–${chEnd}`,
          book,
          lastChapter: chEnd,
          requests: chapterRequests,
        });
        continue;
      }
    }

    // Bare single number: "4" (if after verse, it's verse; otherwise whole chapter)
    const bareNumMatch = item.match(/^(\d+)$/);
    if (bareNumMatch) {
      const num = parseInt(bareNumMatch[1], 10);
      const isAfterVerse = results.some((r) => r.requests[0]?.type === 'verse' || r.requests[0]?.type === 'passage');
      if (isAfterVerse && currentChapter !== null) {
        const verseId = `${book.id}.${currentChapter}.${num}`;
        results.push({
          label: `${book.name} ${currentChapter}:${num}`,
          book,
          lastChapter: currentChapter,
          requests: [{
            type: 'verse',
            id: verseId,
            bookId: book.id,
            label: `${book.name} ${currentChapter}:${num}`,
          }],
        });
      } else {
        // Whole chapter like "Romans 8"
        results.push({
          label: `${book.name} ${num}`,
          book,
          lastChapter: num,
          requests: [{
            type: 'chapter',
            id: `${book.id}.${num}`,
            bookId: book.id,
            label: `${book.name} ${num}`,
          }],
        });
      }
      continue;
    }
  }

  return results;
}
