import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_FIND_OPTIONS,
  compileFindPattern,
  expandReplacement,
} from '../src/components/editor/findInEditor.js';

/**
 * Find and replace.
 *
 * The awkward part is not the searching, it is that ignoring diacritics changes
 * the length of the text being searched — an accent written as its own mark
 * disappears, a precomposed letter decomposes — so a match found in the folded
 * text has to be measured back into the document through a map rather than by
 * its index. Those cases are covered in the DOM suite against a real document;
 * what is asserted here is the pattern-building and the replacement grammar.
 */

describe('what gets searched for', () => {
  it('takes a plain term literally, punctuation and all', () => {
    assert.equal(compileFindPattern('a.b').source, 'a\\.b');
  });

  it('hands a regular expression through untouched', () => {
    assert.equal(compileFindPattern('a.b', { regex: true }).source, 'a.b');
  });

  it('ignores case unless asked not to', () => {
    assert.equal(compileFindPattern('you').flags.includes('i'), true);
    assert.equal(compileFindPattern('you', { matchCase: true }).flags.includes('i'), false);
  });

  it('strips accents from the term so it can meet the folded text', () => {
    // "café" is searched as "cafe", which is what the folded document holds.
    assert.equal(compileFindPattern('café').source, 'cafe');
    assert.equal(compileFindPattern('café', { ignoreDiacritics: false }).source, 'café');
  });

  it('says nothing rather than throwing on a half-typed expression', () => {
    // "(" is a normal thing to see while someone is still typing.
    assert.equal(compileFindPattern('(', { regex: true }), null);
    assert.equal(compileFindPattern('[a-', { regex: true }), null);
  });

  it('has nothing to look for when the box is empty', () => {
    assert.equal(compileFindPattern(''), null);
    assert.equal(compileFindPattern(null), null);
  });

  it('ignores diacritics by default, as Docs does', () => {
    assert.equal(DEFAULT_FIND_OPTIONS.ignoreDiacritics, true);
    assert.equal(DEFAULT_FIND_OPTIONS.matchCase, false);
    assert.equal(DEFAULT_FIND_OPTIONS.regex, false);
  });
});

describe('what gets written back', () => {
  it('uses the replacement as written when it names no groups', () => {
    assert.equal(expandReplacement('sky blue', { groups: [] }, 'techelet'), 'sky blue');
  });

  it('works capture groups into it', () => {
    assert.equal(
      expandReplacement('$2 $1', { groups: ['Moses', 'Maimonides'] }, 'Moses Maimonides'),
      'Maimonides Moses',
    );
  });

  it('puts the whole match back for $&', () => {
    assert.equal(expandReplacement('"$&"', { groups: [] }, 'tzitzit'), '"tzitzit"');
  });

  it('writes a literal dollar for $$', () => {
    assert.equal(expandReplacement('$$5', { groups: [] }, 'x'), '$5');
  });

  it('drops a group that never took part rather than writing "undefined"', () => {
    assert.equal(expandReplacement('[$3]', { groups: ['a'] }, 'a'), '[]');
  });

  it('survives an empty replacement, which is how a word gets deleted', () => {
    assert.equal(expandReplacement('', { groups: [] }, 'techelet'), '');
    assert.equal(expandReplacement(undefined, { groups: [] }, 'techelet'), '');
  });
});
