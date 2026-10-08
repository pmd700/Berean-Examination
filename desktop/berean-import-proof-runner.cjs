'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app, safeStorage } = require('electron');
const {
  closeDatabase,
  createLocalEntity,
  getLocalEntity,
  importKnowledgeWebGraph,
  initializeDatabase,
  listLocalEntities,
} = require('./database.cjs');
const { createSafeStorageProtector } = require('./privacy-vault.cjs');

function sourceDigest(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function portableValue(value) {
  const copy = { ...value };
  for (const field of [
    'id',
    'web_id',
    'source_ids',
    'created_at',
    'created_date',
    'updated_at',
    'updated_date',
    'user_id',
  ]) delete copy[field];
  return copy;
}

function acceptedLegacyConnections(parsed) {
  const cardIds = new Set(parsed.cards.map((card) => String(card.id)));
  return parsed.connections.filter((connection) => (
    (connection.from_kind || 'card') === 'card'
    && (connection.to_kind || 'card') === 'card'
    && cardIds.has(String(connection.from_card_id))
    && cardIds.has(String(connection.to_card_id))
  ));
}

function assertSavedEndpoints(snapshot) {
  const cardIds = new Set(snapshot.cards.map((record) => record.id));
  const objectIds = new Map(snapshot.canvasObjects.map((record) => [record.id, record.object_type]));
  for (const connection of snapshot.connections) {
    for (const side of ['from', 'to']) {
      const kind = connection[`${side}_kind`] || 'card';
      const id = connection[`${side}_card_id`];
      if (kind === 'card') assert.equal(cardIds.has(id), true);
      else assert.equal(objectIds.get(id), kind);
    }
  }
}

function correctedPayload() {
  return {
    formatVersion: 2,
    web: { title: 'Corrected portable web', description: 'Atomic proof', connector_style: 'straight' },
    cards: [
      { id: 'card-a', title: 'A', x: 10, y: 20, width: 210, height: 130, source_ids: null },
      { id: 'card-b', title: 'B', x: 300, y: 400, width: 220, height: 140, source_ids: null },
    ],
    canvasObjects: [
      { id: 'point-a', object_type: 'point', x: 500, y: 600, color: '#abcdef' },
    ],
    connections: [
      { from_card_id: 'card-a', to_card_id: 'card-b', from_kind: 'card', to_kind: 'card', label: 'card link' },
      { from_card_id: 'card-b', to_card_id: 'point-a', from_kind: 'card', to_kind: 'point', label: 'to point' },
      { from_card_id: 'point-a', to_card_id: 'card-a', from_kind: 'point', to_kind: 'card', label: 'from point' },
    ],
  };
}

function runCorrectedProof() {
  const web = createLocalEntity('KnowledgeWeb', { title: 'Original disposable web' });
  const sentinel = createLocalEntity('WebCard', {
    title: 'Must survive preview',
    web_id: web.id,
    x: 1,
    y: 2,
  });
  const payload = correctedPayload();
  const preview = importKnowledgeWebGraph(web.id, payload, { commit: false });
  assert.equal(preview.committed, false);
  assert.deepEqual(preview.report.accepted, { cards: 2, connections: 3, canvasObjects: 1 });
  assert.equal(getLocalEntity('WebCard', sentinel.id).title, 'Must survive preview');

  const malformed = {
    ...payload,
    canvasObjects: [{ object_type: 'point', x: 1, y: 2 }],
  };
  assert.throws(
    () => importKnowledgeWebGraph(web.id, malformed, { commit: true }),
    (error) => error?.code === 'BEX_ENTITY_INVALID',
  );
  assert.equal(getLocalEntity('WebCard', sentinel.id).title, 'Must survive preview');

  const committed = importKnowledgeWebGraph(web.id, payload, { commit: true });
  assert.equal(committed.committed, true);
  assert.equal(committed.snapshot.cards.length, 2);
  assert.equal(committed.snapshot.connections.length, 3);
  assert.equal(committed.snapshot.canvasObjects.length, 1);
  assertSavedEndpoints(committed.snapshot);
  assert.equal(committed.snapshot.cards[0].x, 10);
  assert.equal(committed.snapshot.cards[1].height, 140);
  assert.equal(committed.snapshot.canvasObjects[0].color, '#abcdef');
  assert.equal(committed.web.title, 'Corrected portable web');
  assert.equal(committed.web.description, 'Atomic proof');
  assert.equal(committed.web.connector_style, 'straight');
  return { report: committed.report, webId: web.id };
}

function runLegacyProof(samplePath) {
  const beforeDigest = sourceDigest(samplePath);
  const parsed = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
  const payload = {
    formatVersion: parsed.version,
    web: parsed.web || {},
    cards: parsed.cards || [],
    connections: parsed.connections || [],
    canvasObjects: parsed.canvasObjects || [],
  };
  const web = createLocalEntity('KnowledgeWeb', { title: 'Legacy disposable target' });
  const sentinel = createLocalEntity('WebCard', { title: 'Legacy preview sentinel', web_id: web.id });
  const preview = importKnowledgeWebGraph(web.id, payload, { commit: false });
  assert.equal(preview.report.accepted.cards, 78);
  assert.equal(preview.report.accepted.connections, 82);
  assert.equal(preview.report.accepted.canvasObjects, 13);
  assert.equal(preview.report.skippedConnections, 12);
  assert.equal(preview.report.legacyObjectsWithoutIds, 13);
  assert.equal(getLocalEntity('WebCard', sentinel.id).title, 'Legacy preview sentinel');

  const committed = importKnowledgeWebGraph(web.id, payload, { commit: true });
  assert.equal(committed.snapshot.cards.length, 78);
  assert.equal(committed.snapshot.connections.length, 82);
  assert.equal(committed.snapshot.canvasObjects.length, 13);
  assertSavedEndpoints(committed.snapshot);
  committed.snapshot.cards.forEach((saved, index) => {
    assert.deepEqual(portableValue(saved), portableValue(parsed.cards[index]));
  });
  committed.snapshot.canvasObjects.forEach((saved, index) => {
    assert.deepEqual(portableValue(saved), portableValue(parsed.canvasObjects[index]));
  });
  const expectedConnections = acceptedLegacyConnections(parsed);
  committed.snapshot.connections.forEach((saved, index) => {
    const expected = portableValue(expectedConnections[index]);
    const actual = portableValue(saved);
    delete expected.from_card_id;
    delete expected.to_card_id;
    delete actual.from_card_id;
    delete actual.to_card_id;
    assert.deepEqual(actual, expected);
  });
  assert.equal(sourceDigest(samplePath), beforeDigest);
  return { report: committed.report, webId: web.id };
}

async function main() {
  const libraryPath = path.resolve(process.argv[2] || '');
  const samplePath = process.argv[3] ? path.resolve(process.argv[3]) : null;
  assert.equal(safeStorage.isEncryptionAvailable(), true, 'macOS protected storage is unavailable.');
  const protector = createSafeStorageProtector(safeStorage);
  initializeDatabase(libraryPath, { privacyProtector: protector });

  const corrected = runCorrectedProof();
  const legacy = samplePath ? runLegacyProof(samplePath) : null;
  closeDatabase();
  initializeDatabase(libraryPath, { privacyProtector: protector });
  assert.equal(listLocalEntities('WebCard', { filter: { web_id: corrected.webId } }).length, 2);
  assert.equal(listLocalEntities('WebConnection', { filter: { web_id: corrected.webId } }).length, 3);
  if (legacy) {
    assert.equal(listLocalEntities('WebCard', { filter: { web_id: legacy.webId } }).length, 78);
    assert.equal(listLocalEntities('WebConnection', { filter: { web_id: legacy.webId } }).length, 82);
  }
  closeDatabase();
  process.stdout.write(`BEX_BEREAN_IMPORT_PROOF ${JSON.stringify({ corrected: corrected.report, legacy: legacy?.report || null })}\n`);
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
