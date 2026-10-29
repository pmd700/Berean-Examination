'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateEncryptedMediaSnapshot } = require('./local-media-backup.cjs');

// Keep recent work plus progressively spaced restore points. Unknown files and
// Archives are never candidates. The newest verified backup is always pinned.
const BACKUP_PATTERN = /^BEX-(\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z)-[a-f0-9]{12}\.bex-backup\.db$/;
const BACKUP_RETENTION = Object.freeze({ recent: 3, days: 7, weeks: 4, months: 6 });
function backupTime(name) {
  const match = BACKUP_PATTERN.exec(name);
  if (!match) return null;
  const value = Date.parse(match[1].replace(/T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z$/, 'T$1:$2:$3.$4Z'));
  return Number.isFinite(value) ? value : null;
}
function backupFiles(folder) {
  return fs.readdirSync(folder).flatMap(name => {
    const time = backupTime(name), target = path.join(folder, name);
    if (time === null) return [];
    const stat = fs.lstatSync(target);
    return stat.isFile() && !stat.isSymbolicLink() ? [{ name, time, path: target }] : [];
  }).sort((a, b) => b.time - a.time || b.name.localeCompare(a.name));
}
function retainedBackupNames(entries, now = Date.now(), policy = BACKUP_RETENTION) {
  const sorted = [...entries].sort((a, b) => b.time - a.time || b.name.localeCompare(a.name));
  const keep = new Set(sorted.slice(0, policy.recent).map(item => item.name));
  // UTC periods make retention independent of daylight-saving and clock zone.
  const today = Math.floor(now / 86400000), currentMonth = new Date(now).getUTCFullYear() * 12 + new Date(now).getUTCMonth();
  const seen = [new Set(), new Set(), new Set()];
  for (const item of sorted) {
    const day = Math.floor(item.time / 86400000), week = Math.floor((day + 3) / 7);
    const date = new Date(item.time), month = date.getUTCFullYear() * 12 + date.getUTCMonth();
    const periods = [day, week, month], ages = [today - day, Math.floor((today + 3) / 7) - week, currentMonth - month];
    const limits = [policy.days, policy.weeks, policy.months];
    periods.forEach((period, index) => {
      if (ages[index] >= 0 && ages[index] < limits[index] && !seen[index].has(period)) {
        seen[index].add(period); keep.add(item.name);
      }
    });
    if (item.time > now) keep.add(item.name); // Never prune future-dated files.
  }
  return keep;
}
function digest(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function deduplicateBackupMedia(backupFolder) {
  const content = new Map();
  let linkedFiles = 0, savedBytes = 0;
  // Oldest first gives stable immutable sources. Never link to live Media.
  for (const backup of backupFiles(backupFolder).reverse()) {
    let snapshot;
    try { snapshot = validateEncryptedMediaSnapshot(backup.path); } catch { continue; }
    if (!snapshot.snapshotPath) continue;
    for (const relative of snapshot.files) {
      const file = path.join(snapshot.snapshotPath, relative), stat = fs.lstatSync(file);
      const entry = snapshot.expected.get(relative), key = `${entry.bytes}:${entry.sha256}`;
      const original = content.get(key);
      if (!original) { content.set(key, file); continue; }
      const source = fs.lstatSync(original);
      if (source.dev === stat.dev && source.ino === stat.ino) continue;
      // The manifests and both files were validated above. Check the source
      // again immediately before linking in case it was changed externally.
      if (!source.isFile() || source.isSymbolicLink() || source.size !== entry.bytes || digest(original) !== entry.sha256) continue;
      const temporary = `${file}.dedup-${crypto.randomBytes(6).toString('hex')}`;
      try {
        fs.linkSync(original, temporary);
        fs.renameSync(temporary, file);
        linkedFiles++; savedBytes += stat.size;
      } catch (error) {
        if (!['EXDEV', 'EPERM', 'EACCES', 'ENOTSUP', 'EMLINK'].includes(error.code)) throw error;
        // Filesystems without hard links keep their independent safe copies.
      } finally { fs.rmSync(temporary, { force: true }); }
    }
  }
  return { linkedFiles, savedBytes };
}

function removeEmptyVerificationSidecars(folder) {
  let removedFiles = 0;
  for (const name of fs.readdirSync(folder)) {
    if (!/^\.BEX-.*\.bex-backup\.db\.partial-(?:wal|shm)$/.test(name)) continue;
    const partial = path.join(folder, name.replace(/-(wal|shm)$/, ''));
    const final = path.join(folder, path.basename(partial).slice(1).replace(/\.partial$/, ''));
    if (fs.existsSync(partial) || backupTime(path.basename(final)) === null) continue;
    const wal = `${partial}-wal`, shm = `${partial}-shm`;
    if (fs.existsSync(wal)) {
      const stat = fs.lstatSync(wal);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== 0) continue;
    }
    for (const target of [wal, shm]) {
      if (!fs.existsSync(target)) continue;
      const stat = fs.lstatSync(target);
      if (stat.isFile() && !stat.isSymbolicLink()) { fs.unlinkSync(target); removedFiles++; }
    }
  }
  return removedFiles;
}

function pruneBackupHistory({ backupFolder, verifiedBackupPath, protectedBackupPaths = [], now = Date.now() }) {
  const entries = backupFiles(backupFolder), pinned = entries.find(item => item.path === path.resolve(verifiedBackupPath));
  if (!pinned || fs.statSync(pinned.path).size < 100) throw new Error('A verified complete backup is required before retention cleanup.');
  // Called only after SQLite verification and media snapshot publication.
  validateEncryptedMediaSnapshot(pinned.path);
  const keep = retainedBackupNames(entries, now); keep.add(pinned.name);
  const protectedPaths = new Set(protectedBackupPaths.map(file => path.resolve(file)));
  let removedBackups = 0;
  for (const item of entries) {
    if (keep.has(item.name) || protectedPaths.has(item.path) || item.time > pinned.time) continue;
    const media = `${item.path}.media`;
    if (fs.existsSync(media)) {
      const stat = fs.lstatSync(media);
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
    }
    fs.unlinkSync(item.path);
    fs.rmSync(media, { recursive: true, force: true });
    removedBackups++;
  }
  return { removedBackups, retainedBackups: entries.length - removedBackups };
}
module.exports = { BACKUP_RETENTION, backupFiles, retainedBackupNames, deduplicateBackupMedia, removeEmptyVerificationSidecars, pruneBackupHistory };
