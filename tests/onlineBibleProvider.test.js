import assert from 'node:assert/strict';
import test from 'node:test';
import {
  convertBracketedBibleText,
  fetchOnlineBibleChapter,
} from '../src/online-mode/providers/bibleChapterProvider.js';

test('converts invented bracketed text without a network call', () => {
  assert.equal(
    convertBracketedBibleText('An Invented Heading\n[1] Invented first line.\n[2] Invented second line.'),
    '### An Invented Heading\n~1 Invented first line.\n~2 Invented second line.',
  );
});

test('preserves the dormant ESV request contract with a fake provider', async () => {
  let request;
  const result = await fetchOnlineBibleChapter({
    version: 'ESV',
    book: 'John',
    chapter: 3,
    esvApiKey: 'synthetic-test-key',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({ passages: ['An Invented Heading\n[1] Invented ESV-format text.'] }),
      };
    },
  });
  assert.match(request.url, /^https:\/\/api\.esv\.org\/v3\/passage\/text\//);
  assert.equal(request.options.headers.Authorization, 'Token synthetic-test-key');
  assert.equal(result.text, '### An Invented Heading\n~1 Invented ESV-format text.');
});

test('removed or unsupported translations never reach the network', async () => {
  let called = false;
  await assert.rejects(
    fetchOnlineBibleChapter({
      version: 'NLT',
      book: 'John',
      chapter: 1,
      fetchImpl: async () => { called = true; },
    }),
    /Only the future Online Mode ESV provider is preserved/,
  );
  assert.equal(called, false);
});

test('KJV is local and can never reach the online provider', async () => {
  let called = false;
  await assert.rejects(
    fetchOnlineBibleChapter({
      version: 'KJV',
      book: 'Genesis',
      chapter: 1,
      fetchImpl: async () => { called = true; },
    }),
    /Only the future Online Mode ESV provider is preserved/,
  );
  assert.equal(called, false);
});
