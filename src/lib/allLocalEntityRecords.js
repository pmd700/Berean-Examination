const DEFAULT_PAGE_SIZE = 1000;
const MAX_PAGE_SIZE = 5000;
const MAX_RECORDS = 50_000;

function compareValues(left, right) {
  if (left === right) return 0;
  if (left === null || left === undefined) return 1;
  if (right === null || right === undefined) return -1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right));
}

function sortedRecords(records, sort) {
  if (typeof sort !== 'string' || !/^-?[A-Za-z][A-Za-z0-9_]{0,119}$/.test(sort)) {
    throw new TypeError('Library export received an invalid entity sort.');
  }
  const descending = sort.startsWith('-');
  const field = descending ? sort.slice(1) : sort;
  return [...records].sort((left, right) => {
    const comparison = compareValues(left?.[field], right?.[field]);
    return descending ? -comparison : comparison;
  });
}

/**
 * Exhausts the cursor API exposed by a local entity client.
 *
 * Pages are always read in monotonically increasing local-id order. The final
 * in-memory sort preserves the familiar entity-list ordering without using an
 * offset cursor that could skip records when an earlier row is inserted or
 * deleted during a long export.
 * @param {any} entityClient
 * @param {{sort?: string, filter?: object, pageSize?: number, maxRecords?: number, signal?: AbortSignal}} [options]
 */
export async function listAllEntityRecords(entityClient, {
  sort = '-updated_date',
  filter = {},
  pageSize = DEFAULT_PAGE_SIZE,
  maxRecords = MAX_RECORDS,
  signal,
} = {}) {
  if (!entityClient || typeof entityClient.listPage !== 'function') {
    throw new TypeError('Library export requires a paginated local entity client.');
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new RangeError(`Library export page size must be between 1 and ${MAX_PAGE_SIZE}.`);
  }
  if (
    !Number.isSafeInteger(maxRecords)
    || maxRecords < 1
    || maxRecords > MAX_RECORDS
  ) {
    throw new RangeError(
      `Library export record limit must be between 1 and ${MAX_RECORDS}.`,
    );
  }

  const records = [];
  const seenIds = new Set();
  let cursor = null;

  while (true) {
    if (signal?.aborted) throw new DOMException('Export canceled.', 'AbortError');
    const page = await entityClient.listPage({ cursor, filter, limit: pageSize });
    if (signal?.aborted) throw new DOMException('Export canceled.', 'AbortError');
    if (!page || !Array.isArray(page.records) || page.records.length > pageSize) {
      throw new Error('The local entity page was invalid.');
    }

    if (records.length + page.records.length > maxRecords) {
      throw new RangeError(`Library export exceeded the ${maxRecords}-record safety limit.`);
    }

    let previousId = cursor || 0;
    for (const record of page.records) {
      const id = Number(record?.id);
      if (!Number.isSafeInteger(id) || id < 1 || (cursor !== null && id <= cursor)) {
        throw new Error('The local entity page did not advance in id order.');
      }
      if (seenIds.has(id)) throw new Error('The local entity page contained a duplicate record.');
      if (id <= previousId) throw new Error('The local entity page did not advance in id order.');
      seenIds.add(id);
      records.push(record);
      previousId = id;
    }

    if (page.nextCursor === null || page.nextCursor === undefined) break;
    const nextCursor = Number(page.nextCursor);
    if (
      !Number.isSafeInteger(nextCursor)
      || nextCursor < 1
      || (cursor !== null && nextCursor <= cursor)
      || page.records.length === 0
      || nextCursor !== previousId
    ) {
      throw new Error('The local entity cursor did not advance.');
    }
    cursor = nextCursor;
  }

  return sortedRecords(records, sort);
}

