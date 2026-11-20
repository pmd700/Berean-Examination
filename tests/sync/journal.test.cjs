'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { applyMigrations } = require('../../desktop/database.cjs');
const { ENTITY_CONFIG, LocalEntityStore } = require('../../desktop/local-entity-store.cjs');
const { installEntityJournal, bootstrapEntityJournal, ID_RANGE } = require('../../desktop/sync/entity-journal.cjs');
const identity = { vaultId: crypto.randomUUID(), epoch: crypto.randomUUID(), deviceId: crypto.randomUUID(), slot: 1 };
function setup() {
  const database = new DatabaseSync(':memory:'); applyMigrations(database);
  const privacy = { assertUnlocked() {}, encryptValue(value) { return Buffer.from(JSON.stringify(value).padEnd(40, ' ')); }, decryptValue(bytes) { return JSON.parse(Buffer.from(bytes).toString()); } };
  installEntityJournal(database, identity); bootstrapEntityJournal(database, identity);
  return { database, store: new LocalEntityStore(database, privacy) };
}
test('all entity tables have atomic insert/update/delete capture, including bulk SQL paths', () => {
  const { database, store } = setup();
  try {
    assert.equal(database.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE 'sync_%'").get().n, Object.keys(ENTITY_CONFIG).length * 3);
    const note = store.create('MindNote', { title: 'First', content: '<p>First</p>' });
    assert.equal(Math.floor(note.id / ID_RANGE), 1);
    store.update('MindNote', note.id, { title: 'Updated' });
    const rows = database.prepare('SELECT * FROM local_sync_journal ORDER BY sequence').all();
    assert.equal(rows.length, 2); assert.deepEqual(JSON.parse(rows[1].parents), [`${identity.deviceId}:${rows[0].sequence}`]);
    database.exec('BEGIN'); database.prepare('DELETE FROM local_mind_notes WHERE id=?').run(note.id); database.exec('ROLLBACK');
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM local_sync_journal').get().n, 2);
    store.delete('MindNote', note.id);
    assert.equal(database.prepare('SELECT action FROM local_sync_journal ORDER BY sequence DESC LIMIT 1').get().action, 'delete');
  } finally { database.close(); }
});
test('remote suppression prevents echo and imports never allocate in another device range', () => {
  const { database, store } = setup();
  try {
    database.prepare('UPDATE local_sync_config SET suppress=1').run();
    database.prepare('INSERT INTO local_mind_notes VALUES(?,?,?,?)').run(ID_RANGE * 2 + 99, Buffer.from(JSON.stringify({ title: 'Remote' }).padEnd(40, ' ')), '2026-11-11', '2026-11-11');
    database.prepare('UPDATE local_sync_config SET suppress=0').run();
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM local_sync_journal').get().n, 0);
    const ids = store.reserveImportIds('MindNote', 2);
    assert.ok(ids.every(id => Math.floor(id / ID_RANGE) === 1));
    const note = store.create('MindNote', { title: 'Local' }); assert.ok(note.id > ids[1] && Math.floor(note.id / ID_RANGE) === 1);
  } finally { database.close(); }
});
