import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteReplicaStore } from '../../desktop/sync/replica-store.cjs';
import { SyncReplica } from '../../shared/sync/replica.js';
import { randomSecret, importSyncKey, sealJson, openJson } from '../../shared/sync/crypto.js';
import { ENTITY_TABLES, assertTableCoverage } from '../../shared/sync/catalog.js';
const vaultId = crypto.randomUUID(), epoch = crypto.randomUUID();
const identity = slot => ({ vaultId, epoch, deviceId: crypto.randomUUID(), slot });
async function setup() {
  const key = await importSyncKey(randomSecret());
  const stores = [new SqliteReplicaStore(':memory:', identity(1)), new SqliteReplicaStore(':memory:', identity(2))];
  return { key, stores, replicas: stores.map(store => new SyncReplica(store, key)) };
}
async function deliver(from, to, replica) {
  const batch = from.pending(), meta = to.meta();
  if (batch.length) await replica.receive(batch, { baseCursor: meta.cursor, cursor: meta.cursor + batch.length });
}
test('inventory covers every current table, including spreadsheets and course state', () => {
  const source = readFileSync(new URL('../../desktop/database.cjs', import.meta.url), 'utf8') + readFileSync(new URL('../../desktop/privacy-vault.cjs', import.meta.url), 'utf8');
  assertTableCoverage([...source.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? (\w+)/g)].map(match => match[1]));
  assert.equal(ENTITY_TABLES.Spreadsheet, 'local_spreadsheets');
});
test('two offline clients preserve exact IDs, rich content, concurrent versions and conflict resolution', async () => {
  const { stores: [a, b], replicas: [mac, phone] } = await setup();
  try {
    const created = await mac.create('MindNote', { title: 'Original', pages: [{ id: 'page-1', content: '<p>Text<sup>1</sup></p>' }] });
    await deliver(a, b, phone);
    await mac.change(created.record, { ...created.payload, title: 'Mac offline' });
    await phone.change(created.record, { ...created.payload, title: 'Phone offline' });
    await deliver(a, b, phone); await deliver(b, a, mac);
    for (const replica of [mac, phone]) {
      const record = await replica.record(created.record);
      assert.equal(record.status, 'conflict'); assert.equal(record.versions.length, 2);
    }
    await assert.rejects(phone.change(created.record, { title: 'Should not overwrite' }), { code: 'BEX_SYNC_CONFLICT' });
    const versions = (await phone.record(created.record)).versions;
    await phone.change(created.record, { ...created.payload, title: 'Explicitly merged' }, { resolveParents: versions.map(op => op.id).sort() });
    await deliver(b, a, mac);
    assert.equal((await mac.record(created.record)).versions[0].payload.title, 'Explicitly merged');
    await phone.change(created.record, null, { action: 'delete' }); await deliver(b, a, mac);
    assert.equal((await mac.record(created.record)).status, 'deleted');
  } finally { a.close(); b.close(); }
});
test('concurrent local saves allocate unique IDs and a durable sequence atomically', async () => {
  const { stores: [a, b], replicas: [mac, phone] } = await setup();
  try {
    const all = await Promise.all([mac.create('Keyword', { title: 'One' }), mac.create('Keyword', { title: 'Two' }), phone.create('Keyword', { title: 'Three' })]);
    assert.equal(new Set(all.map(op => op.payload.id)).size, 3);
    assert.equal(a.meta().sequence, 2); assert.equal(a.pending().length, 2);
    assert.equal(a.commit(0, { cursor: 999 }), false); assert.equal(a.meta().cursor, 0);
  } finally { a.close(); b.close(); }
});
test('disk restart retains encrypted outbox without plaintext study content', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bex-sync-test-')), filename = join(directory, 'replica.sqlite');
  const id = identity(1), key = await importSyncKey(randomSecret());
  let store = new SqliteReplicaStore(filename, id);
  try {
    await new SyncReplica(store, key).create('MindNote', { title: 'PRIVATE-TEST-MARKER', content: '<p>Retain me</p>' });
    store.close(); store = new SqliteReplicaStore(filename, id);
    assert.equal(store.pending().length, 1);
    assert.equal((await new SyncReplica(store, key).records()).records[0].versions[0].payload.title, 'PRIVATE-TEST-MARKER');
    assert.equal(readFileSync(filename).includes(Buffer.from('PRIVATE-TEST-MARKER')), false);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('changed replay and tampered ciphertext cannot advance a durable receive cursor', async () => {
  const { key, stores: [a, b], replicas: [mac, phone] } = await setup();
  try {
    const op = await mac.create('MindNote', { title: 'Original' });
    await deliver(a, b, phone);
    const row = a.pending()[0], changed = { ...op, payload: { ...op.payload, title: 'Rewritten history' } };
    const { operationPurpose } = await import('../../shared/sync/crypto.js');
    const envelope = await sealJson(key, changed, operationPurpose(a.meta().identity, op.id));
    await assert.rejects(phone.receive([{ ...row, envelope }], { baseCursor: 1, cursor: 2 }), { code: 'BEX_SYNC_REPLAY_MISMATCH' });
    assert.equal(b.meta().cursor, 1);
    await assert.rejects(openJson(key, row.envelope, 'wrong-purpose'), { code: 'BEX_SYNC_AUTH_FAILED' });
  } finally { a.close(); b.close(); }
});
test('warm snapshots avoid history decryption, track new writes, and are discarded on lock',async()=>{
  const {stores:[a,b],replicas:[mac]}=await setup();
  try{
    const created=await mac.create('MindNote',{title:'First',content:'<p>Keep</p>'});
    const first=await mac.records();let reads=0;const rowsAfter=a.rowsAfter.bind(a);a.rowsAfter=cursor=>{reads++;return rowsAfter(cursor);};
    assert.equal(await mac.records(),first);assert.equal(reads,0);
    await mac.change(created.record,{...created.payload,title:'Second'});
    const changed=await mac.records();assert.equal(changed.records[0].versions[0].payload.title,'Second');assert.equal(reads,1);
    await mac.acknowledge(a.pending().map(row=>row.id));assert.equal((await mac.records()).records[0].versions[0].payload.title,'Second');
    mac.lock();assert.equal(mac.decoded.size,0);assert.equal(mac.groups.size,0);assert.equal(mac.snapshot,null);await assert.rejects(mac.records(),{code:'BEX_SYNC_LOCKED'});
  }finally{a.close();b.close();}
});

test('incremental native history keeps old revisions without re-reading them after an edit',async()=>{
 const {stores:[a,b],replicas:[mac]}=await setup();
 try{let op=await mac.create('MindNote',{title:'History',content:'x'.repeat(20000)});for(let i=0;i<30;i++)op=await mac.change(op.record,{...op.payload,title:`Revision ${i}`});const before=await mac.records(),original=before.operations[0];let readRows=[];const scan=a.rowsAfter.bind(a);a.rowsAfter=cursor=>{const batch=scan(cursor);readRows.push(batch.rows.length);return batch;};a.all=()=>{throw new Error('Whole-history reads are forbidden in the native update path.');};await mac.change(op.record,{...op.payload,title:'Latest'});const after=await mac.records();assert.equal(after.operations.length,32);assert.equal(after.operations[0],original);assert(Object.isFrozen(original.payload));assert.equal(after.records[0].versions[0].payload.title,'Latest');await mac.acknowledge(a.pending().map(row=>row.id));await mac.records();assert.deepEqual(readRows,[1,0]);}finally{a.close();b.close();}
});
