'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const EXPORT_FILE_CHANNEL = 'export:save-file';

function registerExportFileHandlers({ appUrl, ipcMain, showSaveDialog, writeFile = fs.writeFile }) {
  const trustedOrigin = new URL(appUrl).origin;
  const selections = new Map();
  const trusted = event => {
    const senderUrl = event?.senderFrame?.url || event?.sender?.getURL?.();
    if (new URL(senderUrl).origin !== trustedOrigin) throw new Error('Untrusted export request.');
    if (event.sender?.mainFrame && event.senderFrame !== event.sender.mainFrame) throw new Error('Untrusted export frame.');
  };
  const choose = (event, fileName) => {
    const extension = path.extname(fileName).slice(1);
    return showSaveDialog(event, { title: 'Save export', defaultPath: path.basename(fileName), ...(extension ? { filters: [{ name: extension === 'pdf' ? 'PDF document' : 'Markdown document', extensions: [extension] }] } : {}) });
  };
  ipcMain.removeHandler('export:choose-file');
  ipcMain.handle('export:choose-file', async (event, { fileName } = {}) => {
    try {
      trusted(event);
      if (typeof fileName !== 'string' || !fileName) throw new Error('Invalid export filename.');
      const result = await choose(event, fileName);
      if (result.canceled || !result.filePath) return { status: 'canceled' };
      const selectionId = randomUUID();
      for (const [id, selection] of selections) if (selection.expires < Date.now()) selections.delete(id);
      selections.set(selectionId, { filePath: result.filePath, sender: event.sender, expires: Date.now() + 30 * 60 * 1000 });
      return { status: 'ready', selectionId };
    } catch (error) { return { status: 'failed', error: error.message }; }
  });
  ipcMain.removeHandler('export:cancel-selection');
  ipcMain.handle('export:cancel-selection', (event, { selectionId } = {}) => {
    trusted(event);
    if (selections.get(selectionId)?.sender === event.sender) selections.delete(selectionId);
  });
  ipcMain.removeHandler(EXPORT_FILE_CHANNEL);
  ipcMain.handle(EXPORT_FILE_CHANNEL, async (event, payload) => {
    try {
      trusted(event);
      if (!payload || typeof payload.fileName !== 'string' || !(payload.bytes instanceof Uint8Array)) {
        throw new Error('Invalid export file.');
      }
      const fileName = path.basename(payload.fileName);
      let result;
      if (payload.selectionId) {
        const selection = selections.get(payload.selectionId);
        if (!selection || selection.sender !== event.sender || selection.expires < Date.now()) throw new Error('Choose an export location again.');
        selections.delete(payload.selectionId);
        result = { filePath: selection.filePath, canceled: false };
      } else result = await choose(event, fileName);
      if (result.canceled || !result.filePath) return { status: 'canceled' };
      await writeFile(result.filePath, payload.bytes);
      return { status: 'saved', fileName: path.basename(result.filePath) };
    } catch (error) {
      return { status: 'failed', error: error?.message || 'Could not save the export.' };
    }
  });
}
module.exports = { EXPORT_FILE_CHANNEL, registerExportFileHandlers };
