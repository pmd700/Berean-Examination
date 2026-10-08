'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  CONTACT_MAILTO,
  OPEN_CONTACT_EMAIL_CHANNEL,
  registerContactHandlers,
} = require('../desktop/contact-ipc.cjs');

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

test('opens only David\'s fixed contact email from the trusted BEX page', async () => {
  const ipcMain = fakeIpcMain();
  const opened = [];
  registerContactHandlers({
    appUrl: 'http://127.0.0.1:4173',
    ipcMain,
    openExternal: async (target) => opened.push(target),
  });

  const handler = ipcMain.handlers.get(OPEN_CONTACT_EMAIL_CHANNEL);
  const result = await handler(
    { senderFrame: { url: 'http://127.0.0.1:4173/ContactFeedback' } },
    'mailto:someone-else@example.com',
  );
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(opened, [CONTACT_MAILTO]);
  assert.equal(CONTACT_MAILTO, 'mailto:simonbarjona@atomicmail.io?subject=Berean%20Examination%20Feedback');
});

test('blocks contact requests from pages outside BEX', async () => {
  const ipcMain = fakeIpcMain();
  const opened = [];
  registerContactHandlers({
    appUrl: 'http://127.0.0.1:4173',
    ipcMain,
    openExternal: async (target) => opened.push(target),
  });

  const handler = ipcMain.handlers.get(OPEN_CONTACT_EMAIL_CHANNEL);
  const result = await handler({ senderFrame: { url: 'https://example.com/' } });
  assert.equal(result.ok, false);
  assert.deepEqual(opened, []);
});

test('the visible contact page contains no feedback form or fake submission', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'pages', 'ContactFeedback.jsx'),
    'utf8',
  );
  assert.doesNotMatch(source, /Feedback\.create|handleSubmit|Send Feedback|Feedback sent/);
  assert.match(source, /simonbarjona@atomicmail\.io/);
  assert.match(source, /Nothing is sent until you choose Send/);
});
