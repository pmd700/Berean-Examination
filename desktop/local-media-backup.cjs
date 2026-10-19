'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { MEDIA_CATEGORIES, parseMediaUrl, requireMediaCategory, requireMediaFolder } = require('./local-media.cjs');
const { FILE_PATTERN } = require('./local-attachments.cjs');
const MANIFEST_NAME = '.bex-media-manifest.json';
const MEDIA_RESTORE_JOURNAL = '.bex-media-restore-state.json';
const MEDIA_RESTORE_STAGING = '.bex-media-restore-staging';
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;

function invalid() { const error = new Error('The encrypted media snapshot could not be read safely.'); error.code = 'BEX_BACKUP_MEDIA_INVALID'; return error; }

function isImage(name) { try { parseMediaUrl(`bex-media://library/${name}`); return true; } catch { return false; } }

function safeRelativePath(value) {
  if (typeof value !== 'string' || value.includes('\\')) throw invalid();
  const parts = value.split('/');
  if (parts.length === 1 && isImage(parts[0])) return parts[0];
  if (parts.length === 2 && MEDIA_CATEGORIES.includes(parts[0])
    && ((parts[0] === 'Images' && isImage(parts[1])) || FILE_PATTERN.test(parts[1]))) return path.join(...parts);
  throw invalid();
}

function fsyncFolder(folder) {
  const fd = fs.openSync(folder, 'r');
  try { fs.fsyncSync(fd); } catch (error) { if (process.platform !== 'win32') throw error; } finally { fs.closeSync(fd); }
}

function fileDigest(target) {
  const before = fs.lstatSync(target);
  if (!before.isFile() || before.isSymbolicLink()) throw invalid();
  const fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    const initial = fs.fstatSync(fd);
    if (!initial.isFile() || initial.dev !== before.dev || initial.ino !== before.ino) throw invalid();
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    for (;;) {
      const length = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!length) break;
      bytes += length; hash.update(buffer.subarray(0, length));
    }
    const final = fs.fstatSync(fd);
    if (initial.size !== final.size || initial.mtimeMs !== final.mtimeMs || bytes !== initial.size) throw invalid();
    return { bytes, sha256: hash.digest('hex') };
  } finally { buffer.fill(0); fs.closeSync(fd); }
}

function durableCopy(source, destination) {
  const sourceStats = fs.lstatSync(source);
  if (!sourceStats.isFile() || sourceStats.isSymbolicLink()) throw invalid();
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE);
  if (process.platform !== 'win32') fs.chmodSync(destination, 0o600);
  const fd = fs.openSync(destination, 'r+');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function writePrivateJson(target, value) {
  const temporary = `${target}.tmp`;
  if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, target); fsyncFolder(path.dirname(target));
}

function readPrivateJson(target) {
  const stats = fs.lstatSync(target);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_MANIFEST_BYTES) throw invalid();
  try { return JSON.parse(fs.readFileSync(target, 'utf8')); } catch { throw invalid(); }
}

function listEncryptedMedia(root, relative = '') {
  const stats = fs.lstatSync(root);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw invalid();
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    if (entry.isSymbolicLink()) throw invalid();
    if (!relative && entry.name === MANIFEST_NAME && entry.isFile()) continue;
    const target = path.join(root, entry.name);
    const nextRelative = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      if (relative || !MEDIA_CATEGORIES.includes(entry.name)) throw invalid();
      files.push(...listEncryptedMedia(target, nextRelative));
    } else if (entry.isFile()) {
      if (!(isImage(entry.name) && (!relative || relative === 'Images')) && !(relative && FILE_PATTERN.test(entry.name))) throw invalid();
      files.push(nextRelative);
    } else throw invalid();
  }
  return files;
}

function copyEncryptedMediaSnapshot({ libraryPath, destination }) {
  const source = requireMediaFolder(libraryPath);
  const files = listEncryptedMedia(source);
  fs.mkdirSync(destination, { mode: 0o700 });
  try {
    const manifestFiles = [];
    for (const relative of files) {
      const target = path.join(destination, relative);
      const folder = path.dirname(target);
      if (folder !== destination && !fs.existsSync(folder)) fs.mkdirSync(folder, { mode: 0o700 });
      durableCopy(path.join(source, relative), target);
      manifestFiles.push({ path: relative.split(path.sep).join('/'), ...fileDigest(target) });
    }
    writePrivateJson(path.join(destination, MANIFEST_NAME), { version: 1, files: manifestFiles });
    return { fileCount: files.length };
  } catch (error) { fs.rmSync(destination, { force: true, recursive: true }); throw error; }
}

function validateEncryptedMediaSnapshot(backupPath) {
  const snapshotPath = `${backupPath}.media`;
  if (!fs.existsSync(snapshotPath)) return { snapshotPath: null, files: [] };
  const files = listEncryptedMedia(snapshotPath);
  let manifest;
  try { manifest = readPrivateJson(path.join(snapshotPath, MANIFEST_NAME)); } catch { throw invalid(); }
  if (manifest?.version !== 1 || !Array.isArray(manifest.files) || manifest.files.length !== files.length) throw invalid();
  const expected = new Map();
  for (const entry of manifest.files) {
    const relative = safeRelativePath(entry?.path);
    if (expected.has(relative) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !/^[0-9a-f]{64}$/.test(entry.sha256)) throw invalid();
    expected.set(relative, entry);
  }
  for (const relative of files) {
    const entry = expected.get(relative);
    if (!entry) throw invalid();
    const actual = fileDigest(path.join(snapshotPath, relative));
    if (actual.bytes !== entry.bytes || actual.sha256 !== entry.sha256) throw invalid();
  }
  return { snapshotPath, files, expected };
}

function restorePaths(libraryPath) {
  const databaseFolder = path.join(path.resolve(libraryPath), 'Database');
  const stats = fs.lstatSync(databaseFolder);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw invalid();
  return { databaseFolder, staging: path.join(databaseFolder, MEDIA_RESTORE_STAGING), journal: path.join(databaseFolder, MEDIA_RESTORE_JOURNAL) };
}

function mediaDestination(libraryPath, relative) {
  const mediaFolder = requireMediaFolder(libraryPath);
  const safePath = safeRelativePath(relative.split(path.sep).join('/'));
  const folderName = path.dirname(safePath);
  const folder = folderName === '.' ? requireMediaCategory(libraryPath, 'Images') : requireMediaCategory(libraryPath, folderName);
  return path.join(folder, path.basename(safePath));
}

function transactionFromJournal(libraryPath, paths, state) {
  if (state?.version !== 1 || !Array.isArray(state.entries) || !Number.isSafeInteger(state.fileCount) || state.fileCount < state.entries.length) throw invalid();
  const seen = new Set();
  for (const entry of state.entries) {
    safeRelativePath(entry?.relative);
    if (typeof entry.hadOriginal !== 'boolean' || seen.has(entry.relative)) throw invalid();
    seen.add(entry.relative);
  }
  if (!fs.lstatSync(paths.staging).isDirectory() || fs.lstatSync(paths.staging).isSymbolicLink()) throw invalid();
  let finished = false;
  const cleanup = () => {
    fs.rmSync(paths.journal, { force: true }); fsyncFolder(paths.databaseFolder); finished = true;
    fs.rmSync(paths.staging, { recursive: true, force: true }); fsyncFolder(paths.databaseFolder);
  };
  return {
    fileCount: state.fileCount,
    commit() { if (!finished) cleanup(); },
    rollback() {
      if (finished) return;
      state.rollbackRequested = true; writePrivateJson(paths.journal, state);
      for (let index = state.entries.length - 1; index >= 0; index -= 1) {
        const entry = state.entries[index];
        const target = mediaDestination(libraryPath, entry.relative);
        const previous = path.join(paths.staging, `old-${index}`);
        const staged = path.join(paths.staging, `new-${index}`);
        if (fs.existsSync(previous)) {
          const stats = fs.lstatSync(previous); if (!stats.isFile() || stats.isSymbolicLink()) throw invalid();
          fs.rmSync(target, { force: true }); fs.renameSync(previous, target); fsyncFolder(path.dirname(target));
        } else if (!entry.hadOriginal && !fs.existsSync(staged)) {
          fs.rmSync(target, { force: true }); fsyncFolder(path.dirname(target));
        }
      }
      cleanup();
    },
  };
}

function recoverInterruptedMediaRestore(libraryPath) {
  const paths = restorePaths(libraryPath);
  if (!fs.existsSync(paths.journal)) {
    if (fs.existsSync(paths.staging)) {
      const stats = fs.lstatSync(paths.staging); if (!stats.isDirectory() || stats.isSymbolicLink()) throw invalid();
      fs.rmSync(paths.staging, { recursive: true, force: true });
    }
    return { recovered: false };
  }
  const transaction = transactionFromJournal(libraryPath, paths, readPrivateJson(paths.journal));
  const pendingDatabase = fs.existsSync(path.join(paths.databaseFolder, '.bex-restore-state.json'))
    || fs.existsSync(path.join(paths.databaseFolder, '.berean.restore-previous.db'));
  const state = readPrivateJson(paths.journal);
  const shouldRollback = pendingDatabase || state.rollbackRequested === true;
  if (shouldRollback) transaction.rollback(); else transaction.commit();
  return { recovered: true, rolledBack: shouldRollback };
}

function restoreEncryptedMediaSnapshot({ backupPath, libraryPath, deferCommit = false }) {
  const { snapshotPath, files, expected } = validateEncryptedMediaSnapshot(backupPath);
  if (!snapshotPath) return { fileCount: 0, commit() {}, rollback() {} };
  const paths = restorePaths(libraryPath);
  if (fs.existsSync(paths.journal) || fs.existsSync(paths.staging)) throw invalid();
  fs.mkdirSync(paths.staging, { mode: 0o700 });
  const entries = [];
  let transaction;
  try {
    for (const relative of files) {
      const destination = mediaDestination(libraryPath, relative);
      const hadOriginal = fs.existsSync(destination);
      const desired = expected.get(relative);
      if (hadOriginal) {
        const actual = fileDigest(destination);
        if (actual.bytes === desired.bytes && actual.sha256 === desired.sha256) continue;
      }
      const staged = path.join(paths.staging, `new-${entries.length}`);
      durableCopy(path.join(snapshotPath, relative), staged);
      const copied = fileDigest(staged);
      if (copied.bytes !== desired.bytes || copied.sha256 !== desired.sha256) throw invalid();
      entries.push({ relative: relative.split(path.sep).join('/'), hadOriginal });
    }
    fsyncFolder(paths.staging);
    const state = { version: 1, fileCount: files.length, entries };
    writePrivateJson(paths.journal, state);
    transaction = transactionFromJournal(libraryPath, paths, state);
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const destination = mediaDestination(libraryPath, entry.relative);
      if (entry.hadOriginal) {
        fs.renameSync(destination, path.join(paths.staging, `old-${index}`));
        fsyncFolder(paths.staging);
      }
      fs.renameSync(path.join(paths.staging, `new-${index}`), destination);
      fsyncFolder(paths.staging); fsyncFolder(path.dirname(destination));
    }
    if (!deferCommit) transaction.commit();
    return transaction;
  } catch (error) {
    if (transaction) transaction.rollback();
    else fs.rmSync(paths.staging, { force: true, recursive: true });
    throw error;
  }
}

module.exports = { MANIFEST_NAME, copyEncryptedMediaSnapshot, fileDigest, listEncryptedMedia, recoverInterruptedMediaRestore, restoreEncryptedMediaSnapshot, validateEncryptedMediaSnapshot };
