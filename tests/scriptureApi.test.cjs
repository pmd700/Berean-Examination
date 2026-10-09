'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { ScriptureCache } = require('../desktop/scripture-cache.cjs');
const { ScriptureUsageLedger } = require('../desktop/scripture-usage.cjs');
const { ScriptureApi } = require('../desktop/scripture-api.cjs');

test('ScriptureCache stores catalog, books, and respects LRU verse limits', () => {
  const cache = new ScriptureCache({ maxVersesPerBible: 5 });

  // Catalog
  assert.equal(cache.getCatalog(), null);
  cache.setCatalog([{ id: 'b1', name: 'Bible 1' }]);
  assert.deepEqual(cache.getCatalog(), [{ id: 'b1', name: 'Bible 1' }]);

  // Books
  assert.equal(cache.getBooks('b1'), null);
  cache.setBooks('b1', [{ id: 'GEN' }]);
  assert.deepEqual(cache.getBooks('b1'), [{ id: 'GEN' }]);

  // Content LRU
  cache.setContent('b1', 'verse', 'GEN.1.1', { text: 'v1' }, 2);
  assert.deepEqual(cache.getContent('b1', 'verse', 'GEN.1.1'), { text: 'v1' });

  cache.setContent('b1', 'verse', 'GEN.1.2', { text: 'v2' }, 2);
  // Total is now 4 verses (limit is 5)
  assert.ok(cache.getContent('b1', 'verse', 'GEN.1.1'));
  assert.ok(cache.getContent('b1', 'verse', 'GEN.1.2'));

  // Adding 3 more verses exceeds limit (4 + 3 = 7 > 5), oldest should be evicted
  cache.setContent('b1', 'verse', 'GEN.1.3', { text: 'v3' }, 3);
  assert.equal(cache.getContent('b1', 'verse', 'GEN.1.1'), null); // Evicted!
  assert.ok(cache.getContent('b1', 'verse', 'GEN.1.3'));

  cache.clear();
  assert.equal(cache.getCatalog(), null);
  assert.equal(cache.getBooks('b1'), null);
});

test('ScriptureUsageLedger partitions by fingerprint and summarizes counts', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bex-usage-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const ledger = new ScriptureUsageLedger({ storageDir: dir });
  assert.deepEqual(ledger.getSummary('fp-1'), { totalRequests: 0, requestsToday: 0, lastRequest: null });

  ledger.recordRequest({ fingerprint: 'fp-1', endpointType: 'catalog', status: 200, durationMs: 120 });
  ledger.recordRequest({ fingerprint: 'fp-1', endpointType: 'content', status: 200, durationMs: 45 });
  ledger.recordRequest({ fingerprint: 'fp-2', endpointType: 'content', status: 200, durationMs: 60 });

  const summary1 = ledger.getSummary('fp-1');
  assert.equal(summary1.totalRequests, 2);
  assert.equal(summary1.requestsToday, 2);
  assert.ok(summary1.lastRequest);

  const summary2 = ledger.getSummary('fp-2');
  assert.equal(summary2.totalRequests, 1);
});

test('ScriptureApi integrates with settings, cache, and handles cancellation', async () => {
  const calls = [];
  const fakeKey = 'super-secret-api-key';
  const settings = {
    getKey: () => fakeKey,
    getFingerprint: () => 'fp-abc1234',
  };
  const cache = new ScriptureCache();
  const api = new ScriptureApi({ settings, cache });

  // Mock global.fetch
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url: url.toString(), headers: options.headers, signal: options.signal });
    if (url.toString().includes('/bibles/b1/passages/JHN.1.1')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { id: 'JHN.1.1', reference: 'John 1:1', content: [] } }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  try {
    const result = await api.fetchContent({ bibleId: 'b1', type: 'passage', id: 'JHN.1.1' });
    assert.equal(result.data.reference, 'John 1:1');
    assert.equal(result.cached, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers['api-key'], fakeKey);

    // Second call should come from cache
    const cachedResult = await api.fetchContent({ bibleId: 'b1', type: 'passage', id: 'JHN.1.1' });
    assert.equal(cachedResult.cached, true);
    assert.equal(calls.length, 1); // No new network call!
  } finally {
    global.fetch = originalFetch;
  }
});
