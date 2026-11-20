'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { detectImageFormat, requireMediaCategory, requireMediaFolder } = require('./local-media.cjs');
const { parseByteRange } = require('./course-media-protocol.cjs');

const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024 * 1024;
const CHUNK_BYTES = 1024 * 1024;
const ENCRYPTION_OVERHEAD = 29;
const MAGIC = Buffer.from('BEXFILE1');
const FILE_PATTERN = /^file-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[a-z0-9]{1,20}$/;
const CATEGORY_FOR_KIND = Object.freeze({ pdf: 'Documents', audio: 'Audio', video: 'Video', image: 'Images', file: 'Files' });
const BLOCKED_EXTENSIONS = new Set(['app', 'exe', 'com', 'scr', 'msi', 'msp', 'bat', 'cmd', 'ps1', 'vbs', 'vbe', 'js', 'jse', 'cjs', 'mjs', 'wsf', 'wsh', 'hta', 'sh', 'bash', 'zsh', 'command', 'workflow', 'scpt', 'jar', 'dmg', 'pkg', 'lnk', 'url', 'desktop', 'reg', 'dll', 'so', 'dylib']);

function codedError(code, message) { const error = new Error(message); error.code = code; return error; }
function purpose(name, part) { return `bex:media:file:v1:${name}:${part}`; }

function parseAttachmentUrl(value) {
  if (typeof value !== 'string') throw codedError('BEX_ATTACHMENT_INVALID', 'Invalid attachment.');
  let parsed;
  try { parsed = new URL(value); } catch { throw codedError('BEX_ATTACHMENT_INVALID', 'Invalid attachment.'); }
  const name = parsed.pathname.slice(1);
  if (parsed.protocol !== 'bex-media:' || parsed.hostname !== 'library' || parsed.username || parsed.password
    || parsed.port || parsed.search || parsed.hash || !FILE_PATTERN.test(name)
    || value !== `bex-media://library/${name}`) {
    throw codedError('BEX_ATTACHMENT_INVALID', 'Invalid attachment.');
  }
  return name;
}

function classifyFile(bytes, extension) {
  const ascii = (start, end) => bytes.subarray(start, end).toString('ascii');
  if (ascii(0, 5) === '%PDF-') return { kind: 'pdf', mimeType: 'application/pdf' };
  try { const format = detectImageFormat(bytes); return { kind: 'image', mimeType: format.mimeType }; } catch { /* Other formats are attachments. */ }
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return { kind: 'audio', mimeType: 'audio/wav' };
  if (ascii(0, 4) === 'fLaC') return { kind: 'audio', mimeType: 'audio/flac' };
  if (ascii(0, 4) === 'OggS') return { kind: extension === 'ogv' ? 'video' : 'audio', mimeType: extension === 'ogv' ? 'video/ogg' : 'audio/ogg' };
  if (ascii(0, 3) === 'ID3' || (extension === 'mp3' && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return { kind: 'audio', mimeType: 'audio/mpeg' };
  if (extension === 'aac' && bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return { kind: 'audio', mimeType: 'audio/aac' };
  if (ascii(4, 8) === 'ftyp') {
    if (['m4a', 'm4b'].includes(extension)) return { kind: 'audio', mimeType: 'audio/mp4' };
    if (['mp4', 'm4v', 'mov'].includes(extension)) return { kind: 'video', mimeType: extension === 'mov' ? 'video/quicktime' : 'video/mp4' };
  }
  if (bytes.length >= 4 && bytes.readUInt32BE(0) === 0x1a45dfa3 && ['webm', 'weba'].includes(extension)) return { kind: extension === 'weba' ? 'audio' : 'video', mimeType: extension === 'weba' ? 'audio/webm' : 'video/webm' };
  return { kind: 'file', mimeType: 'application/octet-stream' };
}

function normalFileDescriptor(target) {
  const before = fs.lstatSync(target);
  if (!before.isFile() || before.isSymbolicLink()) throw codedError('BEX_ATTACHMENT_INVALID', 'Choose a regular file.');
  const fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  const after = fs.fstatSync(fd);
  if (!after.isFile() || before.ino !== after.ino || before.dev !== after.dev) {
    fs.closeSync(fd);
    throw codedError('BEX_ATTACHMENT_INVALID', 'The selected file changed during import.');
  }
  return { fd, stats: after };
}

function saveEncryptedAttachment({ libraryPath, privacyVault, sourcePath, storedName = null, originalName: suppliedOriginalName = null }) {
  privacyVault.assertUnlocked();
  if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) throw codedError('BEX_ATTACHMENT_INVALID', 'Choose a regular file.');
  const { fd, stats } = normalFileDescriptor(sourcePath);
  let output;
  let destination;
  const chunk = Buffer.alloc(CHUNK_BYTES);
  try {
    if (stats.size > MAX_ATTACHMENT_BYTES) throw codedError('BEX_ATTACHMENT_TOO_LARGE', 'Files must be 2 GB or smaller.');
    const extension = path.extname(sourcePath).slice(1).toLowerCase();
    const storedExtension = /^[a-z0-9]{1,20}$/.test(extension) ? extension : 'bin';
    const sampleSize = fs.readSync(fd, chunk, 0, Math.min(CHUNK_BYTES, stats.size), 0);
    const classification = classifyFile(chunk.subarray(0, sampleSize), storedExtension);
    const originalName = (suppliedOriginalName || path.basename(sourcePath)).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 255) || 'File';
    const name = storedName || `file-${crypto.randomUUID()}.${storedExtension}`;
    if (!FILE_PATTERN.test(name) || path.extname(name).slice(1) !== storedExtension) throw codedError('BEX_ATTACHMENT_INVALID', 'Invalid synchronized attachment name.');
    const metadata = { name: originalName, extension: storedExtension, size: stats.size, chunkBytes: CHUNK_BYTES, ...classification };
    const encryptedHeader = privacyVault.encryptBinary(Buffer.from(JSON.stringify(metadata)), purpose(name, 'metadata'));
    const header = Buffer.alloc(MAGIC.length + 4);
    MAGIC.copy(header); header.writeUInt32BE(encryptedHeader.length, MAGIC.length);
    destination = path.join(requireMediaCategory(libraryPath, CATEGORY_FOR_KIND[classification.kind]), name);
    output = fs.openSync(destination, 'wx', 0o600);
    fs.writeFileSync(output, header); fs.writeFileSync(output, encryptedHeader);
    for (let offset = 0, index = 0; offset < stats.size; offset += CHUNK_BYTES, index += 1) {
      const length = Math.min(CHUNK_BYTES, stats.size - offset);
      if (fs.readSync(fd, chunk, 0, length, offset) !== length) throw codedError('BEX_ATTACHMENT_INVALID', 'The selected file changed during import.');
      fs.writeFileSync(output, privacyVault.encryptBinary(chunk.subarray(0, length), purpose(name, `chunk:${index}`)));
      chunk.fill(0);
    }
    const finalStats = fs.fstatSync(fd);
    if (stats.size !== finalStats.size || stats.mtimeMs !== finalStats.mtimeMs) throw codedError('BEX_ATTACHMENT_INVALID', 'The selected file changed during import.');
    fs.fsyncSync(output);
    return Object.freeze({ url: `bex-media://library/${name}`, name: metadata.name, mimeType: metadata.mimeType, kind: metadata.kind, size: metadata.size });
  } catch (error) {
    if (destination && output !== undefined) try { fs.unlinkSync(destination); } catch { /* Failed imports leave no attachment. */ }
    throw error;
  } finally {
    chunk.fill(0); fs.closeSync(fd); if (output !== undefined) fs.closeSync(output);
  }
}

function locateAttachment(libraryPath, name) {
  const root = requireMediaFolder(libraryPath);
  for (const category of Object.values(CATEGORY_FOR_KIND)) {
    const folder = path.join(root, category);
    if (!fs.existsSync(folder)) continue;
    const folderStats = fs.lstatSync(folder);
    if (!folderStats.isDirectory() || folderStats.isSymbolicLink()) throw codedError('BEX_ATTACHMENT_INVALID', 'Invalid media folder.');
    const target = path.join(folder, name);
    if (fs.existsSync(target)) return target;
  }
  throw codedError('BEX_ATTACHMENT_NOT_FOUND', 'That file is no longer in the vault.');
}

function attachmentHeader({ libraryPath, privacyVault, mediaUrl }) {
  privacyVault.assertUnlocked();
  const name = parseAttachmentUrl(mediaUrl);
  const target = locateAttachment(libraryPath, name);
  const { fd, stats } = normalFileDescriptor(target);
  try {
    const header = Buffer.alloc(MAGIC.length + 4);
    if (fs.readSync(fd, header, 0, header.length, 0) !== header.length || !header.subarray(0, MAGIC.length).equals(MAGIC)) throw codedError('BEX_ATTACHMENT_INVALID', 'Invalid attachment.');
    const length = header.readUInt32BE(MAGIC.length);
    if (length < ENCRYPTION_OVERHEAD || length > 4096) throw codedError('BEX_ATTACHMENT_INVALID', 'Invalid attachment.');
    const encrypted = Buffer.alloc(length);
    if (fs.readSync(fd, encrypted, 0, length, header.length) !== length) throw codedError('BEX_ATTACHMENT_INVALID', 'Invalid attachment.');
    const plaintext = privacyVault.decryptBinary(encrypted, purpose(name, 'metadata'));
    let metadata;
    try { metadata = JSON.parse(plaintext.toString('utf8')); } finally { plaintext.fill(0); }
    if (!metadata || typeof metadata.name !== 'string' || metadata.name.length > 255
      || !CATEGORY_FOR_KIND[metadata.kind] || !Number.isSafeInteger(metadata.size) || metadata.size < 0 || metadata.size > MAX_ATTACHMENT_BYTES
      || metadata.chunkBytes !== CHUNK_BYTES || !/^[a-z0-9]{1,20}$/.test(metadata.extension)
      || !['application/pdf', 'application/octet-stream', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'audio/wav', 'audio/flac', 'audio/ogg', 'audio/mpeg', 'audio/aac', 'audio/mp4', 'audio/webm', 'video/mp4', 'video/quicktime', 'video/webm', 'video/ogg'].includes(metadata.mimeType)
      || stats.size !== header.length + length + metadata.size + Math.ceil(metadata.size / CHUNK_BYTES) * ENCRYPTION_OVERHEAD) {
      throw codedError('BEX_ATTACHMENT_INVALID', 'Invalid attachment.');
    }
    return { ...metadata, nameOnDisk: name, target, offset: header.length + length };
  } finally { fs.closeSync(fd); }
}

function* attachmentChunks(info, privacyVault, range) {
  privacyVault.assertUnlocked();
  const { fd } = normalFileDescriptor(info.target);
  try {
    if (info.size === 0) return;
    const start = range?.start ?? 0;
    const end = range?.end ?? info.size - 1;
    const first = Math.floor(start / CHUNK_BYTES);
    const last = Math.floor(end / CHUNK_BYTES);
    for (let index = first; index <= last; index += 1) {
      privacyVault.assertUnlocked();
      const chunkSize = Math.min(CHUNK_BYTES, info.size - index * CHUNK_BYTES);
      const encrypted = Buffer.alloc(chunkSize + ENCRYPTION_OVERHEAD);
      const position = info.offset + index * (CHUNK_BYTES + ENCRYPTION_OVERHEAD);
      if (fs.readSync(fd, encrypted, 0, encrypted.length, position) !== encrypted.length) throw codedError('BEX_ATTACHMENT_INVALID', 'Invalid attachment.');
      const bytes = privacyVault.decryptBinary(encrypted, purpose(info.nameOnDisk, `chunk:${index}`));
      try {
        const from = Math.max(0, start - index * CHUNK_BYTES);
        const to = Math.min(bytes.length, end - index * CHUNK_BYTES + 1);
        yield Buffer.from(bytes.subarray(from, to));
      } finally { bytes.fill(0); }
    }
  } finally { fs.closeSync(fd); }
}

function readEncryptedAttachment({ libraryPath, privacyVault, mediaUrl, range: rangeValue, head = false }) {
  const info = attachmentHeader({ libraryPath, privacyVault, mediaUrl });
  let range;
  try { range = parseByteRange(rangeValue, info.size); } catch { throw codedError('BEX_MEDIA_RANGE_INVALID', String(info.size)); }
  return { ...info, range, body: head ? null : Readable.toWeb(Readable.from(attachmentChunks(info, privacyVault, range))) };
}

function deleteEncryptedAttachment({ libraryPath, mediaUrl }) {
  const name = parseAttachmentUrl(mediaUrl);
  const target = locateAttachment(libraryPath, name);
  const stats = fs.lstatSync(target);
  if (!stats.isFile() || stats.isSymbolicLink()) throw codedError('BEX_ATTACHMENT_INVALID', 'Invalid attachment.');
  fs.unlinkSync(target);
  const folder = path.dirname(target);
  if (fs.readdirSync(folder).length === 0) fs.rmdirSync(folder);
}

function executableSignature(bytes) {
  const prefix = bytes.subarray(0, 4);
  return prefix.subarray(0, 2).toString('ascii') === 'MZ' || prefix.toString('hex') === '7f454c46'
    || ['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca'].includes(prefix.toString('hex'))
    || prefix.subarray(0, 2).toString('ascii') === '#!';
}

class AttachmentExternalCopies {
  constructor({ tempRoot, readLocalMedia, assertUnlocked }) {
    this.tempRoot = path.resolve(tempRoot); this.readLocalMedia = readLocalMedia; this.assertUnlocked = assertUnlocked;
    fs.mkdirSync(this.tempRoot, { recursive: true, mode: 0o700 });
    if (!fs.lstatSync(this.tempRoot).isDirectory() || fs.lstatSync(this.tempRoot).isSymbolicLink()) throw codedError('BEX_ATTACHMENT_INVALID', 'Invalid attachment temporary folder.');
    if (process.platform !== 'win32') fs.chmodSync(this.tempRoot, 0o700);
    this.generation = 0;
    this.cleanup();
  }
  cleanup() {
    this.generation += 1;
    for (const name of fs.readdirSync(this.tempRoot)) {
      if (/^open-[0-9a-f-]{36}$/.test(name)) fs.rmSync(path.join(this.tempRoot, name), { recursive: true, force: true });
    }
  }
  async open(mediaUrl, openPath) {
    this.assertUnlocked(); parseAttachmentUrl(mediaUrl);
    const generation = this.generation;
    const media = this.readLocalMedia(mediaUrl);
    if (BLOCKED_EXTENSIONS.has(media.extension)) {
      await media.body.cancel();
      throw codedError('BEX_ATTACHMENT_EXECUTABLE', 'BEX does not launch executable files or scripts.');
    }
    const folder = fs.mkdtempSync(path.join(this.tempRoot, 'open-'));
    // Replace mkdtemp's suffix with a stable UUID so startup cleanup recognizes only BEX-owned directories.
    const ownedFolder = path.join(this.tempRoot, `open-${crypto.randomUUID()}`);
    fs.renameSync(folder, ownedFolder);
    const displayStem = path.parse(path.basename(media.name)).name.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 180) || 'File';
    const name = `${displayStem}.${media.extension}`;
    const target = path.join(ownedFolder, name);
    const fd = fs.openSync(target, 'wx', 0o600);
    let first = true;
    try {
      const reader = media.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          this.assertUnlocked();
          const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
          try {
            if (first && executableSignature(bytes)) throw codedError('BEX_ATTACHMENT_EXECUTABLE', 'BEX does not launch executable files or scripts.');
            first = false; fs.writeFileSync(fd, bytes);
          } finally { bytes.fill(0); }
        }
      } finally { await reader.cancel(); }
      this.assertUnlocked();
      if (generation !== this.generation) throw codedError('BEX_PRIVACY_LOCKED', 'Unlock the vault before opening a file.');
      fs.fsyncSync(fd); fs.closeSync(fd);
      const error = await openPath(target);
      if (error) throw codedError('BEX_ATTACHMENT_OPEN_FAILED', 'Your system could not open that file.');
      return { opened: true };
    } catch (error) {
      try { fs.closeSync(fd); } catch { /* Already closed. */ }
      fs.rmSync(ownedFolder, { force: true, recursive: true });
      throw error;
    }
  }
}

module.exports = { AttachmentExternalCopies, CHUNK_BYTES, FILE_PATTERN, MAX_ATTACHMENT_BYTES, attachmentHeader, classifyFile, deleteEncryptedAttachment, parseAttachmentUrl, readEncryptedAttachment, saveEncryptedAttachment };
