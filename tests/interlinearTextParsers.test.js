import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseSblgntText,
  parseUxlcText,
} from '../src/lib/bible-import/interlinearTextParsers.js';

test('parses an invented SBLGNT-format line without downloading anything', () => {
  assert.deepEqual(parseSblgntText('Matt 2:3 SYNTHETIC-GREEK-TEXT'), [{
    source_text: 'SBLGNT',
    book: 'Matthew',
    chapter: 2,
    verse: 3,
    greek_text: 'SYNTHETIC-GREEK-TEXT',
    ref_key: 'SBLGNT:Matthew:2:3',
  }]);
});

test('parses an invented UXLC-format line and removes source annotations', () => {
  assert.deepEqual(parseUxlcText('xxxx Chapter 4\n2 ׃ 4 SYNTHETIC-HEBREW [note] פ', 'Genesis'), [{
    source_text: 'UXLC',
    book: 'Genesis',
    chapter: 4,
    verse: 2,
    hebrew_text: 'SYNTHETIC-HEBREW',
    ref_key: 'UXLC:Genesis:4:2',
  }]);
});

test('rejects UXLC parsing without an explicit canonical book', () => {
  assert.throws(() => parseUxlcText('1 ׃ 1 SYNTHETIC', ''), /canonical book name/);
});
