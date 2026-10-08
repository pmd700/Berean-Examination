import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCardClipboardText, richTextToPlainText } from '../src/components/knowledgeweb/cardClipboard.js';

test('copies the title followed by the full readable description', () => {
  assert.equal(
    buildCardClipboardText({
      title: 'Debate topic',
      description: '<p>My position: Negative</p><p>My opponent: Affirmative</p>',
    }),
    'Debate topic\n\nMy position: Negative\nMy opponent: Affirmative'
  );
});

test('removes formatting without removing its text', () => {
  assert.equal(
    richTextToPlainText('<p><strong>Truth</strong> &amp; <em>grace</em></p>'),
    'Truth & grace'
  );
});

test('uses the visible untitled label when a card has no title', () => {
  assert.equal(buildCardClipboardText({ description: '<p>Body</p>' }), 'Untitled\n\nBody');
});
