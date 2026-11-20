import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
const { applyMigrations } = require('../../desktop/database.cjs');
const { PrivacyVault } = require('../../desktop/privacy-vault.cjs');
const { LocalEntityStore } = require('../../desktop/local-entity-store.cjs');
const { installEntityJournal, bootstrapEntityJournal } = require('../../desktop/sync/entity-journal.cjs');
const { EntitySyncAdapter } = require('../../desktop/sync/entity-adapter.cjs');
const { SqliteReplicaStore } = require('../../desktop/sync/replica-store.cjs');
import { SyncReplica } from '../../shared/sync/replica.js';
import { randomSecret, importSyncKey } from '../../shared/sync/crypto.js';
async function setup() {
  const identity = { vaultId: crypto.randomUUID(), epoch: crypto.randomUUID(), deviceId: crypto.randomUUID(), slot: 1 };
  const db = new DatabaseSync(':memory:'); applyMigrations(db);
  const { vault } = PrivacyVault.attach({ database: db, databasePath: ':memory:', protector: { protect: bytes => Buffer.from(bytes), unprotect: bytes => Buffer.from(bytes) } });
  const store = new LocalEntityStore(db, vault);
  const note = store.create('MindNote', { title: 'Existing Mac note', content: '<p>Original</p>' });
  installEntityJournal(db, identity); bootstrapEntityJournal(db, identity); store.syncAllocation = identity;
  const key = await importSyncKey(randomSecret());
  const replicaStore = new SqliteReplicaStore(':memory:', identity), replica = new SyncReplica(replicaStore, key);
  const phoneStore = new SqliteReplicaStore(':memory:', { ...identity, deviceId: crypto.randomUUID(), slot: 2 }), phone = new SyncReplica(phoneStore, key);
  const adapter = new EntitySyncAdapter(db, vault, store, identity, replica);
  return { db, vault, store, note, adapter, replica, phone, replicaStore, phoneStore };
}
async function deliver(source, target) { const rows = await source.store.pending(), meta = await target.store.meta(); await target.receive(rows, { baseCursor: meta.cursor, cursor: meta.cursor + rows.length }); }
test('existing Mac IDs survive bootstrap, phone edits apply without echo, and a new phone note opens in the desktop store', async () => {
  const state = await setup(), { adapter, replica, phone, note, store, db } = state;
  try {
    await adapter.drain(); await deliver(replica, phone);
    const ref = { kind: 'MindNote', id: String(note.id) };
    const version = (await phone.record(ref)).versions[0];
    await phone.change(ref, { ...version.payload, content: '<p>Edited on iPhone</p>' });
    const created = await phone.create('MindNote', { title: 'Phone-created note', content: '<p>New</p>' });
    await deliver(phone, replica);
    const before = db.prepare('SELECT COUNT(*) AS n FROM local_sync_journal').get().n;
    const changed = await adapter.apply();
    assert.equal(store.get('MindNote', note.id).content, '<p>Edited on iPhone</p>');
    assert.equal(store.get('MindNote', created.payload.id).title, 'Phone-created note');
    assert.equal(changed.length, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM local_sync_journal').get().n, before);
    store.update('MindNote', note.id, { title: 'Mac after phone' }); await adapter.drain(); await deliver(replica, phone);
    assert.equal((await phone.record(ref)).versions[0].payload.title, 'Mac after phone');
  } finally { state.replicaStore.close(); state.phoneStore.close(); state.vault.close(); db.close(); }
});
test('concurrent Mac and phone edits remain conflicts rather than overwriting the active desktop row', async () => {
  const state = await setup();
  try {
    await state.adapter.drain(); await deliver(state.replica, state.phone);
    const ref = { kind: 'MindNote', id: String(state.note.id) };
    const original = (await state.phone.record(ref)).versions[0].payload;
    await state.phone.change(ref, { ...original, content: '<p>Phone branch</p>' });
    state.store.update('MindNote', state.note.id, { content: '<p>Mac branch</p>' });
    await state.adapter.drain(); await deliver(state.phone, state.replica); await state.adapter.apply();
    assert.equal(state.store.get('MindNote', state.note.id).content, '<p>Mac branch</p>');
    assert.equal(state.db.prepare('SELECT COUNT(*) AS n FROM local_sync_conflicts').get().n, 1);
    assert.equal((await state.replica.record(ref)).versions.length, 2);
  } finally { state.replicaStore.close(); state.phoneStore.close(); state.vault.close(); state.db.close(); }
});
