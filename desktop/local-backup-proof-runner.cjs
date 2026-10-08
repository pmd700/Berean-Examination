'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { app, safeStorage } = require('electron');
const {
  closeDatabase,
  createLocalBackup,
  createLocalEntity,
  getLocalDatabaseSummary,
  getLocalEntity,
  initializeDatabase,
  readPrivateRecord,
  restoreLocalBackup,
  savePrivateRecord,
  updateLocalEntity,
} = require('./database.cjs');
const {
  CREATE_LOCAL_BACKUP_CHANNEL,
  RESTORE_LOCAL_BACKUP_CHANNEL,
  registerLocalBackupHandlers,
} = require('./local-backup-ipc.cjs');
const { createSafeStorageProtector } = require('./privacy-vault.cjs');
const { installLocalRestore } = require('./local-restore.cjs');

const APP_NAME = 'BEX Launcher Official';
const APP_URL = 'http://127.0.0.1:4173';
const LIBRARY_FOLDERS = ['Database', 'Courses', 'Media', 'Imports', 'Exports', 'Backups'];
const PRIVATE_MARKER = 'BEX-DISPOSABLE-BACKUP-PRIVATE-MARKER';

function createLibrary(libraryPath) {
  for (const folderName of LIBRARY_FOLDERS) {
    fs.mkdirSync(path.join(libraryPath, folderName), { recursive: true });
  }
}

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      handlers.delete(channel);
    },
  };
}

async function runProof(proofRoot) {
  const sourceLibrary = path.join(proofRoot, 'Source Berean Library');
  const restoredLibrary = path.join(proofRoot, 'Restored Berean Library');
  createLibrary(sourceLibrary);
  createLibrary(restoredLibrary);
  assert.equal(safeStorage.isEncryptionAvailable(), true, 'macOS protected storage is unavailable.');
  const protector = createSafeStorageProtector(safeStorage);

  initializeDatabase(sourceLibrary, { privacyProtector: protector });
  savePrivateRecord('backup-proof-private', 'test-only', { secret: PRIVATE_MARKER });
  const web = createLocalEntity('KnowledgeWeb', {
    title: 'Disposable backup web',
    graph_data: JSON.stringify({ proof: PRIVATE_MARKER }),
  });
  const source = createLocalEntity('BrainSource', {
    raw_text: 'Disposable private source text',
    source_type: 'note',
    title: 'Disposable source',
    web_id: web.id,
  });
  const chapter = createLocalEntity('StudyChapter', {
    book: 'John',
    chapter_number: 1,
    content: 'Disposable private study notes',
    version: 'BSB',
  });
  const sourceSummary = getLocalDatabaseSummary();

  const ipcMain = fakeIpcMain();
  registerLocalBackupHandlers({
    appUrl: APP_URL,
    chooseAndRestoreLocalBackup: async () => ({ canceled: true }),
    createLocalBackup,
    ipcMain,
  });
  const handler = ipcMain.handlers.get(CREATE_LOCAL_BACKUP_CHANNEL);
  const blocked = await handler({ senderFrame: { url: 'https://untrusted.example' } });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'BEX_UNTRUSTED_SENDER');
  const blockedRestore = await ipcMain.handlers.get(RESTORE_LOCAL_BACKUP_CHANNEL)(
    { senderFrame: { url: 'https://untrusted.example' } },
  );
  assert.equal(blockedRestore.ok, false);
  assert.equal(blockedRestore.code, 'BEX_UNTRUSTED_SENDER');
  const canceledRestore = await ipcMain.handlers.get(RESTORE_LOCAL_BACKUP_CHANNEL)(
    { senderFrame: { url: `${APP_URL}/Study` } },
  );
  assert.deepEqual(canceledRestore, { ok: true, canceled: true });

  const response = await handler({ senderFrame: { url: `${APP_URL}/KnowledgeWeb` } });
  assert.equal(response.ok, true, response.error);
  assert.deepEqual(response.backup.tableCounts, sourceSummary.tableCounts);
  assert.equal('path' in response.backup, false);
  const backupPath = path.join(sourceLibrary, 'Backups', response.backup.fileName);
  assert.equal(fs.existsSync(backupPath), true);
  assert.equal(
    fs.readFileSync(backupPath).includes(Buffer.from(PRIVATE_MARKER, 'utf8')),
    false,
  );
  closeDatabase();

  fs.copyFileSync(backupPath, path.join(restoredLibrary, 'Database', 'berean.db'));
  initializeDatabase(restoredLibrary, { privacyProtector: protector });
  const restoredSummary = getLocalDatabaseSummary();
  assert.deepEqual(restoredSummary, sourceSummary);
  assert.deepEqual(readPrivateRecord('backup-proof-private'), { secret: PRIVATE_MARKER });
  assert.equal(getLocalEntity('KnowledgeWeb', web.id).title, web.title);
  assert.equal(getLocalEntity('BrainSource', source.id).raw_text, source.raw_text);
  assert.equal(getLocalEntity('StudyChapter', chapter.id).content, chapter.content);
  closeDatabase();

  initializeDatabase(sourceLibrary, { privacyProtector: protector });
  updateLocalEntity('KnowledgeWeb', web.id, { title: 'Changed after the backup' });
  const laterWeb = createLocalEntity('KnowledgeWeb', { title: 'Created after the backup' });
  const productionRestore = await restoreLocalBackup(backupPath, { privacyProtector: protector });
  assert.equal(productionRestore.fileName, response.backup.fileName);
  assert.equal(getLocalEntity('KnowledgeWeb', web.id).title, web.title);
  assert.throws(
    () => getLocalEntity('KnowledgeWeb', laterWeb.id),
    (error) => error?.code === 'BEX_ENTITY_NOT_FOUND',
  );
  assert.equal(
    fs.readdirSync(path.join(sourceLibrary, 'Backups'))
      .filter((fileName) => fileName.endsWith('.bex-backup.db')).length,
    2,
  );

  const outsideBackupPath = path.join(proofRoot, 'outside.bex-backup.db');
  fs.copyFileSync(backupPath, outsideBackupPath);
  await assert.rejects(
    () => restoreLocalBackup(outsideBackupPath, { privacyProtector: protector }),
    (error) => error?.code === 'BEX_RESTORE_BACKUP_INVALID',
  );

  const corruptBackupPath = path.join(sourceLibrary, 'Backups', 'corrupt.bex-backup.db');
  fs.writeFileSync(corruptBackupPath, 'not a SQLite database');
  await assert.rejects(
    () => restoreLocalBackup(corruptBackupPath, { privacyProtector: protector }),
    (error) => error?.code === 'BEX_RESTORE_BACKUP_INVALID',
  );

  const rollbackTitle = 'Current work survives failed restore';
  updateLocalEntity('KnowledgeWeb', web.id, { title: rollbackTitle });
  const unreadableBackupPath = path.join(
    sourceLibrary,
    'Backups',
    'unreadable-key.bex-backup.db',
  );
  fs.copyFileSync(backupPath, unreadableBackupPath);
  const unreadableDatabase = new DatabaseSync(unreadableBackupPath);
  unreadableDatabase.prepare(`
    UPDATE privacy_vault
    SET automatic_key_envelope = randomblob(16)
    WHERE singleton_id = 1
  `).run();
  unreadableDatabase.close();
  await assert.rejects(
    () => restoreLocalBackup(unreadableBackupPath, { privacyProtector: protector }),
    (error) => error?.code === 'BEX_RESTORE_FAILED' && error?.rolledBack === true,
  );
  assert.equal(getLocalEntity('KnowledgeWeb', web.id).title, rollbackTitle);

  closeDatabase();
  const sourceDatabasePath = path.join(sourceLibrary, 'Database', 'berean.db');
  installLocalRestore({ backupPath, databasePath: sourceDatabasePath });
  initializeDatabase(sourceLibrary, { privacyProtector: protector });
  assert.equal(getLocalEntity('KnowledgeWeb', web.id).title, rollbackTitle);
  closeDatabase();

  return [
    'untrusted pages cannot request backups',
    'untrusted pages cannot open Restore and canceling changes nothing',
    'backup is created only inside the Berean Library Backups folder',
    'visible app receives no unrestricted file path',
    'live database and backup have identical table counts',
    'backup file exposes no private test plaintext',
    'backup reopens as a separate disposable Berean Library',
    'restored private, Knowledge Web, Second Brain, and Study records match',
    'production restore creates an emergency backup before replacing current work',
    'production restore returns the library to the selected point in time',
    'outside and corrupt files are rejected before replacement',
    'a post-install decryption failure automatically restores the current database',
    'an interrupted replacement automatically restores the original database at launch',
  ];
}

async function main() {
  const proofRoot = path.resolve(process.argv[2] || '');
  assert.ok(proofRoot, 'The local backup proof folder is required.');
  try {
    const checks = await runProof(proofRoot);
    process.stdout.write(`BEX_BACKUP_PROOF ${JSON.stringify({ checks })}\n`);
  } finally {
    closeDatabase();
  }
}

app.setName(APP_NAME);
if (process.platform === 'darwin' && app.dock) app.dock.hide();
app.whenReady().then(async () => {
  try {
    await main();
    app.exit(0);
  } catch (error) {
    process.stderr.write(`${error?.stack || error}\n`);
    app.exit(1);
  }
});
