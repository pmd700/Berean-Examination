import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const calls = [];
const records = new Map();
let nextId = 1;
let localMediaSaves = 0;
let localMediaDeletes = 0;

globalThis.window = {
  bexDesktop: {
    isDesktop: true,
    async getLocalBibleChapter({ version, book, chapter }) {
      assert.equal(['BSB', 'LSV'].includes(version), true);
      assert.equal(book, 'Genesis');
      assert.equal(chapter, 1);
      return { ok: true, chapter: { version, book, chapter, text: `~1 ${version} local text` } };
    },
    async saveLocalImage(payload) {
      assert.equal(payload.mimeType, 'image/png');
      assert.equal(payload.bytes instanceof ArrayBuffer, true);
      localMediaSaves += 1;
      return {
        ok: true,
        media: {
          mimeType: 'image/png',
          size: payload.bytes.byteLength,
          url: 'bex-media://library/image-11111111-1111-4111-8111-111111111111.png',
        },
      };
    },
    async createLocalEntity(entityType, value) {
      calls.push(['create', entityType]);
      const record = { ...value, id: nextId++ };
      records.set(`${entityType}:${record.id}`, record);
      return { ok: true, record };
    },
    async deleteLocalEntity(entityType, entityId) {
      calls.push(['delete', entityType]);
      records.delete(`${entityType}:${entityId}`);
      return { ok: true, result: { deleted: true, id: entityId } };
    },
    async deleteLocalImage(mediaUrl) {
      assert.match(mediaUrl, /^bex-media:\/\/library\/image-[0-9a-f-]+\.png$/);
      localMediaDeletes += 1;
      return { ok: true, result: { deleted: true, url: mediaUrl } };
    },
    async getLocalEntity(entityType, entityId) {
      calls.push(['get', entityType]);
      return { ok: true, record: records.get(`${entityType}:${entityId}`) };
    },
    async listLocalEntities(entityType, query) {
      calls.push(['list', entityType]);
      const rows = [...records.entries()]
        .filter(([key]) => key.startsWith(`${entityType}:`))
        .map(([, record]) => record)
        .filter((record) => Object.entries(query?.filter || {}).every(
          ([field, expected]) => record[field] === expected,
        ));
      return { ok: true, records: rows };
    },
    async reorderLocalEntities(entityType, entityIds, containerId) {
      calls.push(['reorder', entityType]);
      const reordered = entityIds.map((entityId, index) => {
        const key = `${entityType}:${entityId}`;
        const record = {
          ...records.get(key),
          ...(['KnowledgeWeb', 'MindNote'].includes(entityType) ? { folder_id: containerId } : {}),
          id: entityId,
          sort_order: index,
        };
        records.set(key, record);
        return record;
      });
      return { ok: true, records: reordered };
    },
    async restoreKnowledgeWebGraph(_webId, snapshot) {
      calls.push(['restoreGraph', 'KnowledgeWeb']);
      return { ok: true, snapshot };
    },
    async updateLocalEntity(entityType, entityId, patch) {
      calls.push(['update', entityType]);
      const key = `${entityType}:${entityId}`;
      const record = { ...records.get(key), ...patch, id: entityId };
      records.set(key, record);
      return { ok: true, record };
    },
  },
};
globalThis.fetch = async () => {
  throw new Error('The old online API was called during the desktop route proof.');
};

const server = await createServer({
  appType: 'custom',
  configFile: false,
  logLevel: 'silent',
  resolve: {
    alias: {
      '@': path.join(projectRoot, 'src'),
    },
  },
  root: projectRoot,
  server: { middlewareMode: true },
});

try {
  const { desktopClient } = await server.ssrLoadModule('/src/api/desktopClient.js');
  const {
    deleteAsset,
    listAssets,
    uploadAsset,
  } = await server.ssrLoadModule('/src/lib/assetRegistry.js');
  const {
    listRecentChapterArt,
    removeChapterArt,
    setChapterArt,
    updateChapterArtName,
    updateChapterArtSettings,
  } = await server.ssrLoadModule('/src/lib/chapterArtRegistry.js');
  const { readLocalBibleChapter } = await server.ssrLoadModule('/src/lib/localBible.js');
  const { searchLocalBrainRecords } = await server.ssrLoadModule('/src/lib/localBrainSearch.js');
  const { replaceLocalKnowledgeWebGraph } = await server.ssrLoadModule('/src/lib/localEntities.js');
  const {
    checkVerifier,
    deriveKey,
    generateSaltB64,
    makeVerifier,
  } = await server.ssrLoadModule('/src/lib/webCrypto.js');
  const upload = await desktopClient.media.uploadFile({
    file: new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'proof.png', {
      type: 'image/png',
    }),
  });
  assert.equal(upload.file_url, 'bex-media://library/image-11111111-1111-4111-8111-111111111111.png');
  assert.equal(localMediaSaves, 1);
  const asset = await uploadAsset(new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47])],
    'local-asset.png',
    { type: 'image/png' },
  ));
  assert.equal(asset.name, 'local-asset.png');
  assert.equal((await listAssets()).length, 1);
  await deleteAsset(asset.id);
  assert.equal((await listAssets()).length, 0);
  assert.equal(localMediaSaves, 2);
  assert.equal(localMediaDeletes, 1);
  await setChapterArt('Genesis', 1, new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47])],
    'genesis-art.png',
    { type: 'image/png' },
  ));
  await updateChapterArtName('Genesis', 1, 'Creation');
  await updateChapterArtSettings('Genesis', 1, {
    cover_art_opacity: 140,
    cover_art_scale: 120,
    cover_art_x: 30,
    cover_art_y: 60,
  });
  assert.equal((await listRecentChapterArt())[0].cover_art_name, 'Creation');
  await removeChapterArt('Genesis', 1);
  const [emptyChapterArtCatalog] = await desktopClient.entities.ChapterArtCatalog.list();
  assert.equal(emptyChapterArtCatalog.entries.length, 0);
  await desktopClient.entities.ChapterArtCatalog.delete(emptyChapterArtCatalog.id);
  assert.equal(localMediaSaves, 3);
  assert.equal(localMediaDeletes, 2);
  assert.equal((await readLocalBibleChapter('BSB', 'Genesis', 1)).text, '~1 BSB local text');
  assert.equal((await readLocalBibleChapter('LSV', 'Genesis', 1)).text, '~1 LSV local text');
  const studyChapter = await desktopClient.entities.StudyChapter.create({
    book: 'Genesis', chapter_number: 1, raw_text: '~1 Local text', version: 'BSB',
  });
  const annotation = await desktopClient.entities.Annotation.create({
    book: 'Genesis', chapter_number: 1, content: 'Local note', version: 'BSB',
  });
  const highlight = await desktopClient.entities.TextHighlight.create({
    book: 'Genesis', chapter_number: 1, color: '#ffee00', version: 'BSB',
  });
  const drawing = await desktopClient.entities.Drawing.create({ annotation_id: annotation.id });
  const keyword = await desktopClient.entities.Keyword.create({ title: 'Beginning' });
  const dailyActivity = await desktopClient.entities.DailyActivity.create({ date: '2026-07-23' });
  assert.equal((await desktopClient.entities.StudyChapter.get(studyChapter.id)).version, 'BSB');
  assert.equal((await desktopClient.entities.Annotation.filter({ version: 'BSB' })).length, 1);
  assert.equal((await desktopClient.entities.TextHighlight.list()).length, 1);
  assert.equal((await desktopClient.entities.Drawing.get(drawing.id)).annotation_id, annotation.id);
  assert.equal((await desktopClient.entities.Keyword.update(keyword.id, { title: 'Creation' })).title, 'Creation');
  assert.equal((await desktopClient.entities.DailyActivity.list()).length, 1);
  const web = await desktopClient.entities.KnowledgeWeb.create({ title: 'Renderer route proof' });
  const brainSource = await desktopClient.entities.BrainSource.create({
    web_id: web.id,
    title: 'Local source',
    source_type: 'note',
    raw_text: 'Local source content',
  });
  const folder = await desktopClient.entities.WebFolder.create({ name: 'Saved folder' });
  await desktopClient.entities.WebFolder.reorder([folder.id]);
  await desktopClient.entities.KnowledgeWeb.reorder([web.id], folder.id);
  const card = await desktopClient.entities.WebCard.create({
    web_id: web.id,
    title: 'Saved card',
    source_ids: [brainSource.id],
  });
  const connection = await desktopClient.entities.WebConnection.create({
    web_id: web.id,
    from_card_id: card.id,
    to_card_id: card.id,
    label: 'Saved relationship',
  });
  const canvasObject = await desktopClient.entities.CanvasObject.create({
    web_id: web.id,
    object_type: 'section',
  });
  const note = await desktopClient.entities.MindNote.create({
    title: 'Saved note',
    content: '<p>Private local note</p>',
  });
  const otherNote = await desktopClient.entities.MindNote.create({
    title: 'Other saved note',
    content: '',
  });
  await desktopClient.entities.MindNote.reorder([otherNote.id, note.id], folder.id);
  const mindLink = await desktopClient.entities.MindLink.create({
    from_type: 'note',
    from_id: note.id,
    to_type: 'web',
    to_id: web.id,
  });
  const version = await desktopClient.entities.WebVersion.create({
    web_id: web.id,
    label: 'Saved checkpoint',
    snapshot: JSON.stringify({
      cards: [card],
      connections: [connection],
      canvasObjects: [canvasObject],
    }),
  });

  assert.equal((await desktopClient.entities.KnowledgeWeb.get(web.id)).title, 'Renderer route proof');
  assert.equal((await desktopClient.entities.WebCard.filter({ web_id: web.id })).length, 1);
  assert.equal((await desktopClient.entities.BrainSource.get(brainSource.id)).raw_text, 'Local source content');
  assert.equal((await desktopClient.entities.WebCard.update(card.id, { title: 'Updated card' })).title, 'Updated card');
  assert.equal((await desktopClient.entities.MindNote.get(note.id)).content, '<p>Private local note</p>');
  assert.equal((await desktopClient.entities.MindNote.filter({ folder_id: folder.id })).length, 2);
  assert.equal((await desktopClient.entities.MindLink.update(mindLink.id, { label: 'Related' })).label, 'Related');
  assert.equal((await desktopClient.entities.WebVersion.filter({ web_id: web.id })).length, 1);
  const savedSnapshot = JSON.parse((await desktopClient.entities.WebVersion.get(version.id)).snapshot);
  assert.equal(savedSnapshot.cards[0].title, 'Saved card');
  assert.equal((await replaceLocalKnowledgeWebGraph(web.id, savedSnapshot)).cards.length, 1);
  const searchCollections = {
    cards: await desktopClient.entities.WebCard.list(),
    connections: await desktopClient.entities.WebConnection.list(),
    links: await desktopClient.entities.MindLink.list(),
    notes: await desktopClient.entities.MindNote.list(),
    sources: await desktopClient.entities.BrainSource.list(),
  };
  const sourceMatches = searchLocalBrainRecords(searchCollections, {
    query: 'Local source content',
    scope: 'sources',
  });
  assert.equal(sourceMatches.length, 1);
  assert.equal(sourceMatches[0].result_type, 'source');
  assert.equal('raw_text' in sourceMatches[0], false);
  assert.equal(sourceMatches[0].snippet.includes('Local source content'), true);
  assert.equal(searchLocalBrainRecords(searchCollections, {
    query: 'Updated card',
    scope: 'cards',
  })[0].result_type, 'card');
  assert.equal(searchLocalBrainRecords(searchCollections, {
    query: 'Saved relationship',
    scope: 'connections',
  })[0].result_type, 'connection');
  assert.equal(searchLocalBrainRecords(searchCollections, {
    query: 'Private local note',
    scope: 'notes',
  })[0].result_type, 'note');
  assert.equal(searchLocalBrainRecords(searchCollections, {
    query: 'Private local note',
    scope: 'notes',
    webId: web.id,
  }).length, 1);
  assert.equal(searchLocalBrainRecords(searchCollections, {
    query: 'Other saved note',
    scope: 'notes',
    webId: web.id,
  }).length, 0);
  await desktopClient.entities.WebConnection.delete(connection.id);
  await desktopClient.entities.CanvasObject.delete(canvasObject.id);
  await desktopClient.entities.WebCard.delete(card.id);
  await desktopClient.entities.BrainSource.delete(brainSource.id);
  await desktopClient.entities.MindLink.delete(mindLink.id);
  await desktopClient.entities.MindNote.delete(note.id);
  await desktopClient.entities.MindNote.delete(otherNote.id);
  await desktopClient.entities.WebVersion.delete(version.id);
  await desktopClient.entities.KnowledgeWeb.delete(web.id);
  await desktopClient.entities.WebFolder.delete(folder.id);
  await desktopClient.entities.Drawing.delete(drawing.id);
  await desktopClient.entities.Annotation.delete(annotation.id);
  await desktopClient.entities.TextHighlight.delete(highlight.id);
  await desktopClient.entities.Keyword.delete(keyword.id);
  await desktopClient.entities.DailyActivity.delete(dailyActivity.id);
  await desktopClient.entities.StudyChapter.delete(studyChapter.id);

  assert.deepEqual(
    [...new Set(calls.map(([, entityType]) => entityType))].sort(),
    [
      'Annotation', 'Asset', 'BrainSource', 'CanvasObject', 'ChapterArtCatalog',
      'DailyActivity', 'Drawing', 'Keyword',
      'KnowledgeWeb', 'MindLink', 'MindNote', 'StudyChapter', 'TextHighlight', 'WebCard',
      'WebConnection', 'WebFolder', 'WebVersion',
    ],
  );
  assert.equal(records.size, 0);
  records.set('KnowledgeWeb:999', { id: 999, title: 'Must survive wrong passphrase' });
  const recordsBeforePassphraseCheck = JSON.stringify([...records.entries()]);
  const callsBeforePassphraseCheck = calls.length;
  const salt = generateSaltB64();
  const correctKey = await deriveKey('correct private phrase', salt);
  const wrongKey = await deriveKey('wrong private phrase', salt);
  const verifier = await makeVerifier(correctKey);
  assert.equal(await checkVerifier(wrongKey, verifier), false);
  assert.equal(await checkVerifier(correctKey, verifier), true);
  assert.equal(calls.length, callsBeforePassphraseCheck);
  assert.equal(JSON.stringify([...records.entries()]), recordsBeforePassphraseCheck);
  records.delete('KnowledgeWeb:999');

  const activePrivateWebSource = [
    fs.readFileSync(path.join(projectRoot, 'src/pages/KnowledgeWeb.jsx'), 'utf8'),
    fs.readFileSync(path.join(projectRoot, 'src/components/knowledgeweb/UnlockWebModal.jsx'), 'utf8'),
  ].join('\n');
  for (const forbiddenText of [
    '/unlock-attempt',
    'failed_unlock_attempts',
    'unlock_locked_until',
    'DATA DESTROYED',
    'reportUnlockAttempt',
  ]) {
    assert.equal(activePrivateWebSource.includes(forbiddenText), false);
  }
  const brainInboxSource = fs.readFileSync(path.join(projectRoot, 'src/pages/BrainInbox.jsx'), 'utf8');
  for (const forbiddenText of [
    '/api/brain/sources',
    'brainFetch(',
    'handleProcessWithAI',
  ]) {
    assert.equal(brainInboxSource.includes(forbiddenText), false);
  }
  assert.equal(brainInboxSource.includes('platformEntities.BrainSource'), true);
  assert.equal(brainInboxSource.includes('Online Mode is off'), true);
  assert.equal(brainInboxSource.includes('handleDeleteSource'), true);
  const brainSearchSource = fs.readFileSync(path.join(projectRoot, 'src/pages/BrainSearch.jsx'), 'utf8');
  for (const forbiddenText of [
    '/api/brain',
    'brainFetch(',
    'includeSuggested',
    'Open Brain Chat',
  ]) {
    assert.equal(brainSearchSource.includes(forbiddenText), false);
  }
  assert.equal(brainSearchSource.includes('searchLocalBrainRecords'), true);
  assert.equal(brainSearchSource.includes('Online Mode off'), true);
  assert.equal(brainSearchSource.includes('platformEntities.MindNote'), true);
  const activeBrainChatSource = fs.readFileSync(path.join(projectRoot, 'src/pages/BrainChat.jsx'), 'utf8');
  for (const forbiddenText of [
    '/api/brain',
    'brainFetch(',
    'fetch(',
    'BrainChatOnline',
  ]) {
    assert.equal(activeBrainChatSource.includes(forbiddenText), false);
  }
  assert.equal(activeBrainChatSource.includes('Online Mode off'), true);
  assert.equal(activeBrainChatSource.includes("navigate('/BrainSearch')"), true);
  assert.equal(activeBrainChatSource.includes("navigate('/BrainInbox')"), true);
  const dormantBrainChatSource = fs.readFileSync(path.join(projectRoot, 'src/ai-spine/BrainChatOnline.jsx'), 'utf8');
  assert.equal(dormantBrainChatSource.includes('/api/brain/chat'), true);
  assert.equal(dormantBrainChatSource.includes('brainFetch('), true);
  const assetRegistrySource = fs.readFileSync(path.join(projectRoot, 'src/lib/assetRegistry.js'), 'utf8');
  assert.equal(assetRegistrySource.includes('/api/assets'), false);
  assert.equal(assetRegistrySource.includes('platformEntities.Asset'), true);
  const assetLibrarySource = fs.readFileSync(path.join(projectRoot, 'src/pages/AssetLibrary.jsx'), 'utf8');
  assert.equal(assetLibrarySource.includes('target="_blank"'), false);
  assert.equal(assetLibrarySource.includes('image-asset-preview'), true);
  const chapterArtSource = fs.readFileSync(path.join(projectRoot, 'src/pages/ChapterArt.jsx'), 'utf8');
  assert.equal(chapterArtSource.includes('manageChapterArt'), false);
  assert.equal(chapterArtSource.includes('functions.invoke'), false);
  assert.equal(chapterArtSource.includes('listRecentChapterArt'), true);
  const studySource = fs.readFileSync(path.join(projectRoot, 'src/pages/Study.jsx'), 'utf8');
  assert.equal(studySource.includes('listAllChapterArt'), true);
  const knowledgeWebSource = fs.readFileSync(path.join(projectRoot, 'src/pages/KnowledgeWeb.jsx'), 'utf8');
  assert.equal(knowledgeWebSource.includes('entities.CardPlacement'), false);
  assert.equal(fs.existsSync(path.join(projectRoot, 'src/components/study/AIInsightsButton.jsx')), false);
  assert.equal(fs.existsSync(path.join(projectRoot, 'src/ai-spine/AIInsightsOnline.jsx')), false);
  const interlinearSource = fs.readFileSync(path.join(projectRoot, 'src/components/interlinear/useInterlinearChapter.jsx'), 'utf8');
  assert.equal(interlinearSource.includes('fetchMamChapter'), false);
  assert.equal(interlinearSource.includes('base44'), false);
  assert.equal(interlinearSource.includes('desktopClient.entities'), false);
  assert.equal(interlinearSource.includes('getLocalMamChapter'), true);
  process.stdout.write('PASS: visible Knowledge Web, folder, note, and Mind View calls use the desktop SQLite bridge\n');
  process.stdout.write('PASS: the old online API is not called for canvas, notes, links, version history, or folder ordering\n');
  process.stdout.write('PASS: wrong private-web passphrases stay local and cannot delete or change library data\n');
  process.stdout.write('PASS: renderer image uploads use the encrypted desktop Media bridge\n');
  process.stdout.write('PASS: visible Asset Library add, list, and delete use encrypted local bridges with no /api/assets call\n');
  process.stdout.write('PASS: visible Chapter Art choose, edit, reopen route, and remove use encrypted local bridges\n');
  process.stdout.write('PASS: visible BSB/LSV reads and all six Study record types use local desktop bridges\n');
  process.stdout.write('PASS: renderer Second Brain sources use the encrypted desktop entity bridge\n');
  process.stdout.write('PASS: visible Raw Source Inbox uses encrypted local CRUD while its AI Spine stays dormant\n');
  process.stdout.write('PASS: visible Brain Search finds local sources, cards, connections, and notes without a server or AI call\n');
  process.stdout.write('PASS: Brain Chat is sealed behind Online Mode while its AI Spine remains preserved\n');
  process.stdout.write('PASS: visible Card Library and MAM Interlinear make no dead cloud calls; chapter AI Insights removed\n');
} finally {
  await server.close();
  delete globalThis.fetch;
  delete globalThis.window;
}
