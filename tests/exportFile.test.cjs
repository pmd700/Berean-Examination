'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EXPORT_FILE_CHANNEL, registerExportFileHandlers } = require('../desktop/export-file-ipc.cjs');

test('exporting to the same Markdown path replaces every old byte with the new note', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'bex-note-export-test-'));
  const filePath = path.join(folder, 'note.md');
  let handler;
  registerExportFileHandlers({
    appUrl: 'http://127.0.0.1:5199',
    ipcMain: { removeHandler() {}, handle(channel, callback) { assert.equal(channel, EXPORT_FILE_CHANNEL); handler = callback; } },
    showSaveDialog: async () => ({ canceled: false, filePath }),
  });
  const event = { senderFrame: { url: 'http://127.0.0.1:5199/LibraryHome' } };
  try {
    const first = '# Note\n\nOld body to be replaced.\n'.repeat(10);
    const revised = '# Note\n\nUpdated body with new evidence.\n';
    assert.equal((await handler(event, { fileName: 'note.md', bytes: Buffer.from(first) })).status, 'saved');
    assert.equal(await fs.readFile(filePath, 'utf8'), first);
    assert.equal((await handler(event, { fileName: 'note.md', bytes: Buffer.from(revised) })).status, 'saved');
    assert.equal(await fs.readFile(filePath, 'utf8'), revised);
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});
