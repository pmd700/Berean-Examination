'use strict';
const { randomUUID } = require('node:crypto');

function registerScriptureHandlers({ appUrl, ipcMain, settings, api }) {
  const trustedOrigin = new URL(appUrl).origin;
  const watchedSenders = new WeakSet();
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
        const status = await handler(...args);
        if (channel === 'scripture:save-key' || channel === 'scripture:clear-key') api?.reset();
        return { ok: true, status };
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
          const prefix = `${event.sender.id}:`;
          if (!watchedSenders.has(event.sender)) {
            watchedSenders.add(event.sender);
            event.sender.once?.('destroyed', () => api.cancelOwner(prefix));
            event.sender.on?.('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
              if (mainFrame && !inPlace) api.cancelOwner(prefix);
            });
          }
          // A reader may cancel its own subscriber, never a different window's.
          if (channel === 'scripture:cancel-request') args[0] = `${prefix}${args[0]}`;
          else if (channel !== 'scripture:get-usage') {
            args[0] = { ...args[0], requestId: `${prefix}${args[0]?.requestId || randomUUID()}` };
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
