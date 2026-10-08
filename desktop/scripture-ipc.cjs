'use strict';

function registerScriptureHandlers({ appUrl, ipcMain, settings }) {
  const trustedOrigin = new URL(appUrl).origin;
  const handlers = {
    'scripture:get-status': () => settings.status(),
    'scripture:save-key': (key) => settings.save(key),
    'scripture:clear-key': () => settings.clear(),
  };
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        const frame = event?.senderFrame;
        if (!frame || new URL(frame.url).origin !== trustedOrigin
          || frame !== event.sender?.mainFrame) {
          return { ok: false, error: 'BEX blocked scripture setup from an untrusted page.' };
        }
        return { ok: true, status: handler(...args) };
      } catch {
        // Never forward an OS/IPC error which could contain credential input.
        return { ok: false, error: channel === 'scripture:save-key'
          ? 'BEX could not securely save that key. Check the key and protected system storage, then try again.'
          : 'BEX could not update scripture setup. Try again.' };
      }
    });
  }
}

module.exports = { registerScriptureHandlers };
