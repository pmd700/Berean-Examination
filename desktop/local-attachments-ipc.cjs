'use strict';

const ATTACHMENT_CHANNELS = Object.freeze({ import: 'local-attachments:import', open: 'local-attachments:open' });
const MESSAGES = Object.freeze({
  BEX_DATABASE_NOT_OPEN: 'Choose or reconnect the Berean Library before adding files.',
  BEX_PRIVACY_LOCKED: 'Unlock the Berean Library before opening or adding files.',
  BEX_PRIVACY_NOT_OPEN: 'The encrypted Berean Library vault is unavailable.',
  BEX_UNTRUSTED_SENDER: 'BEX blocked a file request from an untrusted page.',
  BEX_ATTACHMENT_INVALID: 'That file could not be read safely.',
  BEX_ATTACHMENT_NOT_FOUND: 'That file is no longer in the vault.',
  BEX_ATTACHMENT_TOO_LARGE: 'Files must be 2 GB or smaller.',
  BEX_ATTACHMENT_EXECUTABLE: 'BEX does not launch executable files or scripts.',
  BEX_ATTACHMENT_OPEN_FAILED: 'Your system could not open that file.',
  BEX_MEDIA_LIBRARY_UNAVAILABLE: 'The Berean Library Media folder is unavailable.',
});

function assertTrustedSender(event, trustedOrigin) {
  const value = event?.senderFrame?.url || event?.sender?.getURL?.();
  let trusted = false;
  try { trusted = new URL(value).origin === trustedOrigin && !event?.senderFrame?.parent; } catch { /* Malformed URLs are never trusted. */ }
  if (!trusted) { const error = new Error('Untrusted file request.'); error.code = 'BEX_UNTRUSTED_SENDER'; throw error; }
}

function failure(error) { return { ok: false, error: MESSAGES[error?.code] || 'BEX could not open or save that file.', code: error?.code || null }; }

function registerLocalAttachmentHandlers({ appUrl, ipcMain, assertUnlocked, chooseFiles, saveLocalFile, openLocalFile, rollbackLocalFile }) {
  if (typeof appUrl !== 'string' || !ipcMain || [assertUnlocked, chooseFiles, saveLocalFile, openLocalFile].some((value) => typeof value !== 'function')) throw new TypeError('The attachment bridge is incomplete.');
  const trustedOrigin = new URL(appUrl).origin;
  for (const channel of Object.values(ATTACHMENT_CHANNELS)) ipcMain.removeHandler(channel);
  ipcMain.handle(ATTACHMENT_CHANNELS.import, async (event) => {
    const attachments = [];
    try {
      assertTrustedSender(event, trustedOrigin); assertUnlocked();
      const selected = await chooseFiles(event);
      if (selected.canceled || !selected.filePaths?.length) return { ok: true, canceled: true, attachments: [] };
      assertUnlocked();
      for (const sourcePath of selected.filePaths) attachments.push(await saveLocalFile(sourcePath));
      return { ok: true, canceled: false, attachments };
    } catch (error) {
      for (const attachment of attachments) {
        try { await rollbackLocalFile?.(attachment.url); } catch { /* Only newly created, encrypted files may remain. */ }
      }
      return failure(error);
    }
  });
  ipcMain.handle(ATTACHMENT_CHANNELS.open, async (event, mediaUrl) => {
    try {
      assertTrustedSender(event, trustedOrigin); assertUnlocked();
      return { ok: true, result: await openLocalFile(mediaUrl) };
    } catch (error) { return failure(error); }
  });
}

module.exports = { ATTACHMENT_CHANNELS, registerLocalAttachmentHandlers };
