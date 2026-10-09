/**
 * Scripture Reference Parser and Interpreter for API.Bible
 *
 * Supports single and complex mixed references such as:
 *   "revelation 4:1, 4, 9; Col 1:1, 2:2, 4-5; jere 50:1 - song of solomon 1:1, 4"
 *   "Jn1:1-3, mark 5:1,3-4, revelation 2-3, 4:4"
 *   "john 1:1"
 *
 * Converts references into canonical USFM IDs and request plans:
 * - passages: "JHN.1.1-JHN.1.3", "COL.2.4-COL.2.5"
 * - verses:   "REV.4.1", "REV.4.4", "REV.4.9", "COL.1.1", "JER.50.1", "SNG.1.1", "SNG.1.4"
 * - chapters: "REV.2", "REV.3"
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

// Aliases mapped without spaces to canonical USFM ID
const ALIAS_MAP = {
  // Genesis
  gen: 'GEN', genesis: 'GEN', ge: 'GEN', gn: 'GEN',
  // Exodus
  ex: 'EXO', exo: 'EXO', exodus: 'EXO', exod: 'EXO',
  // Leviticus
  lev: 'LEV', le: 'LEV', leviticus: 'LEV',
  // Numbers
  num: 'NUM', nu: 'NUM', numbers: 'NUM', nm: 'NUM',
  // Deuteronomy
  deut: 'DEU', de: 'DEU', dt: 'DEU', deuteronomy: 'DEU',
  // Joshua
  josh: 'JOS', joshua: 'JOS', jos: 'JOS',
  // Judges
  judg: 'JDG', jdg: 'JDG', judges: 'JDG', jg: 'JDG',
  // Ruth
  ruth: 'RUT', rth: 'RUT', ru: 'RUT',
  // Samuels
  '1sam': '1SA', '1samuel': '1SA', '1s': '1SA', '1sm': '1SA',
  '2sam': '2SA', '2samuel': '2SA', '2s': '2SA', '2sm': '2SA',
  // Kings
  '1kings': '1KI', '1k': '1KI', '1ki': '1KI', '1kgs': '1KI',
  '2kings': '2KI', '2k': '2KI', '2ki': '2KI', '2kgs': '2KI',
  // Chronicles
  '1chron': '1CH', '1chronicles': '1CH', '1ch': '1CH', '1chr': '1CH',
  '2chron': '2CH', '2chronicles': '2CH', '2ch': '2CH', '2chr': '2CH',
  // Ezra, Nehemiah, Esther
  ezra: 'EZR', ezr: 'EZR',
  neh: 'NEH', nehemiah: 'NEH',
  esth: 'EST', esther: 'EST', est: 'EST',
  // Job, Psalms, Proverbs, Eccl, Song
  job: 'JOB', jb: 'JOB',
  ps: 'PSA', psalm: 'PSA', psalms: 'PSA', psa: 'PSA', pss: 'PSA',
  prov: 'PRO', proverbs: 'PRO', pr: 'PRO', pro: 'PRO', prv: 'PRO',
  eccl: 'ECC', ecclesiastes: 'ECC', ecc: 'ECC', qoh: 'ECC',
  song: 'SNG', songs: 'SNG', songofsolomon: 'SNG', songofsongs: 'SNG',
  sng: 'SNG', sos: 'SNG', cant: 'SNG', canticles: 'SNG',
  // Prophets
  isa: 'ISA', isaiah: 'ISA', is: 'ISA',
  jer: 'JER', jere: 'JER', jerem: 'JER', jeremiah: 'JER',
  lam: 'LAM', lamentations: 'LAM',
  ezk: 'EZK', ezek: 'EZK', ezekiel: 'EZK', eze: 'EZK',
  dan: 'DAN', daniel: 'DAN', da: 'DAN',
  hos: 'HOS', hosea: 'HOS',
  joel: 'JOL', jol: 'JOL',
  amos: 'AMO', amo: 'AMO',
  obad: 'OBA', obadiah: 'OBA', oba: 'OBA', ob: 'OBA',
  jonah: 'JON', jon: 'JON', jnh: 'JON',
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
  act: 'ACT', acts: 'ACT', ac: 'ACT',
  // Epistles
  rom: 'ROM', romans: 'ROM', ro: 'ROM', rm: 'ROM',
  '1cor': '1CO', '1corinthians': '1CO', '1co': '1CO',
  '2cor': '2CO', '2corinthians': '2CO', '2co': '2CO',
  gal: 'GAL', galatians: 'GAL', ga: 'GAL',
  eph: 'EPH', ephes: 'EPH', ephesians: 'EPH',
  phil: 'PHP', php: 'PHP', philippians: 'PHP',
  col: 'COL', colo: 'COL', coloss: 'COL', colossians: 'COL',
  '1thess': '1TH', '1thessalonians': '1TH', '1th': '1TH',
  '2thess': '2TH', '2thessalonians': '2TH', '2th': '2TH',
  '1tim': '1TI', '1timothy': '1TI', '1ti': '1TI',
  '2tim': '2TI', '2timothy': '2TI', '2ti': '2TI',
  tit: 'TIT', titus: 'TIT',
  phm: 'PHM', phlm: 'PHM', philemon: 'PHM',
  heb: 'HEB', hebrews: 'HEB',
  jas: 'JAS', jm: 'JAS', james: 'JAS',
  '1pet': '1PE', '1peter': '1PE', '1pe': '1PE',
  '2pet': '2PE', '2peter': '2PE', '2pe': '2PE',
  '1jn': '1JN', '1john': '1JN',
  '2jn': '2JN', '2john': '2JN',
  '3jn': '3JN', '3john': '3JN',
  jude: 'JUD', jud: 'JUD', jd: 'JUD',
  rev: 'REV', revel: 'REV', revelation: 'REV', revelations: 'REV', apoc: 'REV',
};

function cleanDashes(str) {
  return str.replace(/[–—−]/g, '-');
}

function cleanAlnum(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Resolves any book token (e.g. "Jn", "Col", "jere", "song of solomon", "1 John") to USFM book
 */
export function resolveBook(token) {
  if (!token || typeof token !== 'string') return null;
  const clean = cleanAlnum(token);
  if (!clean) return null;

  if (ALIAS_MAP[clean]) return USFM_BOOKS[ALIAS_MAP[clean]];
  if (USFM_BOOKS[clean.toUpperCase()]) return USFM_BOOKS[clean.toUpperCase()];

  // Prefix matching on known aliases and full book names (for >= 3 characters)
  if (clean.length >= 3) {
    for (const [alias, id] of Object.entries(ALIAS_MAP)) {
      if (alias.startsWith(clean) || clean.startsWith(alias)) {
        return USFM_BOOKS[id];
      }
    }
    for (const [id, book] of Object.entries(USFM_BOOKS)) {
      const bClean = cleanAlnum(book.name);
      if (bClean.startsWith(clean) || clean.startsWith(bClean)) {
        return book;
      }
    }
  }

  return null;
}

/**
 * Extracts a book name and remainder digits from a reference string.
 * Supports multi-word books like "Song of Solomon 1:1" or "1 John 2:3".
 */
export function extractBookAndRemainder(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Pattern: book name letters (optionally numbered 1-3) up to the first digit
  const match = trimmed.match(/^([1-3]?\s*[a-zA-Z\s]+?)\s*(\d.*)$/);
  if (match) {
    const book = resolveBook(match[1]);
    if (book) {
      return { book, remainder: match[2].trim() };
    }
  }

  // Entire string might be a book name (e.g. "Romans")
  const fullBook = resolveBook(trimmed);
  if (fullBook) {
    return { book: fullBook, remainder: '' };
  }

  return null;
}

/**
 * Checks if a string looks like a scripture reference
 */
export function isLikelyReference(input) {
  if (!input || typeof input !== 'string') return false;
  const raw = cleanDashes(input.trim());
  if (!raw) return false;

  // Check first token before colon or digits
  const extracted = extractBookAndRemainder(raw);
  if (extracted) return true;

  // Single book name
  return Boolean(resolveBook(raw));
}

/**
 * Main parser: converts a query string into typed presentation groups and retrieval requests.
 */
export function parseScriptureQuery(input) {
  if (!input || typeof input !== 'string') {
    return { isReference: false, groups: [], requests: [], summary: '' };
  }

  const raw = cleanDashes(input.trim());
  if (!raw) {
    return { isReference: false, groups: [], requests: [], summary: '' };
  }

  // Split by semicolon into major clauses
  const semiBlocks = raw.split(';').map((s) => s.trim()).filter(Boolean);
  if (semiBlocks.length === 0) {
    return { isReference: false, groups: [], requests: [], summary: '' };
  }

  const groups = [];
  let currentBook = null;
  let currentChapter = null;

  for (const block of semiBlocks) {
    const parsedBlockGroups = parseBlock(block, currentBook, currentChapter);
    if (!parsedBlockGroups || parsedBlockGroups.length === 0) continue;

    for (const g of parsedBlockGroups) {
      currentBook = g.book;
      currentChapter = g.lastChapter || currentChapter;
      groups.push(g);
    }
  }

  if (groups.length === 0) {
    return { isReference: false, groups: [], requests: [], summary: '' };
  }

  // Flatten requests
  const requests = [];
  for (const g of groups) {
    for (const r of g.requests) {
      requests.push(r);
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
 * Parses a block (e.g. "revelation 4:1, 4, 9", "Col 1:1, 2:2, 4-5", or "jere 50:1 - song of solomon 1:1, 4")
 */
function parseBlock(blockText, inheritedBook, inheritedChapter) {
  const trimmed = blockText.trim();
  if (!trimmed) return [];

  // Check if this block contains a hyphen that connects two distinct book references
  // e.g. "jere 50:1 - song of solomon 1:1, 4"
  const crossBookRange = findCrossBookRange(trimmed);
  if (crossBookRange) {
    // Parse left part and right part
    const leftGroups = parseSingleBookClause(crossBookRange.left, inheritedBook, inheritedChapter);
    const rightGroups = parseSingleBookClause(crossBookRange.right, crossBookRange.rightBook, null);

    if (leftGroups.length > 0 && rightGroups.length > 0) {
      const leftPrimary = leftGroups[0];
      const rightPrimary = rightGroups[0];

      // Form a combined cross-book group for the range endpoints
      const combinedGroup = {
        label: `${leftPrimary.label} – ${rightPrimary.label}`,
        book: rightPrimary.book,
        lastChapter: rightPrimary.lastChapter,
        requests: [...leftPrimary.requests, ...rightPrimary.requests],
      };

      // Any additional groups on the right side (like ", 4") follow
      const subsequentGroups = rightGroups.slice(1);
      return [combinedGroup, ...subsequentGroups];
    }
  }

  // Otherwise, split on commas while observing new books or new chapter:verse
  const clauses = splitCommaClauses(trimmed);
  const groups = [];
  let currentBook = inheritedBook;
  let currentChapter = inheritedChapter;

  for (const clause of clauses) {
    const clauseGroups = parseSingleBookClause(clause, currentBook, currentChapter);
    for (const g of clauseGroups) {
      currentBook = g.book;
      currentChapter = g.lastChapter || currentChapter;
      groups.push(g);
    }
  }

  return groups;
}

/**
 * Checks if a string contains a hyphen separating two different book references.
 * e.g. "jere 50:1 - song of solomon 1:1, 4"
 */
function findCrossBookRange(text) {
  // Look for a hyphen surrounded by optional spaces
  const hyphenRegex = /\s*-\s*/g;
  let match;
  while ((match = hyphenRegex.exec(text)) !== null) {
    const leftPart = text.slice(0, match.index).trim();
    const rightPart = text.slice(match.index + match[0].length).trim();

    const leftExt = extractBookAndRemainder(leftPart);
    const rightExt = extractBookAndRemainder(rightPart);

    if (leftExt && rightExt && leftExt.book.id !== rightExt.book.id) {
      return {
        left: leftPart,
        right: rightPart,
        leftBook: leftExt.book,
        rightBook: rightExt.book,
      };
    }
  }
  return null;
}

/**
 * Splits a single-book block by commas, keeping verse lists together unless a new book appears
 */
function splitCommaClauses(blockText) {
  const parts = blockText.split(',').map((s) => s.trim()).filter(Boolean);
  const clauses = [];
  let accumulator = '';

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!accumulator) {
      accumulator = part;
      continue;
    }

    // Does `part` start a new book?
    const hasNewBook = extractBookAndRemainder(part);
    // Does `part` start an explicit new chapter:verse like "2:2" or "4:4"?
    const hasNewChapterVerse = /^\d+:\d+/.test(part);

    if (hasNewBook || hasNewChapterVerse) {
      clauses.push(accumulator);
      accumulator = part;
    } else {
      // Continuation verse or range like "4" or "4-5"
      accumulator += `, ${part}`;
    }
  }

  if (accumulator) {
    clauses.push(accumulator);
  }

  return clauses;
}

/**
 * Parses a single-book clause like "revelation 4:1, 4, 9", "Col 1:1", or "4-5"
 */
function parseSingleBookClause(clauseText, inheritedBook, inheritedChapter) {
  const text = clauseText.trim();
  if (!text) return [];

  let book = inheritedBook;
  let remainder = text;

  const extracted = extractBookAndRemainder(text);
  if (extracted) {
    book = extracted.book;
    remainder = extracted.remainder;
  }

  if (!book) return [];

  // Single-chapter book support (Jude 5 -> Jude 1:5)
  if (book.singleChapter && /^\d+/.test(remainder) && !remainder.includes(':')) {
    remainder = `1:${remainder}`;
  }

  const subItems = remainder.split(',').map((s) => s.trim()).filter(Boolean);
  const results = [];
  let currentChapter = inheritedChapter;

  for (const item of subItems) {
    // Cross-chapter range in same book: "3:16-4:2" or "3:16 - 4:2"
    const crossChapterMatch = item.match(/^(\d+):(\d+)\s*-\s*(\d+):(\d+)$/);
    if (crossChapterMatch) {
      const chStart = crossChapterMatch[1];
      const vStart = crossChapterMatch[2];
      const chEnd = crossChapterMatch[3];
      const vEnd = crossChapterMatch[4];
      const passageId = `${book.id}.${chStart}.${vStart}-${book.id}.${chEnd}.${vEnd}`;
      currentChapter = parseInt(chEnd, 10);
      results.push({
        label: `${book.name} ${chStart}:${vStart}–${chEnd}:${vEnd}`,
        book,
        lastChapter: currentChapter,
        requests: [{
          type: 'passage',
          id: passageId,
          bookId: book.id,
          label: `${book.name} ${chStart}:${vStart}–${chEnd}:${vEnd}`,
        }],
      });
      continue;
    }

    // Verse range with chapter: "1:1-3" or "2:4-5" (with or without spaces)
    const chRangeMatch = item.match(/^(\d+):(\d+)\s*-\s*(\d+)$/);
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

    // Single verse with chapter: "4:1", "1:1", "2:2"
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

    // Bare range inheriting chapter: "4-5"
    const bareRangeMatch = item.match(/^(\d+)\s*-\s*(\d+)$/);
    if (bareRangeMatch && currentChapter !== null) {
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

    // Bare single number: "4" or "9"
    const bareNumMatch = item.match(/^(\d+)$/);
    if (bareNumMatch) {
      const num = parseInt(bareNumMatch[1], 10);
      const isAfterVerse = results.some((r) => r.requests[0]?.type === 'verse' || r.requests[0]?.type === 'passage');
      if (isAfterVerse && currentChapter !== null) {
        // Inherits chapter as verse
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
