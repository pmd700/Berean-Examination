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

describe('automatic normal-close backup', () => {
  it('drains pending renderer saves before backup and keeps the window open if preparing fails', async () => {
    const calls = [], preparation = deferred();
    let failure = true;
    const handler = createNormalCloseHandler({
      app: { quit: () => calls.push('quit') },
      closeDatabase: () => calls.push('close-database'),
      closeServices: () => calls.push('close-services'),
      prepareForShutdown: async () => { calls.push('prepare'); await preparation.promise; if (failure) throw new Error('Save failed'); },
      onPreparationFailed: () => calls.push('kept-open'),
      createLocalBackup: async () => calls.push('backup'),
      logger: { error() {} },
    });
    const closing = handler(quitEvent());
    await Promise.resolve();
    assert.deepEqual(calls, ['prepare']);
    preparation.resolve(); await closing;
    assert.deepEqual(calls, ['prepare', 'kept-open']);
    failure = false;
    await handler(quitEvent());
    assert.deepEqual(calls, ['prepare', 'kept-open', 'prepare', 'backup', 'close-database', 'close-services', 'quit']);
  });

  it('waits for one backup before closing SQLite and quitting', async () => {
    const backup = deferred();
    const calls = [];
    const handler = createNormalCloseHandler({
      app: { quit: () => calls.push('quit') },
      closeDatabase: () => calls.push('close-database'),
      closeServices: () => calls.push('close-services'),
      createLocalBackup: () => {
        calls.push('backup-started');
        return backup.promise;
      },
      onShutdownStarted: () => calls.push('shutdown-started'),
    });

    const firstEvent = quitEvent();
    const firstShutdown = handler(firstEvent);
    const repeatedEvent = quitEvent();
    const repeatedShutdown = handler(repeatedEvent);
    assert.equal(firstEvent.prevented, true);
    assert.equal(repeatedEvent.prevented, true);
    assert.equal(firstShutdown, repeatedShutdown);
    assert.deepEqual(calls, ['shutdown-started', 'backup-started']);

    backup.resolve({ fileName: 'verified.bex-backup.db' });
    await firstShutdown;
    assert.deepEqual(calls, [
      'shutdown-started',
      'backup-started',
      'close-database',
      'close-services',
      'quit',
    ]);

    const finalEvent = quitEvent();
    assert.equal(handler(finalEvent), undefined);
    assert.equal(finalEvent.prevented, false);
    assert.equal(calls.filter((call) => call === 'backup-started').length, 1);
  });

  it('still closes when backup creation fails', async () => {
    const calls = [];
    const loggedErrors = [];
    const backupError = Object.assign(new Error('Drive unavailable'), {
      code: 'BEX_BACKUP_FOLDER_INVALID',
    });
    const handler = createNormalCloseHandler({
      app: { quit: () => calls.push('quit') },
      closeDatabase: () => calls.push('close-database'),
      closeServices: () => calls.push('close-services'),
      createLocalBackup: async () => {
        calls.push('backup-attempted');
        throw backupError;
      },
      logger: { error: (...values) => loggedErrors.push(values) },
    });

    await handler(quitEvent());
    assert.deepEqual(calls, ['backup-attempted', 'close-database', 'close-services', 'quit']);
    assert.equal(loggedErrors.length, 1);
    assert.match(loggedErrors[0][0], /BEX will still close/);
  });

  it('quietly exits when no Berean Library was opened', async () => {
    const calls = [];
    const loggedErrors = [];
    const handler = createNormalCloseHandler({
      app: { quit: () => calls.push('quit') },
      closeDatabase: () => calls.push('close-database'),
      closeServices: () => calls.push('close-services'),
      createLocalBackup: async () => {
        const error = new Error('No database');
        error.code = 'BEX_DATABASE_NOT_OPEN';
        throw error;
      },
      logger: { error: (...values) => loggedErrors.push(values) },
    });

    await handler(quitEvent());
    assert.deepEqual(calls, ['close-database', 'close-services', 'quit']);
    assert.equal(loggedErrors.length, 0);
  });
});
