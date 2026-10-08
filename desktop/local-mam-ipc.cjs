'use strict';

const LOCAL_MAM_CHAPTER_CHANNEL = 'local-mam:get-chapter';

function senderOrigin(event) {
  const senderUrl = event?.senderFrame?.url
    || (event?.sender && typeof event.sender.getURL === 'function' ? event.sender.getURL() : '');
  try {
    return new URL(senderUrl).origin;
  } catch {
    return null;
  }
}

function registerLocalMamHandlers({ appUrl, ipcMain, readLocalMamChapter } = {}) {
  if (typeof appUrl !== 'string' || !ipcMain || typeof readLocalMamChapter !== 'function') {
    throw new TypeError('The local MAM bridge is missing a required dependency.');
  }
  const trustedOrigin = new URL(appUrl).origin;
  ipcMain.removeHandler(LOCAL_MAM_CHAPTER_CHANNEL);
  ipcMain.handle(LOCAL_MAM_CHAPTER_CHANNEL, async (event, request) => {
    try {
      if (senderOrigin(event) !== trustedOrigin) {
        const error = new Error('Blocked a local MAM request from an untrusted page.');
        error.code = 'BEX_UNTRUSTED_SENDER';
        throw error;
      }
      return { chapter: readLocalMamChapter(request), ok: true };
    } catch (error) {
      const messages = {
        BEX_MAM_INVALID: 'Choose a valid local MAM chapter.',
        BEX_MAM_NOT_FOUND: 'That chapter was not found in the local MAM files.',
        BEX_UNTRUSTED_SENDER: 'BEX blocked a local MAM request from an untrusted page.',
      };
      return {
        code: typeof error?.code === 'string' ? error.code : null,
        error: messages[error?.code] || 'BEX could not read that local MAM chapter.',
        ok: false,
      };
    }
  });
}

module.exports = { LOCAL_MAM_CHAPTER_CHANNEL, registerLocalMamHandlers };
