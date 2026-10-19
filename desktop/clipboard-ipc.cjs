'use strict';
const COPY_TEXT_CHANNEL = 'clipboard:write-text';

function registerClipboardHandlers({ appUrl, ipcMain, clipboard }) {
  const trustedOrigin = new URL(appUrl).origin;
  ipcMain.removeHandler(COPY_TEXT_CHANNEL);
  ipcMain.handle(COPY_TEXT_CHANNEL, (event, text) => {
    try {
      const senderUrl = event?.senderFrame?.url || event?.sender?.getURL?.();
      if (new URL(senderUrl).origin !== trustedOrigin) throw new Error('Untrusted clipboard request.');
      if (typeof text !== 'string') throw new Error('Clipboard text must be a string.');
      clipboard.writeText(text);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error?.message || 'Could not copy text.' };
    }
  });
}
module.exports = { COPY_TEXT_CHANNEL, registerClipboardHandlers };
