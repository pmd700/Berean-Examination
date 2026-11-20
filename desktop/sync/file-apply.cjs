'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { saveEncryptedAttachment } = require('../local-attachments.cjs');
const { parseMediaUrl } = require('../local-media.cjs');
const { fingerprint, PURPOSE } = require('./file-index.cjs');
function safeTarget(root, relative) {
  const parts = relative.split('/');
  if (parts[0] === 'Database' || parts.some(part => !part || part === '.' || part === '..') || /[\\\x00-\x1f\x7f]/.test(relative)) throw new Error('Invalid synchronized file path.');
  let current = fs.realpathSync(root);
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) fs.mkdirSync(current, { mode: 0o700 });
    const stats = fs.lstatSync(current);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('A synchronized folder is unsafe.');
  }
  const target = path.join(current, parts.at(-1));
  if (fs.existsSync(target) && (!fs.lstatSync(target).isFile() || fs.lstatSync(target).isSymbolicLink())) throw new Error('A synchronized file is unsafe.');
  return target;
}
async function applyFiles({ database, privacyVault, libraryPath, replica, relay, blobs }) {
  const { cacheFile, validateFileManifest, decodeFileChunk } = await import('../../shared/sync/files.js');
  const { hexDigest } = await import('../../shared/sync/relay-client.js');
  const { identity } = await replica.store.meta();
  const { records, operations } = await replica.records(), known = new Set(operations.map(op => op.id));
  let completed = 0;
  for (const record of records.filter(record => record.record.kind === 'VaultFile')) {
    privacyVault.assertUnlocked(); replica.assertUnlocked();
    const relative = record.record.id, heads = record.versions.map(op => op.id).sort();
    const prior = database.prepare("SELECT heads FROM local_sync_heads WHERE kind='VaultFile' AND record_id=?").get(relative);
    if (prior && JSON.stringify(JSON.parse(prior.heads).sort()) === JSON.stringify(heads)) continue;
    if (prior && JSON.parse(prior.heads).some(id => !known.has(id))) continue;
    if (record.status === 'conflict') {
      database.prepare('INSERT INTO local_sync_conflicts VALUES(?,?) ON CONFLICT(record_key) DO UPDATE SET encrypted_versions=excluded.encrypted_versions').run(record.key, privacyVault.encryptValue(record, 'bex:sync:conflict:v1'));
      continue;
    }
    const target = safeTarget(libraryPath, relative), before = fs.existsSync(target) ? fingerprint(target) : null;
    const recoveryFolder = path.join(blobs.directory, 'file-recovery'); fs.mkdirSync(recoveryFolder, { recursive: true, mode: 0o700 });
    if (record.status === 'deleted') {
      // Retain an encrypted/raw original outside the mirrored tree for recovery.
      if (before) fs.renameSync(target, path.join(recoveryFolder, crypto.randomUUID()));
      database.prepare("INSERT INTO local_sync_file_index VALUES(?,'deleted',?) ON CONFLICT(path) DO UPDATE SET fingerprint='deleted',encrypted_manifest=excluded.encrypted_manifest").run(relative, privacyVault.encryptValue({}, PURPOSE));
    } else {
      const manifest = validateFileManifest(record.versions[0].payload);
      if (manifest.path !== relative) throw new Error('The encrypted manifest changed its file identity.');
      if (manifest.url && manifest.url !== `bex-media://library/${path.basename(target)}`) throw new Error('Invalid synchronized media reference.');
      if (manifest.url && !/^Media\/(?:Images|Documents|Audio|Video|Files)\//.test(relative)) throw new Error('Invalid synchronized media folder.');
      await cacheFile(manifest, blobs, relay);
      const plainTarget = path.join(recoveryFolder, `${crypto.randomUUID()}${path.extname(target)}`), fd = fs.openSync(plainTarget, 'wx', 0o600);
      const hash = crypto.createHash('sha256'); let size = 0;
      try {
        for (const [index, address] of manifest.chunks.entries()) {
          privacyVault.assertUnlocked(); replica.assertUnlocked();
          const bytes = await blobs.get(address);
          if (!bytes || await hexDigest(bytes) !== address) throw new Error('File chunk integrity failed.');
          const plain = await decodeFileChunk(replica.key, bytes, identity, manifest.digest, index);
          try { hash.update(plain); size += plain.length; fs.writeFileSync(fd, plain); } finally { plain.fill(0); }
        }
        fs.fsyncSync(fd);
      } catch (error) { fs.closeSync(fd); fs.unlinkSync(plainTarget); throw error; }
      fs.closeSync(fd);
      let preserved = null;
      try {
        if (size !== manifest.size || hash.digest('hex') !== manifest.digest) throw new Error('The complete file failed its integrity check.');
        privacyVault.assertUnlocked();
        if ((fs.existsSync(target) ? fingerprint(target) : null) !== before) throw new Error('A local file changed during download. Both versions were retained.');
        if (before) { preserved = path.join(recoveryFolder, crypto.randomUUID()); fs.renameSync(target, preserved); }
        if (manifest.url && path.basename(target).startsWith('image-')) {
          const name = parseMediaUrl(manifest.url), bytes = fs.readFileSync(plainTarget);
          try { fs.writeFileSync(target, privacyVault.encryptBinary(bytes, `bex:media:image:v1:${name}`), { flag: 'wx', mode: 0o600 }); } finally { bytes.fill(0); }
        } else if (manifest.url) {
          const result = saveEncryptedAttachment({ libraryPath, privacyVault, sourcePath: plainTarget, storedName: path.basename(target), originalName: manifest.name });
          const category = { image: 'Images', pdf: 'Documents', audio: 'Audio', video: 'Video', file: 'Files' }[result.kind];
          const installed = path.join(libraryPath, 'Media', category, path.basename(target));
          if (installed !== target) fs.renameSync(installed, target);
        } else fs.renameSync(plainTarget, target);
        database.prepare('INSERT INTO local_sync_file_index VALUES(?,?,?) ON CONFLICT(path) DO UPDATE SET fingerprint=excluded.fingerprint,encrypted_manifest=excluded.encrypted_manifest').run(relative, fingerprint(target), privacyVault.encryptValue(manifest, PURPOSE));
      } catch (error) { if (preserved && !fs.existsSync(target)) fs.renameSync(preserved, target); throw error; }
      finally { if (fs.existsSync(plainTarget)) fs.unlinkSync(plainTarget); }
    }
    database.prepare("INSERT INTO local_sync_heads VALUES('VaultFile',?,?) ON CONFLICT(kind,record_id) DO UPDATE SET heads=excluded.heads").run(relative, JSON.stringify(heads));
    database.prepare('DELETE FROM local_sync_conflicts WHERE record_key=?').run(record.key); completed++;
  }
  return completed;
}
module.exports = { applyFiles, safeTarget };
