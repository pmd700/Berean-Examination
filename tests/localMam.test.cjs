'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { LocalMamLibrary, extractNode } = require('../desktop/local-mam.cjs');

const sourceFolder = path.resolve(__dirname, '..', 'data', 'sources', 'mam-parsed', 'plus');

test('reads a complete MAM chapter from bundled local files', () => {
  const library = new LocalMamLibrary({ sourceFolder });
  const chapter = library.readChapter({ book: 'Genesis', chapter: 1 });
  assert.equal(chapter.book, 'Genesis');
  assert.equal(chapter.chapter, 1);
  assert.equal(chapter.attribution.license, 'CC BY-SA 4.0');
  assert.equal(chapter.verses['1'].startsWith('ב'), true);
  assert.match(chapter.verses['1'], /אֱלֹהִ֑ים/);
  assert.equal(Object.keys(chapter.verses).length, 31);
});

test('supports combined MAM book files without mixing sub-books', () => {
  const library = new LocalMamLibrary({ sourceFolder });
  assert.equal(Object.keys(library.readChapter({ book: '1 Samuel', chapter: 1 }).verses).length > 0, true);
  assert.equal(Object.keys(library.readChapter({ book: '2 Samuel', chapter: 1 }).verses).length > 0, true);
});

test('rejects invalid local MAM requests', () => {
  const library = new LocalMamLibrary({ sourceFolder });
  assert.throws(() => library.readChapter({ book: 'Matthew', chapter: 1 }), { code: 'BEX_MAM_INVALID' });
  assert.throws(() => library.readChapter({ book: 'Genesis', chapter: 999 }), { code: 'BEX_MAM_INVALID' });
});

test('removes structural metadata while retaining visible Hebrew', () => {
  assert.equal(extractNode({ tmpl_name: 'מ:פסוק', tmpl_params: { 1: 'Genesis' } }), '');
  assert.equal(extractNode({ tmpl_name: 'נוסח', tmpl_params: { 1: 'בְּרֵאשִׁית' } }), 'בְּרֵאשִׁית');
});
