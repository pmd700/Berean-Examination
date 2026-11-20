'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readEncryptedMedia, requireMediaCategory, parseMediaUrl } = require('../local-media.cjs');
const { readEncryptedAttachment, saveEncryptedAttachment } = require('../local-attachments.cjs');
const PURPOSE = 'bex:sync:file-manifest:v1';
const mimeFor = name => ({ '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.txt': 'text/plain', '.json': 'application/json' }[path.extname(name).toLowerCase()] || 'application/octet-stream');
function* walkVault(root, directory = root) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name), relative = path.relative(root, target).split(path.sep).join('/');
    if (entry.isSymbolicLink()) throw new Error('A Vault symlink must be explicitly resolved before file synchronization.');
    if (relative.split('/')[0] === 'Database' || entry.name === '.DS_Store') continue;
    if (entry.isDirectory()) yield* walkVault(root, target);
    else if (entry.isFile()) yield { path: target, relative };
    else throw new Error('A special Vault file requires review before synchronization.');
  }
}
function fingerprint(target) { const s = fs.statSync(target, { bigint: true }); return [s.dev,s.ino,s.size,s.mtimeNs].join(':'); }
function sourceFor(file, libraryPath, privacyVault) {
  const name = path.basename(file.path);
  if (file.relative.startsWith('Media/') && name.startsWith('image-')) {
    return { url: `bex-media://library/${name}`, mimeType: mimeFor(name), async *read() { const media = readEncryptedMedia({ libraryPath, privacyVault, mediaUrl: this.url }); try { yield media.bytes; } finally { media.bytes.fill(0); } } };
  }
  if (file.relative.startsWith('Media/') && name.startsWith('file-')) {
    const url = `bex-media://library/${name}`;
    const info = readEncryptedAttachment({ libraryPath, privacyVault, mediaUrl: url, head: true });
    return { url, name: info.name, kind: info.kind, mimeType: info.mimeType, async *read() { const media = readEncryptedAttachment({ libraryPath, privacyVault, mediaUrl: url }); for await (const bytes of media.body) yield bytes; } };
  }
  return { url: null, mimeType: mimeFor(name), async *read() { const before = fs.lstatSync(file.path);
    const realRoot = fs.realpathSync(libraryPath), realTarget = fs.realpathSync(file.path);
    if (!realTarget.startsWith(realRoot + path.sep) || !before.isFile() || before.isSymbolicLink()) throw new Error('Unsafe Vault file.');
    const fd = fs.openSync(file.path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fs.fstatSync(fd);
    if (opened.ino !== before.ino || opened.dev !== before.dev) { fs.closeSync(fd); throw new Error('A Vault file changed during opening.'); }
    const stream = fs.createReadStream(file.path, { fd, autoClose: true, highWaterMark: 256 * 1024 }); for await (const bytes of stream) yield bytes; } };
}
class VaultFileIndex {
  constructor(database, privacyVault, libraryPath, blobStore) {
    Object.assign(this, { database, privacyVault, libraryPath, blobStore });
    database.exec('CREATE TABLE IF NOT EXISTS local_sync_file_index(path TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,encrypted_manifest BLOB NOT NULL); CREATE TABLE IF NOT EXISTS local_sync_file_content(digest TEXT PRIMARY KEY,encrypted_manifest BLOB NOT NULL)');
  }
  queue(relative, manifest, stamp, action = 'put') {
    const db = this.database, heads = db.prepare("SELECT heads FROM local_sync_heads WHERE kind='VaultFile' AND record_id=?").get(relative)?.heads || '[]';
    const encrypted = this.privacyVault.encryptValue(manifest, PURPOSE);
    db.exec('SAVEPOINT sync_file_manifest');
    try {
      const identity = JSON.parse(db.prepare('SELECT identity FROM local_sync_config WHERE id=1').get().identity);
      const time = new Date().toISOString();
      const result = db.prepare("INSERT INTO local_sync_journal(kind,record_id,action,encrypted_payload,created_at,updated_at,parents) VALUES('VaultFile',?,?,?,?,?,?)").run(relative, action, encrypted, time, time, heads);
      db.prepare("INSERT INTO local_sync_heads VALUES('VaultFile',?,?) ON CONFLICT(kind,record_id) DO UPDATE SET heads=excluded.heads").run(relative, JSON.stringify([`${identity.deviceId}:${result.lastInsertRowid}`]));
      db.prepare('INSERT INTO local_sync_file_index VALUES(?,?,?) ON CONFLICT(path) DO UPDATE SET fingerprint=excluded.fingerprint,encrypted_manifest=excluded.encrypted_manifest').run(relative, stamp, encrypted);
      db.exec('RELEASE sync_file_manifest');
    } catch (error) { db.exec('ROLLBACK TO sync_file_manifest'); db.exec('RELEASE sync_file_manifest'); throw error; }
  }
  async scan(key, identity, progress = () => {}) {
    const { encodeFileChunk, FILE_CHUNK_BYTES } = await import('../../shared/sync/files.js');
    const files = [...walkVault(this.libraryPath)]; let completed = 0;
    for (const file of files) {
      this.privacyVault.assertUnlocked(); const stamp = fingerprint(file.path);
      const prior = this.database.prepare('SELECT fingerprint FROM local_sync_file_index WHERE path=?').get(file.relative);
      if (prior?.fingerprint === stamp) { progress({ completed: ++completed, total: files.length }); continue; }
      const source = sourceFor(file, this.libraryPath, this.privacyVault), hash = crypto.createHash('sha256'); let size = 0;
      for await (const bytes of source.read()) { this.privacyVault.assertUnlocked(); hash.update(bytes); size += bytes.length; }
      const digest = hash.digest('hex');
      let existing = this.database.prepare('SELECT encrypted_manifest FROM local_sync_file_content WHERE digest=?').get(digest);
      let content = existing ? this.privacyVault.decryptValue(existing.encrypted_manifest, PURPOSE) : null;
      if (!content) {
        const chunks = [], secondHash = crypto.createHash('sha256'); let pending = Buffer.alloc(0), index = 0;
        const save = async bytes => { this.privacyVault.assertUnlocked(); const chunk = await encodeFileChunk(key, new Uint8Array(bytes), identity, digest, index++); await this.blobStore.put(chunk.hash, chunk.bytes); chunks.push(chunk.hash); };
        for await (const bytes of source.read()) {
          secondHash.update(bytes);
          pending = Buffer.concat([pending, bytes]);
          while (pending.length >= FILE_CHUNK_BYTES) { await save(pending.subarray(0, FILE_CHUNK_BYTES)); pending = pending.subarray(FILE_CHUNK_BYTES); }
        }
        if (pending.length) await save(pending);
        if (secondHash.digest('hex') !== digest) throw new Error('A file changed while being encrypted. Retry without replacing its prior manifest.');
        content = { size, digest, chunks };
        this.database.prepare('INSERT OR IGNORE INTO local_sync_file_content VALUES(?,?)').run(digest, this.privacyVault.encryptValue(content, PURPOSE));
      }
      if (fingerprint(file.path) !== stamp) throw new Error('A file changed during snapshotting. Its prior manifest was retained; retry synchronization.');
      this.queue(file.relative, { ...content, version: 1, path: file.relative, mimeType: source.mimeType, url: source.url, name: source.name || path.basename(file.path), kind: source.kind || 'file' }, stamp);
      progress({ completed: ++completed, total: files.length });
    }
    const present = new Set(files.map(file => file.relative));
    for (const prior of this.database.prepare('SELECT path,fingerprint FROM local_sync_file_index').all()) {
      if (!present.has(prior.path) && prior.fingerprint !== 'deleted') this.queue(prior.path, {}, 'deleted', 'delete');
    }
    return { files: files.length };
  }
}
module.exports = { VaultFileIndex, walkVault, PURPOSE, fingerprint };
