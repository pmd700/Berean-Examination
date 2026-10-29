'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { backupFiles, retainedBackupNames, deduplicateBackupMedia, removeEmptyVerificationSidecars, pruneBackupHistory } = require('../desktop/backup-storage.cjs');
const { validateEncryptedMediaSnapshot } = require('../desktop/local-media-backup.cjs');
const name = (date, id = 'abcdef123456') => `BEX-${new Date(date).toISOString().replace(/[:.]/g, '-')}-${id}.bex-backup.db`;
function fixture(run) { const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bex-backup-storage-')); try { return run(folder); } finally { fs.rmSync(folder, { recursive: true, force: true }); } }
function backup(folder, date, bytes, id) {
  const target = path.join(folder, name(date, id)); fs.writeFileSync(target, Buffer.alloc(120));
  if (bytes) {
    const media = `${target}.media`; fs.mkdirSync(path.join(media, 'Files'), { recursive: true });
    const relative = 'Files/file-01234567-89ab-4def-8123-456789abcdef.pdf';
    fs.writeFileSync(path.join(media, relative), bytes);
    fs.writeFileSync(path.join(media, '.bex-media-manifest.json'), JSON.stringify({ version: 1, files: [{ path: relative, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }] }));
  }
  return target;
}
describe('backup storage efficiency', () => {
  it('keeps three recent plus daily, weekly and monthly restore points with a bounded count', () => {
    const now = Date.parse('2026-10-19T16:00:00Z');
    const entries = Array.from({ length: 400 }, (_, index) => { const time = now - index * 3600000; return { time, name: name(time) }; });
    const keep = retainedBackupNames(entries, now);
    assert.ok(keep.size <= 20); assert.ok(keep.size >= 7);
    for (const item of entries.slice(0, 3)) assert.ok(keep.has(item.name));
    for (let day = 1; day < 7; day++) assert.ok(keep.has(entries.find(item => new Date(item.time).getUTCDate() === 19 - day).name));
  });
  it('ignores unknown files and protects future dates', () => fixture(folder => {
    const future = backup(folder, '2027-01-01'); fs.writeFileSync(path.join(folder, 'personal.db'), 'untouched');
    fs.symlinkSync(future, path.join(folder, name('2020-01-01')));
    const entries = backupFiles(folder); assert.equal(entries.length, 1);
    assert.ok(retainedBackupNames(entries, Date.parse('2026-10-19')).has(path.basename(future)));
  }));
  it('shares only verified backup media, preserves all manifests, and never links live media', () => fixture(folder => {
    const data = Buffer.from('encrypted bytes with no plaintext study content');
    const older = backup(folder, '2026-10-10', data), newer = backup(folder, '2026-10-11', data);
    const live = path.join(folder, 'live-file'); fs.writeFileSync(live, data);
    const report = deduplicateBackupMedia(folder); assert.equal(report.linkedFiles, 1); assert.equal(report.savedBytes, data.length);
    const a = validateEncryptedMediaSnapshot(older), b = validateEncryptedMediaSnapshot(newer);
    const first = path.join(a.snapshotPath, a.files[0]), second = path.join(b.snapshotPath, b.files[0]);
    assert.equal(fs.statSync(first).ino, fs.statSync(second).ino); assert.notEqual(fs.statSync(first).ino, fs.statSync(live).ino);
    assert.equal(deduplicateBackupMedia(folder).linkedFiles, 0);
    fs.rmSync(`${older}.media`, { recursive: true }); assert.deepEqual(fs.readFileSync(second), data);
  }));
  it('never uses corrupted media as a deduplication source', () => fixture(folder => {
    const data = Buffer.from('encrypted fixture'); const bad = backup(folder, '2026-10-10', data), good = backup(folder, '2026-10-11', data);
    const badMedia = validateEncryptedMediaSnapshot(bad); fs.writeFileSync(path.join(badMedia.snapshotPath, badMedia.files[0]), 'corrupt');
    assert.equal(deduplicateBackupMedia(folder).linkedFiles, 0); assert.equal(validateEncryptedMediaSnapshot(good).files.length, 1);
  }));
  it('prunes complete backup/media pairs only after a newly verified snapshot and preserves Archives', () => fixture(folder => {
    for (let day = 1; day <= 20; day++) backup(folder, `2026-10-${String(day).padStart(2, '0')}`, Buffer.from('ciphertext'));
    const latest = path.join(folder, name('2026-10-20'));
    fs.mkdirSync(path.join(folder, 'Archives')); fs.writeFileSync(path.join(folder, 'Archives', 'recovery.tar.xz'), 'archive');
    const report = pruneBackupHistory({ backupFolder: folder, verifiedBackupPath: latest, now: Date.parse('2026-10-20') });
    assert.ok(report.removedBackups > 0); assert.ok(fs.existsSync(latest));
    assert.equal(fs.readFileSync(path.join(folder, 'Archives', 'recovery.tar.xz'), 'utf8'), 'archive');
    for (const item of backupFiles(folder)) assert.equal(validateEncryptedMediaSnapshot(item.path).files.length, 1);
    assert.throws(() => pruneBackupHistory({ backupFolder: folder, verifiedBackupPath: '/elsewhere/missing' }));
  }));
  it('removes only orphaned verification sidecars with an empty WAL', () => fixture(folder => {
    const final = backup(folder, '2026-10-10'), partial = path.join(folder, `.${path.basename(final)}.partial`);
    fs.writeFileSync(`${partial}-wal`, ''); fs.writeFileSync(`${partial}-shm`, Buffer.alloc(32768));
    assert.equal(removeEmptyVerificationSidecars(folder), 2);
    fs.unlinkSync(final); // Also clean leftovers after their old backup expires.
    fs.writeFileSync(`${partial}-wal`, ''); fs.writeFileSync(`${partial}-shm`, Buffer.alloc(32768));
    assert.equal(removeEmptyVerificationSidecars(folder), 2);
    fs.writeFileSync(`${partial}-wal`, 'uncheckpointed data'); fs.writeFileSync(`${partial}-shm`, 'keep');
    assert.equal(removeEmptyVerificationSidecars(folder), 0); assert.ok(fs.existsSync(`${partial}-shm`));
    fs.writeFileSync(`${partial}-wal`, ''); fs.writeFileSync(partial, 'still being written');
    assert.equal(removeEmptyVerificationSidecars(folder), 0);
  }));
  it('pins a selected old restore target during emergency-backup retention', () => fixture(folder => {
    const target = backup(folder, '2020-01-01');
    const latest = backup(folder, '2026-10-20');
    pruneBackupHistory({ backupFolder: folder, verifiedBackupPath: latest, protectedBackupPaths: [target], now: Date.parse('2026-10-20') });
    assert.ok(fs.existsSync(target)); assert.ok(fs.existsSync(latest));
  }));
});
