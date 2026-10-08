'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');

const CONFIG_VERSION = 1;
const MIN_ZIP_BYTES = 22;
// ZIP bytes cross both the context bridge and Electron IPC before reaching this
// process. Keep a firm per-archive ceiling so a malformed or unexpectedly large
// library cannot multiply into gigabytes of renderer/main-process allocations.
const MAX_ZIP_BYTES = 256 * 1024 * 1024;
const MANIFEST_FILE_NAME = '_bex-mass-backup.json';
const MANIFEST_SIGNATURE = 'bex-mass-backup';
const MANIFEST_VERSION = 1;

const HARD_LINK_COPY_FALLBACK_CODES = new Set([
  'EACCES',
  'EINVAL',
  'EMLINK',
  'ENOSYS',
  'ENOTSUP',
  'EOPNOTSUPP',
  'EPERM',
  'EXDEV',
  'UNKNOWN',
]);

const MASS_BACKUP_CATEGORIES = Object.freeze({
  knowledge: Object.freeze({ fileSegment: 'Knowledge-Webs', label: 'Knowledge Webs' }),
  notes: Object.freeze({ fileSegment: 'Notes', label: 'Notes' }),
  timelines: Object.freeze({ fileSegment: 'Timelines', label: 'Timelines' }),
});

const CATEGORY_BY_FILE_SEGMENT = Object.freeze(Object.fromEntries(
  Object.entries(MASS_BACKUP_CATEGORIES).map(([category, value]) => [value.fileSegment, category]),
));

const MASS_BACKUP_FILE_PATTERN = /^BEX-Mass-Backup-(Knowledge-Webs|Notes|Timelines)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-([a-f0-9]{32})\.zip$/;

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function defaultConfig() {
  return {
    destinationPath: null,
    replacePrevious: false,
    version: CONFIG_VERSION,
  };
}

function parseConfig(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw codedError('BEX_MASS_BACKUP_CONFIG_INVALID', 'The saved Mass Backup setting is invalid.');
  }
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || value.version !== CONFIG_VERSION
    || (value.destinationPath !== null && typeof value.destinationPath !== 'string')
    || typeof value.replacePrevious !== 'boolean'
  ) {
    throw codedError('BEX_MASS_BACKUP_CONFIG_INVALID', 'The saved Mass Backup setting is invalid.');
  }
  return {
    destinationPath: value.destinationPath && value.destinationPath.trim()
      ? path.resolve(value.destinationPath)
      : null,
    replacePrevious: value.replacePrevious,
    version: CONFIG_VERSION,
  };
}

function timestampForFile(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('Mass Backup requires a valid clock value.');
  }
  return date.toISOString().replace(/[:.]/g, '-');
}

function runToken(randomUUID = crypto.randomUUID) {
  const token = String(randomUUID()).replaceAll('-', '').toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(token)) {
    throw new TypeError('Mass Backup requires a UUID-compatible random source.');
  }
  return token;
}

function massBackupFileName(category, date = new Date(), token = runToken()) {
  const definition = MASS_BACKUP_CATEGORIES[category];
  if (!definition) {
    throw codedError('BEX_MASS_BACKUP_ARCHIVE_INVALID', 'That Mass Backup category is not supported.');
  }
  if (!/^[a-f0-9]{32}$/.test(token)) {
    throw new TypeError('The Mass Backup run token is invalid.');
  }
  return `BEX-Mass-Backup-${definition.fileSegment}-${timestampForFile(date)}-${token}.zip`;
}

function parseMassBackupFileName(fileName) {
  if (typeof fileName !== 'string') return null;
  const match = MASS_BACKUP_FILE_PATTERN.exec(fileName);
  if (!match) return null;
  return Object.freeze({
    category: CATEGORY_BY_FILE_SEGMENT[match[1]],
    timestamp: match[2],
    token: match[3],
  });
}

function archiveBuffer(value) {
  let bytes;
  if (Buffer.isBuffer(value)) {
    bytes = value;
  } else if (value instanceof ArrayBuffer) {
    bytes = Buffer.from(value);
  } else if (ArrayBuffer.isView(value)) {
    bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  } else {
    throw codedError('BEX_MASS_BACKUP_ARCHIVE_INVALID', 'A Mass Backup ZIP file is invalid.');
  }

  if (bytes.byteLength < MIN_ZIP_BYTES || bytes.byteLength > MAX_ZIP_BYTES) {
    throw codedError('BEX_MASS_BACKUP_ARCHIVE_INVALID', 'A Mass Backup ZIP file has an invalid size.');
  }

  const hasLocalHeader = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  const isEmptyArchive = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x05 && bytes[3] === 0x06;
  if (!hasLocalHeader && !isEmptyArchive) {
    throw codedError('BEX_MASS_BACKUP_ARCHIVE_INVALID', 'A Mass Backup file is not a ZIP archive.');
  }

  const tailStart = Math.max(0, bytes.length - 65557);
  let hasEndRecord = false;
  for (let index = bytes.length - 22; index >= tailStart; index -= 1) {
    if (
      bytes[index] === 0x50
      && bytes[index + 1] === 0x4b
      && bytes[index + 2] === 0x05
      && bytes[index + 3] === 0x06
    ) {
      hasEndRecord = true;
      break;
    }
  }
  if (!hasEndRecord) {
    throw codedError('BEX_MASS_BACKUP_ARCHIVE_INVALID', 'A Mass Backup ZIP file is incomplete.');
  }
  return bytes;
}

function isExactIsoTimestamp(value) {
  if (typeof value !== 'string' || !value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

async function readArchiveManifest(bytes, expectedCategory) {
  let zip;
  try {
    zip = await JSZip.loadAsync(bytes, { checkCRC32: false, createFolders: false });
  } catch {
    throw codedError('BEX_MASS_BACKUP_ARCHIVE_INVALID', 'A Mass Backup ZIP file is unreadable.');
  }

  const manifestEntry = zip.file(MANIFEST_FILE_NAME);
  if (!manifestEntry || manifestEntry.dir) {
    throw codedError('BEX_MASS_BACKUP_ARCHIVE_INVALID', 'A Mass Backup ZIP file has no valid manifest.');
  }
  const declaredManifestBytes = manifestEntry?._data?.uncompressedSize;
  if (!Number.isSafeInteger(declaredManifestBytes) || declaredManifestBytes > 16 * 1024) {
    throw codedError('BEX_MASS_BACKUP_ARCHIVE_INVALID', 'A Mass Backup ZIP manifest is invalid.');
  }

  let manifestText;
  let manifest;
  try {
    manifestText = await manifestEntry.async('string');
    if (Buffer.byteLength(manifestText, 'utf8') > 16 * 1024) throw new Error('Manifest too large.');
    manifest = JSON.parse(manifestText);
  } catch {
    throw codedError('BEX_MASS_BACKUP_ARCHIVE_INVALID', 'A Mass Backup ZIP manifest is invalid.');
  }

  const itemEntries = Object.values(zip.files).filter((entry) => (
    !entry.dir && entry.name !== MANIFEST_FILE_NAME
  ));
  if (
    !manifest
    || typeof manifest !== 'object'
    || Array.isArray(manifest)
    || manifest.signature !== MANIFEST_SIGNATURE
    || manifest.version !== MANIFEST_VERSION
    || manifest.category !== expectedCategory
    || !Number.isSafeInteger(manifest.itemCount)
    || manifest.itemCount < 1
    || manifest.itemCount !== itemEntries.length
    || !isExactIsoTimestamp(manifest.createdAt)
  ) {
    throw codedError('BEX_MASS_BACKUP_ARCHIVE_INVALID', 'A Mass Backup ZIP manifest does not match its contents.');
  }
  return Object.freeze({ ...manifest });
}

async function normalizeArchives(archives) {
  if (!Array.isArray(archives) || archives.length < 1 || archives.length > 3) {
    throw codedError('BEX_MASS_BACKUP_ARCHIVE_INVALID', 'Choose at least one Mass Backup ZIP file.');
  }
  const categories = new Set();
  const normalized = [];
  for (const archive of archives) {
    if (!archive || typeof archive !== 'object' || Array.isArray(archive)) {
      throw codedError('BEX_MASS_BACKUP_ARCHIVE_INVALID', 'A Mass Backup ZIP file is invalid.');
    }
    const category = archive.category;
    if (!MASS_BACKUP_CATEGORIES[category] || categories.has(category)) {
      throw codedError('BEX_MASS_BACKUP_ARCHIVE_INVALID', 'A Mass Backup category is invalid or duplicated.');
    }
    categories.add(category);
    const bytes = archiveBuffer(archive.bytes);
    const manifest = await readArchiveManifest(bytes, category);
    normalized.push(Object.freeze({ category, bytes, manifest }));
  }
  return normalized;
}

async function safeUnlink(filePath) {
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function fsyncFile(filePath) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function fsyncDirectory(folderPath) {
  let handle;
  try {
    handle = await fs.promises.open(folderPath, 'r');
    await handle.sync();
  } catch (error) {
    if (process.platform !== 'win32') throw error;
  } finally {
    if (handle) await handle.close();
  }
}

async function publishStagedFile(temporaryPath, finalPath) {
  try {
    // Both paths live in the chosen directory, so a hard link publishes the
    // already-fsynced inode atomically without copying the archive bytes again.
    await fs.promises.link(temporaryPath, finalPath);
    return 'link';
  } catch (error) {
    // Never fall back when the managed final name already exists: COPYFILE_EXCL
    // would also reject it, and preserving an existing file is non-negotiable.
    if (error?.code === 'EEXIST' || !HARD_LINK_COPY_FALLBACK_CODES.has(error?.code)) {
      throw error;
    }
  }

  await fs.promises.copyFile(temporaryPath, finalPath, fs.constants.COPYFILE_EXCL);
  return 'copy';
}

class MassBackupManager {
  constructor({
    configPath,
    now = () => new Date(),
    randomUUID = crypto.randomUUID,
  } = {}) {
    if (typeof configPath !== 'string' || !configPath.trim()) {
      throw new TypeError('Mass Backup requires a settings path.');
    }
    if (typeof now !== 'function' || typeof randomUUID !== 'function') {
      throw new TypeError('Mass Backup requires clock and random providers.');
    }
    this.configPath = path.resolve(configPath);
    this.now = now;
    this.randomUUID = randomUUID;
    this.writeActive = false;
  }

  async readConfig({ repairInvalid = false } = {}) {
    try {
      return parseConfig(await fs.promises.readFile(this.configPath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return defaultConfig();
      if (error?.code === 'BEX_MASS_BACKUP_CONFIG_INVALID' && repairInvalid) {
        const repaired = defaultConfig();
        await this.writeConfig(repaired);
        return repaired;
      }
      throw error;
    }
  }

  async writeConfig(config) {
    const normalized = parseConfig(JSON.stringify(config));
    await fs.promises.mkdir(path.dirname(this.configPath), { recursive: true });
    const temporaryPath = `${this.configPath}.tmp-${runToken(this.randomUUID)}`;
    try {
      await fs.promises.writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      await fsyncFile(temporaryPath);
      await fs.promises.rename(temporaryPath, this.configPath);
      await fsyncDirectory(path.dirname(this.configPath));
    } catch (error) {
      await safeUnlink(temporaryPath).catch(() => {});
      throw error;
    }
    return normalized;
  }

  async resolveDestination(destinationPath) {
    if (typeof destinationPath !== 'string' || !destinationPath.trim()) {
      throw codedError('BEX_MASS_BACKUP_NOT_CONFIGURED', 'Choose a Mass Backup folder first.');
    }
    const resolvedPath = path.resolve(destinationPath);
    let stats;
    let realPath;
    try {
      stats = await fs.promises.lstat(resolvedPath);
      realPath = await fs.promises.realpath(resolvedPath);
    } catch {
      throw codedError('BEX_MASS_BACKUP_FOLDER_UNAVAILABLE', 'The saved Mass Backup folder is unavailable.');
    }
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw codedError('BEX_MASS_BACKUP_FOLDER_UNAVAILABLE', 'The saved Mass Backup folder is not a normal folder.');
    }
    return realPath;
  }

  async getSettings({ repairInvalid = false } = {}) {
    const config = await this.readConfig({ repairInvalid });
    if (!config.destinationPath) {
      return Object.freeze({
        available: false,
        configured: false,
        destinationPath: null,
        issue: 'not_configured',
        replacePrevious: config.replacePrevious,
      });
    }
    try {
      const destinationPath = await this.resolveDestination(config.destinationPath);
      return Object.freeze({
        available: true,
        configured: true,
        destinationPath,
        issue: null,
        replacePrevious: config.replacePrevious,
      });
    } catch (error) {
      if (error?.code !== 'BEX_MASS_BACKUP_FOLDER_UNAVAILABLE') throw error;
      return Object.freeze({
        available: false,
        configured: true,
        destinationPath: config.destinationPath,
        issue: 'folder_unavailable',
        replacePrevious: config.replacePrevious,
      });
    }
  }

  async setDestination(destinationPath) {
    const realPath = await this.resolveDestination(destinationPath);
    const current = await this.readConfig({ repairInvalid: true });
    await this.writeConfig({
      destinationPath: realPath,
      replacePrevious: current.replacePrevious,
      version: CONFIG_VERSION,
    });
    return this.getSettings();
  }

  async setReplacePrevious(replacePrevious) {
    if (typeof replacePrevious !== 'boolean') {
      throw codedError('BEX_MASS_BACKUP_SETTING_INVALID', 'The Mass Backup replacement setting is invalid.');
    }
    const current = await this.readConfig({ repairInvalid: true });
    await this.writeConfig({ ...current, replacePrevious });
    return this.getSettings();
  }

  async cleanupPrevious(destinationPath, categories, currentFileNames) {
    const deleted = [];
    const failed = [];
    const entries = await fs.promises.readdir(destinationPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || currentFileNames.has(entry.name)) continue;
      const parsed = parseMassBackupFileName(entry.name);
      if (!parsed || !categories.has(parsed.category)) continue;

      const candidatePath = path.join(destinationPath, entry.name);
      try {
        const stats = await fs.promises.lstat(candidatePath);
        if (!stats.isFile() || stats.isSymbolicLink()) continue;
        if (
          !Number.isSafeInteger(stats.size)
          || stats.size < MIN_ZIP_BYTES
          || stats.size > MAX_ZIP_BYTES
        ) continue;
        const bytes = archiveBuffer(await fs.promises.readFile(candidatePath));
        await readArchiveManifest(bytes, parsed.category);
        await fs.promises.unlink(candidatePath);
        deleted.push(entry.name);
      } catch (error) {
        if (error?.code === 'ENOENT') continue;
        if (error?.code === 'BEX_MASS_BACKUP_ARCHIVE_INVALID') continue;
        failed.push(entry.name);
      }
    }
    return { deleted, failed };
  }

  async writeArchives(archiveInput) {
    if (this.writeActive) {
      throw codedError('BEX_MASS_BACKUP_ACTIVE', 'A Mass Backup is already being saved.');
    }
    this.writeActive = true;
    const temporaryPaths = [];
    const createdPaths = [];
    let committed = false;
    try {
      const archives = await normalizeArchives(archiveInput);
      const config = await this.readConfig();
      const destinationPath = await this.resolveDestination(config.destinationPath);
      const createdAt = this.now();
      const token = runToken(this.randomUUID);
      const stageToken = runToken(this.randomUUID);
      const staged = archives.map((archive) => {
        const fileName = massBackupFileName(archive.category, createdAt, token);
        return {
          ...archive,
          fileName,
          finalPath: path.join(destinationPath, fileName),
          temporaryPath: path.join(destinationPath, `.${fileName}.${stageToken}.partial`),
        };
      });

      for (const archive of staged) {
        await fs.promises.writeFile(archive.temporaryPath, archive.bytes, {
          flag: 'wx',
          mode: 0o600,
        });
        temporaryPaths.push(archive.temporaryPath);
        await fsyncFile(archive.temporaryPath);
      }

      for (const archive of staged) {
        await publishStagedFile(archive.temporaryPath, archive.finalPath);
        createdPaths.push(archive.finalPath);
        await fsyncFile(archive.finalPath);
      }
      await fsyncDirectory(destinationPath);

      for (const temporaryPath of temporaryPaths) await safeUnlink(temporaryPath);
      temporaryPaths.length = 0;
      committed = true;

      let cleanup = { deleted: [], failed: [] };
      let cleanupIncomplete = false;
      if (config.replacePrevious) {
        try {
          cleanup = await this.cleanupPrevious(
            destinationPath,
            new Set(staged.map((archive) => archive.category)),
            new Set(staged.map((archive) => archive.fileName)),
          );
          await fsyncDirectory(destinationPath);
        } catch {
          cleanupIncomplete = true;
        }
      }

      return Object.freeze({
        archives: staged.map((archive) => Object.freeze({
          bytes: archive.bytes.byteLength,
          category: archive.category,
          fileName: archive.fileName,
        })),
        cleanupFailed: Object.freeze(cleanup.failed),
        cleanupIncomplete,
        createdAt: createdAt.toISOString(),
        deletedPrevious: Object.freeze(cleanup.deleted),
        destinationPath,
        replacePrevious: config.replacePrevious,
      });
    } catch (error) {
      for (const temporaryPath of temporaryPaths) await safeUnlink(temporaryPath).catch(() => {});
      if (!committed) {
        for (const createdPath of createdPaths) await safeUnlink(createdPath).catch(() => {});
      }
      if (typeof error?.code === 'string' && error.code.startsWith('BEX_MASS_BACKUP_')) throw error;
      throw codedError('BEX_MASS_BACKUP_WRITE_FAILED', 'BEX could not save the Mass Backup ZIP files.');
    } finally {
      this.writeActive = false;
    }
  }
}

module.exports = {
  CONFIG_VERSION,
  MAX_ZIP_BYTES,
  MASS_BACKUP_CATEGORIES,
  MASS_BACKUP_FILE_PATTERN,
  MassBackupManager,
  massBackupFileName,
  parseMassBackupFileName,
};
