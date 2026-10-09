'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

// Import the parser (using dynamic import because scriptureReferences is an ESM module)
async function getParser() {
  return await import('../src/lib/scriptureReferences.js');
}

test('parses the exact specification example: Jn1:1-3, mark 5:1,3-4, revelation 2-3, 4:4', async () => {
  const { parseScriptureQuery } = await getParser();
  const result = parseScriptureQuery('Jn1:1-3, mark 5:1,3-4, revelation 2-3, 4:4');

  assert.equal(result.isReference, true);
  assert.equal(result.groups.length, 5);

  // Group 1: John 1:1–3
  assert.equal(result.groups[0].label, 'John 1:1–3');
  assert.deepEqual(result.groups[0].requests, [
    { type: 'passage', id: 'JHN.1.1-JHN.1.3', bookId: 'JHN', label: 'John 1:1–3' }
  ]);

  // Group 2: Mark 5:1
  assert.equal(result.groups[1].label, 'Mark 5:1');
  assert.deepEqual(result.groups[1].requests, [
    { type: 'verse', id: 'MRK.5.1', bookId: 'MRK', label: 'Mark 5:1' }
  ]);

  // Group 3: Mark 5:3–4 (inherited Mark 5)
  assert.equal(result.groups[2].label, 'Mark 5:3–4');
  assert.deepEqual(result.groups[2].requests, [
    { type: 'passage', id: 'MRK.5.3-MRK.5.4', bookId: 'MRK', label: 'Mark 5:3–4' }
  ]);

  // Group 4: Revelation 2–3 (two chapter requests)
  assert.equal(result.groups[3].label, 'Revelation 2–3');
  assert.deepEqual(result.groups[3].requests, [
    { type: 'chapter', id: 'REV.2', bookId: 'REV', label: 'Revelation 2' },
    { type: 'chapter', id: 'REV.3', bookId: 'REV', label: 'Revelation 3' },
  ]);

  // Group 5: Revelation 4:4 (inherited Revelation)
  assert.equal(result.groups[4].label, 'Revelation 4:4');
  assert.deepEqual(result.groups[4].requests, [
    { type: 'verse', id: 'REV.4.4', bookId: 'REV', label: 'Revelation 4:4' }
  ]);

  // Total content requests: exactly 6!
  assert.equal(result.requests.length, 6);
  assert.deepEqual(result.requests.map(r => r.id), [
    'JHN.1.1-JHN.1.3',
    'MRK.5.1',
    'MRK.5.3-MRK.5.4',
    'REV.2',
    'REV.3',
    'REV.4.4',
  ]);
});

test('handles single-chapter book shorthand, cross-chapter ranges, and single chapters', async () => {
  const { parseScriptureQuery } = await getParser();

  // Single-chapter book: Jude 5 -> JUD.1.5
  const jude = parseScriptureQuery('Jude 5');
  assert.equal(jude.requests[0].id, 'JUD.1.5');
  assert.equal(jude.requests[0].type, 'verse');

  // Cross-chapter range: John 3:16-4:2 -> JHN.3.16-JHN.4.2
  const cross = parseScriptureQuery('John 3:16-4:2');
  assert.equal(cross.requests[0].id, 'JHN.3.16-JHN.4.2');
  assert.equal(cross.requests[0].type, 'passage');

  // Single chapter: Romans 8 -> ROM.8
  const rom8 = parseScriptureQuery('Romans 8');
  assert.equal(rom8.requests[0].id, 'ROM.8');
  assert.equal(rom8.requests[0].type, 'chapter');
});

test('identifies non-reference free text as non-reference', async () => {
  const { isLikelyReference, parseScriptureQuery } = await getParser();
  assert.equal(isLikelyReference('faith hope love'), false);
  assert.equal(isLikelyReference('grace and mercy'), false);
  assert.equal(isLikelyReference('John 3:16'), true);
  assert.equal(isLikelyReference('1Jn 1:9'), true);

  const nonRef = parseScriptureQuery('grace and truth');
  assert.equal(nonRef.isReference, false);
  assert.equal(nonRef.requests.length, 0);
});

test('parses complex multi-clause query: revelation 4:1, 4, 9; Col 1:1, 2:2, 4-5; jere 50:1 - song of solomon 1:1, 4', async () => {
  const { parseScriptureQuery } = await getParser();
  const query = 'revelation 4:1, 4, 9; Col 1:1, 2:2, 4-5; jere 50:1 - song of solomon 1:1, 4';
  const result = parseScriptureQuery(query);

  assert.equal(result.isReference, true);
  assert.deepEqual(result.groups.map(g => g.label), [
    'Revelation 4:1',
    'Revelation 4:4',
    'Revelation 4:9',
    'Colossians 1:1',
    'Colossians 2:2',
    'Colossians 2:4–5',
    'Jeremiah 50:1 – Song of Solomon 1:1',
    'Song of Solomon 1:4'
  ]);
  assert.deepEqual(result.requests.map(r => r.id), [
    'REV.4.1',
    'REV.4.4',
    'REV.4.9',
    'COL.1.1',
    'COL.2.2',
    'COL.2.4-COL.2.5',
    'JER.50.1',
    'SNG.1.1',
    'SNG.1.4'
  ]);
});

