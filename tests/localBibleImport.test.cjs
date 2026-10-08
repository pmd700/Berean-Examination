'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const {
  cleanText,
  parseVerseText,
  selectReaderVerses,
} = require('../tools/import-bible-library.cjs');
const {
  IMPORTED_BIBLE_VERSIONS,
  LocalBibleLibrary,
} = require('../desktop/local-bible.cjs');

test('plain verse sources preserve book, chapter, verse, and text', () => {
  const parsed = parseVerseText([
    'TEST',
    'Genesis 1:1\tInvented first line.',
    'Genesis 1:2\tInvented second line.',
    'Psalm 1:1\tInvented psalm line.',
  ].join('\n'));
  assert.deepEqual(parsed.get('Genesis\u00001'), [
    { number: 1, text: 'Invented first line.' },
    { number: 2, text: 'Invented second line.' },
  ]);
  assert.equal(parsed.get('Psalms\u00001')[0].text, 'Invented psalm line.');
});

test('reader-edition alignment skips headings but keeps every verse', () => {
  const selected = selectReaderVerses([
    'An Invented Heading',
    'Invented first verse sentence.',
    'A Second Invented Heading',
    'Invented second verse sentence.',
  ], [
    { number: 1, text: 'Invented first verse sentence.' },
    { number: 2, text: 'Invented second verse sentence.' },
  ], 'fixture');
  assert.deepEqual([...selected].sort(([left], [right]) => left - right), [[1, 1], [3, 2]]);
});

test('legacy smart punctuation is repaired deterministically', () => {
  assert.equal(cleanText('\u0093Hello\u0094\u0097it\u0092s me.'), '“Hello”—it’s me.');
});

test('every generated edition opens locally and matches the manifest', async () => {
  const sourceFolder = path.resolve(__dirname, '..', 'attached_assets');
  const manifest = JSON.parse(await fs.readFile(path.join(sourceFolder, 'bibles', 'manifest.json'), 'utf8'));
  assert.deepEqual(
    manifest.translations.map((translation) => translation.code),
    IMPORTED_BIBLE_VERSIONS,
  );

  const library = new LocalBibleLibrary({ sourceFolder });
  for (const version of IMPORTED_BIBLE_VERSIONS) {
    const book = ['BGB', 'BIB'].includes(version) ? 'John' : 'Genesis';
    const chapter = await library.readChapter({ version, book, chapter: 1 });
    assert.match(chapter.text, /(?:^|\n)~1\s/);
  }
  await assert.rejects(
    library.readChapter({ version: 'BGB', book: 'Genesis', chapter: 1 }),
    (error) => error.code === 'BEX_BIBLE_NOT_FOUND',
  );
});
