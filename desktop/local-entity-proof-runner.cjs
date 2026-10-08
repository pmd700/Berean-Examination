'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  app,
  net,
  protocol,
  safeStorage,
} = require('electron');
const {
  closeDatabase,
  createLocalEntity,
  deleteLocalImage,
  deleteLocalEntity,
  getLocalEntity,
  initializeDatabase,
  importKnowledgeWebGraph,
  listLocalEntities,
  lockPrivacyVault,
  readLocalMedia,
  reorderLocalEntities,
  restoreKnowledgeWebGraph,
  saveLocalImage,
  unlockPrivacyAutomatically,
  updateLocalEntity,
} = require('./database.cjs');
const {
  LOCAL_ENTITY_CHANNELS,
  registerLocalEntityHandlers,
} = require('./local-entity-ipc.cjs');
const {
  registerLocalMediaHandlers,
  SAVE_IMAGE_CHANNEL,
} = require('./local-media-ipc.cjs');
const {
  registerLocalMediaProtocol,
  registerLocalMediaScheme,
} = require('./local-media-protocol.cjs');
const { createSafeStorageProtector } = require('./privacy-vault.cjs');

const APP_NAME = 'BEX Launcher Official';
const APP_URL = 'http://127.0.0.1:43119';
const ORIGINAL_TITLE = 'DISPOSABLE-KNOWLEDGE-WEB-PLAINTEXT-TITLE';
const UPDATED_TITLE = 'DISPOSABLE-KNOWLEDGE-WEB-UPDATED-TITLE';
const PRIVATE_NOTE = 'DISPOSABLE-PRIVATE-KNOWLEDGE-WEB-NOTE';
const OTHER_WEB_TITLE = 'DISPOSABLE-OTHER-KNOWLEDGE-WEB';
const CARD_TITLE = 'DISPOSABLE-WEB-CARD-TITLE';
const UPDATED_CARD_TITLE = 'DISPOSABLE-WEB-CARD-UPDATED-TITLE';
const SECOND_CARD_TITLE = 'DISPOSABLE-SECOND-WEB-CARD';
const CONNECTION_LABEL = 'DISPOSABLE-WEB-CONNECTION-LABEL';
const CANVAS_TITLE = 'DISPOSABLE-CANVAS-SECTION-TITLE';
const FOLDER_NAME = 'DISPOSABLE-KNOWLEDGE-WEB-FOLDER';
const RENAMED_FOLDER_NAME = 'DISPOSABLE-RENAMED-WEB-FOLDER';
const OTHER_FOLDER_NAME = 'DISPOSABLE-OTHER-WEB-FOLDER';
const TIMEGRAPH_TITLE = 'DISPOSABLE-FOLDERED-TIMEGRAPH';
const STUDY_NOTE = 'DISPOSABLE-FOLDERED-STUDY-NOTE';
const NOTE_TITLE = 'DISPOSABLE-MIND-NOTE-TITLE';
const UPDATED_NOTE_TITLE = 'DISPOSABLE-MIND-NOTE-UPDATED-TITLE';
const NOTE_CONTENT = 'DISPOSABLE-PRIVATE-MIND-NOTE-CONTENT';
const OTHER_NOTE_TITLE = 'DISPOSABLE-OTHER-MIND-NOTE';
const LINK_LABEL = 'DISPOSABLE-MIND-LINK-LABEL';
const VERSION_LABEL = 'DISPOSABLE-KNOWLEDGE-WEB-VERSION';
const BRAIN_SOURCE_TITLE = 'DISPOSABLE-SECOND-BRAIN-SOURCE-TITLE';
const UPDATED_BRAIN_SOURCE_TITLE = 'DISPOSABLE-UPDATED-BRAIN-SOURCE-TITLE';
const BRAIN_SOURCE_TEXT = 'DISPOSABLE-PRIVATE-SECOND-BRAIN-RAW-TEXT';
const OTHER_BRAIN_SOURCE_TITLE = 'DISPOSABLE-OTHER-SECOND-BRAIN-SOURCE';
const OTHER_BRAIN_SOURCE_TEXT = 'DISPOSABLE-OTHER-SECOND-BRAIN-RAW-TEXT';
const MEDIA_MARKER = 'DISPOSABLE-ENCRYPTED-LOCAL-IMAGE-CONTENT';
const PROOF_IMAGE = Buffer.concat([
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  Buffer.from(MEDIA_MARKER, 'utf8'),
]);
const PLAINTEXT_SECRETS = [
  ORIGINAL_TITLE,
  UPDATED_TITLE,
  PRIVATE_NOTE,
  OTHER_WEB_TITLE,
  CARD_TITLE,
  UPDATED_CARD_TITLE,
  SECOND_CARD_TITLE,
  CONNECTION_LABEL,
  CANVAS_TITLE,
  FOLDER_NAME,
  RENAMED_FOLDER_NAME,
  OTHER_FOLDER_NAME,
  TIMEGRAPH_TITLE,
  STUDY_NOTE,
  NOTE_TITLE,
  UPDATED_NOTE_TITLE,
  NOTE_CONTENT,
  OTHER_NOTE_TITLE,
  LINK_LABEL,
  VERSION_LABEL,
  BRAIN_SOURCE_TITLE,
  UPDATED_BRAIN_SOURCE_TITLE,
  BRAIN_SOURCE_TEXT,
  OTHER_BRAIN_SOURCE_TITLE,
  OTHER_BRAIN_SOURCE_TEXT,
  MEDIA_MARKER,
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
  return { senderFrame: { url: `${APP_URL}/KnowledgeWeb` } };
}

function assertPlaintextAbsent(libraryPath) {
  for (const folderName of ['Database', 'Media']) {
    const folderPath = path.join(libraryPath, folderName);
    const files = fs.readdirSync(folderPath);
    for (const fileName of files) {
      const filePath = path.join(folderPath, fileName);
      if (!fs.statSync(filePath).isFile()) continue;
      const bytes = fs.readFileSync(filePath);
      for (const secret of PLAINTEXT_SECRETS) {
        assert.equal(
          bytes.includes(Buffer.from(secret, 'utf8')),
          false,
          `${folderName} exposed plaintext in ${fileName}: ${secret}`,
        );
      }
    }
  }
}

function registerRealHandlers() {
  const ipcMain = fakeIpcMain();
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
  registerLocalMediaHandlers({
    appUrl: APP_URL,
    deleteLocalImage,
    ipcMain,
    saveLocalImage,
  });
  return ipcMain.handlers;
}

async function createPhase(libraryPath, protector) {
  const opened = initializeDatabase(libraryPath, { privacyProtector: protector });
  assert.equal(opened.schemaVersion, 15);
  assert.equal(opened.privacy.locked, false);
  const handlers = registerRealHandlers();
  registerLocalMediaProtocol({ protocol, readLocalMedia });

  const blockedMedia = await handlers.get(SAVE_IMAGE_CHANNEL)(
    { senderFrame: { url: 'https://untrusted.example/KnowledgeWeb' } },
    { bytes: PROOF_IMAGE, mimeType: 'image/png' },
  );
  assert.equal(blockedMedia.ok, false);
  assert.equal(blockedMedia.code, 'BEX_UNTRUSTED_SENDER');

  const invalidMedia = await handlers.get(SAVE_IMAGE_CHANNEL)(trustedEvent(), {
    bytes: new TextEncoder().encode('not an image'),
    mimeType: 'image/png',
  });
  assert.equal(invalidMedia.ok, false);
  assert.equal(invalidMedia.code, 'BEX_MEDIA_INVALID');

  const mediaResponse = await handlers.get(SAVE_IMAGE_CHANNEL)(trustedEvent(), {
    bytes: PROOF_IMAGE,
    mimeType: 'image/png',
    name: 'proof.png',
  });
  assert.equal(mediaResponse.ok, true);
  assert.match(mediaResponse.media.url, /^bex-media:\/\/library\/image-[0-9a-f-]+\.png$/);
  const openedMedia = readLocalMedia(mediaResponse.media.url);
  assert.deepEqual(openedMedia.bytes, PROOF_IMAGE);
  openedMedia.bytes.fill(0);
  const displayedMediaResponse = await net.fetch(mediaResponse.media.url);
  assert.equal(displayedMediaResponse.status, 200);
  assert.equal(displayedMediaResponse.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await displayedMediaResponse.arrayBuffer()), PROOF_IMAGE);
  assert.throws(
    () => readLocalMedia('bex-media://library/../../outside.png'),
    (error) => error?.code === 'BEX_MEDIA_INVALID',
  );

  const blocked = await handlers.get(LOCAL_ENTITY_CHANNELS.list)(
    { senderFrame: { url: 'https://untrusted.example/KnowledgeWeb' } },
    'KnowledgeWeb',
    {},
  );
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'BEX_UNTRUSTED_SENDER');

  const createdWebResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.create)(
    trustedEvent(),
    'KnowledgeWeb',
    {
      title: ORIGINAL_TITLE,
      graph_data: JSON.stringify({ note: PRIVATE_NOTE }),
      is_private: true,
      tags: ['proof', 'encrypted'],
    },
  );
  assert.equal(createdWebResponse.ok, true);
  assert.equal(createdWebResponse.record.id, 1);
  assert.equal(createdWebResponse.record.title, ORIGINAL_TITLE);

  const otherWebResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.create)(
    trustedEvent(),
    'KnowledgeWeb',
    { title: OTHER_WEB_TITLE },
  );
  assert.equal(otherWebResponse.ok, true);
  assert.equal(otherWebResponse.record.id, 2);

  const brainSourceResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.create)(
    trustedEvent(),
    'BrainSource',
    {
      web_id: createdWebResponse.record.id,
      title: BRAIN_SOURCE_TITLE,
      source_type: 'note',
      source_url: 'https://example.test/private-source',
      raw_text: BRAIN_SOURCE_TEXT,
      metadata_json: { author: 'Local Owner', tags: ['manual', 'proof'] },
    },
  );
  assert.equal(brainSourceResponse.ok, true);
  assert.equal(brainSourceResponse.record.processing_status, 'unprocessed');
  assert.equal(brainSourceResponse.record.processed_at, null);

  const otherBrainSourceResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.create)(
    trustedEvent(),
    'BrainSource',
    {
      web_id: createdWebResponse.record.id,
      title: OTHER_BRAIN_SOURCE_TITLE,
      source_type: 'article',
      raw_text: OTHER_BRAIN_SOURCE_TEXT,
    },
  );
  assert.equal(otherBrainSourceResponse.ok, true);

  const invalidBrainParent = await handlers.get(LOCAL_ENTITY_CHANNELS.create)(
    trustedEvent(),
    'BrainSource',
    { web_id: 999, title: 'INVALID', source_type: 'note', raw_text: 'must fail' },
  );
  assert.equal(invalidBrainParent.ok, false);
  assert.equal(invalidBrainParent.code, 'BEX_ENTITY_INVALID');

  const updatedBrainSource = await handlers.get(LOCAL_ENTITY_CHANNELS.update)(
    trustedEvent(),
    'BrainSource',
    brainSourceResponse.record.id,
    { title: UPDATED_BRAIN_SOURCE_TITLE, metadata_json: { author: 'Local Owner' } },
  );
  assert.equal(updatedBrainSource.ok, true);
  assert.equal(updatedBrainSource.record.raw_text, BRAIN_SOURCE_TEXT);

  for (const forbiddenPatch of [
    { raw_text: 'MUTATION-MUST-FAIL' },
    { processing_status: 'processing' },
  ]) {
    const forbiddenBrainUpdate = await handlers.get(LOCAL_ENTITY_CHANNELS.update)(
      trustedEvent(),
      'BrainSource',
      brainSourceResponse.record.id,
      forbiddenPatch,
    );
    assert.equal(forbiddenBrainUpdate.ok, false);
    assert.equal(forbiddenBrainUpdate.code, 'BEX_ENTITY_INVALID');
  }

  const folderResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.create)(
    trustedEvent(),
    'WebFolder',
    { name: FOLDER_NAME },
  );
  const otherFolderResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.create)(
    trustedEvent(),
    'WebFolder',
    { name: OTHER_FOLDER_NAME },
  );
  assert.equal(folderResponse.ok, true);
  assert.equal(otherFolderResponse.ok, true);
  assert.equal(Number.isSafeInteger(folderResponse.record.sort_order), true);

  const folderedTimegraphResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.create)(
    trustedEvent(),
    'Timegraph',
    { title: TIMEGRAPH_TITLE, description: '', events: [], view: null, folder_id: folderResponse.record.id },
  );
  const folderedStudyResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.create)(
    trustedEvent(),
    'StudyChapter',
    {
      book: 'Genesis',
      chapter_number: 1,
      version: 'BSB',
      annotation_count: 0,
      notes: STUDY_NOTE,
      folder_id: folderResponse.record.id,
    },
  );
  assert.equal(folderedTimegraphResponse.ok, true);
  assert.equal(folderedStudyResponse.ok, true);

  const renamedFolderResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.update)(
    trustedEvent(),
    'WebFolder',
    folderResponse.record.id,
    { name: RENAMED_FOLDER_NAME },
  );
  assert.equal(renamedFolderResponse.ok, true);

  const reorderedFoldersResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.reorder)(
    trustedEvent(),
    'WebFolder',
    [otherFolderResponse.record.id, folderResponse.record.id],
    null,
  );
  assert.equal(reorderedFoldersResponse.ok, true);
  assert.deepEqual(
    reorderedFoldersResponse.records.map((record) => record.id),
    [otherFolderResponse.record.id, folderResponse.record.id],
  );

  const firstFolderMoveResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.reorder)(
    trustedEvent(),
    'KnowledgeWeb',
    [createdWebResponse.record.id],
    folderResponse.record.id,
  );
  assert.equal(firstFolderMoveResponse.ok, true);

  const reorderedWebsResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.reorder)(
    trustedEvent(),
    'KnowledgeWeb',
    [otherWebResponse.record.id, createdWebResponse.record.id],
    folderResponse.record.id,
  );
  assert.equal(reorderedWebsResponse.ok, true);
  assert.deepEqual(
    reorderedWebsResponse.records.map((record) => [record.id, record.folder_id, record.sort_order]),
    [
      [otherWebResponse.record.id, folderResponse.record.id, 0],
      [createdWebResponse.record.id, folderResponse.record.id, 1],
    ],
  );

  const incompleteOrderResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.reorder)(
    trustedEvent(),
    'KnowledgeWeb',
    [createdWebResponse.record.id],
    folderResponse.record.id,
  );
  assert.equal(incompleteOrderResponse.ok, false);
  assert.equal(incompleteOrderResponse.code, 'BEX_ENTITY_INVALID');

  const noteResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.create)(
    trustedEvent(),
    'MindNote',
    { title: NOTE_TITLE, content: NOTE_CONTENT, tags: ['proof'] },
  );
  const otherNoteResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.create)(
    trustedEvent(),
    'MindNote',
    { title: OTHER_NOTE_TITLE, content: '' },
  );
  assert.equal(noteResponse.ok, true);
  assert.equal(otherNoteResponse.ok, true);

  const updatedNoteResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.update)(
    trustedEvent(),
    'MindNote',
    noteResponse.record.id,
    { title: UPDATED_NOTE_TITLE, color: 'violet' },
  );
  assert.equal(updatedNoteResponse.ok, true);
  assert.equal(updatedNoteResponse.record.content, NOTE_CONTENT);

  const webLinkResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.create)(
    trustedEvent(),
    'MindLink',
    {
      from_type: 'note',
      from_id: noteResponse.record.id,
      to_type: 'web',
      to_id: createdWebResponse.record.id,
    },
  );
  const noteLinkResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.create)(
    trustedEvent(),
    'MindLink',
    {
      from_type: 'note',
      from_id: noteResponse.record.id,
      to_type: 'note',
      to_id: otherNoteResponse.record.id,
    },
  );
  assert.equal(webLinkResponse.ok, true);
  assert.equal(noteLinkResponse.ok, true);

  const labeledLinkResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.update)(
    trustedEvent(),
    'MindLink',
    webLinkResponse.record.id,
    { label: LINK_LABEL },
  );
  assert.equal(labeledLinkResponse.ok, true);

  const selfLinkResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.create)(
    trustedEvent(),
    'MindLink',
    {
      from_type: 'note',
      from_id: noteResponse.record.id,
      to_type: 'note',
      to_id: noteResponse.record.id,
    },
  );
  assert.equal(selfLinkResponse.ok, false);
  assert.equal(selfLinkResponse.code, 'BEX_ENTITY_INVALID');

  const repointedLinkResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.update)(
    trustedEvent(),
    'MindLink',
    webLinkResponse.record.id,
    { to_id: otherWebResponse.record.id },
  );
  assert.equal(repointedLinkResponse.ok, false);
  assert.equal(repointedLinkResponse.code, 'BEX_ENTITY_INVALID');

  const firstNoteMoveResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.reorder)(
    trustedEvent(),
    'MindNote',
    [noteResponse.record.id],
    folderResponse.record.id,
  );
  assert.equal(firstNoteMoveResponse.ok, true);

  const reorderedNotesResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.reorder)(
    trustedEvent(),
    'MindNote',
    [otherNoteResponse.record.id, noteResponse.record.id],
    folderResponse.record.id,
  );
  assert.equal(reorderedNotesResponse.ok, true);
  assert.deepEqual(
    reorderedNotesResponse.records.map((record) => [record.id, record.folder_id, record.sort_order]),
    [[2, 1, 0], [1, 1, 1]],
  );

  const incompleteNoteOrder = await handlers.get(LOCAL_ENTITY_CHANNELS.reorder)(
    trustedEvent(),
    'MindNote',
    [noteResponse.record.id],
    folderResponse.record.id,
  );
  assert.equal(incompleteNoteOrder.ok, false);
  assert.equal(incompleteNoteOrder.code, 'BEX_ENTITY_INVALID');

  const orphanResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.create)(
    trustedEvent(),
    'WebCard',
    { web_id: 999, title: 'ORPHAN-MUST-NOT-SAVE' },
  );
  assert.equal(orphanResponse.ok, false);
  assert.equal(orphanResponse.code, 'BEX_ENTITY_INVALID');

  const missingSourceCard = await handlers.get(LOCAL_ENTITY_CHANNELS.create)(
    trustedEvent(),
    'WebCard',
    { web_id: 1, title: 'INVALID-SOURCE-CARD', source_ids: [999] },
  );
  assert.equal(missingSourceCard.ok, false);
  assert.equal(missingSourceCard.code, 'BEX_ENTITY_INVALID');

  const firstCardResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.create)(
    trustedEvent(),
    'WebCard',
    {
      web_id: 1,
      title: CARD_TITLE,
      description: PRIVATE_NOTE,
      image_url: mediaResponse.media.url,
      source_ids: [brainSourceResponse.record.id],
      x: 100,
      y: 150,
    },
  );
  assert.equal(firstCardResponse.ok, true);
  assert.equal(firstCardResponse.record.web_id, 1);

  const secondCardResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.create)(
    trustedEvent(),
    'WebCard',
    {
      web_id: 1,
      title: SECOND_CARD_TITLE,
      source_ids: [otherBrainSourceResponse.record.id],
      x: 420,
      y: 150,
    },
  );
  assert.equal(secondCardResponse.ok, true);

  const otherWebCardResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.create)(
    trustedEvent(),
    'WebCard',
    { web_id: 2, title: 'OTHER-WEB-CARD' },
  );
  assert.equal(otherWebCardResponse.ok, true);

  const connectionResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.create)(
    trustedEvent(),
    'WebConnection',
    {
      web_id: 1,
      from_card_id: firstCardResponse.record.id,
      to_card_id: secondCardResponse.record.id,
      label: CONNECTION_LABEL,
    },
  );
  assert.equal(connectionResponse.ok, true);

  const canvasResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.create)(
    trustedEvent(),
    'CanvasObject',
    {
      web_id: 1,
      object_type: 'section',
      title: CANVAS_TITLE,
      x: 40,
      y: 60,
      width: 600,
      height: 320,
    },
  );
  assert.equal(canvasResponse.ok, true);

  const versionSnapshot = {
    cards: [firstCardResponse.record, secondCardResponse.record],
    connections: [connectionResponse.record],
    canvasObjects: [canvasResponse.record],
  };
  const versionResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.create)(
    trustedEvent(),
    'WebVersion',
    { web_id: 1, label: VERSION_LABEL, snapshot: JSON.stringify(versionSnapshot) },
  );
  assert.equal(versionResponse.ok, true);

  const invalidVersionResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.create)(
    trustedEvent(),
    'WebVersion',
    { web_id: 1, label: 'INVALID', snapshot: '{not valid json' },
  );
  assert.equal(invalidVersionResponse.ok, false);
  assert.equal(invalidVersionResponse.code, 'BEX_ENTITY_INVALID');

  const wrongWebVersionResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.create)(
    trustedEvent(),
    'WebVersion',
    {
      web_id: 1,
      label: 'WRONG-WEB',
      snapshot: JSON.stringify({
        cards: [{ ...firstCardResponse.record, web_id: 2 }],
        connections: [],
        canvasObjects: [],
      }),
    },
  );
  assert.equal(wrongWebVersionResponse.ok, false);
  assert.equal(wrongWebVersionResponse.code, 'BEX_ENTITY_INVALID');

  const versionListResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.list)(
    trustedEvent(),
    'WebVersion',
    { filter: { web_id: 1 }, sort: '-created_date' },
  );
  assert.equal(versionListResponse.ok, true);
  assert.equal(versionListResponse.records.length, 1);
  assert.equal(versionListResponse.records[0].label, VERSION_LABEL);
  assert.equal(versionListResponse.records[0].snapshot, undefined);

  const filteredResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.list)(
    trustedEvent(),
    'KnowledgeWeb',
    { filter: { is_private: true }, limit: 10, sort: '-updated_date' },
  );
  assert.equal(filteredResponse.ok, true);
  assert.equal(filteredResponse.records.length, 1);
  assert.equal(filteredResponse.records[0].graph_data.includes(PRIVATE_NOTE), true);

  const scopedCards = await handlers.get(LOCAL_ENTITY_CHANNELS.list)(
    trustedEvent(),
    'WebCard',
    { filter: { web_id: 1 }, limit: 10, sort: 'id' },
  );
  assert.equal(scopedCards.ok, true);
  assert.equal(scopedCards.records.length, 2);
  assert.deepEqual(scopedCards.records.map((record) => record.web_id), [1, 1]);

  const updatedWebResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.update)(
    trustedEvent(),
    'KnowledgeWeb',
    1,
    { title: UPDATED_TITLE },
  );
  assert.equal(updatedWebResponse.ok, true);
  assert.equal(updatedWebResponse.record.title, UPDATED_TITLE);
  assert.equal(updatedWebResponse.record.graph_data.includes(PRIVATE_NOTE), true);

  const updatedCardResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.update)(
    trustedEvent(),
    'WebCard',
    firstCardResponse.record.id,
    { title: UPDATED_CARD_TITLE, x: 180 },
  );
  assert.equal(updatedCardResponse.ok, true);
  assert.equal(updatedCardResponse.record.description, PRIVATE_NOTE);
  assert.equal(updatedCardResponse.record.web_id, 1);

  const movedCardResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.update)(
    trustedEvent(),
    'WebCard',
    firstCardResponse.record.id,
    { web_id: 2 },
  );
  assert.equal(movedCardResponse.ok, false);
  assert.equal(movedCardResponse.code, 'BEX_ENTITY_INVALID');

  lockPrivacyVault();
  const lockedResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.list)(
    trustedEvent(),
    'WebCard',
    {},
  );
  assert.equal(lockedResponse.ok, false);
  assert.equal(lockedResponse.code, 'BEX_PRIVACY_LOCKED');
  const lockedBrainResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.list)(
    trustedEvent(),
    'BrainSource',
    {},
  );
  assert.equal(lockedBrainResponse.ok, false);
  assert.equal(lockedBrainResponse.code, 'BEX_PRIVACY_LOCKED');
  assert.throws(
    () => readLocalMedia(mediaResponse.media.url),
    (error) => error?.code === 'BEX_PRIVACY_LOCKED',
  );
  const lockedMediaResponse = await handlers.get(SAVE_IMAGE_CHANNEL)(trustedEvent(), {
    bytes: PROOF_IMAGE,
    mimeType: 'image/png',
  });
  assert.equal(lockedMediaResponse.ok, false);
  assert.equal(lockedMediaResponse.code, 'BEX_PRIVACY_LOCKED');
  const lockedDisplayResponse = await net.fetch(mediaResponse.media.url);
  assert.equal(lockedDisplayResponse.status, 423);
  unlockPrivacyAutomatically();

  closeDatabase();
  assertPlaintextAbsent(libraryPath);
  return [
    'schema 15 opens the encrypted Knowledge Web, Second Brain, Bible Study, Asset, Chapter Art, and Course stores',
    'untrusted pages are rejected before local-data access',
    'untrusted, fake, unsafe-path, and locked media requests fail safely',
    'a Knowledge Web image saves as an encrypted library file',
    'Electron opens the encrypted image for display only while the library is unlocked',
    'trusted bridge creates two encrypted Knowledge Webs',
    'manual Second Brain sources save with validated Knowledge Web links',
    'raw source text and Offline Mode processing state cannot be overwritten',
    'encrypted folders create and rename locally',
    'one shared folder accepts Timeline and Bible Study records',
    'folder and web drag orders save as atomic batches',
    'an incomplete drag order is rejected without partial writes',
    'encrypted notes create, edit, and preserve untouched content',
    'note-to-web and note-to-note links save with valid endpoints',
    'self-links and endpoint changes are rejected',
    'note folder ordering saves atomically',
    'a validated encrypted version snapshot saves without bloating its history list',
    'invalid and cross-web version snapshots are rejected',
    'a card cannot be saved without a real parent web',
    'cards, a connection, and a canvas object save under one web',
    'cards link only to real encrypted Second Brain sources',
    'web-scoped filtering returns only that web’s cards',
    'partial web and card updates preserve untouched encrypted fields',
    'a child record cannot be silently moved to another web',
    'locked privacy vault blocks local entity reads',
    'SQLite, WAL, and Media files contain no plaintext private content',
  ];
}

async function reopenPhase(libraryPath, protector) {
  const reopened = initializeDatabase(libraryPath, { privacyProtector: protector });
  assert.equal(reopened.schemaVersion, 15);
  assert.equal(reopened.privacy.created, false);
  const handlers = registerRealHandlers();
  registerLocalMediaProtocol({ protocol, readLocalMedia });

  const reopenedFolders = await handlers.get(LOCAL_ENTITY_CHANNELS.list)(
    trustedEvent(),
    'WebFolder',
    { sort: 'sort_order' },
  );
  assert.equal(reopenedFolders.ok, true);
  assert.deepEqual(reopenedFolders.records.map((record) => record.id), [2, 1]);
  assert.equal(reopenedFolders.records[1].name, RENAMED_FOLDER_NAME);

  const reopenedFolderWebs = await handlers.get(LOCAL_ENTITY_CHANNELS.list)(
    trustedEvent(),
    'KnowledgeWeb',
    { filter: { folder_id: 1 }, sort: 'sort_order' },
  );
  assert.equal(reopenedFolderWebs.ok, true);
  assert.deepEqual(reopenedFolderWebs.records.map((record) => record.id), [2, 1]);

  const reopenedFolderNotes = await handlers.get(LOCAL_ENTITY_CHANNELS.list)(
    trustedEvent(),
    'MindNote',
    { filter: { folder_id: 1 }, sort: 'sort_order' },
  );
  assert.equal(reopenedFolderNotes.ok, true);
  assert.deepEqual(reopenedFolderNotes.records.map((record) => record.id), [2, 1]);
  assert.equal(reopenedFolderNotes.records[1].title, UPDATED_NOTE_TITLE);
  assert.equal(reopenedFolderNotes.records[1].content, NOTE_CONTENT);

  const reopenedFolderedTimegraphs = await handlers.get(LOCAL_ENTITY_CHANNELS.list)(
    trustedEvent(),
    'Timegraph',
    { filter: { folder_id: 1 } },
  );
  const reopenedFolderedStudies = await handlers.get(LOCAL_ENTITY_CHANNELS.list)(
    trustedEvent(),
    'StudyChapter',
    { filter: { folder_id: 1 } },
  );
  assert.equal(reopenedFolderedTimegraphs.ok, true);
  assert.equal(reopenedFolderedTimegraphs.records[0].title, TIMEGRAPH_TITLE);
  assert.equal(reopenedFolderedStudies.ok, true);
  assert.equal(reopenedFolderedStudies.records[0].notes, STUDY_NOTE);

  const reopenedLinks = await handlers.get(LOCAL_ENTITY_CHANNELS.list)(
    trustedEvent(),
    'MindLink',
    { sort: 'id' },
  );
  assert.equal(reopenedLinks.ok, true);
  assert.equal(reopenedLinks.records.length, 2);
  assert.equal(reopenedLinks.records[0].label, LINK_LABEL);

  const reopenedBrainSources = await handlers.get(LOCAL_ENTITY_CHANNELS.list)(
    trustedEvent(),
    'BrainSource',
    { sort: 'id' },
  );
  assert.equal(reopenedBrainSources.ok, true);
  assert.equal(reopenedBrainSources.records.length, 2);
  assert.equal(reopenedBrainSources.records[0].title, UPDATED_BRAIN_SOURCE_TITLE);
  assert.equal(reopenedBrainSources.records[0].raw_text, BRAIN_SOURCE_TEXT);
  assert.equal(reopenedBrainSources.records[0].processing_status, 'unprocessed');
  assert.equal(reopenedBrainSources.records[1].raw_text, OTHER_BRAIN_SOURCE_TEXT);

  const recordResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.get)(
    trustedEvent(),
    'KnowledgeWeb',
    1,
  );
  assert.equal(recordResponse.ok, true);
  assert.equal(recordResponse.record.title, UPDATED_TITLE);
  assert.equal(recordResponse.record.graph_data.includes(PRIVATE_NOTE), true);

  const cardResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.get)(
    trustedEvent(),
    'WebCard',
    1,
  );
  assert.equal(cardResponse.ok, true);
  assert.equal(cardResponse.record.title, UPDATED_CARD_TITLE);
  assert.equal(cardResponse.record.description, PRIVATE_NOTE);
  assert.deepEqual(cardResponse.record.source_ids, [1]);
  assert.match(cardResponse.record.image_url, /^bex-media:\/\/library\/image-[0-9a-f-]+\.png$/);
  const reopenedMedia = readLocalMedia(cardResponse.record.image_url);
  assert.deepEqual(reopenedMedia.bytes, PROOF_IMAGE);
  reopenedMedia.bytes.fill(0);
  const reopenedDisplayResponse = await net.fetch(cardResponse.record.image_url);
  assert.equal(reopenedDisplayResponse.status, 200);
  assert.deepEqual(Buffer.from(await reopenedDisplayResponse.arrayBuffer()), PROOF_IMAGE);

  const reopenedVersionList = await handlers.get(LOCAL_ENTITY_CHANNELS.list)(
    trustedEvent(),
    'WebVersion',
    { filter: { web_id: 1 }, sort: '-created_date' },
  );
  assert.equal(reopenedVersionList.ok, true);
  assert.equal(reopenedVersionList.records.length, 1);
  assert.equal(reopenedVersionList.records[0].snapshot, undefined);

  const reopenedVersion = await handlers.get(LOCAL_ENTITY_CHANNELS.get)(
    trustedEvent(),
    'WebVersion',
    reopenedVersionList.records[0].id,
  );
  assert.equal(reopenedVersion.ok, true);
  const restoredSnapshot = JSON.parse(reopenedVersion.record.snapshot);
  assert.equal(restoredSnapshot.cards[0].title, CARD_TITLE);

  const conflictingRestore = await handlers.get(LOCAL_ENTITY_CHANNELS.restoreGraph)(
    trustedEvent(),
    1,
    {
      ...restoredSnapshot,
      cards: [
        ...restoredSnapshot.cards,
        { id: 3, web_id: 1, title: 'COLLISION-MUST-ROLL-BACK' },
      ],
    },
  );
  assert.equal(conflictingRestore.ok, false);
  assert.equal(conflictingRestore.code, 'BEX_ENTITY_INVALID');
  const cardsAfterRejectedRestore = await handlers.get(LOCAL_ENTITY_CHANNELS.list)(
    trustedEvent(),
    'WebCard',
    { filter: { web_id: 1 }, sort: 'id' },
  );
  assert.equal(cardsAfterRejectedRestore.ok, true);
  assert.equal(cardsAfterRejectedRestore.records.length, 2);

  const deleteSavedCard = await handlers.get(LOCAL_ENTITY_CHANNELS.delete)(
    trustedEvent(),
    'WebCard',
    restoredSnapshot.cards[1].id,
  );
  assert.equal(deleteSavedCard.ok, true);
  const restoredGraph = await handlers.get(LOCAL_ENTITY_CHANNELS.restoreGraph)(
    trustedEvent(),
    1,
    restoredSnapshot,
  );
  assert.equal(restoredGraph.ok, true);
  assert.equal(restoredGraph.snapshot.cards.length, 2);
  assert.equal(restoredGraph.snapshot.cards[0].title, CARD_TITLE);
  assert.equal(restoredGraph.snapshot.connections[0].from_card_id, restoredSnapshot.cards[0].id);
  assert.equal(restoredGraph.snapshot.connections[0].to_card_id, restoredSnapshot.cards[1].id);

  for (const entityType of ['WebCard', 'WebConnection', 'CanvasObject']) {
    const graphRows = await handlers.get(LOCAL_ENTITY_CHANNELS.list)(
      trustedEvent(),
      entityType,
      { filter: { web_id: 1 } },
    );
    assert.equal(graphRows.ok, true);
    assert.equal(graphRows.records.length > 0, true);
  }

  const deleteFirstBrainSource = await handlers.get(LOCAL_ENTITY_CHANNELS.delete)(
    trustedEvent(),
    'BrainSource',
    1,
  );
  assert.equal(deleteFirstBrainSource.ok, true);
  const cardAfterSourceDelete = await handlers.get(LOCAL_ENTITY_CHANNELS.get)(
    trustedEvent(),
    'WebCard',
    1,
  );
  assert.equal(cardAfterSourceDelete.ok, true);
  assert.deepEqual(cardAfterSourceDelete.record.source_ids, []);

  const deletedResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.delete)(
    trustedEvent(),
    'KnowledgeWeb',
    1,
  );
  assert.equal(deletedResponse.ok, true);
  assert.deepEqual(deletedResponse.result, { deleted: true, id: 1 });

  const detachedBrainSource = await handlers.get(LOCAL_ENTITY_CHANNELS.get)(
    trustedEvent(),
    'BrainSource',
    2,
  );
  assert.equal(detachedBrainSource.ok, true);
  assert.equal(detachedBrainSource.record.web_id, null);

  const linksAfterWebDelete = await handlers.get(LOCAL_ENTITY_CHANNELS.list)(
    trustedEvent(),
    'MindLink',
    {},
  );
  assert.equal(linksAfterWebDelete.ok, true);
  assert.equal(linksAfterWebDelete.records.length, 1);
  assert.equal(linksAfterWebDelete.records[0].to_type, 'note');

  const versionsAfterWebDelete = await handlers.get(LOCAL_ENTITY_CHANNELS.list)(
    trustedEvent(),
    'WebVersion',
    { filter: { web_id: 1 } },
  );
  assert.equal(versionsAfterWebDelete.ok, true);
  assert.equal(versionsAfterWebDelete.records.length, 0);

  for (const entityType of ['WebCard', 'WebConnection', 'CanvasObject']) {
    const graphRows = await handlers.get(LOCAL_ENTITY_CHANNELS.list)(
      trustedEvent(),
      entityType,
      { filter: { web_id: 1 } },
    );
    assert.equal(graphRows.ok, true);
    assert.equal(graphRows.records.length, 0);
  }

  const otherWebCards = await handlers.get(LOCAL_ENTITY_CHANNELS.list)(
    trustedEvent(),
    'WebCard',
    { filter: { web_id: 2 } },
  );
  assert.equal(otherWebCards.ok, true);
  assert.equal(otherWebCards.records.length, 1);

  const deleteFolderResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.delete)(
    trustedEvent(),
    'WebFolder',
    1,
  );
  assert.equal(deleteFolderResponse.ok, true);

  const detachedWebResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.get)(
    trustedEvent(),
    'KnowledgeWeb',
    2,
  );
  assert.equal(detachedWebResponse.ok, true);
  assert.equal(detachedWebResponse.record.folder_id, null);

  const detachedNoteResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.get)(
    trustedEvent(),
    'MindNote',
    1,
  );
  assert.equal(detachedNoteResponse.ok, true);
  assert.equal(detachedNoteResponse.record.folder_id, null);

  const detachedTimegraphResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.get)(
    trustedEvent(),
    'Timegraph',
    1,
  );
  const detachedStudyResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.get)(
    trustedEvent(),
    'StudyChapter',
    1,
  );
  assert.equal(detachedTimegraphResponse.ok, true);
  assert.equal(detachedTimegraphResponse.record.folder_id, null);
  assert.equal(detachedStudyResponse.ok, true);
  assert.equal(detachedStudyResponse.record.folder_id, null);

  assert.equal((await handlers.get(LOCAL_ENTITY_CHANNELS.delete)(trustedEvent(), 'Timegraph', 1)).ok, true);
  assert.equal((await handlers.get(LOCAL_ENTITY_CHANNELS.delete)(trustedEvent(), 'StudyChapter', 1)).ok, true);

  const deleteNoteResponse = await handlers.get(LOCAL_ENTITY_CHANNELS.delete)(
    trustedEvent(),
    'MindNote',
    1,
  );
  assert.equal(deleteNoteResponse.ok, true);

  const linksAfterNoteDelete = await handlers.get(LOCAL_ENTITY_CHANNELS.list)(
    trustedEvent(),
    'MindLink',
    {},
  );
  assert.equal(linksAfterNoteDelete.ok, true);
  assert.equal(linksAfterNoteDelete.records.length, 0);

  const otherNoteStillExists = await handlers.get(LOCAL_ENTITY_CHANNELS.get)(
    trustedEvent(),
    'MindNote',
    2,
  );
  assert.equal(otherNoteStillExists.ok, true);

  const deleteOtherNote = await handlers.get(LOCAL_ENTITY_CHANNELS.delete)(
    trustedEvent(),
    'MindNote',
    2,
  );
  assert.equal(deleteOtherNote.ok, true);

  const deleteOtherBrainSource = await handlers.get(LOCAL_ENTITY_CHANNELS.delete)(
    trustedEvent(),
    'BrainSource',
    2,
  );
  assert.equal(deleteOtherBrainSource.ok, true);

  const deleteOtherWeb = await handlers.get(LOCAL_ENTITY_CHANNELS.delete)(
    trustedEvent(),
    'KnowledgeWeb',
    2,
  );
  assert.equal(deleteOtherWeb.ok, true);

  const deleteOtherFolder = await handlers.get(LOCAL_ENTITY_CHANNELS.delete)(
    trustedEvent(),
    'WebFolder',
    2,
  );
  assert.equal(deleteOtherFolder.ok, true);

  const remaining = await handlers.get(LOCAL_ENTITY_CHANNELS.list)(
    trustedEvent(),
    'KnowledgeWeb',
    {},
  );
  assert.equal(remaining.ok, true);
  assert.equal(remaining.records.length, 0);

  const remainingFolders = await handlers.get(LOCAL_ENTITY_CHANNELS.list)(
    trustedEvent(),
    'WebFolder',
    {},
  );
  assert.equal(remainingFolders.ok, true);
  assert.equal(remainingFolders.records.length, 0);

  const remainingNotes = await handlers.get(LOCAL_ENTITY_CHANNELS.list)(
    trustedEvent(),
    'MindNote',
    {},
  );
  assert.equal(remainingNotes.ok, true);
  assert.equal(remainingNotes.records.length, 0);

  const remainingBrainSources = await handlers.get(LOCAL_ENTITY_CHANNELS.list)(
    trustedEvent(),
    'BrainSource',
    {},
  );
  assert.equal(remainingBrainSources.ok, true);
  assert.equal(remainingBrainSources.records.length, 0);

  closeDatabase();
  assertPlaintextAbsent(libraryPath);
  return [
    'second Electron launch reopens folder names and drag order',
    'second launch reopens foldered Timeline and Bible Study records',
    'second launch reopens note content, note order, and both link types',
    'second launch reopens encrypted raw sources and card citations',
    'failed restores roll back and a valid snapshot atomically restores a deleted card with its connection',
    'second Electron launch reopens the web and its updated card',
    'second launch decrypts and displays the image referenced by that card',
    'second launch reopens saved cards, connection, and canvas object',
    'deleting a web automatically removes all of its graph pieces',
    'deleting a web automatically removes its version history',
    'deleting a source removes only its card citation',
    'deleting a web detaches its surviving source instead of deleting research',
    'deleting one web leaves another web and its card untouched',
    'deleting a folder atomically detaches its remaining web',
    'deleting linked items removes only their attached links',
    'deleting a folder also detaches notes without deleting them',
    'deleting a folder also detaches Timeline and Bible Study records without deleting them',
    'all disposable graph rows delete cleanly',
    'post-delete SQLite files still contain no plaintext',
  ];
}

async function main() {
  const phase = process.argv[2];
  const libraryPath = path.resolve(process.argv[3] || '');
  assert.ok(phase === 'create' || phase === 'reopen', 'Unknown entity proof phase.');
  assert.ok(libraryPath, 'The disposable Berean Library path is required.');
  assert.equal(safeStorage.isEncryptionAvailable(), true, 'macOS protected storage is unavailable.');
  const protector = createSafeStorageProtector(safeStorage);
  const checks = phase === 'create'
    ? await createPhase(libraryPath, protector)
    : await reopenPhase(libraryPath, protector);
  process.stdout.write(`BEX_ENTITY_PROOF ${JSON.stringify({ phase, checks })}\n`);
}

registerLocalMediaScheme(protocol);
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
