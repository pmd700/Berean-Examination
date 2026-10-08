'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const EXPORT_FILE_CHANNEL = 'export:save-file';

function registerExportFileHandlers({ appUrl, ipcMain, showSaveDialog, writeFile = fs.writeFile }) {
  const trustedOrigin = new URL(appUrl).origin;
  ipcMain.removeHandler(EXPORT_FILE_CHANNEL);
  ipcMain.handle(EXPORT_FILE_CHANNEL, async (event, payload) => {
    try {
      const senderUrl = event?.senderFrame?.url || event?.sender?.getURL?.();
      if (new URL(senderUrl).origin !== trustedOrigin) throw new Error('Untrusted export request.');
      if (!payload || typeof payload.fileName !== 'string' || !(payload.bytes instanceof Uint8Array)) {
        throw new Error('Invalid export file.');
      }
      const fileName = path.basename(payload.fileName);
      const result = await showSaveDialog(event, { title: 'Save export', defaultPath: fileName });
      if (result.canceled || !result.filePath) return { status: 'canceled' };
      await writeFile(result.filePath, payload.bytes);
      return { status: 'saved', fileName: path.basename(result.filePath) };
    } catch (error) {
      return { status: 'failed', error: error?.message || 'Could not save the export.' };
    }
  });
}
module.exports = { EXPORT_FILE_CHANNEL, registerExportFileHandlers };
