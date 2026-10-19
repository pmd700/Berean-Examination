const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateStudyCanvasRecord: validate } = require('../desktop/study-canvas-record.cjs');
const verse = (book = 'Isaiah', chapter = 22, verse = 13) => ({ kind: 'verse', book, chapter, verse });
describe('permanent study canvas records', () => {
  it('accepts a verse endpoint without requiring it to be displayed or saved as a chapter', () => {
    const result = validate('StudyConnection', { from: verse(), to: { kind: 'annotation', id: 7 } }, (type, id) => type === 'Annotation' && id === 7);
    assert.deepEqual(result.from, verse('isaiah'));
    assert.deepEqual(result.to, { kind: 'annotation', id: 7 });
  });
  it('rejects missing cards and invalid or self-referencing verses', () => {
    assert.throws(() => validate('StudyConnection', { from: verse(), to: { kind: 'object', id: 8 } }, () => false), /no longer exists/);
    for (const from of [verse('Isaiah', 0), verse('Isaiah', 22, NaN), verse('<img>'), { kind: 'invalid', id: 7 }]) assert.throws(() => validate('StudyConnection', { from, to: verse() }, () => true));
    assert.throws(() => validate('StudyConnection', { from: verse(), to: verse() }, () => true), /different items/);
  });
  it('accepts every placeable tool item and rejects invalid geometry or unprotected images', () => {
    const records = [
      { object_type: 'card', content: '<p>My idea</p>' }, { object_type: 'point' }, { object_type: 'section' },
      { object_type: 'drawing', strokes_data: JSON.stringify({ points: [[0, 0], [10, 30]] }) },
      { object_type: 'image', image_url: 'bex-media://image/fixture' }, { object_type: 'timegraph', timegraph_id: 1 }, { object_type: 'web_link', link_web_id: 2 },
    ];
    for (const record of records) assert.ok(validate('StudyCanvasObject', { ...record, x: -10000000, y: 10000000 }, () => true));
    for (const invalid of [{ x: NaN }, { width: -1 }, { object_type: 'image', image_url: 'https://remote.test/photo.png' }, { object_type: 'drawing', strokes_data: '{' }, { object_type: 'timegraph' }]) {
      assert.throws(() => validate('StudyCanvasObject', { object_type: 'card', x: 0, y: 0, ...invalid }, () => true));
    }
  });
});
