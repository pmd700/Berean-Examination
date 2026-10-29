import { ENTITY_TABLES, STRING_RECORD_KINDS, assertVaultRelativePath } from './catalog.js';
import { operationId, requireOperationId, requireRecordId, requireUuid } from './identity.js';

export const PROTOCOL_VERSION = 1;
export const SCHEMA_VERSION = 1;
export const MAX_OPERATION_BYTES = 34 * 1024 * 1024;
export const MAX_PARENTS = 128;
const encoder = new TextEncoder();

export function syncError(code, message) {
  return Object.assign(new Error(message), { code });
}

export function assertVersion(version, expected, name) {
  if (version !== expected) throw syncError('BEX_SYNC_VERSION_UNSUPPORTED', `Unsupported ${name}; update before applying data.`);
}

// Canonical JSON detects changed replays without silently dropping undefined,
// unsupported objects, accessors, holes, non-finite numbers, or nested fields.
export function canonicalJson(value, maxBytes = MAX_OPERATION_BYTES) {
  const ancestors = new Set();
  function encode(item, depth) {
    if (depth > 64) throw new RangeError('Sync JSON is too deeply nested.');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (typeof item !== 'object' || ancestors.has(item)) throw new TypeError('Sync data must be lossless JSON.');
    const array = Array.isArray(item);
    if (!array && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
      throw new TypeError('Sync data must contain plain JSON objects.');
    }
    ancestors.add(item);
    const keys = Reflect.ownKeys(item).filter((key) => !(array && key === 'length'));
    if (keys.some((key) => typeof key !== 'string'
      || !Object.getOwnPropertyDescriptor(item, key)?.enumerable
      || !Object.hasOwn(Object.getOwnPropertyDescriptor(item, key), 'value'))) {
      throw new TypeError('Sync data cannot contain hidden or computed fields.');
    }
    let result;
    if (array) {
      if (keys.length !== item.length || keys.some((key, index) => key !== String(index))) {
        throw new TypeError('Sync arrays cannot contain holes or extra properties.');
      }
      result = `[${item.map((entry) => encode(entry, depth + 1)).join(',')}]`;
    } else {
      result = `{${keys.sort().map((key) => `${JSON.stringify(key)}:${encode(item[key], depth + 1)}`).join(',')}}`;
    }
    ancestors.delete(item);
    return result;
  }
  const text = encode(value, 0);
  if (encoder.encode(text).byteLength > maxBytes) throw new RangeError('Sync JSON exceeds the supported size.');
  return text;
}

function exactFields(value, fields) {
  if (!value || Array.isArray(value) || typeof value !== 'object'
    || Object.keys(value).length !== fields.length || fields.some((key) => !Object.hasOwn(value, key))) {
    throw new TypeError('Invalid sync record shape.');
  }
}

export function recordKey(ref) {
  exactFields(ref, ['kind', 'id']);
  if (Object.hasOwn(ENTITY_TABLES, ref.kind)) {
    if (typeof ref.id !== 'string' || !/^[1-9]\d*$/.test(ref.id)
      || String(requireRecordId(Number(ref.id))) !== ref.id) throw new TypeError('Invalid entity reference.');
  } else if (STRING_RECORD_KINDS.includes(ref.kind)) {
    if (typeof ref.id !== 'string' || !ref.id || ref.id.length > 2048 || /[\u0000-\u001f\u007f]/u.test(ref.id)) {
      throw new TypeError('Invalid sync record reference.');
    }
    if (ref.kind === 'VaultFile') assertVaultRelativePath(ref.id);
  } else {
    throw syncError('BEX_SYNC_KIND_UNSUPPORTED', 'Unrecognized vault record type; preserve the incoming data and update.');
  }
  return JSON.stringify([ref.kind, ref.id]);
}

function freezeJson(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeJson);
    Object.freeze(value);
  }
  return value;
}

export function validateOperation(input) {
  // Own a frozen JSON copy so later caller mutations cannot rewrite history.
  const value = JSON.parse(canonicalJson(input));
  exactFields(value, ['protocolVersion', 'schemaVersion', 'vaultId', 'epoch', 'deviceId', 'sequence', 'id', 'record', 'parents', 'action', 'payload']);
  assertVersion(value.protocolVersion, PROTOCOL_VERSION, 'sync protocol');
  assertVersion(value.schemaVersion, SCHEMA_VERSION, 'record schema');
  requireUuid(value.vaultId); requireUuid(value.epoch); requireUuid(value.deviceId);
  if (operationId(value.deviceId, value.sequence) !== value.id) throw new TypeError('Mismatched operation identity.');
  recordKey(value.record);
  if (!Array.isArray(value.parents) || value.parents.length > MAX_PARENTS
    || new Set(value.parents).size !== value.parents.length) throw new TypeError('Invalid revision parents.');
  for (const parent of value.parents) {
    requireOperationId(parent);
    const [device, sequence] = parent.split(':');
    if (device === value.deviceId && Number(sequence) >= value.sequence) throw new TypeError('A revision cannot precede itself.');
  }
  if (!['put', 'delete'].includes(value.action) || (value.action === 'delete' && value.payload !== null)) {
    throw new TypeError('Invalid sync mutation.');
  }
  if (value.action === 'put' && (!value.payload || Array.isArray(value.payload) || typeof value.payload !== 'object')) {
    throw new TypeError('Sync record content must be a JSON object.');
  }
  if (value.action === 'put' && Object.hasOwn(ENTITY_TABLES, value.record.kind)
    && Object.hasOwn(value.payload, 'id') && String(value.payload.id) !== value.record.id) {
    throw new TypeError('The payload changed an existing entity identity.');
  }
  return freezeJson(value);
}

export function createOperation({ vaultId, epoch, deviceId, sequence, record, parents = [], action = 'put', payload = null }) {
  return validateOperation({
    protocolVersion: PROTOCOL_VERSION, schemaVersion: SCHEMA_VERSION,
    vaultId, epoch, deviceId, sequence, id: operationId(deviceId, sequence), record,
    parents: [...parents].sort(), action, payload,
  });
}
