import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatTabTitle, TAB_TITLE_MAX } from '../src/lib/tabTitle.js';

describe('workspace tab titles', () => {
  test('leaves a short document name untouched', () => {
    assert.equal(formatTabTitle('John 3'), 'John 3');
    assert.equal(formatTabTitle('Atheism / Agnosticism'), 'Atheism / Agnosticism');
  });

  test('cuts a long name at a word boundary with an ellipsis', () => {
    assert.equal(
      formatTabTitle("Babies, Original Sin, and Jesus' conception"),
      'Babies, Original Sin, and…',
    );
  });

  test('never returns more than the limit plus the ellipsis', () => {
    const long = 'Supralapsarianism versus infralapsarianism in Reformed dogmatics';
    assert.ok(formatTabTitle(long).length <= TAB_TITLE_MAX + 1);
  });

  test('cuts mid-word when the first word alone is too long', () => {
    // Breaking on the only space would leave "A…", which names nothing.
    assert.equal(formatTabTitle('A supercalifragilisticexpialidocious note'), 'A supercalifragilisticexpial…');
  });

  test('collapses whitespace so a wrapped title stays one line', () => {
    assert.equal(formatTabTitle('  Genesis\n  1  '), 'Genesis 1');
  });

  test('treats a blank or missing title as empty rather than throwing', () => {
    assert.equal(formatTabTitle(''), '');
    assert.equal(formatTabTitle(null), '');
    assert.equal(formatTabTitle(undefined), '');
  });
});
