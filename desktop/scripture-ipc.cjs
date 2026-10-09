'use strict';

function registerScriptureHandlers({ appUrl, ipcMain, settings, api }) {
  const trustedOrigin = new URL(appUrl).origin;
  const setupHandlers = {
    'scripture:get-status': () => settings.status(),
    'scripture:save-key': (key) => settings.save(key),
    'scripture:clear-key': () => settings.clear(),
  };

  for (const [channel, handler] of Object.entries(setupHandlers)) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        const frame = event?.senderFrame;
        if (!frame || new URL(frame.url).origin !== trustedOrigin
          || frame !== event.sender?.mainFrame) {
          return { ok: false, error: 'BEX blocked scripture setup from an untrusted page.' };
        }
        return { ok: true, status: await handler(...args) };
      } catch {
        return { ok: false, error: channel === 'scripture:save-key'
          ? 'BEX could not securely save that key. Check the key and protected system storage, then try again.'
          : 'BEX could not update scripture setup. Try again.' };
      }
    });
  }

  if (api) {
    const dataHandlers = {
      'scripture:get-catalog': (options) => api.getCatalog(options),
      'scripture:get-books': (options) => api.getBooks(options),
      'scripture:fetch-content': (options) => api.fetchContent(options),
      'scripture:search-words': (options) => api.searchWords(options),
      'scripture:cancel-request': (requestId) => ({ cancelled: api.cancelRequest(requestId) }),
      'scripture:get-usage': () => api.getUsage(),
    };

    for (const [channel, handler] of Object.entries(dataHandlers)) {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, async (event, ...args) => {
        try {
          const frame = event?.senderFrame;
          if (!frame || new URL(frame.url).origin !== trustedOrigin
            || frame !== event.sender?.mainFrame) {
            return { ok: false, error: 'BEX blocked scripture request from an untrusted page.' };
          }
          const result = await handler(...args);
          return { ok: true, result };
        } catch (err) {
          return { ok: false, error: err.message || 'Scripture operation failed.' };
        }
      });
    }
  }
}

module.exports = { registerScriptureHandlers };
