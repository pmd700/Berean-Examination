'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { AttachmentExternalCopies, CHUNK_BYTES, parseAttachmentUrl, readEncryptedAttachment, saveEncryptedAttachment } = require('../desktop/local-attachments.cjs');
const { createLocalMediaResponse } = require('../desktop/local-media-protocol.cjs');
const { ATTACHMENT_CHANNELS, registerLocalAttachmentHandlers } = require('../desktop/local-attachments-ipc.cjs');
const { migrateLegacyImages, readEncryptedMedia, saveEncryptedImage } = require('../desktop/local-media.cjs');
const { MANIFEST_NAME, copyEncryptedMediaSnapshot, recoverInterruptedMediaRestore, restoreEncryptedMediaSnapshot, validateEncryptedMediaSnapshot } = require('../desktop/local-media-backup.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bex-attachment-test-'));
  const libraryPath = path.join(root, 'Vault');
  fs.mkdirSync(path.join(libraryPath, 'Media'), { recursive: true });
  fs.mkdirSync(path.join(libraryPath, 'Database'));
  const key = crypto.randomBytes(32);
  let locked = false;
  const privacyVault = {
    assertUnlocked() { if (locked) { const error = new Error('Locked'); error.code = 'BEX_PRIVACY_LOCKED'; throw error; } },
    lock() { locked = true; },
    encryptBinary(bytes, purpose) {
      this.assertUnlocked();
      const nonce = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(Buffer.from(purpose));
      const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
      return Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), encrypted]);
    },
    decryptBinary(bytes, purpose) {
      this.assertUnlocked();
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(1, 13));
      decipher.setAAD(Buffer.from(purpose)); decipher.setAuthTag(bytes.subarray(13, 29));
      return Buffer.concat([decipher.update(bytes.subarray(29)), decipher.final()]);
    },
  };
  const save = (name, bytes) => {
    const sourcePath = path.join(root, name); fs.writeFileSync(sourcePath, bytes);
    return saveEncryptedAttachment({ libraryPath, privacyVault, sourcePath });
  };
  const read = (mediaUrl, options = {}) => readEncryptedAttachment({ libraryPath, privacyVault, mediaUrl, ...options });
  return { root, libraryPath, privacyVault, save, read, cleanup: () => fs.rmSync(root, { force: true, recursive: true }) };
}

test('attachments keep private names and bytes encrypted, survive source removal, and support authenticated seeking across chunks', async () => {
  const f = fixture();
  try {
    const bytes = Buffer.alloc(CHUNK_BYTES * 2 + 19, 97); Buffer.from('%PDF-1.7 PRIVATE CONTENT').copy(bytes);
    const attachment = f.save('Private teaching notes.pdf', bytes);
    assert.equal(attachment.kind, 'pdf'); assert.equal(attachment.mimeType, 'application/pdf');
    fs.unlinkSync(path.join(f.root, attachment.name));
    const encryptedPath = path.join(f.libraryPath, 'Media', 'Documents', parseAttachmentUrl(attachment.url));
    const encrypted = fs.readFileSync(encryptedPath);
    assert.equal(encrypted.includes(Buffer.from(attachment.name)), false);
    assert.equal(encrypted.includes(Buffer.from('PRIVATE CONTENT')), false);
    assert.equal(fs.statSync(encryptedPath).mode & 0o777, 0o600);
    const range = `bytes=${CHUNK_BYTES - 3}-${CHUNK_BYTES + 5}`;
    const request = new Request(attachment.url, { headers: { Origin: 'http://127.0.0.1:3000', Range: range } });
    const response = await createLocalMediaResponse(request, f.read, 'http://127.0.0.1:3000');
    assert.equal(response.status, 206); assert.equal(response.headers.get('content-length'), '9');
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:3000');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(CHUNK_BYTES - 3, CHUNK_BYTES + 6));
    const head = await createLocalMediaResponse(new Request(attachment.url, { method: 'HEAD', headers: { Origin: 'http://127.0.0.1:3000' } }), f.read, 'http://127.0.0.1:3000');
    assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), String(bytes.length));
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    const outOfRange = await createLocalMediaResponse(new Request(attachment.url, { headers: { Origin: 'http://127.0.0.1:3000', Range: 'bytes=9999999-' } }), f.read, 'http://127.0.0.1:3000');
    assert.equal(outOfRange.status, 416);
    const untrusted = await createLocalMediaResponse(new Request(attachment.url, { headers: { Origin: 'https://outside.example' } }), f.read, 'http://127.0.0.1:3000');
    assert.equal(untrusted.status, 403);
    encrypted[encrypted.length - 1] ^= 1; fs.writeFileSync(encryptedPath, encrypted);
    await assert.rejects(new Response(f.read(attachment.url).body).arrayBuffer());
    f.privacyVault.lock();
    const locked = await createLocalMediaResponse(request, f.read, 'http://127.0.0.1:3000'); assert.equal(locked.status, 423);
  } finally { f.cleanup(); }
});

test('URLs, selected source paths, and snapshot trees reject traversal or symlinks', () => {
  const f = fixture();
  try {
    for (const url of ['file:///tmp/file.pdf', 'bex-media://library/../file.pdf', 'bex-media://user@library/file-11111111-1111-4111-8111-111111111111.pdf', 'bex-media://library/file-11111111-1111-4111-8111-111111111111.pdf?x=1', 'bex-media://library/%66ile-11111111-1111-4111-8111-111111111111.pdf']) assert.throws(() => parseAttachmentUrl(url));
    fs.writeFileSync(path.join(f.root, 'original.txt'), 'Hello'); fs.symlinkSync(path.join(f.root, 'original.txt'), path.join(f.root, 'alias.txt'));
    assert.throws(() => saveEncryptedAttachment({ libraryPath: f.libraryPath, privacyVault: f.privacyVault, sourcePath: path.join(f.root, 'alias.txt') }));
    const backupPath = path.join(f.root, 'backup.db'); fs.mkdirSync(`${backupPath}.media`); fs.symlinkSync(path.join(f.root, 'original.txt'), path.join(`${backupPath}.media`, 'escape'));
    assert.throws(() => validateEncryptedMediaSnapshot(backupPath), { code: 'BEX_BACKUP_MEDIA_INVALID' });
  } finally { f.cleanup(); }
});

test('external handoff preserves extensions, limits temporary file permissions, cleans up, and blocks scripts even when renamed', async () => {
  const f = fixture();
  try {
    const attachment = f.save(`${'a'.repeat(220)}.txt`, Buffer.from('Private handoff'));
    const tempRoot = path.join(f.root, 'Temp');
    const copies = new AttachmentExternalCopies({ tempRoot, readLocalMedia: f.read, assertUnlocked: () => f.privacyVault.assertUnlocked() });
    let handedPath;
    await copies.open(attachment.url, async (target) => { handedPath = target; return ''; });
    assert.equal(path.extname(handedPath), '.txt'); assert.equal(fs.readFileSync(handedPath, 'utf8'), 'Private handoff');
    assert.equal(fs.statSync(handedPath).mode & 0o777, 0o600); assert.equal(fs.statSync(tempRoot).mode & 0o777, 0o700);
    copies.cleanup(); assert.equal(fs.existsSync(handedPath), false);
    const script = f.save('renamed.txt', Buffer.from('#!/bin/sh\necho hello'));
    await assert.rejects(copies.open(script.url, async () => { throw new Error('Must not launch'); }), { code: 'BEX_ATTACHMENT_EXECUTABLE' });
    assert.deepEqual(fs.readdirSync(tempRoot), []);
    const executable = f.save('unsafe.command', Buffer.from('echo hello'));
    await assert.rejects(copies.open(executable.url, async () => ''), { code: 'BEX_ATTACHMENT_EXECUTABLE' });
  } finally { f.cleanup(); }
});

test('legacy image references retain their encryption purpose after organized migration and encrypted snapshots restore missing files', async () => {
  const f = fixture();
  try {
    const image = Buffer.from('89504e470d0a1a0a504f50554c4152494d414745', 'hex');
    const savedImage = saveEncryptedImage({ libraryPath: f.libraryPath, privacyVault: f.privacyVault, payload: { bytes: image } });
    const imageName = new URL(savedImage.url).pathname.slice(1);
    fs.renameSync(path.join(f.libraryPath, 'Media', 'Images', imageName), path.join(f.libraryPath, 'Media', imageName));
    migrateLegacyImages(f.libraryPath);
    assert.deepEqual(readEncryptedMedia({ libraryPath: f.libraryPath, privacyVault: f.privacyVault, mediaUrl: savedImage.url }).bytes, image);
    const attachment = f.save('Archive.txt', Buffer.from('Vault backup bytes'));
    const backupPath = path.join(f.root, 'backup.db');
    const copied = copyEncryptedMediaSnapshot({ libraryPath: f.libraryPath, destination: `${backupPath}.media` }); assert.equal(copied.fileCount, 2);
    fs.rmSync(path.join(f.libraryPath, 'Media'), { recursive: true }); fs.mkdirSync(path.join(f.libraryPath, 'Media'));
    assert.equal(restoreEncryptedMediaSnapshot({ backupPath, libraryPath: f.libraryPath }).fileCount, 2);
    assert.equal(Buffer.from(await new Response(f.read(attachment.url).body).arrayBuffer()).toString(), 'Vault backup bytes');
    assert.deepEqual(readEncryptedMedia({ libraryPath: f.libraryPath, privacyVault: f.privacyVault, mediaUrl: savedImage.url }).bytes, image);
  } finally { f.cleanup(); }
});

test('the picker runs only for trusted unlocked pages and multi-file failures roll back newly imported files', async () => {
  const handlers = new Map(); let picked = 0; let unlocked = true; const rolledBack = [];
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler), removeHandler: (channel) => handlers.delete(channel) };
  registerLocalAttachmentHandlers({ appUrl: 'http://127.0.0.1:3000', ipcMain,
    assertUnlocked: () => { if (!unlocked) { const error = new Error('Locked'); error.code = 'BEX_PRIVACY_LOCKED'; throw error; } },
    chooseFiles: async () => { picked += 1; return { canceled: false, filePaths: ['/first', '/second'] }; },
    saveLocalFile: (source) => { if (source === '/second') throw new Error('Unavailable'); return { url: 'new-file-url' }; },
    openLocalFile: async () => ({}), rollbackLocalFile: (url) => rolledBack.push(url),
  });
  const blocked = await handlers.get(ATTACHMENT_CHANNELS.import)({ senderFrame: { url: 'https://outside.example' } });
  assert.equal(blocked.code, 'BEX_UNTRUSTED_SENDER'); assert.equal(picked, 0);
  const trusted = { senderFrame: { url: 'http://127.0.0.1:3000/Notes' } };
  const failed = await handlers.get(ATTACHMENT_CHANNELS.import)(trusted); assert.equal(failed.ok, false); assert.deepEqual(rolledBack, ['new-file-url']);
  unlocked = false; const locked = await handlers.get(ATTACHMENT_CHANNELS.import)(trusted); assert.equal(locked.code, 'BEX_PRIVACY_LOCKED'); assert.equal(picked, 1);
});

test('snapshot checksums reject corrupt or incomplete companions and restore replaces corrupted live ciphertext', async () => {
  const f = fixture();
  try {
    const attachment = f.save('Private restored document.txt', Buffer.from('Recoverable private bytes'));
    const fileName = parseAttachmentUrl(attachment.url);
    const livePath = path.join(f.libraryPath, 'Media', 'Files', fileName);
    const backupPath = path.join(f.root, 'backup.db');
    copyEncryptedMediaSnapshot({ libraryPath: f.libraryPath, destination: `${backupPath}.media` });
    const manifest = fs.readFileSync(path.join(`${backupPath}.media`, MANIFEST_NAME), 'utf8');
    assert.equal(manifest.includes(attachment.name), false); assert.equal(manifest.includes('Recoverable private bytes'), false);
    fs.writeFileSync(livePath, 'Truncated live ciphertext');
    restoreEncryptedMediaSnapshot({ backupPath, libraryPath: f.libraryPath });
    assert.equal(Buffer.from(await new Response(f.read(attachment.url).body).arrayBuffer()).toString(), 'Recoverable private bytes');
    const snapshotFile = path.join(`${backupPath}.media`, 'Files', fileName);
    const ciphertext = fs.readFileSync(snapshotFile); ciphertext[ciphertext.length - 1] ^= 1; fs.writeFileSync(snapshotFile, ciphertext);
    const before = fs.readFileSync(livePath);
    assert.throws(() => restoreEncryptedMediaSnapshot({ backupPath, libraryPath: f.libraryPath }), { code: 'BEX_BACKUP_MEDIA_INVALID' });
    assert.deepEqual(fs.readFileSync(livePath), before);
    fs.unlinkSync(path.join(`${backupPath}.media`, MANIFEST_NAME));
    assert.throws(() => validateEncryptedMediaSnapshot(backupPath), { code: 'BEX_BACKUP_MEDIA_INVALID' });
    assert.equal(restoreEncryptedMediaSnapshot({ backupPath: path.join(f.root, 'legacy.db'), libraryPath: f.libraryPath }).fileCount, 0);
  } finally { f.cleanup(); }
});

test('a media restore transaction rolls changed existing files and newly created files back after later failure', () => {
  const f = fixture();
  try {
    const first = f.save('one.txt', Buffer.from('First snapshot file'));
    const second = f.save('two.txt', Buffer.from('Second snapshot file'));
    const firstPath = path.join(f.libraryPath, 'Media', 'Files', parseAttachmentUrl(first.url));
    const secondPath = path.join(f.libraryPath, 'Media', 'Files', parseAttachmentUrl(second.url));
    const backupPath = path.join(f.root, 'backup.db');
    copyEncryptedMediaSnapshot({ libraryPath: f.libraryPath, destination: `${backupPath}.media` });
    fs.writeFileSync(firstPath, 'Original before failed restore'); fs.unlinkSync(secondPath);
    const transaction = restoreEncryptedMediaSnapshot({ backupPath, libraryPath: f.libraryPath, deferCommit: true });
    assert.notEqual(fs.readFileSync(firstPath).toString(), 'Original before failed restore'); assert.equal(fs.existsSync(secondPath), true);
    transaction.rollback();
    assert.equal(fs.readFileSync(firstPath).toString(), 'Original before failed restore'); assert.equal(fs.existsSync(secondPath), false);
    assert.equal(fs.existsSync(path.join(f.libraryPath, 'Database', '.bex-media-restore-staging')), false);
    assert.equal(fs.existsSync(path.join(f.libraryPath, 'Database', '.bex-media-restore-state.json')), false);
  } finally { f.cleanup(); }
});

test('a failed atomic media swap restores every original ciphertext file', (t) => {
  const f = fixture();
  try {
    const first = f.save('one.txt', Buffer.from('First snapshot file'));
    const second = f.save('two.txt', Buffer.from('Second snapshot file'));
    const firstPath = path.join(f.libraryPath, 'Media', 'Files', parseAttachmentUrl(first.url));
    const secondPath = path.join(f.libraryPath, 'Media', 'Files', parseAttachmentUrl(second.url));
    const backupPath = path.join(f.root, 'backup.db');
    copyEncryptedMediaSnapshot({ libraryPath: f.libraryPath, destination: `${backupPath}.media` });
    fs.writeFileSync(firstPath, 'Original first file'); fs.writeFileSync(secondPath, 'Original second file');
    const rename = fs.renameSync;
    t.mock.method(fs, 'renameSync', (source, destination) => {
      if (path.basename(source) === 'new-1') { const error = new Error('Simulated disk failure'); error.code = 'EIO'; throw error; }
      return rename(source, destination);
    });
    assert.throws(() => restoreEncryptedMediaSnapshot({ backupPath, libraryPath: f.libraryPath }), { code: 'EIO' });
    assert.equal(fs.readFileSync(firstPath).toString(), 'Original first file'); assert.equal(fs.readFileSync(secondPath).toString(), 'Original second file');
    assert.equal(fs.existsSync(path.join(f.libraryPath, 'Database', '.bex-media-restore-state.json')), false);
  } finally { f.cleanup(); }
});

test('startup recovers media swaps with the pending database restore and cleans committed swaps without reverting them', () => {
  const f = fixture();
  try {
    const attachment = f.save('one.txt', Buffer.from('Snapshot file'));
    const livePath = path.join(f.libraryPath, 'Media', 'Files', parseAttachmentUrl(attachment.url));
    const backupPath = path.join(f.root, 'backup.db');
    copyEncryptedMediaSnapshot({ libraryPath: f.libraryPath, destination: `${backupPath}.media` });
    const snapshotBytes = fs.readFileSync(livePath);
    fs.writeFileSync(livePath, 'Current file before interrupted restore');
    restoreEncryptedMediaSnapshot({ backupPath, libraryPath: f.libraryPath, deferCommit: true });
    const pendingDatabaseJournal = path.join(f.libraryPath, 'Database', '.bex-restore-state.json'); fs.writeFileSync(pendingDatabaseJournal, '{}');
    assert.equal(recoverInterruptedMediaRestore(f.libraryPath).rolledBack, true);
    assert.equal(fs.readFileSync(livePath).toString(), 'Current file before interrupted restore');
    fs.unlinkSync(pendingDatabaseJournal);
    restoreEncryptedMediaSnapshot({ backupPath, libraryPath: f.libraryPath, deferCommit: true });
    assert.equal(recoverInterruptedMediaRestore(f.libraryPath).rolledBack, false);
    assert.deepEqual(fs.readFileSync(livePath), snapshotBytes);
  } finally { f.cleanup(); }
});
