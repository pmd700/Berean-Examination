'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  OPEN_EXTERNAL_URL_CHANNEL,
  registerExternalLinkHandlers,
  validateExternalUrl,
} = require('../desktop/external-link-ipc.cjs');

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      handlers.delete(channel);
    },
  };
}

test('opens a validated HTTPS rights page from the trusted BEX window', async () => {
  const ipcMain = fakeIpcMain();
  const opened = [];
  registerExternalLinkHandlers({
    appUrl: 'http://127.0.0.1:4173',
    ipcMain,
    openExternal: async (url) => opened.push(url),
  });
  const result = await ipcMain.handlers.get(OPEN_EXTERNAL_URL_CHANNEL)(
    { senderFrame: { url: 'http://127.0.0.1:4173/SourcesLicenses' } },
    'https://berean.bible/terms.htm',
  );
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(opened, ['https://berean.bible/terms.htm']);
});

test('blocks unsafe protocols, embedded credentials, and untrusted pages', async () => {
  for (const target of [
    'http://example.com/',
    'file:///private/etc/passwd',
    'javascript:alert(1)',
    'https://user:password@example.com/',
  ]) {
    assert.throws(() => validateExternalUrl(target), /secure/);
  }

  const ipcMain = fakeIpcMain();
  const opened = [];
  registerExternalLinkHandlers({
    appUrl: 'http://127.0.0.1:4173',
    ipcMain,
    openExternal: async (url) => opened.push(url),
  });
  const result = await ipcMain.handlers.get(OPEN_EXTERNAL_URL_CHANNEL)(
    { senderFrame: { url: 'https://untrusted.example/' } },
    'https://berean.bible/terms.htm',
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'BEX_UNTRUSTED_SENDER');
  assert.deepEqual(opened, []);
});
