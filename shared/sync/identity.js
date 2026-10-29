// Existing hyperlinks and desktop APIs require positive safe integers.
export const ID_RANGE_SIZE = 2 ** 32;
export const MAX_DEVICE_SLOT = 2 ** 21 - 1;

export function requireRecordId(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('Invalid numeric record ID.');
  return value;
}

export function requireUuid(value) {
  if (typeof value !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) {
    throw new TypeError('Invalid sync identity.');
  }
  return value;
}

export function allocatedRecordId(slot, counter) {
  if (!Number.isSafeInteger(slot) || slot < 1 || slot > MAX_DEVICE_SLOT
    || !Number.isSafeInteger(counter) || counter < 1 || counter >= ID_RANGE_SIZE) {
    throw new RangeError('Invalid or exhausted sync ID allocation.');
  }
  return requireRecordId(slot * ID_RANGE_SIZE + counter);
}

// Pairing must grant a unique slot and persist it transactionally. This helper
// only selects a candidate: it does not provide a distributed reservation lock.
export function nextAvailableDeviceSlot(existingIds, reservedSlots = []) {
  const unavailable = new Set(reservedSlots);
  for (const slot of unavailable) {
    if (!Number.isSafeInteger(slot) || slot < 1 || slot > MAX_DEVICE_SLOT) {
      throw new RangeError('Invalid reserved device slot.');
    }
  }
  for (const id of existingIds) {
    requireRecordId(id);
    // Reserve a whole range even when a legacy import used only one ID in it.
    const slot = Math.floor(id / ID_RANGE_SIZE);
    if (slot > 0) unavailable.add(slot);
  }
  for (let slot = 1; slot <= MAX_DEVICE_SLOT; slot += 1) {
    if (!unavailable.has(slot)) return slot;
  }
  throw new RangeError('No sync ID allocation is available.');
}

export function operationId(deviceId, sequence) {
  requireUuid(deviceId);
  requireRecordId(sequence);
  return `${deviceId}:${sequence}`;
}

export function requireOperationId(value) {
  if (typeof value !== 'string') throw new TypeError('Invalid operation ID.');
  const [device, sequence, extra] = value.split(':');
  if (extra !== undefined || !/^[1-9]\d*$/.test(sequence || '')
    || operationId(device, Number(sequence)) !== value) throw new TypeError('Invalid operation ID.');
  return value;
}
