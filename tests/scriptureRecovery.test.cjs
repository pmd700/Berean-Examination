'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ScriptureApi, countVerses } = require('../desktop/scripture-api.cjs');
const { ScriptureCache } = require('../desktop/scripture-cache.cjs');
const { LocalEntityStore } = require('../desktop/local-entity-store.cjs');
const { DatabaseSync } = require('node:sqlite');

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(t) {
  const old = global.fetch; t.after(() => { global.fetch = old; });
  const calls = [];
  global.fetch = (url, options) => {
    const item = { ...deferred(), url, options };
    calls.push(item);
    options.signal.addEventListener('abort', () => item.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    return item.promise;
  };
  let fingerprint = 'first';
  const cache = new ScriptureCache();
  const ledger = { records: [], recordRequest(record) { this.records.push(record); } };
  const api = new ScriptureApi({ settings: { getKey: () => 'fixture-key', getFingerprint: () => fingerprint }, cache, ledger });
  const load = (id, requestId) => api.fetchContent({ bibleId: 'edition', type: 'verse', id, requestId });
  const reply = (index, content = 'verse') => calls[index].resolve({ ok: true, status: 200, json: async () => ({ data: { id: 'ROM.1.1', verseCount: 1, content }, meta: { fumsToken: 'retained-token' } }) });
  return { api, cache, ledger, calls, load, reply, rotate: () => { fingerprint = 'second'; } };
}

test('deduplicated readers cancel independently and retain reporting metadata on a cache hit', async t => {
  const h = harness(t);
  const first = h.load('ROM.1.1', 'tab-one');
  const firstRejected = assert.rejects(first, /cancelled/);
  const second = h.load('ROM.1.1', 'tab-two');
  await tick(); assert.equal(h.calls.length, 1);
  assert.equal(h.api.cancelRequest('tab-one'), true);
  await firstRejected;
  assert.equal(h.calls[0].options.signal.aborted, false);
  h.reply(0); await second;
  const cached = await h.load('ROM.1.1', 'third');
  assert.equal(cached.cached, true);
  assert.equal(cached.meta.fumsToken, 'retained-token');
  assert.equal(h.calls.length, 1);
  assert.equal(h.ledger.records.length, 1);
});

test('two network requests across tabs and queued cancellation dispatches no extra work', async t => {
  const h = harness(t);
  const a = h.load('ROM.1.1', 'a'); const b = h.load('JHN.1.1', 'b'); const c = h.load('MRK.1.1', 'c');
  const rejected = assert.rejects(c, /cancelled/);
  await tick(); assert.equal(h.calls.length, 2);
  h.api.cancelRequest('c'); await rejected;
  h.reply(0); h.reply(1); await Promise.all([a, b]);
  await tick(); assert.equal(h.calls.length, 2);
});

test('cancelling the last subscriber aborts its fetch and leaves no failed promise in deduplication', async t => {
  const h = harness(t);
  const a = h.load('ROM.1.1', 'a'); const rejected = assert.rejects(a, /cancelled/);
  await tick(); h.api.cancelRequest('a'); await rejected; await tick();
  assert.equal(h.calls[0].options.signal.aborted, true);
  const retry = h.load('ROM.1.1', 'b'); await tick(); h.reply(1); await retry;
  assert.equal(h.api.inFlightRequests.size, 0); assert.equal(h.api.dedupeMap.size, 0);
});

test('key replacement clears cached content and aborts old key work', async t => {
  const h = harness(t);
  const a = h.load('ROM.1.1', 'a'); await tick(); h.reply(0); await a;
  const pending = h.load('JHN.1.1', 'b'); const rejected = assert.rejects(pending, /cancelled/);
  await tick(); h.rotate();
  const fresh = h.load('ROM.1.1', 'c'); await rejected; await tick();
  assert.equal(h.calls.length, 3); assert.equal(h.calls[1].options.signal.aborted, true);
  h.reply(2); assert.equal((await fresh).cached, false);
});

test('HTTP failures record exactly one attempt and are never cached', async t => {
  const h = harness(t); const pending = h.load('ROM.1.1', 'a');
  const rejected = assert.rejects(pending, /HTTP 503/);
  await tick(); h.calls[0].resolve({ ok: false, status: 503 }); await rejected;
  assert.equal(h.ledger.records.length, 1); assert.equal(h.ledger.records[0].status, 503);
  assert.equal(h.cache.getContent('edition', 'verse', 'ROM.1.1'), null);
});

test('cache rejects oversized and uncountable bodies, replacement stays within budget, and expiry purges idle entries', () => {
  const cache = new ScriptureCache({ maxVersesPerBible: 5 });
  cache.setContent('a', 'chapter', 'big', {}, 6); assert.equal(cache.content.size, 0);
  cache.setContent('a', 'chapter', 'unknown', {}); assert.equal(cache.content.size, 0);
  cache.setContent('a', 'chapter', 'one', {}, 3);
  cache.setContent('a', 'chapter', 'one', {}, 3); assert.equal(cache.content.size, 1);
  cache.setContent('a', 'chapter', 'two', {}, 2); assert.equal(cache.content.size, 2);
  for (const entry of cache.content.values()) entry.time -= 15 * 24 * 60 * 60 * 1000;
  cache.pruneExpired(); assert.equal(cache.content.size, 0);
  assert.equal(countVerses({ content: [] }, 'chapter'), null);
  assert.equal(countVerses({ content: [{ name: 'verse', attrs: { number: '2-4' } }] }, 'chapter'), 3);
});

test('API parent migration removes only remote bodies and prevents them from being written back', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE local_study_chapters (id INTEGER PRIMARY KEY, encrypted_payload BLOB, created_at TEXT, updated_at TEXT);
    CREATE TABLE local_entity_sequences (entity_type TEXT PRIMARY KEY, last_id INTEGER);`);
  const vault = { assertUnlocked() {}, encryptValue: value => Buffer.from(JSON.stringify(value)), decryptValue: value => JSON.parse(Buffer.from(value).toString()) };
  const store = new LocalEntityStore(db, vault);
  const original = { version: 'API:edition', api_bible_id: 'edition', book: 'Romans', chapter_number: 1, raw_text: 'old fetched scripture',
    blocks: [{ text: 'fetched' }], notes: 'permanent writing', context: 'permanent context', annotation_count: 2 };
  const insert = db.prepare('INSERT INTO local_study_chapters VALUES (?, ?, ?, ?)');
  insert.run(7, vault.encryptValue(original), 'created', 'updated');
  insert.run(8, vault.encryptValue({ ...original, version: 'BSB', api_bible_id: 'edition' }), 'created', 'updated');
  const migrated = store.get('StudyChapter', 7);
  assert.equal(migrated.id, 7); assert.equal(migrated.raw_text, ''); assert.equal(migrated.blocks, undefined);
  assert.equal(migrated.notes, original.notes); assert.equal(migrated.context, original.context); assert.equal(migrated.annotation_count, 2);
  assert.equal(migrated.updated_date, 'updated');
  const stored = vault.decryptValue(db.prepare('SELECT encrypted_payload FROM local_study_chapters WHERE id = 7').get().encrypted_payload);
  assert.equal(stored.raw_text, ''); assert.equal(stored.blocks, undefined);
  assert.equal(store.get('StudyChapter', 8).raw_text, 'old fetched scripture');
  assert.equal(store.update('StudyChapter', 7, { raw_text: 'attempt to retain fetched text', blocks: [{ text: 'fetched' }] }).raw_text, '');
  db.close();
});
