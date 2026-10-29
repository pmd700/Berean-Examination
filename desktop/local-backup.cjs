'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { copyEncryptedMediaSnapshot } = require('./local-media-backup.cjs');
const { deduplicateBackupMedia, removeEmptyVerificationSidecars, pruneBackupHistory } = require('./backup-storage.cjs');

const BACKUP_FOLDER_NAME = 'Backups';
const BACKUP_FILE_SUFFIX = '.bex-backup.db';
const SAFE_TABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireDatabase(database) {
  if (!database || typeof database.prepare !== 'function') {
    throw codedError('BEX_DATABASE_NOT_OPEN', 'The Berean Library database is not open.');
  }
  return database;
}

function readDatabaseSummary(database) {
  const openDatabase = requireDatabase(database);
  const integrityRows = openDatabase.prepare('PRAGMA quick_check').all();
  const integrityValues = integrityRows.flatMap((row) => Object.values(row));
  if (integrityValues.length !== 1 || integrityValues[0] !== 'ok') {
    throw codedError(
      'BEX_BACKUP_DATABASE_INVALID',
      'The local database did not pass its safety check.',
    );
  }

  const tableRows = openDatabase.prepare(`
    SELECT name
    FROM sqlite_schema
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all();
  const tableCounts = {};
  for (const row of tableRows) {
    const tableName = String(row.name);
    if (!SAFE_TABLE_NAME.test(tableName)) {
      throw codedError('BEX_BACKUP_DATABASE_INVALID', 'The local database has an invalid table name.');
    }
    const countRow = openDatabase.prepare(`SELECT COUNT(*) AS count FROM "${tableName}"`).get();
    tableCounts[tableName] = Number(countRow.count);
  }

  const schemaVersion = tableCounts.schema_migrations === undefined
    ? 0
    : Number(openDatabase.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get().version);
  const recordCount = Object.values(tableCounts).reduce((total, count) => total + count, 0);
  return { recordCount, schemaVersion, tableCounts };
}

function summariesMatch(source, backup) {
  return source.schemaVersion === backup.schemaVersion
    && source.recordCount === backup.recordCount
    && JSON.stringify(source.tableCounts) === JSON.stringify(backup.tableCounts);
}

function resolveBackupFolder(libraryPath) {
  if (typeof libraryPath !== 'string' || !libraryPath.trim()) {
    throw codedError('BEX_BACKUP_FOLDER_INVALID', 'The Berean Library location is unavailable.');
  }

  const resolvedLibrary = path.resolve(libraryPath);
  const backupFolder = path.join(resolvedLibrary, BACKUP_FOLDER_NAME);
  let libraryRealPath;
  let backupRealPath;
  try {
    libraryRealPath = fs.realpathSync(resolvedLibrary);
    const backupStats = fs.lstatSync(backupFolder);
    if (!backupStats.isDirectory() || backupStats.isSymbolicLink()) {
      throw new Error('The Backups location is not a normal folder.');
    }
    backupRealPath = fs.realpathSync(backupFolder);
  } catch {
    throw codedError(
      'BEX_BACKUP_FOLDER_INVALID',
      'The Berean Library Backups folder is unavailable.',
    );
  }

  const relativePath = path.relative(libraryRealPath, backupRealPath);
  if (!relativePath || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw codedError(
      'BEX_BACKUP_FOLDER_INVALID',
      'The backup location must stay inside the Berean Library.',
    );
  }
  return backupRealPath;
}

function backupFileName(now = new Date(), randomBytes = crypto.randomBytes) {
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const uniquePart = randomBytes(6).toString('hex');
  return `BEX-${timestamp}-${uniquePart}${BACKUP_FILE_SUFFIX}`;
}

async function createEncryptedLocalBackup({
  database,
  libraryPath,
  now = new Date(),
  privacyVault,
  protectedBackupPaths = [],
} = {}) {
  if (!privacyVault || typeof privacyVault.createEncryptedBackup !== 'function') {
    throw codedError('BEX_PRIVACY_NOT_OPEN', 'The encrypted Berean Library vault is unavailable.');
  }

  const sourceSummary = readDatabaseSummary(database);
  const backupFolder = resolveBackupFolder(libraryPath);
  const fileName = backupFileName(now);
  const finalPath = path.join(backupFolder, fileName);
  const partialPath = path.join(backupFolder, `.${fileName}.partial`);
  if (fs.existsSync(finalPath) || fs.existsSync(partialPath)) {
    throw codedError('BEX_BACKUP_EXISTS', 'A backup with this name already exists.');
  }

  let backupDatabase;
  let backupSummary;
  try {
    await privacyVault.createEncryptedBackup(partialPath);
    // The live database uses WAL; the immutable snapshot should not. Opening a
    // WAL-mode copy read-only created orphan .partial-shm/-wal files per close.
    backupDatabase = new DatabaseSync(partialPath);
    backupDatabase.exec('PRAGMA journal_mode = DELETE');
    backupSummary = readDatabaseSummary(backupDatabase);
  } catch (error) {
    if (backupDatabase) { backupDatabase.close(); backupDatabase = null; }
    for (const file of [partialPath, `${partialPath}-wal`, `${partialPath}-shm`]) fs.rmSync(file, { force: true });
    throw error;
  } finally {
    if (backupDatabase) backupDatabase.close();
  }

  if (!summariesMatch(sourceSummary, backupSummary)) {
    fs.rmSync(partialPath, { force: true });
    throw codedError(
      'BEX_BACKUP_VERIFICATION_FAILED',
      'The backup did not contain the same records as the live library.',
    );
  }

  const mediaPartialPath = `${partialPath}.media`;
  const mediaFinalPath = `${finalPath}.media`;
  let mediaSummary;
  try {
    mediaSummary = copyEncryptedMediaSnapshot({ libraryPath, destination: mediaPartialPath });
    fs.renameSync(mediaPartialPath, mediaFinalPath);
    fs.renameSync(partialPath, finalPath);
  } catch (error) {
    fs.rmSync(mediaPartialPath, { force: true, recursive: true });
    fs.rmSync(mediaFinalPath, { force: true, recursive: true });
    fs.rmSync(partialPath, { force: true });
    throw error;
  }
  if (process.platform !== 'win32') fs.chmodSync(finalPath, 0o600);
  const fileStats = fs.statSync(finalPath);
  let storageMaintenance;
  try {
    const deduplication = deduplicateBackupMedia(backupFolder);
    const retention = pruneBackupHistory({ backupFolder, verifiedBackupPath: finalPath, protectedBackupPaths, now: now.getTime() });
    storageMaintenance = { ...deduplication, ...retention, removedSidecars: removeEmptyVerificationSidecars(backupFolder) };
  } catch (error) {
    // A failed optimization must never invalidate a completed backup or stop
    // shutdown. Retry maintenance after the next verified backup instead.
    console.error('[backup] Storage maintenance deferred:', error.code || error.message);
  }
  return {
    bytes: fileStats.size,
    createdAt: now.toISOString(),
    fileName,
    path: finalPath,
    mediaFileCount: mediaSummary.fileCount,
    storageMaintenance,
    ...backupSummary,
  };
}

module.exports = {
  BACKUP_FILE_SUFFIX,
  BACKUP_FOLDER_NAME,
  backupFileName,
  createEncryptedLocalBackup,
  readDatabaseSummary,
  resolveBackupFolder,
};
