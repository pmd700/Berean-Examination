'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { registerAppRestartHandler } = require('../desktop/app-restart-ipc.cjs');

function fixture() {
  let handler;
  const calls = [];
  const scheduled = [];
  registerAppRestartHandler({
    appUrl: 'http://127.0.0.1:5199',
    ipcMain: { removeHandler() {}, handle(_channel, callback) { handler = callback; } },
    app: { relaunch: () => calls.push('relaunch'), quit: () => calls.push('quit') },
    schedule: (callback) => scheduled.push(callback),
  });
  const frame = { url: 'http://127.0.0.1:5199/LibraryHome' };
  return { handler, calls, scheduled, event: { senderFrame: frame, sender: { mainFrame: frame } } };
}

test('restart uses one relaunch and normal quit, even with repeated requests', async () => {
  const { handler, event, calls, scheduled } = fixture();
  assert.deepEqual(await handler(event), { ok: true });
  assert.deepEqual(await handler(event), { ok: true });
  assert.deepEqual(calls, ['relaunch']);
  assert.equal(scheduled.length, 1);
  scheduled[0]();
  assert.deepEqual(calls, ['relaunch', 'quit']);
});

test('external pages and child frames cannot restart the app', async () => {
  const { handler, calls, event } = fixture();
  for (const frame of [{ url: 'https://evil.example/' }, { url: 'invalid' }, { url: event.senderFrame.url }, null]) {
    assert.equal((await handler({ ...event, senderFrame: frame })).ok, false);
  }
  assert.deepEqual(calls, []);
});

test('a failed relaunch does not quit and can be retried', async () => {
  let handler;
  let quit = false;
  let broken = true;
  registerAppRestartHandler({
    appUrl: 'http://localhost:5199',
    ipcMain: { removeHandler() {}, handle(_channel, callback) { handler = callback; } },
    app: { relaunch() { if (broken) throw Error('not available'); }, quit() { quit = true; } },
    schedule: (callback) => callback(),
  });
  const frame = { url: 'http://localhost:5199/' };
  const event = { senderFrame: frame, sender: { mainFrame: frame } };
  assert.equal((await handler(event)).ok, false);
  assert.equal(quit, false);
  broken = false;
  assert.equal((await handler(event)).ok, true);
  assert.equal(quit, true);
});
