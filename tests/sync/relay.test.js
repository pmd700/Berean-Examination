import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker, { sha256 } from '../../services/sync-relay/worker.js';
import { RelayClient, exchangeReplica, hexDigest } from '../../shared/sync/relay-client.js';
import { SyncReplica } from '../../shared/sync/replica.js';
import { importSyncKey, randomSecret } from '../../shared/sync/crypto.js';
import { SqliteReplicaStore } from '../../desktop/sync/replica-store.cjs';
import { createInvitation, consumeInvitation } from '../../shared/sync/pairing.js';
import { publishReceipt, readReceipts } from '../../shared/sync/receipts.js';
class D1 {
  constructor() { this.db = new DatabaseSync(':memory:'); this.db.exec(readFileSync(new URL('../../services/sync-relay/schema.sql', import.meta.url), 'utf8')); }
  prepare(sql) {
    const statement = this.db.prepare(sql); let values = [];
    return { bind(...args) { values = args.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value); return this; }, async first() { return statement.get(...values) || null; }, async all() { return { results: statement.all(...values) }; }, async run() { const result = statement.run(...values); return { success: true, meta: { changes: result.changes } }; } };
  }
  async batch(statements) { this.db.exec('BEGIN'); try { const result = []; for (const statement of statements) result.push(await statement.run()); this.db.exec('COMMIT'); return result; } catch (error) { this.db.exec('ROLLBACK'); throw error; } }
}
async function setup() {
  const env = { DB: new D1(), BOOTSTRAP_SECRET: randomSecret() }, token = randomSecret();
  const identity = { vaultId: crypto.randomUUID(), epoch: crypto.randomUUID(), deviceId: crypto.randomUUID(), slot: 1 };
  const fetcher = (url, options) => worker.fetch(new Request(url, options), env);
  const bootstrap = new RelayClient('https://relay.example', env.BOOTSTRAP_SECRET, fetcher);
  await bootstrap.request('/api/libraries', { method: 'POST', body: { ...identity, tokenHash: await sha256(token) } });
  return { env, identity, fetcher, relay: new RelayClient('https://relay.example', token, fetcher) };
}
test('real relay handlers exchange encrypted operations and chunks between two durable devices', async () => {
  const { env, identity, fetcher, relay } = await setup();
  const token = randomSecret(), second = { ...identity, deviceId: crypto.randomUUID(), slot: 2 };
  env.DB.db.prepare("INSERT INTO devices(vault_id,id,token_hash,role,slot) VALUES(?,?,?,'device',2)").run(identity.vaultId, second.deviceId, await sha256(token));
  const key = await importSyncKey(randomSecret()), a = new SqliteReplicaStore(':memory:', identity), b = new SqliteReplicaStore(':memory:', second);
  const mac = new SyncReplica(a, key), phone = new SyncReplica(b, key), phoneRelay = new RelayClient('https://relay.example', token, fetcher);
  try {
    const op = await mac.create('MindNote', { title: 'SECRET-TITLE', content: '<p>From Mac</p>' });
    await exchangeReplica(mac, relay); await exchangeReplica(phone, phoneRelay);
    assert.equal((await phone.record(op.record)).versions[0].payload.title, 'SECRET-TITLE');
    await phone.change(op.record, { ...op.payload, content: '<p>From phone offline</p>' });
    await exchangeReplica(phone, phoneRelay); await exchangeReplica(mac, relay);
    assert.equal((await mac.record(op.record)).versions[0].payload.content, '<p>From phone offline</p>');
    assert.equal(a.pending().length, 0); assert.equal(b.pending().length, 0);
    await publishReceipt({replica:phone,identity:second,relay:phoneRelay});
    const receipts=await readReceipts(mac,identity,relay);assert.equal(receipts.length,1);assert.equal(receipts[0].deviceId,second.deviceId);assert.equal(receipts[0].matchesCurrentHeads,true);assert.equal(receipts[0].pending,0);
    assert.equal(JSON.stringify(env.DB.db.prepare('SELECT envelope FROM receipts').all()).includes('SECRET-TITLE'),false);
    await assert.rejects(phoneRelay.request('/api/receipts'),{code:'OWNER_REQUIRED'});
    assert.equal(env.DB.db.prepare('SELECT count(*) AS n FROM operations').get().n, 2);
    assert.equal(JSON.stringify(env.DB.db.prepare('SELECT descriptor FROM operations').all()).includes('SECRET-TITLE'), false);
    await assert.rejects(new RelayClient('https://relay.example', randomSecret(), fetcher).request('/api/operations'), { code: 'UNAUTHORIZED' });
    const other = await setup();
    assert.equal((await other.relay.request('/api/operations')).operations.length, 0); other.env.DB.db.close();
    const request = new Request('https://relay.example/api/status', { headers: { Origin: 'https://evil.example', Authorization: `Bearer ${token}` } });
    assert.equal((await worker.fetch(request, env)).status, 403);
    await relay.request('/api/devices/revoke', { method: 'POST', body: { deviceId: second.deviceId } });
    await assert.rejects(phoneRelay.request('/api/operations'), { code: 'UNAUTHORIZED' });
  } finally { a.close(); b.close(); env.DB.db.close(); }
});
test('pairing tickets are one-use, cryptographically wrapped and expire', async () => {
  const { env, identity, fetcher, relay } = await setup(), syncKey = randomSecret();
  const invitation = await createInvitation(relay, { identity, syncKey });
  const previousFetch = globalThis.fetch; globalThis.fetch = fetcher;
  try {
    const phone = await consumeInvitation(invitation.code);
    assert.equal(phone.syncKey, syncKey); assert.equal(phone.identity.slot, 2);
    assert.equal(env.DB.db.prepare('SELECT bundle FROM invitations').get().bundle.includes(syncKey), false);
    await assert.rejects(consumeInvitation(invitation.code), { code: 'PAIRING_EXPIRED' });
  } finally { globalThis.fetch = previousFetch; env.DB.db.close(); }
});
test('a chunk that exceeds hard capacity fails without accepting an operation', async () => {
  const { env, relay } = await setup();
  try {
    env.DB.db.prepare('UPDATE capacity SET bytes=400000000').run();
    const bytes = new Uint8Array([1, 2, 3]), hash = await hexDigest(bytes);
    await assert.rejects(relay.request('/api/blobs/' + hash, { method: 'PUT', body: bytes, binary: true }), { code: 'CAPACITY_REACHED' });
    assert.equal(env.DB.db.prepare('SELECT count(*) AS n FROM blobs').get().n, 0);
  } finally { env.DB.db.close(); }
});
