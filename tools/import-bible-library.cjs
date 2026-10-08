'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const JSZip = require('jszip');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_SOURCE_DIR = path.join(PROJECT_ROOT, 'source_data', 'bibles');
const DEFAULT_OUTPUT_DIR = path.join(PROJECT_ROOT, 'attached_assets', 'bibles');
const CHAPTER_SEPARATOR = '\u0000';

const CATALOG = Object.freeze([
  { code: 'AKJV', title: 'American King James Version', file: 'akjv - American King James Version.txt', parser: 'verses', scope: 'full' },
  { code: 'ASV', title: 'American Standard Version', file: 'asv - American Standard Version.txt', parser: 'verses', scope: 'full' },
  { code: 'BAB', title: 'Berean Annotated Bible', file: 'bab - Berean Annotated Bible.txt', parser: 'verses', scope: 'full' },
  { code: 'BGB', title: 'Berean Greek Bible', file: 'bgb - Berean Greek Bible NT.docx', parser: 'docx', scope: 'nt' },
  { code: 'BIB', title: 'Berean Interlinear Bible', file: 'bib - Berean Interlinear Bible.docx', parser: 'docx', scope: 'nt' },
  { code: 'BLB', title: 'Berean Literal Bible', file: 'blb - Berean Literal Bible.txt', parser: 'verses', scope: 'full' },
  { code: 'BRB', title: "Berean Reader's Bible", file: "brb - Berean Reader's Bible.txt", parser: 'reader', scope: 'full' },
  { code: 'BSB', title: 'Berean Standard Bible', file: 'bsb - berean standard bible.txt', parser: 'verses', scope: 'full' },
  { code: 'CPDV', title: 'Catholic Public Domain Version', file: 'cpdv - Catholic Public Domain Version.txt', parser: 'verses', scope: 'full' },
  { code: 'DBT', title: 'Darby Bible Translation', file: 'dbt - Darby Bible Translation.txt', parser: 'verses', scope: 'full' },
  { code: 'DRB', title: 'Douay-Rheims Bible', file: 'drb - Douay-Rheims Bible.txt', parser: 'verses', scope: 'full' },
  { code: 'ERV', title: 'English Revised Version', file: 'erv - English Revised Version.txt', parser: 'verses', scope: 'full' },
  { code: 'JPS', title: 'JPS Tanakh 1917 / Weymouth New Testament', file: 'jps - JPS Tanakh 1917 OT.txt', parser: 'verses', scope: 'full' },
  { code: 'KJV', title: 'King James Version', file: 'kjv - King James Version.txt', parser: 'verses', scope: 'full' },
  { code: 'MSB', title: 'Majority Standard Bible', file: 'msb - Majority Standard Bible.txt', parser: 'verses', scope: 'full' },
  { code: 'SLT', title: "Smith's Literal Translation", file: "slt - Smith's Literal Translation .txt", parser: 'verses', scope: 'full' },
  { code: 'WBT', title: "Webster's Bible Translation", file: "wbt - Webster's Bible Translation.txt", parser: 'verses', scope: 'full' },
  { code: 'WEB', title: 'World English Bible', file: 'web - World English Bible.txt', parser: 'verses', scope: 'full' },
  { code: 'YLT', title: "Young's Literal Translation", file: "ylt - Young's Literal Translation.txt", parser: 'verses', scope: 'full' },
]);

function chapterKey(book, chapter) {
  return `${book}${CHAPTER_SEPARATOR}${chapter}`;
}

function normalizeBook(book) {
  return book === 'Psalm' ? 'Psalms' : book;
}

function repairLegacyPunctuation(text) {
  return text
    .replaceAll('\u0091', '‘')
    .replaceAll('\u0092', '’')
    .replaceAll('\u0093', '“')
    .replaceAll('\u0094', '”')
    .replaceAll('\u0096', '–')
    .replaceAll('\u0097', '—');
}

function decodeText(buffer) {
  const utf8 = buffer.toString('utf8');
  return repairLegacyPunctuation(utf8.includes('\uFFFD') ? buffer.toString('latin1') : utf8)
    .replace(/^\uFEFF/, '');
}

function cleanText(text) {
  return repairLegacyPunctuation(String(text || '')).replace(/\s+/g, ' ').trim();
}

function parseVerseText(sourceText) {
  const chapters = new Map();
  for (const rawLine of sourceText.split(/\r?\n/)) {
    const match = rawLine.match(/^(.+?) (\d+):(\d+)\t(.*)$/);
    if (!match) continue;
    const [, sourceBook, chapterText, verseText, rawVerse] = match;
    const key = chapterKey(normalizeBook(sourceBook), Number(chapterText));
    const verses = chapters.get(key) || [];
    verses.push({ number: Number(verseText), text: cleanText(rawVerse) });
    chapters.set(key, verses);
  }
  return chapters;
}

function assertSequentialVerses(chapters, label) {
  for (const [key, verses] of chapters) {
    verses.forEach((verse, index) => {
      if (verse.number !== index + 1) {
        throw new Error(`${label}: invalid or missing verse ${key.replace(CHAPTER_SEPARATOR, ' ')}:${index + 1}.`);
      }
    });
  }
}

function wordTokens(text) {
  return cleanText(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
}

function similarity(left, right) {
  const a = wordTokens(left);
  const b = wordTokens(right);
  if (!a.length || !b.length) return 0;
  const counts = new Map();
  for (const token of a) counts.set(token, (counts.get(token) || 0) + 1);
  let overlap = 0;
  for (const token of b) {
    const remaining = counts.get(token) || 0;
    if (remaining > 0) {
      overlap += 1;
      counts.set(token, remaining - 1);
    }
  }
  return (2 * overlap) / (a.length + b.length);
}

function selectReaderVerses(lines, referenceVerses, label) {
  const verseCount = referenceVerses.length;
  const lineCount = lines.length;
  if (lineCount < verseCount) {
    throw new Error(`${label}: has ${lineCount} lines for ${verseCount} verses.`);
  }

  const scores = Array.from({ length: verseCount + 1 }, () => new Float64Array(lineCount + 1).fill(-Infinity));
  const choices = Array.from({ length: verseCount + 1 }, () => new Uint8Array(lineCount + 1));
  for (let line = 0; line <= lineCount; line += 1) scores[0][line] = 0;

  for (let verse = 1; verse <= verseCount; verse += 1) {
    for (let line = verse; line <= lineCount; line += 1) {
      const skipped = scores[verse][line - 1];
      const matched = scores[verse - 1][line - 1]
        + similarity(referenceVerses[verse - 1].text, lines[line - 1]);
      if (matched > skipped) {
        scores[verse][line] = matched;
        choices[verse][line] = 1;
      } else {
        scores[verse][line] = skipped;
      }
    }
  }

  const selected = new Map();
  let verse = verseCount;
  let line = lineCount;
  while (verse > 0 && line > 0) {
    if (choices[verse][line] === 1) {
      selected.set(line - 1, referenceVerses[verse - 1].number);
      verse -= 1;
    }
    line -= 1;
  }
  if (verse !== 0) throw new Error(`${label}: could not align every verse.`);

  let weakest = 1;
  const referenceByNumber = new Map(referenceVerses.map((item) => [item.number, item]));
  for (const [lineIndex, verseNumber] of selected) {
    weakest = Math.min(weakest, similarity(referenceByNumber.get(verseNumber).text, lines[lineIndex]));
  }
  if (weakest < 0.3) {
    throw new Error(`${label}: reader-edition alignment confidence was too low (${weakest.toFixed(3)}).`);
  }
  return selected;
}

function parseReaderText(sourceText, referenceChapters) {
  const chapterLabels = new Map();
  for (const key of referenceChapters.keys()) {
    const [book, chapter] = key.split(CHAPTER_SEPARATOR);
    chapterLabels.set(`${book} ${chapter}`, key);
    if (book === 'Psalms') chapterLabels.set(`Psalm ${chapter}`, key);
  }

  const rawChapters = new Map();
  let currentKey = null;
  for (const rawLine of sourceText.split(/\r?\n/)) {
    const line = cleanText(rawLine);
    if (!line) continue;
    const nextKey = chapterLabels.get(line);
    if (nextKey) {
      currentKey = nextKey;
      rawChapters.set(currentKey, []);
    } else if (currentKey) {
      rawChapters.get(currentKey).push(line);
    }
  }

  const prepared = new Map();
  for (const [key, referenceVerses] of referenceChapters) {
    const lines = rawChapters.get(key);
    if (!lines) throw new Error(`BRB: missing ${key.replace(CHAPTER_SEPARATOR, ' ')}.`);
    const alignableVerses = referenceVerses.filter((verse) => verse.text);
    const selected = selectReaderVerses(lines, alignableVerses, `BRB ${key.replace(CHAPTER_SEPARATOR, ' ')}`);
    const output = [];
    let nextVerse = 1;
    lines.forEach((line, index) => {
      const verseNumber = selected.get(index);
      if (!verseNumber) {
        output.push(`### ${line}`);
        return;
      }
      while (nextVerse < verseNumber) {
        output.push(`~${nextVerse} `);
        nextVerse += 1;
      }
      output.push(`~${verseNumber} ${line}`);
      nextVerse = verseNumber + 1;
    });
    while (nextVerse <= referenceVerses.length) {
      output.push(`~${nextVerse} `);
      nextVerse += 1;
    }
    prepared.set(key, output.join('\n'));
  }
  return prepared;
}

function decodeXml(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, value) => String.fromCodePoint(Number.parseInt(value, 16)))
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function xmlRuns(paragraphXml) {
  return [...paragraphXml.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)].map((match) => {
    const runXml = match[1];
    const style = runXml.match(/<w:rStyle[^>]*w:val="([^"]+)"/)?.[1] || '';
    const text = [...runXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
      .map((part) => decodeXml(part[1]))
      .join('');
    return { style, text };
  });
}

async function parseDocx(buffer, referenceChapters, code) {
  const zip = await JSZip.loadAsync(buffer);
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) throw new Error(`${code}: Word document has no document.xml.`);
  const documentXml = await documentFile.async('string');
  const newTestamentBooks = new Set([
    'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', '1 Corinthians',
    '2 Corinthians', 'Galatians', 'Ephesians', 'Philippians', 'Colossians',
    '1 Thessalonians', '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus',
    'Philemon', 'Hebrews', 'James', '1 Peter', '2 Peter', '1 John', '2 John',
    '3 John', 'Jude', 'Revelation',
  ]);
  const chapterLabels = new Map();
  for (const key of referenceChapters.keys()) {
    const [book, chapter] = key.split(CHAPTER_SEPARATOR);
    if (newTestamentBooks.has(book)) chapterLabels.set(`${book} ${chapter}`, key);
  }

  const prepared = new Map();
  let currentKey = null;
  let output = [];
  let currentVerse = null;
  const flushVerse = () => {
    if (!currentVerse) return;
    const text = cleanText(currentVerse.parts.join(''));
    if (!text) throw new Error(`${code}: empty verse ${currentVerse.number} in ${currentKey}.`);
    output.push(`~${currentVerse.number} ${text}`);
    currentVerse = null;
  };
  const flushChapter = () => {
    if (!currentKey) return;
    flushVerse();
    prepared.set(currentKey, output.join('\n'));
    output = [];
  };

  for (const paragraphMatch of documentXml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)) {
    const paragraphXml = paragraphMatch[1];
    const runs = xmlRuns(paragraphXml);
    const paragraphText = cleanText(runs.map((run) => run.text).join(''));
    if (!paragraphText) continue;
    const chapter = chapterLabels.get(paragraphText);
    if (chapter) {
      flushChapter();
      currentKey = chapter;
      continue;
    }
    if (!currentKey) continue;

    const paragraphStyle = paragraphXml.match(/<w:pStyle[^>]*w:val="([^"]+)"/)?.[1] || '';
    if (paragraphStyle === 'hdg') {
      flushVerse();
      output.push(`### ${paragraphText}`);
      continue;
    }
    if (paragraphStyle === 'foot') continue;

    let contributed = false;
    for (const run of runs) {
      if (/^reftext/i.test(run.style) && /^\d+$/.test(run.text.trim())) {
        flushVerse();
        currentVerse = { number: Number(run.text.trim()), parts: [] };
        contributed = true;
      } else if (currentVerse && !/^reftext/i.test(run.style) && !/foot|fnverse/i.test(run.style)) {
        currentVerse.parts.push(run.text);
        contributed = contributed || Boolean(run.text.trim());
      }
    }
    if (currentVerse && contributed) currentVerse.parts.push(' ');
  }
  flushChapter();
  return prepared;
}

function preparedFromVerses(chapters) {
  return new Map([...chapters].map(([key, verses]) => [
    key,
    verses.map((verse) => `~${verse.number} ${verse.text}`).join('\n'),
  ]));
}

function countVerses(prepared) {
  let count = 0;
  for (const chapter of prepared.values()) {
    count += chapter.split('\n').filter((line) => /^~\d+\s/.test(line)).length;
  }
  return count;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function importBibleLibrary({ sourceDir = DEFAULT_SOURCE_DIR, outputDir = DEFAULT_OUTPUT_DIR } = {}) {
  const sourceBuffers = new Map();
  for (const item of CATALOG) {
    sourceBuffers.set(item.code, await fs.readFile(path.join(sourceDir, item.file)));
  }

  const reference = parseVerseText(decodeText(sourceBuffers.get('BSB')));
  assertSequentialVerses(reference, 'BSB');
  if (reference.size !== 1189 || [...reference.values()].reduce((sum, verses) => sum + verses.length, 0) !== 31102) {
    throw new Error('BSB reference must contain exactly 1,189 chapters and 31,102 verses.');
  }

  const outputs = [];
  for (const item of CATALOG) {
    const sourceBuffer = sourceBuffers.get(item.code);
    let prepared;
    if (item.parser === 'verses') {
      const parsed = parseVerseText(decodeText(sourceBuffer));
      assertSequentialVerses(parsed, item.code);
      prepared = preparedFromVerses(parsed);
    } else if (item.parser === 'reader') {
      prepared = parseReaderText(decodeText(sourceBuffer), reference);
    } else {
      prepared = await parseDocx(sourceBuffer, reference, item.code);
    }

    const chapterCount = prepared.size;
    const verseCount = countVerses(prepared);
    const expectedChapters = item.scope === 'full' ? 1189 : 260;
    const expectedVerses = item.scope === 'full' ? 31102 : 7941;
    if (chapterCount !== expectedChapters || verseCount !== expectedVerses) {
      throw new Error(`${item.code}: expected ${expectedChapters} chapters / ${expectedVerses} verses, found ${chapterCount} / ${verseCount}.`);
    }

    const payload = {
      schemaVersion: 1,
      code: item.code,
      title: item.title,
      scope: item.scope,
      sourceFile: item.file,
      sourceSha256: sha256(sourceBuffer),
      chapterCount,
      verseCount,
      chapters: Object.fromEntries(prepared),
    };
    outputs.push({ item, payload, json: `${JSON.stringify(payload)}\n` });
  }

  await fs.mkdir(outputDir, { recursive: true });
  for (const output of outputs) {
    const target = path.join(outputDir, `${output.item.code}.json`);
    const temporary = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temporary, output.json, 'utf8');
    await fs.rename(temporary, target);
  }
  const manifest = {
    schemaVersion: 1,
    translations: outputs.map(({ item, payload, json }) => ({
      code: item.code,
      title: item.title,
      scope: item.scope,
      file: `${item.code}.json`,
      sourceFile: item.file,
      sourceSha256: payload.sourceSha256,
      assetSha256: sha256(json),
      chapterCount: payload.chapterCount,
      verseCount: payload.verseCount,
    })),
  };
  const manifestTarget = path.join(outputDir, 'manifest.json');
  const manifestTemporary = `${manifestTarget}.${process.pid}.tmp`;
  await fs.writeFile(manifestTemporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await fs.rename(manifestTemporary, manifestTarget);
  return manifest;
}

if (require.main === module) {
  importBibleLibrary()
    .then((manifest) => {
      for (const item of manifest.translations) {
        console.log(`${item.code.padEnd(4)} ${String(item.chapterCount).padStart(4)} chapters  ${String(item.verseCount).padStart(5)} verses`);
      }
      console.log(`Imported ${manifest.translations.length} local Bible editions.`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = {
  CATALOG,
  cleanText,
  decodeText,
  importBibleLibrary,
  parseDocx,
  parseReaderText,
  parseVerseText,
  selectReaderVerses,
};
