'use strict';

const NO_OPEN_LIBRARY_CODES = new Set([
  'BEX_DATABASE_NOT_OPEN',
  'BEX_PRIVACY_NOT_OPEN',
]);

function requireFunction(options, name) {
  if (typeof options?.[name] !== 'function') {
    throw new TypeError(`The normal-close backup flow requires ${name}.`);
  }
  return options[name];
}

function createNormalCloseHandler(options = {}) {
  const app = options.app;
  if (!app || typeof app.quit !== 'function') {
    throw new TypeError('The normal-close backup flow requires Electron app.quit.');
  }
  const closeDatabase = requireFunction(options, 'closeDatabase');
  const closeServices = requireFunction(options, 'closeServices');
  const createLocalBackup = requireFunction(options, 'createLocalBackup');
  const onShutdownStarted = typeof options.onShutdownStarted === 'function'
    ? options.onShutdownStarted
    : () => {};
  const logger = options.logger || console;
  let shutdownState = 'idle';
  let shutdownPromise = null;

  function logFailure(label, error) {
    if (logger && typeof logger.error === 'function') {
      logger.error(`[desktop] ${label}:`, error);
    }
  }

  function finishShutdown() {
    try {
      closeDatabase();
    } catch (error) {
      logFailure('Could not close the local database cleanly', error);
    }
    try {
      closeServices();
    } catch (error) {
      logFailure('Could not close a desktop service cleanly', error);
    }
    shutdownState = 'finished';
    app.quit();
  }

  return function handleBeforeQuit(event) {
    if (shutdownState === 'finished') return undefined;
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (shutdownPromise) return shutdownPromise;

    shutdownState = 'backing-up';
    shutdownPromise = (async () => {
      if (typeof options.prepareForShutdown === 'function') {
        try {
          await Promise.resolve().then(() => options.prepareForShutdown());
        } catch (error) {
          shutdownState = 'idle';
          shutdownPromise = null;
          logFailure('Could not finish saving; BEX has been kept open', error);
          options.onPreparationFailed?.(error);
          return;
        }
      }
      onShutdownStarted();
      try {
        await createLocalBackup();
      } catch (error) {
        if (!NO_OPEN_LIBRARY_CODES.has(error?.code)) {
          logFailure('Could not create the normal-close backup; BEX will still close', error);
        }
      } finally {
        finishShutdown();
      }
    })();
    return shutdownPromise;
  };
}

module.exports = {
  createNormalCloseHandler,
};
