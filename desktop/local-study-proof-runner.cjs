'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, safeStorage } = require('electron');
const {
  closeDatabase,
  createLocalEntity,
  deleteLocalEntity,
  getLocalEntity,
  initializeDatabase,
  importKnowledgeWebGraph,
  listLocalEntities,
  lockPrivacyVault,
  reorderLocalEntities,
  restoreKnowledgeWebGraph,
  unlockPrivacyAutomatically,
  updateLocalEntity,
} = require('./database.cjs');
const {
  buildBsbIndex,
  buildLsvIndex,
  readLocalBibleChapter,
} = require('./local-bible.cjs');
const {
  LOCAL_BIBLE_CHAPTER_CHANNEL,
  registerLocalBibleHandlers,
} = require('./local-bible-ipc.cjs');
const {
  LOCAL_ENTITY_CHANNELS,
  registerLocalEntityHandlers,
} = require('./local-entity-ipc.cjs');
const { createSafeStorageProtector } = require('./privacy-vault.cjs');

const APP_NAME = 'BEX Launcher Official';
const APP_URL = 'http://127.0.0.1:43119';
const BSB_NOTE = 'DISPOSABLE-ENCRYPTED-BSB-NOTE';
const BSB_CONTEXT = 'DISPOSABLE-ENCRYPTED-BSB-CONTEXT';
const BSB_ANNOTATION = 'DISPOSABLE-ENCRYPTED-BSB-ANNOTATION';
const LSV_APPLICATION = 'DISPOSABLE-ENCRYPTED-LSV-APPLICATION';
const LSV_HIGHLIGHT = '#BEX123';
const DRAWING_MARKER = 'DISPOSABLE-ENCRYPTED-DRAWING-STROKE';
const KEYWORD_MARKER = 'DISPOSABLE-ENCRYPTED-STUDY-KEYWORD';
const PRIVATE_MARKERS = [
  BSB_NOTE,
  BSB_CONTEXT,
  BSB_ANNOTATION,
  LSV_APPLICATION,
  LSV_HIGHLIGHT,
  DRAWING_MARKER,
  KEYWORD_MARKER,
];

function fakeIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      handlers.delete(channel);
    },
  };
}

function trustedEvent() {
  return { senderFrame: { url: `${APP_URL}/Study` } };
}

function registerHandlers() {
  const ipcMain = fakeIpcMain();
  registerLocalBibleHandlers({ appUrl: APP_URL, ipcMain, readLocalBibleChapter });
  registerLocalEntityHandlers({
    appUrl: APP_URL,
    createLocalEntity,
    deleteLocalEntity,
    getLocalEntity,
    ipcMain,
    importKnowledgeWebGraph,
    listLocalEntities,
    reorderLocalEntities,
    restoreKnowledgeWebGraph,
    updateLocalEntity,
  });
  return ipcMain.handlers;
}

function assertPrivatePlaintextAbsent(libraryPath) {
  const databaseFolder = path.join(libraryPath, 'Database');
  for (const fileName of fs.readdirSync(databaseFolder)) {
    const filePath = path.join(databaseFolder, fileName);
    if (!fs.statSync(filePath).isFile()) continue;
    const bytes = fs.readFileSync(filePath);
    for (const marker of PRIVATE_MARKERS) {
      assert.equal(
        bytes.includes(Buffer.from(marker, 'utf8')),
        false,
        `Private Study plaintext leaked into ${fileName}: ${marker}`,
      );
    }
  }
}

async function readChapter(handlers, version, book, chapter) {
  const response = await handlers.get(LOCAL_BIBLE_CHAPTER_CHANNEL)(
    trustedEvent(),
    { version, book, chapter },
  );
  assert.equal(response.ok, true);
  assert.equal(response.chapter.version, version);
  return response.chapter;
}

async function createRecord(handlers, entityType, value) {
  const response = await handlers.get(LOCAL_ENTITY_CHANNELS.create)(
    trustedEvent(),
    entityType,
    value,
  );
  assert.equal(response.ok, true, response.error);
  return response.record;
}

async function createPhase(libraryPath, protector) {
  const opened = initializeDatabase(libraryPath, { privacyProtector: protector });
  assert.equal(opened.schemaVersion, 15);
  assert.equal(opened.privacy.locked, false);
  const handlers = registerHandlers();

  const sourceFolder = path.resolve(__dirname, '..', 'attached_assets');
  const bsbIndex = buildBsbIndex(fs.readFileSync(
    path.join(sourceFolder, 'Berean_Standard_Bible_1775867344760.txt'),
    'utf8',
  ));
  const lsvIndex = buildLsvIndex(fs.readFileSync(
    path.join(sourceFolder, 'lsv_1775867344760.txt'),
    'utf8',
  ));
  const countRows = (index, omitSpecialSections = false) => [...index.entries()]
    .filter(([key]) => !omitSpecialSections || !key.endsWith('\u00000'))
    .reduce((total, [, text]) => total + text.split('\n').length, 0);
  assert.equal(bsbIndex.size, 1189);
  assert.equal(countRows(bsbIndex), 31102);
  assert.equal(lsvIndex.size, 1192);
  assert.equal(countRows(lsvIndex, true), 31103);

  const blockedBible = await handlers.get(LOCAL_BIBLE_CHAPTER_CHANNEL)(
    { senderFrame: { url: 'https://untrusted.example/Study' } },
    { version: 'BSB', book: 'Genesis', chapter: 1 },
  );
  assert.equal(blockedBible.ok, false);
  assert.equal(blockedBible.code, 'BEX_UNTRUSTED_SENDER');

  const bsb = await readChapter(handlers, 'BSB', 'Genesis', 1);
  const lsv = await readChapter(handlers, 'LSV', 'Genesis', 1);
  const bsbBlankVerseChapter = await readChapter(handlers, 'BSB', 'Matthew', 17);
  const lsvPhilippians = await readChapter(handlers, 'LSV', 'Philippians', 1);
  const lsvJames = await readChapter(handlers, 'LSV', 'James', 1);
  const lsvSong = await readChapter(handlers, 'LSV', 'Song of Solomon', 1);
  const lsvFirstJohn = await readChapter(handlers, 'LSV', '1 John', 1);
  assert.match(bsb.text, /^~1 In the beginning God created the heavens and the earth\./);
  assert.equal(bsb.text.includes('â€'), false);
  assert.match(lsv.text, /^~1 In \[the\] beginning God created the heavens and the earth,/);
  assert.equal(bsb.text.split('\n').length, 31);
  assert.equal(lsv.text.split('\n').length, 31);
  assert.match(bsbBlankVerseChapter.text, /(?:^|\n)~21 (?:\n|$)/);
  for (const uncommonBook of [lsvPhilippians, lsvJames, lsvSong, lsvFirstJohn]) {
    assert.match(uncommonBook.text, /^~1 /);
  }

  const bsbChapter = await createRecord(handlers, 'StudyChapter', {
    application: '',
    book: 'Genesis',
    chapter_number: 1,
    context: BSB_CONTEXT,
    notes: BSB_NOTE,
    raw_text: bsb.text,
    version: 'BSB',
  });
  const lsvChapter = await createRecord(handlers, 'StudyChapter', {
    application: LSV_APPLICATION,
    book: 'Genesis',
    chapter_number: 1,
    context: '',
    notes: '',
    raw_text: lsv.text,
    version: 'LSV',
  });
  assert.equal(bsbChapter.annotation_count, 0);
  assert.equal(lsvChapter.annotation_count, 0);

  const duplicateChapter = await handlers.get(LOCAL_ENTITY_CHANNELS.create)(
    trustedEvent(),
    'StudyChapter',
    { book: 'Genesis', chapter_number: 1, raw_text: bsb.text, version: 'BSB' },
  );
  assert.equal(duplicateChapter.ok, false);
  assert.equal(duplicateChapter.code, 'BEX_ENTITY_INVALID');

  const annotation = await createRecord(handlers, 'Annotation', {
    book: 'Genesis',
    chapter_number: 1,
    content: BSB_ANNOTATION,
    end_token_index: 4,
    end_verse: 1,
    selected_text: 'In the beginning God created',
    start_token_index: 0,
    start_verse: 1,
    version: 'BSB',
  });
  await createRecord(handlers, 'Drawing', {
    annotation_id: annotation.id,
    height: 800,
    strokes_json: JSON.stringify({ marker: DRAWING_MARKER, strokes: [] }),
    width: 1200,
  });
  await createRecord(handlers, 'TextHighlight', {
    book: 'Genesis',
    chapter_number: 1,
    color: LSV_HIGHLIGHT,
    end_token_index: 5,
    end_verse: 1,
    start_token_index: 0,
    start_verse: 1,
    version: 'LSV',
  });
  await createRecord(handlers, 'Keyword', {
    category: 'Proof',
    explanation: `<p>${KEYWORD_MARKER}</p>`,
    title: KEYWORD_MARKER,
  });
  await createRecord(handlers, 'DailyActivity', {
    annotations_created: 1,
    chapters_completed: 2,
    date: '2026-07-23',
    verses_studied: 62,
  });

  const updatedChapter = await handlers.get(LOCAL_ENTITY_CHANNELS.update)(
    trustedEvent(),
    'StudyChapter',
    bsbChapter.id,
    { annotation_count: 1 },
  );
  assert.equal(updatedChapter.ok, true);
  assert.equal(updatedChapter.record.notes, BSB_NOTE);
  assert.equal(updatedChapter.record.annotation_count, 1);

  lockPrivacyVault();
  const lockedRead = await handlers.get(LOCAL_ENTITY_CHANNELS.list)(
    trustedEvent(),
    'StudyChapter',
    {},
  );
  assert.equal(lockedRead.ok, false);
  assert.equal(lockedRead.code, 'BEX_PRIVACY_LOCKED');
  unlockPrivacyAutomatically();

  closeDatabase();
  assertPrivatePlaintextAbsent(libraryPath);
  return [
    'trusted local bridge reads BSB and LSV without Internet',
    'all 1,189 chapters and every BSB/LSV source verse are indexed',
    'blank BSB verse slots and uncommon LSV abbreviations remain reachable',
    'untrusted pages cannot read packaged Bible files',
    'BSB typography is repaired before display',
    'both translations save as distinct encrypted Study chapters',
    'duplicate chapter records are rejected',
    'notes, context, application, annotation, highlight, drawing, keyword, and progress save locally',
    'partial updates preserve untouched encrypted chapter fields',
    'privacy lock blocks Study reads',
    'SQLite and WAL files contain no private Study plaintext',
  ];
}

async function reopenPhase(libraryPath, protector) {
  const reopened = initializeDatabase(libraryPath, { privacyProtector: protector });
  assert.equal(reopened.schemaVersion, 15);
  assert.equal(reopened.privacy.created, false);
  const handlers = registerHandlers();

  const chapters = await handlers.get(LOCAL_ENTITY_CHANNELS.list)(
    trustedEvent(),
    'StudyChapter',
    { sort: 'version' },
  );
  assert.equal(chapters.ok, true);
  assert.equal(chapters.records.length, 2);
  const bsb = chapters.records.find((record) => record.version === 'BSB');
  const lsv = chapters.records.find((record) => record.version === 'LSV');
  assert.equal(bsb.notes, BSB_NOTE);
  assert.equal(bsb.context, BSB_CONTEXT);
  assert.equal(bsb.annotation_count, 1);
  assert.equal(lsv.application, LSV_APPLICATION);

  for (const [entityType, expectedCount] of [
    ['Annotation', 1],
    ['Drawing', 1],
    ['TextHighlight', 1],
    ['Keyword', 1],
    ['DailyActivity', 1],
  ]) {
    const response = await handlers.get(LOCAL_ENTITY_CHANNELS.list)(trustedEvent(), entityType, {});
    assert.equal(response.ok, true);
    assert.equal(response.records.length, expectedCount);
  }

  const deletedBsb = await handlers.get(LOCAL_ENTITY_CHANNELS.delete)(
    trustedEvent(),
    'StudyChapter',
    bsb.id,
  );
  assert.equal(deletedBsb.ok, true);
  for (const entityType of ['Annotation', 'Drawing']) {
    const response = await handlers.get(LOCAL_ENTITY_CHANNELS.list)(trustedEvent(), entityType, {});
    assert.equal(response.ok, true);
    assert.equal(response.records.length, 0);
  }
  const survivingHighlights = await handlers.get(LOCAL_ENTITY_CHANNELS.list)(
    trustedEvent(),
    'TextHighlight',
    {},
  );
  assert.equal(survivingHighlights.records.length, 1);
  const survivingChapters = await handlers.get(LOCAL_ENTITY_CHANNELS.list)(
    trustedEvent(),
    'StudyChapter',
    {},
  );
  assert.equal(survivingChapters.records.length, 1);
  assert.equal(survivingChapters.records[0].version, 'LSV');

  closeDatabase();
  assertPrivatePlaintextAbsent(libraryPath);
  return [
    'second Electron launch reopens both local translations and all private Study records',
    'BSB notes, context, annotation count, and LSV application survive restart',
    'deleting one studied chapter removes only its annotation and drawing children',
    'the other translation and its highlight remain untouched',
    'post-restart SQLite files still contain no private Study plaintext',
  ];
}

async function main() {
  const phase = process.argv[2];
  const libraryPath = path.resolve(process.argv[3] || '');
  assert.ok(phase === 'create' || phase === 'reopen', 'Unknown Study proof phase.');
  assert.ok(libraryPath, 'The disposable Berean Library path is required.');
  assert.equal(safeStorage.isEncryptionAvailable(), true, 'macOS protected storage is unavailable.');
  const protector = createSafeStorageProtector(safeStorage);
  const checks = phase === 'create'
    ? await createPhase(libraryPath, protector)
    : await reopenPhase(libraryPath, protector);
  process.stdout.write(`BEX_STUDY_PROOF ${JSON.stringify({ checks, phase })}\n`);
}

app.setName(APP_NAME);
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
