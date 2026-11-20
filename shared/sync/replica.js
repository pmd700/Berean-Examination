import { createOperation, recordKey, canonicalJson, syncError } from './protocol.js';
import { reconcileOperations, prepareDecodedOperation } from './reconcile.js';
import { requireUuid, allocatedRecordId } from './identity.js';
import { sealJson, openJson, operationPurpose, hashBytes } from './crypto.js';
const encoder = new TextEncoder();
const indexKey = record => hashBytes(encoder.encode(recordKey(record)));
const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));
function freezeTree(value) {
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freezeTree(child);Object.freeze(value);}return value;
}

// Both adapters commit encrypted operations, sequence allocation, outbox and
// receive cursors atomically. Crypto happens before a short compare-and-swap.
export class SyncReplica {
  constructor(store, key) { this.store = store; this.key = key; this.decoded = new Map(); this.groups = new Map(); this.snapshot = null; }
  assertUnlocked() { if (!this.key) throw syncError('BEX_SYNC_LOCKED', 'Unlock before accessing this replica.'); }
  async decode(row, identity) {
    this.assertUnlocked();
    const cached=this.decoded.get(row.id),scope=operationPurpose(identity,row.id);
    if(cached?.key===this.key&&cached.scope===scope&&cached.envelope.format===row.envelope.format&&cached.envelope.iv===row.envelope.iv&&cached.envelope.ciphertext===row.envelope.ciphertext)return cached.operation;
    const operation = prepareDecodedOperation(await openJson(this.key, row.envelope, operationPurpose(identity, row.id)));
    if (operation.id !== row.id || operation.vaultId !== identity.vaultId || operation.epoch !== identity.epoch) throw syncError('BEX_SYNC_SCOPE_MISMATCH', 'Encrypted operation scope does not match this library.');
    this.assertUnlocked();
    freezeTree(operation);
    this.decoded.set(row.id,{key:this.key,scope,envelope:{...row.envelope},operation});
    return operation;
  }
  async record(record) {
    this.assertUnlocked();
    const meta = await this.store.meta();
    const rows = await this.store.record(await indexKey(record));
    const operations = await Promise.all(rows.map(row => this.decode(row, meta.identity)));
    return reconcileOperations({ ...meta.identity, operations }).records[0] || null;
  }
  async change(record, payload, { action = 'put', resolveParents = null, baseParents = null } = {}) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const meta = await this.store.meta();
      const key = await indexKey(record);
      const rows = await this.store.record(key);
      const operations = await Promise.all(rows.map(row => this.decode(row, meta.identity)));
      const current = reconcileOperations({ ...meta.identity, operations }).records[0];
      const heads = current?.versions.map(op => op.id).sort() || [];
      const parents = baseParents ? [...baseParents].sort() : heads;
      if (baseParents && baseParents.some(id => !operations.some(op => op.id === id))) throw syncError('BEX_SYNC_BASE_MISSING', 'The edit base is missing; preserve the draft and reload its history.');
      if (current?.status === 'conflict' && !baseParents && canonicalJson(resolveParents) !== canonicalJson(heads)) throw syncError('BEX_SYNC_CONFLICT', 'Resolve both versions explicitly before saving this record.');
      if (resolveParents && canonicalJson([...resolveParents].sort()) !== canonicalJson(heads)) throw syncError('BEX_SYNC_CONFLICT', 'This record changed while resolving it.');
      const operation = createOperation({ ...meta.identity, sequence: meta.sequence + 1, record, parents, action, payload });
      const row = { id: operation.id, key, envelope: await sealJson(this.key, operation, operationPurpose(meta.identity, operation.id)), pending: 1 };
      this.assertUnlocked();
      if (await this.store.commit(meta.version, { rows: [row], sequence: operation.sequence })) return operation;
    }
    throw syncError('BEX_SYNC_BUSY', 'Concurrent saves are busy; retry without discarding your edit.');
  }
  async create(kind, payload) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const meta = await this.store.meta();
      const id = allocatedRecordId(meta.identity.slot, meta.counter + 1);
      const record = { kind, id: String(id) };
      const operation = createOperation({ ...meta.identity, sequence: meta.sequence + 1, record, payload: { ...payload, id } });
      const row = { id: operation.id, key: await indexKey(record), envelope: await sealJson(this.key, operation, operationPurpose(meta.identity, operation.id)), pending: 1 };
      this.assertUnlocked();
      if (await this.store.commit(meta.version, { rows: [row], sequence: operation.sequence, counter: meta.counter + 1 })) return operation;
    }
    throw syncError('BEX_SYNC_BUSY', 'Concurrent creation is busy; retry.');
  }
  async receive(batch, { baseCursor, cursor }) {
    if (!Array.isArray(batch) || batch.length > 32 || !Number.isSafeInteger(cursor) || cursor < baseCursor) throw new TypeError('Invalid incoming batch.');
    for (let attempt = 0; attempt < 20; attempt++) {
      const meta = await this.store.meta();
      if (meta.cursor !== baseCursor) throw syncError('BEX_SYNC_CURSOR_CHANGED', 'Retry pulling from the last durable cursor.');
      const groups = new Map(), rows = [];
      for (const incoming of batch) {
        const op = await this.decode(incoming, meta.identity), key = await indexKey(op.record);
        if (!groups.has(key)) {
          const history = await this.store.record(key);
          groups.set(key, await Promise.all(history.map(row => this.decode(row, meta.identity))));
        }
        groups.get(key).push(op);
        rows.push({ id: op.id, key, envelope: incoming.envelope, pending: 0 });
      }
      for (const operations of groups.values()) reconcileOperations({ ...meta.identity, operations });
      this.assertUnlocked();
      if (await this.store.commit(meta.version, { rows, cursor })) return true;
    }
    throw syncError('BEX_SYNC_BUSY', 'Receive is busy; the cursor has not advanced.');
  }
  async acknowledge(ids) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const meta = await this.store.meta();
      this.assertUnlocked();
      if (await this.store.commit(meta.version, { ack: ids })) return;
    }
    throw syncError('BEX_SYNC_BUSY', 'Acknowledgements will be retried.');
  }
  async records() {
    this.assertUnlocked();
    const meta = await this.store.meta();
    if(this.snapshot?.version===meta.version)return this.snapshot.state;
    // Native operation rows are append-only. Reading only new rows avoids
    // reparsing hundreds of MB of encrypted history after each autosave.
    let appended=this.store.rowsAfter?await this.store.rowsAfter(this.storageCursor||0):null;
    const rows=appended?appended.rows:await this.store.all(),operations=appended&&this.snapshot?[...this.snapshot.state.operations]:[];
    // Bound crypto work and yield between batches so a cold library does not
    // monopolize Electron's main event loop while the user is typing.
    for(let offset=0;offset<rows.length;offset+=32){operations.push(...await Promise.all(rows.slice(offset,offset+32).map(row=>this.decode(row,meta.identity))));if(offset+32<rows.length)await yieldTask();}
    while(appended?.hasMore){await yieldTask();this.assertUnlocked();appended=await this.store.rowsAfter(appended.cursor);operations.push(...await Promise.all(appended.rows.map(row=>this.decode(row,meta.identity))));}
    const byId=new Map(operations.map(op=>[op.id,op])),grouped=new Map();
    for(const op of operations){const key=recordKey(op.record);for(const parentId of op.parents){const parent=byId.get(parentId);if(parent&&recordKey(parent.record)!==key)throw new TypeError('A revision parent belongs to a different record.');}if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(op);}
    const records=[],pending=[],nextGroups=new Map();let count=0;
    for(const [key,history]of grouped){
      const previous=this.groups.get(key),same=previous&&previous.history.length===history.length&&history.every((op,index)=>previous.history[index]===op);
      const state=same?previous.state:freezeTree(reconcileOperations({...meta.identity,operations:history}));
      nextGroups.set(key,{history,state});records.push(...state.records);pending.push(...state.pending);
      if(++count%32===0)await yieldTask();
    }
    this.assertUnlocked();
    const sort=(a,b)=>a<b?-1:a>b?1:0;
    const state=Object.freeze({operations:Object.freeze(operations.sort((a,b)=>sort(a.id,b.id))),records:Object.freeze(records.sort((a,b)=>sort(a.key,b.key))),pending:Object.freeze(pending.sort((a,b)=>sort(a.id,b.id)))});
    this.groups=nextGroups;this.storageCursor=appended?.cursor||0;this.snapshot={version:meta.version,state};return state;
  }
  lock() { this.key = null; this.decoded.clear(); this.groups.clear(); this.snapshot=null;this.storageCursor=0; }
}
export function validateReplicaIdentity(identity) {
  for (const field of ['vaultId', 'epoch', 'deviceId']) requireUuid(identity[field]);
  allocatedRecordId(identity.slot, 1);
  return identity;
}
