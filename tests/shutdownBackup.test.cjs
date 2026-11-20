'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { createNormalCloseHandler } = require('../desktop/normal-close-backup.cjs');

function quitEvent() {
  return {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe('normal-close shutdown', () => {
  it('drains pending renderer saves before closing SQLite and keeps the window open if preparing fails', async () => {
    const calls = [], preparation = deferred();
    let failure = true;
    const handler = createNormalCloseHandler({
      app: { quit: () => calls.push('quit') },
      closeDatabase: () => calls.push('close-database'),
      closeServices: () => calls.push('close-services'),
      prepareForShutdown: async () => { calls.push('prepare'); await preparation.promise; if (failure) throw new Error('Save failed'); },
      onPreparationFailed: () => calls.push('kept-open'),
      logger: { error() {} },
    });
    const closing = handler(quitEvent());
    await Promise.resolve();
    assert.deepEqual(calls, ['prepare']);
    preparation.resolve(); await closing;
    assert.deepEqual(calls, ['prepare', 'kept-open']);
    failure = false;
    await handler(quitEvent());
    assert.deepEqual(calls, ['prepare', 'kept-open', 'prepare', 'close-database', 'close-services', 'quit']);
  });

  it('runs shutdown once without creating backup files before closing SQLite and quitting', async () => {
    const calls = [];
    const handler = createNormalCloseHandler({
      app: { quit: () => calls.push('quit') },
      closeDatabase: () => calls.push('close-database'),
      closeServices: () => calls.push('close-services'),
      onShutdownStarted: () => calls.push('shutdown-started'),
    });

    const firstEvent = quitEvent();
    const firstShutdown = handler(firstEvent);
    const repeatedEvent = quitEvent();
    const repeatedShutdown = handler(repeatedEvent);
    assert.equal(firstEvent.prevented, true);
    assert.equal(repeatedEvent.prevented, true);
    assert.equal(firstShutdown, repeatedShutdown);

    await firstShutdown;
    assert.deepEqual(calls, [
      'shutdown-started',
      'close-database',
      'close-services',
      'quit',
    ]);

    const finalEvent = quitEvent();
    assert.equal(handler(finalEvent), undefined);
    assert.equal(finalEvent.prevented, false);
    assert.equal(calls.filter((call) => call === 'close-database').length, 1);
  });
});
