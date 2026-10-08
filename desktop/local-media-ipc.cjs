'use strict';

const SAVE_IMAGE_CHANNEL = 'local-media:save-image';
const DELETE_IMAGE_CHANNEL = 'local-media:delete-image';

const PUBLIC_ERROR_MESSAGES = Object.freeze({
  BEX_DATABASE_NOT_OPEN: 'Choose or reconnect the Berean Library before adding images.',
  BEX_MEDIA_INVALID: 'Choose a valid PNG, JPEG, GIF, or WebP image.',
  BEX_MEDIA_LIBRARY_UNAVAILABLE: 'The Berean Library Media folder is unavailable.',
  BEX_MEDIA_NOT_FOUND: 'The encrypted image file no longer exists.',
  BEX_MEDIA_TOO_LARGE: 'Images must be 10 MB or smaller.',
  BEX_PRIVACY_LOCKED: 'Unlock the Berean Library before adding images.',
  BEX_PRIVACY_NOT_OPEN: 'The encrypted Berean Library vault is unavailable.',
  BEX_UNTRUSTED_SENDER: 'BEX blocked a media request from an untrusted page.',
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
    throw codedError('BEX_UNTRUSTED_SENDER', 'Blocked a media request from an untrusted page.');
  }
}

function errorResponse(error, fallbackMessage = 'BEX could not save that image locally.') {
  return {
    ok: false,
    code: typeof error?.code === 'string' ? error.code : null,
    error: PUBLIC_ERROR_MESSAGES[error?.code] || fallbackMessage,
  };
}

function registerLocalMediaHandlers({ appUrl, deleteLocalImage, ipcMain, saveLocalImage }) {
  if (
    typeof appUrl !== 'string'
    || !ipcMain
    || typeof deleteLocalImage !== 'function'
    || typeof saveLocalImage !== 'function'
  ) {
    throw new TypeError('The local media bridge is incomplete.');
  }
  const trustedOrigin = new URL(appUrl).origin;
  ipcMain.removeHandler(SAVE_IMAGE_CHANNEL);
  ipcMain.removeHandler(DELETE_IMAGE_CHANNEL);
  ipcMain.handle(SAVE_IMAGE_CHANNEL, async (event, payload) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      return { ok: true, media: await saveLocalImage(payload) };
    } catch (error) {
      return errorResponse(error);
    }
  });
  ipcMain.handle(DELETE_IMAGE_CHANNEL, async (event, mediaUrl) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      return { ok: true, result: await deleteLocalImage(mediaUrl) };
    } catch (error) {
      return errorResponse(error, 'BEX could not remove that image locally.');
    }
  });
}

module.exports = {
  DELETE_IMAGE_CHANNEL,
  registerLocalMediaHandlers,
  SAVE_IMAGE_CHANNEL,
};
