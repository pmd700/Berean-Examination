'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { ScriptureSettings } = require('../desktop/scripture-settings.cjs');
const { registerScriptureHandlers } = require('../desktop/scripture-ipc.cjs');

// Inject an actual cipher to prove only ciphertext is persisted, without
// touching the user's OS keychain or application credentials in a unit test.
function fixture(t, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bex-scripture-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const secret = crypto.randomBytes(32);
  const safeStorage = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'unknown',
    encryptString(value) {
      const nonce = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', secret, nonce);
      const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
    },
    decryptString(buffer) {
      const nonce = buffer.subarray(0, 12);
      const tag = buffer.subarray(12, 28);
      const ciphertext = buffer.subarray(28);
      const decipher = crypto.createDecipheriv('aes-256-gcm', secret, nonce);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    },
    ...overrides,
  };
  const filePath = path.join(dir, 'credentials.json');
  return { filePath, safeStorage, store: new ScriptureSettings({ filePath, safeStorage }) };
}

test('setup starts locked, saves ciphertext only, survives restart, replaces and removes the key', (t) => {
  const { store, filePath, safeStorage } = fixture(t);
  assert.deepEqual(store.status(), { configured: false });
  assert.throws(() => store.getKey(), /not configured/);
  assert.equal(store.getFingerprint(), null);
  assert.deepEqual(store.save('  synthetic-test-key-one  '), { configured: true });
  assert.equal(store.getKey(), 'synthetic-test-key-one');
  assert.ok(typeof store.getFingerprint() === 'string' && store.getFingerprint().length === 16);
  const first = fs.readFileSync(filePath, 'utf8');
  assert.ok(!first.includes('synthetic-test-key-one'));
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
  const reopened = new ScriptureSettings({ filePath, safeStorage });
  assert.deepEqual(reopened.status(), { configured: true });
  assert.equal(reopened.getKey(), 'synthetic-test-key-one');
  reopened.save('synthetic-test-key-two');
  assert.equal(reopened.getKey(), 'synthetic-test-key-two');
  assert.notEqual(fs.readFileSync(filePath, 'utf8'), first);
  assert.deepEqual(reopened.clear(), { configured: false });
  assert.deepEqual(reopened.status(), { configured: false });
  assert.throws(() => reopened.getKey(), /not configured/);
  reopened.clear(); // Idempotent removal.
});

test('fails closed when protected storage is missing or uses a plaintext backend', (t) => {
  for (const overrides of [{ isEncryptionAvailable: () => false }, { getSelectedStorageBackend: () => 'basic_text' }]) {
    const { store, filePath } = fixture(t, overrides);
    assert.throws(() => store.save('synthetic-test-key'), /Protected system storage/);
    assert.ok(!fs.existsSync(filePath));
  }
});

test('rejects empty, multiline and oversized keys without writing a file', (t) => {
  const { store, filePath } = fixture(t);
  for (const key of ['', '   ', 'abc def', 'abc\r\ndef', 'a'.repeat(513), null]) {
    assert.throws(() => store.save(key), /Paste an API key/);
  }
  assert.ok(!fs.existsSync(filePath));
});

test('failed replacement preserves the previous key and corrupt setup remains recoverable', (t) => {
  const { store, filePath, safeStorage } = fixture(t);
  store.save('synthetic-original');
  const previous = fs.readFileSync(filePath, 'utf8');
  safeStorage.encryptString = () => { throw new Error('OS failure synthetic-sensitive-input'); };
  assert.throws(() => store.save('synthetic-new'), /could not protect/);
  assert.equal(fs.readFileSync(filePath, 'utf8'), previous);
  fs.writeFileSync(filePath, '{broken');
  assert.throws(() => store.status(), /Paste your API key again/);
  store.clear();
  assert.deepEqual(store.status(), { configured: false });
});

test('IPC accepts only the app main frame and never exposes the secret or underlying errors', async () => {
  const handlers = new Map();
  const operations = [];
  const frame = { url: 'http://127.0.0.1:5199/LibraryHome' };
  const event = { senderFrame: frame, sender: { mainFrame: frame } };
  registerScriptureHandlers({ appUrl: frame.url, ipcMain: {
    removeHandler: (channel) => handlers.delete(channel),
    handle: (channel, handler) => handlers.set(channel, handler),
  }, settings: {
    status: () => ({ configured: false }),
    save: (key) => { operations.push(key); return { configured: true }; },
    clear: () => { throw new Error('sensitive-input'); },
  } });
  const save = handlers.get('scripture:save-key');
  const key = 'synthetic-secret';
  assert.deepEqual(await save(event, key), { ok: true, status: { configured: true } });
  const childFrame = { url: frame.url };
  assert.equal((await save({ ...event, senderFrame: childFrame }, key)).ok, false);
  assert.equal((await save({ ...event, senderFrame: { url: 'https://example.com' } }, key)).ok, false);
  assert.equal((await save({}, key)).ok, false);
  assert.deepEqual(operations, [key]);
  const result = await handlers.get('scripture:clear-key')(event);
  assert.equal(result.ok, false);
  assert.ok(!JSON.stringify(result).includes('sensitive-input'));
});

test('IPC exposes scripture data operations when api is supplied', async () => {
  const handlers = new Map();
  const frame = { url: 'http://127.0.0.1:5199/LibraryHome' };
  const event = { senderFrame: frame, sender: { mainFrame: frame } };
  const mockApi = {
    getCatalog: async () => [{ id: 'b1' }],
    getBooks: async ({ bibleId }) => [{ id: `${bibleId}-GEN` }],
    fetchContent: async ({ id }) => ({ id, text: 'hello' }),
    searchWords: async ({ query }) => ({ query, total: 1 }),
    cancelRequest: () => true,
    getUsage: () => ({ totalRequests: 5 }),
  };

  registerScriptureHandlers({
    appUrl: frame.url,
    ipcMain: {
      removeHandler: (channel) => handlers.delete(channel),
      handle: (channel, handler) => handlers.set(channel, handler),
    },
    settings: { status: () => ({ configured: true }) },
    api: mockApi,
  });

  assert.ok(handlers.has('scripture:get-catalog'));
  assert.ok(handlers.has('scripture:fetch-content'));
  assert.ok(handlers.has('scripture:cancel-request'));
  assert.ok(handlers.has('scripture:get-usage'));

  const catalogResult = await handlers.get('scripture:get-catalog')(event);
  assert.deepEqual(catalogResult, { ok: true, result: [{ id: 'b1' }] });

  const contentResult = await handlers.get('scripture:fetch-content')(event, { id: 'JHN.1.1' });
  assert.deepEqual(contentResult, { ok: true, result: { id: 'JHN.1.1', text: 'hello' } });

  const usageResult = await handlers.get('scripture:get-usage')(event);
  assert.deepEqual(usageResult, { ok: true, result: { totalRequests: 5 } });
});

