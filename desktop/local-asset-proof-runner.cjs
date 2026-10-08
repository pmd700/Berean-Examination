'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, safeStorage } = require('electron');
const {
  closeDatabase,
  createLocalEntity,
  deleteLocalEntity,
  deleteLocalImage,
  initializeDatabase,
  listLocalEntities,
  readLocalMedia,
  saveLocalImage,
} = require('./database.cjs');
const { createSafeStorageProtector } = require('./privacy-vault.cjs');

const ASSET_NAME = 'DISPOSABLE-PRIVATE-ASSET-NAME.png';
const MEDIA_MARKER = 'DISPOSABLE-PRIVATE-ASSET-CONTENT';
const PROOF_IMAGE = Buffer.concat([
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  Buffer.from(MEDIA_MARKER, 'utf8'),
]);

function assertPlaintextAbsent(libraryPath) {
  for (const folderName of ['Database', 'Media']) {
    for (const fileName of fs.readdirSync(path.join(libraryPath, folderName))) {
      const filePath = path.join(libraryPath, folderName, fileName);
      if (!fs.statSync(filePath).isFile()) continue;
      const bytes = fs.readFileSync(filePath);
      assert.equal(bytes.includes(Buffer.from(ASSET_NAME)), false);
      assert.equal(bytes.includes(Buffer.from(MEDIA_MARKER)), false);
    }
  }
}

function createPhase(libraryPath, protector) {
  const opened = initializeDatabase(libraryPath, { privacyProtector: protector });
  assert.equal(opened.schemaVersion, 15);
  const media = saveLocalImage({
    bytes: PROOF_IMAGE,
    mimeType: 'image/png',
    name: ASSET_NAME,
  });
  const asset = createLocalEntity('Asset', {
    mime_type: media.mimeType,
    name: ASSET_NAME,
    size: media.size,
    url: media.url,
  });
  assert.equal(asset.id, 1);
  assert.equal(listLocalEntities('Asset', {}).length, 1);
  assert.throws(
    () => createLocalEntity('Asset', {
      mime_type: 'image/png',
      name: 'unsafe.png',
      size: 10,
      url: 'file:///tmp/unsafe.png',
    }),
    (error) => error?.code === 'BEX_MEDIA_INVALID',
  );
  closeDatabase();
  assertPlaintextAbsent(libraryPath);
  return [
    'schema 15 creates an encrypted Asset record beside an encrypted Media file',
    'Asset metadata and image bytes are absent from plaintext storage',
    'Asset records reject file paths outside the protected BEX Media protocol',
  ];
}

function reopenPhase(libraryPath, protector) {
  const opened = initializeDatabase(libraryPath, { privacyProtector: protector });
  assert.equal(opened.schemaVersion, 15);
  const assets = listLocalEntities('Asset', {});
  assert.equal(assets.length, 1);
  assert.equal(assets[0].name, ASSET_NAME);
  const media = readLocalMedia(assets[0].url);
  assert.deepEqual(media.bytes, PROOF_IMAGE);
  media.bytes.fill(0);

  deleteLocalEntity('Asset', assets[0].id);
  deleteLocalImage(assets[0].url);
  assert.equal(listLocalEntities('Asset', {}).length, 0);
  assert.equal(fs.readdirSync(path.join(libraryPath, 'Media')).length, 0);
  closeDatabase();
  return [
    'a second Electron launch reopens the exact Asset record and decrypts its image',
    'confirmed deletion removes both the SQLite record and encrypted Media file',
  ];
}

async function main() {
  const phase = process.argv[2];
  const libraryPath = path.resolve(process.argv[3] || '');
  assert.ok(phase === 'create' || phase === 'reopen');
  assert.ok(libraryPath);
  assert.equal(safeStorage.isEncryptionAvailable(), true);
  const protector = createSafeStorageProtector(safeStorage);
  const checks = phase === 'create'
    ? createPhase(libraryPath, protector)
    : reopenPhase(libraryPath, protector);
  process.stdout.write(`BEX_ASSET_PROOF ${JSON.stringify({ phase, checks })}\n`);
}

app.setName('BEX Launcher Official');
if (process.platform === 'darwin' && app.dock) app.dock.hide();
app.whenReady().then(async () => {
  try {
    await main();
    app.exit(0);
  } catch (error) {
    closeDatabase();
    process.stderr.write(`${error?.stack || error}\n`);
    app.exit(1);
  }
});
