import { canonicalJson, recordKey, syncError, validateOperation } from './protocol.js';
import { requireUuid } from './identity.js';

// Pure reference reducer. A later SQLite/IndexedDB adapter must commit returned
// operations, inbox/outbox, and cursors together. This is NOT durable storage.
export function reconcileOperations({ vaultId, epoch, operations }) {
  requireUuid(vaultId); requireUuid(epoch);
  if (!Array.isArray(operations)) throw new TypeError('Expected a sync operation batch.');
  const byId = new Map();
  const bodies = new Map();
  for (const input of operations) {
    const op = validateOperation(input);
    if (op.vaultId !== vaultId || op.epoch !== epoch) throw syncError('BEX_SYNC_SCOPE_MISMATCH', 'Different vault or recovery epoch.');
    const body = canonicalJson(op);
    if (byId.has(op.id) && bodies.get(op.id) !== body) {
      throw syncError('BEX_SYNC_REPLAY_MISMATCH', 'An operation identity was reused with different content.');
    }
    byId.set(op.id, op); bodies.set(op.id, body);
  }

  // Topological ordering uses only causality. Clocks and delivery order never
  // choose which version of a note survives.
  const children = new Map();
  const remaining = new Map();
  for (const op of byId.values()) {
    remaining.set(op.id, op.parents.length);
    for (const parentId of op.parents) {
      const parent = byId.get(parentId);
      if (parent && recordKey(parent.record) !== recordKey(op.record)) {
        throw new TypeError('A revision parent belongs to a different record.');
      }
      if (!children.has(parentId)) children.set(parentId, []);
      children.get(parentId).push(op.id);
    }
  }
  const ready = [...byId.keys()].filter((id) => remaining.get(id) === 0);
  const accepted = new Set();
  const heads = new Map();
  for (let index = 0; index < ready.length; index += 1) {
    const id = ready[index];
    const op = byId.get(id);
    accepted.add(id);
    const key = recordKey(op.record);
    if (!heads.has(key)) heads.set(key, new Set());
    for (const parent of op.parents) heads.get(key).delete(parent);
    heads.get(key).add(id);
    for (const child of children.get(id) || []) {
      remaining.set(child, remaining.get(child) - 1);
      if (remaining.get(child) === 0) ready.push(child);
    }
  }

  // Missing ancestors are kept pending. Distinguish them from a closed cycle,
  // which is invalid even if an unrelated operation also has missing history.
  const waiting = new Set([...byId.keys()].filter((id) => !accepted.has(id)));
  const missing = new Set([...waiting].filter((id) => byId.get(id).parents.some((parent) => !byId.has(parent))));
  const missingQueue = [...missing];
  for (let index = 0; index < missingQueue.length; index += 1) {
    for (const child of children.get(missingQueue[index]) || []) {
      if (!missing.has(child)) { missing.add(child); missingQueue.push(child); }
    }
  }
  // Check cycles using known edges independently of missing-history flags.
  const knownCounts = new Map([...byId.values()].map((op) => [op.id, op.parents.filter((parent) => byId.has(parent)).length]));
  const acyclic = [...byId.keys()].filter((id) => knownCounts.get(id) === 0);
  for (let index = 0; index < acyclic.length; index += 1) {
    for (const child of children.get(acyclic[index]) || []) {
      knownCounts.set(child, knownCounts.get(child) - 1);
      if (knownCounts.get(child) === 0) acyclic.push(child);
    }
  }
  if (acyclic.length !== byId.size) throw syncError('BEX_SYNC_CAUSAL_CYCLE', 'Invalid circular revision history.');

  const records = [...heads.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, ids]) => {
    const versions = [...ids].sort().map((id) => byId.get(id));
    return Object.freeze({
      key, record: versions[0].record,
      status: versions.length > 1 ? 'conflict' : versions[0].action === 'delete' ? 'deleted' : 'current',
      versions: Object.freeze(versions),
    });
  });
  return Object.freeze({
    operations: Object.freeze([...byId.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    records: Object.freeze(records),
    pending: Object.freeze([...waiting].sort().map((id) => byId.get(id))),
  });
}
