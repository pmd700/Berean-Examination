import assert from 'node:assert/strict';
import test from 'node:test';

import { displayCardTitle, normalizeCardTitle } from '../src/components/knowledgeweb/cardTitle.js';

test('new and legacy-default card titles behave as empty titles', () => {
  assert.equal(normalizeCardTitle(''), '');
  assert.equal(normalizeCardTitle('New Card'), '');
  assert.equal(displayCardTitle(''), 'Untitled');
  assert.equal(displayCardTitle('New Card'), 'Untitled');
});

test('real card titles remain unchanged', () => {
  assert.equal(normalizeCardTitle('Resurrection evidence'), 'Resurrection evidence');
  assert.equal(displayCardTitle('Resurrection evidence'), 'Resurrection evidence');
});
