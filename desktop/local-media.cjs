'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MEDIA_HOST = 'library';
const MEDIA_SCHEME = 'bex-media:';
const FILE_NAME_PATTERN = /^image-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|gif|webp)$/i;
const IMAGE_FORMATS = Object.freeze({
  gif: Object.freeze({ extension: 'gif', mimeType: 'image/gif' }),
  jpg: Object.freeze({ extension: 'jpg', mimeType: 'image/jpeg' }),
  png: Object.freeze({ extension: 'png', mimeType: 'image/png' }),
  webp: Object.freeze({ extension: 'webp', mimeType: 'image/webp' }),
});

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function mediaPurpose(fileName) {
  return `bex:media:image:v1:${fileName}`;
}

function requireMediaFolder(libraryPath) {
  if (typeof libraryPath !== 'string' || !libraryPath.trim()) {
    throw codedError('BEX_MEDIA_LIBRARY_UNAVAILABLE', 'The Berean Library is unavailable.');
  }
  const libraryRoot = path.resolve(libraryPath);
  const mediaFolder = path.join(libraryRoot, 'Media');
  let stats;
  try {
    stats = fs.statSync(mediaFolder);
  } catch {
    throw codedError('BEX_MEDIA_LIBRARY_UNAVAILABLE', 'The Berean Library Media folder is unavailable.');
  }
  if (!stats.isDirectory()) {
    throw codedError('BEX_MEDIA_LIBRARY_UNAVAILABLE', 'The Berean Library Media folder is unavailable.');
  }
  return mediaFolder;
}

function toBuffer(value) {
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  throw codedError('BEX_MEDIA_INVALID', 'The selected image could not be read.');
}

function detectImageFormat(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]))) return IMAGE_FORMATS.png;
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return IMAGE_FORMATS.jpg;
  }
  if (bytes.length >= 6) {
    const signature = bytes.subarray(0, 6).toString('ascii');
    if (signature === 'GIF87a' || signature === 'GIF89a') return IMAGE_FORMATS.gif;
  }
  if (
    bytes.length >= 12
    && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return IMAGE_FORMATS.webp;
  throw codedError('BEX_MEDIA_INVALID', 'Choose a valid PNG, JPEG, GIF, or WebP image.');
}

function parseMediaUrl(mediaUrl) {
  let parsed;
  let fileName;
  try {
    parsed = new URL(mediaUrl);
    fileName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  } catch {
    throw codedError('BEX_MEDIA_INVALID', 'The local media reference is invalid.');
  }
  if (
    parsed.protocol !== MEDIA_SCHEME
    || parsed.hostname !== MEDIA_HOST
    || parsed.search
    || parsed.hash
    || !FILE_NAME_PATTERN.test(fileName)
    || path.basename(fileName) !== fileName
  ) {
    throw codedError('BEX_MEDIA_INVALID', 'The local media reference is invalid.');
  }
  return fileName;
}

function saveEncryptedImage({ libraryPath, privacyVault, payload }) {
  if (!privacyVault || typeof privacyVault.encryptBinary !== 'function') {
    throw codedError('BEX_PRIVACY_NOT_OPEN', 'The encrypted Berean Library vault is unavailable.');
  }
  if (!payload || typeof payload !== 'object') {
    throw codedError('BEX_MEDIA_INVALID', 'No image was provided.');
  }
  const bytes = Buffer.from(toBuffer(payload.bytes));
  try {
    if (bytes.length < 1 || bytes.length > MAX_IMAGE_BYTES) {
      throw codedError('BEX_MEDIA_TOO_LARGE', 'Images must be 10 MB or smaller.');
    }
    const format = detectImageFormat(bytes);
    if (
      payload.mimeType
      && payload.mimeType !== format.mimeType
      && !(format === IMAGE_FORMATS.jpg && payload.mimeType === 'image/jpg')
    ) {
      throw codedError('BEX_MEDIA_INVALID', 'The image contents do not match its file type.');
    }
    const mediaFolder = requireMediaFolder(libraryPath);
    const fileName = `image-${crypto.randomUUID()}.${format.extension}`;
    const destination = path.join(mediaFolder, fileName);
    const encrypted = privacyVault.encryptBinary(bytes, mediaPurpose(fileName));
    fs.writeFileSync(destination, encrypted, { flag: 'wx', mode: 0o600 });
    if (process.platform !== 'win32') fs.chmodSync(destination, 0o600);
    return Object.freeze({
      mimeType: format.mimeType,
      size: bytes.length,
      url: `${MEDIA_SCHEME}//${MEDIA_HOST}/${fileName}`,
    });
  } finally {
    bytes.fill(0);
  }
}

function readEncryptedMedia({ libraryPath, mediaUrl, privacyVault }) {
  if (!privacyVault || typeof privacyVault.decryptBinary !== 'function') {
    throw codedError('BEX_PRIVACY_NOT_OPEN', 'The encrypted Berean Library vault is unavailable.');
  }
  const fileName = parseMediaUrl(mediaUrl);
  const mediaFolder = requireMediaFolder(libraryPath);
  const encrypted = fs.readFileSync(path.join(mediaFolder, fileName));
  if (encrypted.length > MAX_IMAGE_BYTES + 64) {
    throw codedError('BEX_MEDIA_INVALID', 'The encrypted media file is invalid.');
  }
  const bytes = privacyVault.decryptBinary(encrypted, mediaPurpose(fileName));
  const format = detectImageFormat(bytes);
  if (!fileName.endsWith(`.${format.extension}`)) {
    bytes.fill(0);
    throw codedError('BEX_MEDIA_INVALID', 'The encrypted media file is invalid.');
  }
  return Object.freeze({ bytes, mimeType: format.mimeType });
}

function deleteEncryptedMedia({ libraryPath, mediaUrl, privacyVault }) {
  if (!privacyVault || typeof privacyVault.assertUnlocked !== 'function') {
    throw codedError('BEX_PRIVACY_NOT_OPEN', 'The encrypted Berean Library vault is unavailable.');
  }
  privacyVault.assertUnlocked();
  const fileName = parseMediaUrl(mediaUrl);
  const mediaFolder = requireMediaFolder(libraryPath);
  const targetPath = path.join(mediaFolder, fileName);
  try {
    fs.unlinkSync(targetPath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw codedError('BEX_MEDIA_NOT_FOUND', 'The encrypted image file no longer exists.');
    }
    throw error;
  }
  return Object.freeze({ deleted: true, url: mediaUrl });
}

module.exports = {
  MAX_IMAGE_BYTES,
  deleteEncryptedMedia,
  parseMediaUrl,
  readEncryptedMedia,
  saveEncryptedImage,
};
