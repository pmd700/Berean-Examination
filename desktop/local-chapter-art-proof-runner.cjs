'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, safeStorage } = require('electron');
const {
  CURRENT_SCHEMA_VERSION,
  closeDatabase,
  createLocalEntity,
  deleteLocalEntity,
  deleteLocalImage,
  initializeDatabase,
  listLocalEntities,
  readLocalMedia,
  saveLocalImage,
  updateLocalEntity,
} = require('./database.cjs');
const { createSafeStorageProtector } = require('./privacy-vault.cjs');

const FIRST_MARKER = 'DISPOSABLE-CHAPTER-ART-FIRST';
const SECOND_MARKER = 'DISPOSABLE-CHAPTER-ART-SECOND';
const image = (marker) => Buffer.concat([
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  Buffer.from(marker),
]);

function entry(chapterNumber, media, name = 'Genesis art') {
  return {
    book: 'Genesis',
    chapter_number: chapterNumber,
    cover_art_name: name,
    cover_art_opacity: 100,
    cover_art_scale: 100,
    cover_art_url: media.url,
    cover_art_x: 20,
    cover_art_y: 50,
    updated_date: '2026-07-26T12:00:00.000Z',
  };
}

function assertPlaintextAbsent(libraryPath) {
  for (const folderName of ['Database', 'Media']) {
    for (const fileName of fs.readdirSync(path.join(libraryPath, folderName))) {
      const filePath = path.join(libraryPath, folderName, fileName);
      if (!fs.statSync(filePath).isFile()) continue;
      const bytes = fs.readFileSync(filePath);
      for (const secret of [FIRST_MARKER, SECOND_MARKER, 'Genesis art']) {
        assert.equal(bytes.includes(Buffer.from(secret)), false);
      }
    }
  }
}

function createPhase(libraryPath, protector) {
  assert.equal(initializeDatabase(libraryPath, { privacyProtector: protector }).schemaVersion, CURRENT_SCHEMA_VERSION);
  const media = saveLocalImage({
    bytes: image(FIRST_MARKER),
    mimeType: 'image/png',
    name: 'genesis.png',
  });
  const catalog = createLocalEntity('ChapterArtCatalog', {
    entries: [entry(1, media), entry(2, media)],
  });
  assert.equal(catalog.entries.length, 2);
  assert.throws(
    () => createLocalEntity('ChapterArtCatalog', { entries: [] }),
    (error) => error?.code === 'BEX_ENTITY_INVALID',
  );
  closeDatabase();
  assertPlaintextAbsent(libraryPath);
  return [
    `schema ${CURRENT_SCHEMA_VERSION} saves one encrypted Chapter Art catalog with shared protected Media`,
    'duplicate catalogs are rejected and private artwork details remain absent from plaintext',
  ];
}

function reopenPhase(libraryPath, protector) {
  assert.equal(initializeDatabase(libraryPath, { privacyProtector: protector }).schemaVersion, CURRENT_SCHEMA_VERSION);
  const [catalog] = listLocalEntities('ChapterArtCatalog', {});
  assert.equal(catalog.entries.length, 2);
  const firstMedia = readLocalMedia(catalog.entries[0].cover_art_url);
  assert.deepEqual(firstMedia.bytes, image(FIRST_MARKER));
  firstMedia.bytes.fill(0);

  const replacementMedia = saveLocalImage({
    bytes: image(SECOND_MARKER),
    mimeType: 'image/png',
    name: 'replacement.png',
  });
  const replaced = updateLocalEntity('ChapterArtCatalog', catalog.id, {
    entries: [
      {
        ...catalog.entries[0],
        cover_art_name: 'Replacement',
        cover_art_opacity: 150,
        cover_art_url: replacementMedia.url,
        updated_date: '2026-07-26T13:00:00.000Z',
      },
      catalog.entries[1],
    ],
  });
  assert.equal(replaced.entries[0].cover_art_name, 'Replacement');
  assert.equal(replaced.entries[0].cover_art_opacity, 150);

  const removed = updateLocalEntity('ChapterArtCatalog', catalog.id, {
    entries: [replaced.entries[0]],
  });
  deleteLocalImage(catalog.entries[1].cover_art_url);
  assert.equal(removed.entries.length, 1);
  assert.throws(() => readLocalMedia(catalog.entries[1].cover_art_url));

  deleteLocalEntity('ChapterArtCatalog', catalog.id);
  deleteLocalImage(replacementMedia.url);
  assert.equal(listLocalEntities('ChapterArtCatalog', {}).length, 0);
  assert.equal(fs.readdirSync(path.join(libraryPath, 'Media')).length, 0);
  closeDatabase();
  return [
    'a second launch reopens and decrypts the exact Chapter Art catalog and image',
    'replacement settings save atomically while shared artwork remains until its final use is removed',
    'final removal deletes both catalog data and encrypted Media files',
  ];
}

async function main() {
  const phase = process.argv[2];
  const libraryPath = path.resolve(process.argv[3] || '');
  assert.ok(phase === 'create' || phase === 'reopen');
  assert.ok(libraryPath);
  const protector = createSafeStorageProtector(safeStorage);
  const checks = phase === 'create'
    ? createPhase(libraryPath, protector)
    : reopenPhase(libraryPath, protector);
  process.stdout.write(`BEX_CHAPTER_ART_PROOF ${JSON.stringify({ phase, checks })}\n`);
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
