'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { registerClipboardHandlers } = require('../desktop/clipboard-ipc.cjs');

function setup() {
  let handler;
  const writes = [];
  registerClipboardHandlers({
    appUrl: 'http://127.0.0.1:61474/Study',
    ipcMain: { removeHandler() {}, handle(_channel, fn) { handler = fn; } },
    clipboard: { writeText(text) { writes.push(text); } },
  });
  return { handler, writes };
}

test('only the BEX origin can write native clipboard text', () => {
  const { handler, writes } = setup();
  assert.equal(handler({ senderFrame: { url: 'https://untrusted.example/' } }, 'untrusted').ok, false);
  assert.equal(handler({ senderFrame: { url: 'http://127.0.0.1:61474/Study' } }, 'Romans 1:1 (BSB)\nPaul...').ok, true);
  assert.deepEqual(writes, ['Romans 1:1 (BSB)\nPaul...']);
});

test('invalid clipboard payloads do not modify the clipboard', () => {
  const { handler, writes } = setup();
  assert.equal(handler({ senderFrame: { url: 'http://127.0.0.1:61474/Study' } }, { text: 'Invalid' }).ok, false);
  assert.deepEqual(writes, []);
});
