'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { validateEncryptedMediaSnapshot } = require('./local-media-backup.cjs');
const {
  BACKUP_FILE_SUFFIX,
  readDatabaseSummary,
  resolveBackupFolder,
} = require('./local-backup.cjs');

const RESTORE_JOURNAL_FILE = '.bex-restore-state.json';
const RESTORE_JOURNAL_TEMP_FILE = '.bex-restore-state.tmp';
const RESTORE_STAGING_FILE = '.berean.restore-staging.db';
const RESTORE_PREVIOUS_FILE = '.berean.restore-previous.db';
const REQUIRED_BACKUP_TABLES = Object.freeze([
  'app_metadata',
  'privacy_vault',
  'private_records',
  'schema_migrations',
]);

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function safeUnlink(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function fsyncDirectory(folderPath) {
  let descriptor;
  try {
    descriptor = fs.openSync(folderPath, 'r');
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (process.platform !== 'win32') throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function writeJournal(databaseFolder, state) {
  const journalPath = path.join(databaseFolder, RESTORE_JOURNAL_FILE);
  const temporaryPath = path.join(databaseFolder, RESTORE_JOURNAL_TEMP_FILE);
  safeUnlink(temporaryPath);
  const descriptor = fs.openSync(temporaryPath, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(state)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporaryPath, journalPath);
  fsyncDirectory(databaseFolder);
}

function copyFileDurably(sourcePath, destinationPath) {
  fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
  const descriptor = fs.openSync(destinationPath, 'r+');
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  if (process.platform !== 'win32') fs.chmodSync(destinationPath, 0o600);
  fsyncDirectory(path.dirname(destinationPath));
}

function restorePaths(databasePath) {
  const databaseFolder = path.dirname(path.resolve(databasePath));
  return {
    databaseFolder,
    journalPath: path.join(databaseFolder, RESTORE_JOURNAL_FILE),
    journalTempPath: path.join(databaseFolder, RESTORE_JOURNAL_TEMP_FILE),
    livePath: path.resolve(databasePath),
    liveShmPath: `${path.resolve(databasePath)}-shm`,
    liveWalPath: `${path.resolve(databasePath)}-wal`,
    previousPath: path.join(databaseFolder, RESTORE_PREVIOUS_FILE),
    previousShmPath: path.join(databaseFolder, `${RESTORE_PREVIOUS_FILE}-shm`),
    previousWalPath: path.join(databaseFolder, `${RESTORE_PREVIOUS_FILE}-wal`),
    stagingPath: path.join(databaseFolder, RESTORE_STAGING_FILE),
  };
}

function assertBackupPath(libraryPath, backupPath) {
  if (typeof backupPath !== 'string' || !backupPath.trim()) {
    throw codedError('BEX_RESTORE_BACKUP_INVALID', 'Choose a BEX backup file to restore.');
  }
  const backupFolder = resolveBackupFolder(libraryPath);
  const resolvedPath = path.resolve(backupPath);
  let stats;
  let realPath;
  try {
    stats = fs.lstatSync(resolvedPath);
    realPath = fs.realpathSync(resolvedPath);
  } catch {
    throw codedError('BEX_RESTORE_BACKUP_INVALID', 'That backup file is unavailable.');
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw codedError('BEX_RESTORE_BACKUP_INVALID', 'That backup is not a normal file.');
  }
  if (path.dirname(realPath) !== backupFolder || !realPath.endsWith(BACKUP_FILE_SUFFIX)) {
    throw codedError(
      'BEX_RESTORE_BACKUP_INVALID',
      'Restore accepts only BEX backups stored directly in this library Backups folder.',
    );
  }
  return { path: realPath, stats };
}

function inspectLocalRestoreBackup({ backupPath, libraryPath, maxSchemaVersion } = {}) {
  const validated = assertBackupPath(libraryPath, backupPath);
  const mediaSnapshot = validateEncryptedMediaSnapshot(validated.path);
  let database;
  let summary;
  try {
    database = new DatabaseSync(validated.path, { readOnly: true });
    summary = readDatabaseSummary(database);
  } catch (error) {
    if (error?.code === 'BEX_BACKUP_DATABASE_INVALID') throw error;
    throw codedError('BEX_RESTORE_BACKUP_INVALID', 'BEX could not read that backup safely.');
  } finally {
    if (database) database.close();
  }

  if (!Number.isSafeInteger(summary.schemaVersion) || summary.schemaVersion < 1) {
    throw codedError('BEX_RESTORE_BACKUP_INVALID', 'That file is not a complete BEX backup.');
  }
  if (summary.schemaVersion > maxSchemaVersion) {
    throw codedError(
      'BEX_RESTORE_BACKUP_NEWER',
      'This backup was created by a newer BEX version. Update BEX before restoring it.',
    );
  }
  for (const tableName of REQUIRED_BACKUP_TABLES) {
    if (summary.tableCounts[tableName] === undefined) {
      throw codedError('BEX_RESTORE_BACKUP_INVALID', 'That file is missing required BEX data.');
    }
  }

  return {
    bytes: validated.stats.size,
    fileName: path.basename(validated.path),
    modifiedAt: validated.stats.mtime.toISOString(),
    path: validated.path,
    mediaFileCount: mediaSnapshot.files.length,
    ...summary,
  };
}

function assertRestoredSummary(backupSummary, restoredSummary) {
  if (restoredSummary.schemaVersion < backupSummary.schemaVersion) {
    throw codedError('BEX_RESTORE_VERIFICATION_FAILED', 'The restored database version is incomplete.');
  }
  for (const [tableName, expectedCount] of Object.entries(backupSummary.tableCounts)) {
    if (tableName === 'schema_migrations') continue;
    if (restoredSummary.tableCounts[tableName] !== expectedCount) {
      throw codedError(
        'BEX_RESTORE_VERIFICATION_FAILED',
        'The restored database did not contain the expected records.',
      );
    }
  }
}

function recoverInterruptedRestore(databasePath) {
  const paths = restorePaths(databasePath);
  const hasJournal = fs.existsSync(paths.journalPath);
  const hasPrevious = fs.existsSync(paths.previousPath);

  if (!hasJournal && !hasPrevious) {
    safeUnlink(paths.stagingPath);
    safeUnlink(paths.journalTempPath);
    return { recovered: false };
  }

  if (hasPrevious) {
    safeUnlink(paths.liveWalPath);
    safeUnlink(paths.liveShmPath);
    safeUnlink(paths.livePath);
    fs.renameSync(paths.previousPath, paths.livePath);
    if (fs.existsSync(paths.previousWalPath)) fs.renameSync(paths.previousWalPath, paths.liveWalPath);
    if (fs.existsSync(paths.previousShmPath)) fs.renameSync(paths.previousShmPath, paths.liveShmPath);
  } else if (!fs.existsSync(paths.livePath)) {
    throw codedError(
      'BEX_RESTORE_RECOVERY_FAILED',
      'BEX found an interrupted restore but could not find the original database.',
    );
  }

  safeUnlink(paths.stagingPath);
  safeUnlink(paths.journalPath);
  safeUnlink(paths.journalTempPath);
  fsyncDirectory(paths.databaseFolder);
  return { recovered: hasPrevious };
}

function installLocalRestore({ backupPath, databasePath } = {}) {
  const paths = restorePaths(databasePath);
  recoverInterruptedRestore(databasePath);
  if (!fs.existsSync(paths.livePath)) {
    throw codedError('BEX_RESTORE_FAILED', 'The current Berean Library database is missing.');
  }

  writeJournal(paths.databaseFolder, { phase: 'copying', version: 1 });
  copyFileDurably(backupPath, paths.stagingPath);
  writeJournal(paths.databaseFolder, { phase: 'prepared', version: 1 });

  fs.renameSync(paths.livePath, paths.previousPath);
  if (fs.existsSync(paths.liveWalPath)) fs.renameSync(paths.liveWalPath, paths.previousWalPath);
  if (fs.existsSync(paths.liveShmPath)) fs.renameSync(paths.liveShmPath, paths.previousShmPath);
  fsyncDirectory(paths.databaseFolder);
  writeJournal(paths.databaseFolder, { phase: 'original-moved', version: 1 });

  fs.renameSync(paths.stagingPath, paths.livePath);
  fsyncDirectory(paths.databaseFolder);
  writeJournal(paths.databaseFolder, { phase: 'replacement-installed', version: 1 });
  return paths;
}

function completeLocalRestore(databasePath) {
  const paths = restorePaths(databasePath);
  safeUnlink(paths.previousWalPath);
  safeUnlink(paths.previousShmPath);
  safeUnlink(paths.previousPath);
  safeUnlink(paths.stagingPath);
  safeUnlink(paths.journalPath);
  safeUnlink(paths.journalTempPath);
  fsyncDirectory(paths.databaseFolder);
}

function rollbackLocalRestore(databasePath) {
  return recoverInterruptedRestore(databasePath);
}

module.exports = {
  assertRestoredSummary,
  completeLocalRestore,
  inspectLocalRestoreBackup,
  installLocalRestore,
  recoverInterruptedRestore,
  rollbackLocalRestore,
};
