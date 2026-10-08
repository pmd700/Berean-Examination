'use strict';

const LOCAL_BIBLE_CHAPTER_CHANNEL = 'local-bible:get-chapter';

const PUBLIC_ERROR_MESSAGES = Object.freeze({
  BEX_BIBLE_INVALID: 'Choose a valid local Bible chapter.',
  BEX_BIBLE_NOT_FOUND: 'That chapter was not found in the local Bible files.',
  BEX_UNTRUSTED_SENDER: 'BEX blocked a local-Bible request from an untrusted page.',
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
    throw codedError('BEX_UNTRUSTED_SENDER', 'Blocked a local-Bible request from an untrusted page.');
  }
}

function registerLocalBibleHandlers({ appUrl, ipcMain, readLocalBibleChapter } = {}) {
  if (typeof appUrl !== 'string' || !ipcMain || typeof readLocalBibleChapter !== 'function') {
    throw new TypeError('The local Bible bridge is missing a required dependency.');
  }
  const trustedOrigin = new URL(appUrl).origin;
  ipcMain.removeHandler(LOCAL_BIBLE_CHAPTER_CHANNEL);
  ipcMain.handle(LOCAL_BIBLE_CHAPTER_CHANNEL, async (event, request) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      return { chapter: await readLocalBibleChapter(request), ok: true };
    } catch (error) {
      return {
        code: typeof error?.code === 'string' ? error.code : null,
        error: PUBLIC_ERROR_MESSAGES[error?.code] || 'BEX could not read that local Bible chapter.',
        ok: false,
      };
    }
  });
}

module.exports = {
  LOCAL_BIBLE_CHAPTER_CHANNEL,
  registerLocalBibleHandlers,
};
