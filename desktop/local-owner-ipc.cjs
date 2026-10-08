'use strict';

const LOCAL_OWNER_CHANNELS = Object.freeze({
  get: 'local-owner:get',
  update: 'local-owner:update',
});

const PUBLIC_ERROR_MESSAGES = Object.freeze({
  BEX_DATABASE_NOT_OPEN: 'Choose or reconnect the Berean Library before reading local settings.',
  BEX_LOCAL_OWNER_INVALID: 'The local owner settings could not be read or saved.',
  BEX_UNTRUSTED_SENDER: 'BEX blocked a request from an untrusted page.',
});

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertTrustedSender(event, trustedOrigin) {
  const senderUrl = event?.senderFrame?.url
    || (event?.sender && typeof event.sender.getURL === 'function' ? event.sender.getURL() : '');

  let senderOrigin = null;
  try {
    senderOrigin = new URL(senderUrl).origin;
  } catch {
    // A malformed sender URL is never trusted.
  }
  if (senderOrigin !== trustedOrigin) {
    throw codedError('BEX_UNTRUSTED_SENDER', 'Blocked a local owner request from an untrusted page.');
  }
}

function errorResponse(error, fallbackMessage) {
  const publicMessage = error && typeof error.code === 'string'
    ? PUBLIC_ERROR_MESSAGES[error.code]
    : null;
  return { ok: false, error: publicMessage || fallbackMessage };
}

function validateDependencies(options) {
  if (!options || typeof options.appUrl !== 'string') {
    throw new TypeError('The local owner bridge requires the BEX application URL.');
  }
  if (
    !options.ipcMain
    || typeof options.ipcMain.handle !== 'function'
    || typeof options.ipcMain.removeHandler !== 'function'
  ) {
    throw new TypeError('The local owner bridge requires Electron IPC.');
  }
  for (const dependency of ['getLocalOwner', 'updateLocalOwner']) {
    if (typeof options[dependency] !== 'function') {
      throw new TypeError('The local owner bridge is missing ' + dependency + '.');
    }
  }
}

function registerLocalOwnerHandlers(options) {
  validateDependencies(options);
  const {
    appUrl,
    getLocalOwner,
    ipcMain,
    updateLocalOwner,
  } = options;
  const trustedOrigin = new URL(appUrl).origin;

  for (const channel of Object.values(LOCAL_OWNER_CHANNELS)) {
    ipcMain.removeHandler(channel);
  }

  ipcMain.handle(LOCAL_OWNER_CHANNELS.get, async (event) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      return { ok: true, owner: await getLocalOwner() };
    } catch (error) {
      return errorResponse(error, 'BEX could not read the local owner settings.');
    }
  });

  ipcMain.handle(LOCAL_OWNER_CHANNELS.update, async (event, patch) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      return { ok: true, owner: await updateLocalOwner(patch) };
    } catch (error) {
      return errorResponse(error, 'BEX could not save the local owner settings.');
    }
  });
}

module.exports = {
  LOCAL_OWNER_CHANNELS,
  registerLocalOwnerHandlers,
};
