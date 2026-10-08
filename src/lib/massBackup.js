import JSZip from 'jszip';

const MASS_BACKUP_MANIFEST_NAME = '_bex-mass-backup.json';
const MASS_BACKUP_SIGNATURE = 'bex-mass-backup';
const MASS_BACKUP_VERSION = 1;
const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 16;
const DEFAULT_PAGE_SIZE = 1000;
const MAX_PAGE_SIZE = 5000;
const FILE_NAME_ENCODER = new TextEncoder();
const MEBIBYTE = 1024 * 1024;

/**
 * Hard renderer-memory ceilings for one Mass Backup run.
 *
 * Callers may lower these values (primarily useful for tests or constrained
 * devices), but cannot raise them. The archive builder necessarily returns
 * complete Uint8Arrays to Electron, so keeping both raw input and completed ZIP
 * output bounded is the last line of defence against exhausting the renderer.
 */
export const MASS_BACKUP_DEFAULT_LIMITS = Object.freeze({
  maxArtifactBytes: 64 * MEBIBYTE,
  maxCategoryRawBytes: 128 * MEBIBYTE,
  maxArchiveBytes: 160 * MEBIBYTE,
  maxTotalArchiveBytes: 256 * MEBIBYTE,
  maxItemsPerCategory: 50_000,
  maxTotalItems: 100_000,
});

const MASS_BACKUP_LIMIT_KEYS = Object.freeze(Object.keys(MASS_BACKUP_DEFAULT_LIMITS));

/**
 * The only three record families Mass Backup is allowed to package.
 *
 * Keeping this closed list in the pure archive layer makes Bible chapters
 * impossible to include accidentally: there is no StudyChapter collection,
 * serializer branch, extension, or archive kind here.
 */
export const MASS_BACKUP_CATEGORY_SPECS = Object.freeze([
  Object.freeze({
    collection: 'webs',
    extension: 'berean',
    itemKind: 'web',
    kind: 'knowledge',
  }),
  Object.freeze({
    collection: 'notes',
    extension: 'md',
    itemKind: 'note',
    kind: 'notes',
  }),
  Object.freeze({
    collection: 'timelines',
    extension: 'json',
    itemKind: 'timeline',
    kind: 'timelines',
  }),
]);

function compareValues(left, right) {
  if (left === right) return 0;
  if (left === null || left === undefined) return 1;
  if (right === null || right === undefined) return -1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right));
}

function sortedRecords(records, sort) {
  if (typeof sort !== 'string' || !/^-?[A-Za-z][A-Za-z0-9_]{0,119}$/.test(sort)) {
    throw new TypeError('Mass Backup received an invalid entity sort.');
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
 * deleted during a long backup.
 */
export async function listAllEntityRecords(entityClient, {
  sort = '-updated_date',
  filter = {},
  pageSize = DEFAULT_PAGE_SIZE,
  maxRecords = MASS_BACKUP_DEFAULT_LIMITS.maxItemsPerCategory,
} = {}) {
  if (!entityClient || typeof entityClient.listPage !== 'function') {
    throw new TypeError('Mass Backup requires a paginated local entity client.');
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new RangeError(`Mass Backup page size must be between 1 and ${MAX_PAGE_SIZE}.`);
  }
  if (
    !Number.isSafeInteger(maxRecords)
    || maxRecords < 1
    || maxRecords > MASS_BACKUP_DEFAULT_LIMITS.maxItemsPerCategory
  ) {
    throw new RangeError(
      `Mass Backup record limit must be between 1 and ${MASS_BACKUP_DEFAULT_LIMITS.maxItemsPerCategory}.`,
    );
  }

  const records = [];
  const seenIds = new Set();
  let cursor = null;

  while (true) {
    const page = await entityClient.listPage({ cursor, filter, limit: pageSize });
    if (!page || !Array.isArray(page.records) || page.records.length > pageSize) {
      throw new Error('The local entity page was invalid.');
    }

    if (records.length + page.records.length > maxRecords) {
      throw new RangeError(`Mass Backup exceeded the ${maxRecords}-record safety limit.`);
    }

    for (const record of page.records) {
      const id = Number(record?.id);
      if (!Number.isSafeInteger(id) || id < 1 || (cursor !== null && id <= cursor)) {
        throw new Error('The local entity page did not advance in id order.');
      }
      if (seenIds.has(id)) throw new Error('The local entity page contained a duplicate record.');
      seenIds.add(id);
      records.push(record);
    }

    if (page.nextCursor === null || page.nextCursor === undefined) break;
    const nextCursor = Number(page.nextCursor);
    if (
      !Number.isSafeInteger(nextCursor)
      || nextCursor < 1
      || (cursor !== null && nextCursor <= cursor)
      || (page.records.length > 0 && nextCursor < Number(page.records.at(-1)?.id))
    ) {
      throw new Error('The local entity cursor did not advance.');
    }
    cursor = nextCursor;
  }

  return sortedRecords(records, sort);
}

function truncateUtf8(value, maxBytes) {
  let result = '';
  let usedBytes = 0;
  for (const character of value) {
    const characterBytes = FILE_NAME_ENCODER.encode(character).byteLength;
    if (usedBytes + characterBytes > maxBytes) break;
    result += character;
    usedBytes += characterBytes;
  }
  return result;
}

function safeTitle(value) {
  const cleaned = String(value ?? '')
    .normalize('NFC')
    .replace(/[/\\]+/g, '-')
    .replace(/[<>:"|?*\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.\s]+$/g, '');
  // Leave room for the stable kind/id suffix under common 255-byte filename
  // limits. Iterating code points avoids cutting a UTF-16 surrogate pair, and
  // counting encoded bytes keeps emoji/CJK titles within the same bound.
  return truncateUtf8(cleaned || 'Untitled', 140);
}

function safeId(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string') {
    const cleaned = value.trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    if (cleaned) return cleaned.slice(0, 80);
  }
  throw new Error('A Mass Backup item has no safe stable id.');
}

function uniqueEntryName(baseName, usedNames) {
  const collisionKey = baseName.toLocaleLowerCase();
  if (!usedNames.has(collisionKey)) {
    usedNames.add(collisionKey);
    return baseName;
  }
  const dot = baseName.lastIndexOf('.');
  const stem = dot < 0 ? baseName : baseName.slice(0, dot);
  const extension = dot < 0 ? '' : baseName.slice(dot);
  let suffix = 2;
  let candidate = `${stem} (${suffix})${extension}`;
  while (usedNames.has(candidate.toLocaleLowerCase())) {
    suffix += 1;
    candidate = `${stem} (${suffix})${extension}`;
  }
  usedNames.add(candidate.toLocaleLowerCase());
  return candidate;
}

function baseEntryName(spec, item, artifact) {
  const title = artifact && typeof artifact === 'object' && !ArrayBuffer.isView(artifact)
    ? artifact.title ?? item?.title
    : item?.title;
  const id = artifact && typeof artifact === 'object' && !ArrayBuffer.isView(artifact)
    ? artifact.id ?? item?.id
    : item?.id;
  return `${safeTitle(title)} - ${spec.itemKind}-${safeId(id)}.${spec.extension}`;
}

function artifactContent(artifact) {
  if (artifact && typeof artifact === 'object' && !ArrayBuffer.isView(artifact)) {
    if (Object.prototype.hasOwnProperty.call(artifact, 'content')) return artifact.content;
    if (Object.prototype.hasOwnProperty.call(artifact, 'bytes')) return artifact.bytes;
  }
  return artifact;
}

function validZipContent(content) {
  if (typeof content === 'string') return true;
  if (content instanceof ArrayBuffer || ArrayBuffer.isView(content)) return true;
  return typeof Blob !== 'undefined' && content instanceof Blob;
}

function normalizeLimits(overrides) {
  if (overrides === undefined) return MASS_BACKUP_DEFAULT_LIMITS;
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new TypeError('Mass Backup limits must be an object.');
  }
  for (const key of Object.keys(overrides)) {
    if (!MASS_BACKUP_LIMIT_KEYS.includes(key)) {
      throw new TypeError(`Mass Backup received an unknown limit: ${key}.`);
    }
  }
  const normalized = {};
  for (const key of MASS_BACKUP_LIMIT_KEYS) {
    const ceiling = MASS_BACKUP_DEFAULT_LIMITS[key];
    const value = Object.prototype.hasOwnProperty.call(overrides, key)
      ? overrides[key]
      : ceiling;
    if (!Number.isSafeInteger(value) || value < 1 || value > ceiling) {
      throw new RangeError(`Mass Backup ${key} must be between 1 and ${ceiling}.`);
    }
    normalized[key] = value;
  }
  return Object.freeze(normalized);
}

function utf8ByteLengthAtMost(value, stopAfter) {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) bytes += 1;
    else if (codeUnit <= 0x7ff) bytes += 2;
    else if (
      codeUnit >= 0xd800
      && codeUnit <= 0xdbff
      && value.charCodeAt(index + 1) >= 0xdc00
      && value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
    if (bytes > stopAfter) return stopAfter + 1;
  }
  return bytes;
}

function contentByteLength(content, stopAfter) {
  if (typeof content === 'string') return utf8ByteLengthAtMost(content, stopAfter);
  if (content instanceof ArrayBuffer || ArrayBuffer.isView(content)) return content.byteLength;
  if (typeof Blob !== 'undefined' && content instanceof Blob) return content.size;
  return null;
}

function readableByteLimit(bytes) {
  return bytes % MEBIBYTE === 0 ? `${bytes / MEBIBYTE} MiB` : `${bytes} bytes`;
}

function categoryLimitError(message) {
  return new RangeError(message);
}

/**
 * JSZip's `generateAsync` retains every output chunk and then concatenates it,
 * with no size ceiling. Listen to its public internal stream instead so chunks
 * beyond the configured ceiling are discarded rather than accumulated.
 */
function generateBoundedZipBytes(zip, maxBytes, limitMessage) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let exceeded = false;
    let settled = false;

    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      reject(error);
    };

    zip.generateInternalStream({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
      streamFiles: true,
    })
      .on('data', (chunk) => {
        if (settled || exceeded) return;
        const chunkBytes = chunk?.byteLength;
        if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 0) {
          exceeded = true;
          rejectOnce(new Error('Mass Backup received an invalid ZIP output chunk.'));
          return;
        }
        if (totalBytes + chunkBytes > maxBytes) {
          exceeded = true;
          chunks.length = 0;
          return;
        }
        chunks.push(chunk);
        totalBytes += chunkBytes;
      })
      .on('error', rejectOnce)
      .on('end', () => {
        if (settled) return;
        if (exceeded) {
          rejectOnce(new RangeError(limitMessage));
          return;
        }
        try {
          const bytes = new Uint8Array(totalBytes);
          let offset = 0;
          for (let index = 0; index < chunks.length; index += 1) {
            const chunk = chunks[index];
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
            chunks[index] = null;
          }
          chunks.length = 0;
          settled = true;
          resolve(bytes);
        } catch (error) {
          rejectOnce(error);
        }
      })
      .resume();
  });
}

function failureFor(spec, item, error, stage = 'artifact') {
  return Object.freeze({
    kind: spec.kind,
    itemId: item?.id ?? null,
    itemTitle: item?.title || null,
    message: error?.message || 'Mass Backup could not package this item.',
    stage,
  });
}

function reportProgress(onProgress, update) {
  if (typeof onProgress !== 'function') return;
  try {
    onProgress(Object.freeze(update));
  } catch {
    // A visual progress callback must never corrupt an otherwise valid backup.
  }
}

async function runBounded(jobs, concurrency, runJob) {
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const jobIndex = nextIndex;
      nextIndex += 1;
      if (jobIndex >= jobs.length) return;
      await runJob(jobs[jobIndex], jobIndex);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()),
  );
}

/**
 * Builds up to three independent, in-memory ZIP archives.
 *
 * `buildArtifact(kind, item, spec)` owns record serialization (and may load
 * Knowledge Web children or decrypt an unlocked private web). It may return a
 * string/byte value directly or `{ content|bytes, title?, id? }`. A title/id
 * override is useful for a decrypted private-web title; the archive builder
 * still owns collision-safe filenames.
 *
 * `limits` may contain lower overrides for MASS_BACKUP_DEFAULT_LIMITS. The
 * defaults remain absolute ceilings so a caller cannot accidentally disable
 * the renderer's memory safeguards.
 *
 * A category is atomic: one artifact or ZIP failure records a failure and
 * suppresses that entire archive. Other categories remain independent. Empty
 * categories are omitted and never produce placeholder ZIPs.
 */
export async function buildMassBackupArchives({
  webs = [],
  notes = [],
  timelines = [],
  buildArtifact,
  onProgress,
  concurrency = DEFAULT_CONCURRENCY,
  limits: limitOverrides,
} = {}) {
  if (typeof buildArtifact !== 'function') {
    throw new TypeError('Mass Backup requires an artifact builder.');
  }
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
    throw new RangeError(`Mass Backup concurrency must be between 1 and ${MAX_CONCURRENCY}.`);
  }
  const limits = normalizeLimits(limitOverrides);

  const collections = { webs, notes, timelines };
  for (const spec of MASS_BACKUP_CATEGORY_SPECS) {
    if (!Array.isArray(collections[spec.collection])) {
      throw new TypeError(`Mass Backup ${spec.collection} must be an array.`);
    }
    if (collections[spec.collection].length > limits.maxItemsPerCategory) {
      throw new RangeError(
        `Mass Backup ${spec.collection} exceeds the ${limits.maxItemsPerCategory}-item safety limit.`,
      );
    }
  }

  const totalItems = MASS_BACKUP_CATEGORY_SPECS.reduce(
    (total, spec) => total + collections[spec.collection].length,
    0,
  );
  if (totalItems > limits.maxTotalItems) {
    throw new RangeError(
      `Mass Backup exceeds the ${limits.maxTotalItems}-item total safety limit.`,
    );
  }

  const archives = [];
  const failures = [];
  const createdAt = new Date().toISOString();
  let totalCompleted = 0;
  let totalArchiveBytes = 0;

  reportProgress(onProgress, { phase: 'preparing', totalCompleted, totalItems });

  // Build and ZIP one category at a time. This retains at most one category's
  // raw file bodies instead of all notes, timelines, and webs simultaneously.
  for (const spec of MASS_BACKUP_CATEGORY_SPECS) {
    const items = collections[spec.collection];
    const artifacts = [];
    const categoryFailures = [];
    let categoryCompleted = 0;
    let categoryRawBytes = 0;
    let categoryAborted = false;
    let zip = null;

    try {
      await runBounded(items, concurrency, async (item, index) => {
        try {
          if (categoryAborted) return;
          const artifact = await buildArtifact(spec.kind, item, spec);
          // Another in-flight artifact may have failed while this one was being
          // serialized. Drop this result immediately rather than retaining raw
          // data for a category that can no longer be emitted atomically.
          if (categoryAborted) return;
          const content = artifactContent(artifact);
          if (!validZipContent(content)) {
            throw new Error('The Mass Backup artifact had no file content.');
          }
          const rawBytes = contentByteLength(content, limits.maxArtifactBytes);
          if (rawBytes === null) {
            throw new Error('The Mass Backup artifact had no measurable file content.');
          }
          if (rawBytes > limits.maxArtifactBytes) {
            throw categoryLimitError(
              `This Mass Backup item exceeds the ${readableByteLimit(limits.maxArtifactBytes)} raw-data safety limit.`,
            );
          }
          if (categoryRawBytes + rawBytes > limits.maxCategoryRawBytes) {
            throw categoryLimitError(
              `The ${spec.kind} Mass Backup exceeds the ${readableByteLimit(limits.maxCategoryRawBytes)} raw-data safety limit.`,
            );
          }

          // Resolve and sanitize the name now so the retained artifact entry is
          // only the ZIP body plus small scalar metadata. Any ancillary fields
          // returned by buildArtifact can be garbage-collected immediately.
          const baseName = baseEntryName(spec, item, artifact);
          categoryRawBytes += rawBytes;
          artifacts.push({ baseName, content, index });
        } catch (error) {
          if (!categoryAborted) {
            categoryFailures.push(failureFor(spec, item, error));
            categoryAborted = true;
          }
        } finally {
          categoryCompleted += 1;
          totalCompleted += 1;
          reportProgress(onProgress, {
            phase: 'building',
            kind: spec.kind,
            current: categoryCompleted,
            total: items.length,
            totalCompleted,
            totalItems,
          });
        }
      });

      failures.push(...categoryFailures);
      if (items.length === 0 || categoryFailures.length > 0) continue;

      reportProgress(onProgress, {
        phase: 'zipping',
        kind: spec.kind,
        current: artifacts.length,
        total: artifacts.length,
        totalCompleted,
        totalItems,
      });
      artifacts.sort((left, right) => left.index - right.index);
      zip = new JSZip();
      const usedNames = new Set([MASS_BACKUP_MANIFEST_NAME.toLocaleLowerCase()]);
      for (const entry of artifacts) {
        zip.file(uniqueEntryName(entry.baseName, usedNames), entry.content);
      }
      zip.file(MASS_BACKUP_MANIFEST_NAME, JSON.stringify({
        signature: MASS_BACKUP_SIGNATURE,
        version: MASS_BACKUP_VERSION,
        category: spec.kind,
        itemCount: artifacts.length,
        createdAt,
      }, null, 2));

      const remainingTotalBytes = limits.maxTotalArchiveBytes - totalArchiveBytes;
      if (remainingTotalBytes < 1) {
        throw new RangeError(
          `Mass Backup ZIP output exceeds the ${readableByteLimit(limits.maxTotalArchiveBytes)} combined safety limit.`,
        );
      }
      const archiveLimit = Math.min(limits.maxArchiveBytes, remainingTotalBytes);
      const limitMessage = remainingTotalBytes < limits.maxArchiveBytes
        ? `Mass Backup ZIP output exceeds the ${readableByteLimit(limits.maxTotalArchiveBytes)} combined safety limit.`
        : `The ${spec.kind} ZIP exceeds the ${readableByteLimit(limits.maxArchiveBytes)} archive safety limit.`;
      const bytes = await generateBoundedZipBytes(zip, archiveLimit, limitMessage);
      totalArchiveBytes += bytes.byteLength;
      archives.push(Object.freeze({
        kind: spec.kind,
        itemCount: artifacts.length,
        bytes,
      }));
    } catch (error) {
      failures.push(failureFor(spec, null, error, 'archive'));
    } finally {
      // Do not retain raw bodies after this category has either been zipped or
      // suppressed. JSZip also owns references to those bodies, so remove every
      // entry before releasing the archive object.
      for (const entry of artifacts) {
        entry.baseName = null;
        entry.content = null;
      }
      artifacts.length = 0;
      if (zip) {
        for (const fileName of Object.keys(zip.files)) zip.remove(fileName);
        zip = null;
      }
    }
  }

  reportProgress(onProgress, {
    phase: 'complete',
    archiveCount: archives.length,
    failureCount: failures.length,
    totalCompleted,
    totalItems,
  });

  return Object.freeze({ archives, failures, totalItems });
}
