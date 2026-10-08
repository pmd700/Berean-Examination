function requireDesktopEntities() {
  const desktopApi = typeof window === 'undefined' ? null : window.bexDesktop;
  if (!desktopApi?.isDesktop) {
    throw new Error('Local records are available only inside the BEX desktop app.');
  }
  return desktopApi;
}

let activeMutationCount = 0;
let mutationSequence = 0;
let lastMutationActivityAt = 0;
const unresolvedMutationFailures = new Map();
const MASS_BACKUP_ENTITY_TYPES = new Set([
  'KnowledgeWeb',
  'MindNote',
  'Timegraph',
  'WebCard',
  'WebConnection',
  'CanvasObject',
]);
const latestMutationByScope = new Map();
const successfulDeletionByEntity = new Map();

function mutationScopeKey(entityType, action, entityId, field) {
  return `${entityType}:${action}:${entityId ?? 'collection'}:${field}`;
}

function mutationEntityKey(entityType, entityId) {
  return `${entityType}:${entityId ?? 'collection'}`;
}

function clearEntityMutationFailures(entityType, entityId) {
  for (const [key, failure] of unresolvedMutationFailures) {
    if (failure.entityType === entityType && String(failure.entityId) === String(entityId)) {
      unresolvedMutationFailures.delete(key);
    }
  }
}

function recordMutationActivity() {
  mutationSequence += 1;
  lastMutationActivityAt = Date.now();
  return mutationSequence;
}

async function trackMutation(
  entityType,
  action,
  entityId,
  operation,
  { fields = ['*'], supersedesEntityFailures = false } = {},
) {
  if (!MASS_BACKUP_ENTITY_TYPES.has(entityType)) return operation();
  const sequence = recordMutationActivity();
  const normalizedFields = Array.from(new Set(
    (Array.isArray(fields) ? fields : [])
      .filter((field) => typeof field === 'string' && field)
      .sort(),
  ));
  if (normalizedFields.length === 0) normalizedFields.push('*');
  const scopes = normalizedFields.map((field) => ({
    field,
    key: mutationScopeKey(entityType, action, entityId, field),
  }));
  for (const scope of scopes) latestMutationByScope.set(scope.key, sequence);
  activeMutationCount += 1;
  try {
    const result = await operation();
    if (supersedesEntityFailures) {
      successfulDeletionByEntity.set(mutationEntityKey(entityType, entityId), sequence);
      clearEntityMutationFailures(entityType, entityId);
    }
    // A successful title-only save must not clear an earlier failed content
    // save. Resolve only the exact fields this operation persisted, and only
    // when this is still the newest operation for that field.
    for (const scope of scopes) {
      if (latestMutationByScope.get(scope.key) === sequence) {
        unresolvedMutationFailures.delete(scope.key);
      }
    }
    return result;
  } catch (error) {
    for (const scope of scopes) {
      if (latestMutationByScope.get(scope.key) !== sequence) continue;
      const laterDeletion = successfulDeletionByEntity.get(mutationEntityKey(entityType, entityId));
      if (action !== 'delete' && Number.isSafeInteger(laterDeletion) && laterDeletion > sequence) continue;
      unresolvedMutationFailures.set(scope.key, {
        action,
        entityId,
        entityType,
        error,
        field: scope.field,
      });
    }
    throw error;
  } finally {
    activeMutationCount = Math.max(0, activeMutationCount - 1);
    // Work such as a protected image upload can synchronously schedule an
    // editor debounce when its promise settles. Restart the quiet window here,
    // not only when work starts, so Mass Backup waits for that follow-up save.
    recordMutationActivity();
  }
}

/**
 * Registers asynchronous work that can lead to backup-visible entity changes
 * but is not itself an entity mutation (for example a protected image upload
 * or an atomic Knowledge Web import). Failures are owned by the calling UI;
 * the barrier only needs to prevent a snapshot while the work is in flight.
 */
export async function runWithLocalBackupBarrier(operation) {
  if (typeof operation !== 'function') {
    throw new TypeError('Local backup work requires an operation.');
  }
  recordMutationActivity();
  activeMutationCount += 1;
  try {
    return await operation();
  } finally {
    activeMutationCount = Math.max(0, activeMutationCount - 1);
    recordMutationActivity();
  }
}

/**
 * Waits until every mounted editor's debounced local write has had time to
 * start and all writes have actually settled. Workspace tabs stay mounted in
 * the background, so this one gateway observes notes, Knowledge Webs and
 * timelines without each editor having to expose a bespoke backup hook.
 *
 * A failed autosave remains unresolved until that same mutation succeeds on a
 * retry. Mass Backup must surface that failure instead of archiving stale disk
 * state with a green confirmation.
 */
export async function waitForLocalEntityWritesToSettle({
  quietMs = 800,
  timeoutMs = 15_000,
} = {}) {
  if (!Number.isFinite(quietMs) || quietMs < 0 || quietMs > 5000) {
    throw new RangeError('The local-save quiet window is invalid.');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < quietMs || timeoutMs > 60_000) {
    throw new RangeError('The local-save timeout is invalid.');
  }

  const startedAt = Date.now();
  let observedSequence = mutationSequence;
  let quietSince = startedAt;

  while (true) {
    const now = Date.now();
    if (mutationSequence !== observedSequence) {
      observedSequence = mutationSequence;
      quietSince = Math.max(lastMutationActivityAt, now);
    }

    if (activeMutationCount === 0 && now - quietSince >= quietMs) {
      if (unresolvedMutationFailures.size > 0) {
        const failure = unresolvedMutationFailures.values().next().value;
        const error = new Error(
          `BEX could not save recent ${failure.entityType} changes. Fix the save error, then try Mass Backup again. Nothing was written.`,
        );
        error.cause = failure.error;
        error.code = 'BEX_PENDING_SAVE_FAILED';
        throw error;
      }
      return;
    }

    if (now - startedAt >= timeoutMs) {
      throw new Error('BEX is still saving recent edits. Wait a moment, then try Mass Backup again. Nothing was written.');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function responseError(result, fallbackMessage) {
  const error = new Error(result?.error || fallbackMessage);
  error.code = result?.code || null;
  return error;
}

function requireRecord(result, fallbackMessage) {
  if (!result?.ok || !result.record) throw responseError(result, fallbackMessage);
  return result.record;
}

export async function replaceLocalKnowledgeWebGraph(webId, snapshot) {
  return runWithLocalBackupBarrier(async () => {
    const result = await requireDesktopEntities().restoreKnowledgeWebGraph(webId, snapshot);
    if (!result?.ok || !result.snapshot) {
      throw responseError(result, 'BEX could not restore the local Knowledge Web snapshot.');
    }
    return result.snapshot;
  });
}

async function runLocalKnowledgeWebImport(webId, importValue, commit) {
  const importOperation = async () => {
    const result = await requireDesktopEntities().importKnowledgeWebGraph(
      webId,
      importValue,
      { commit },
    );
    if (!result?.ok || !result.result?.report) {
      throw responseError(result, 'BEX could not import the Knowledge Web.');
    }
    return result.result;
  };
  return commit ? runWithLocalBackupBarrier(importOperation) : importOperation();
}

export function previewLocalKnowledgeWebImport(webId, importValue) {
  return runLocalKnowledgeWebImport(webId, importValue, false);
}

export async function commitLocalKnowledgeWebImport(webId, importValue) {
  const result = await runLocalKnowledgeWebImport(webId, importValue, true);
  if (!result.committed || !result.snapshot || !result.web) {
    throw new Error('BEX did not complete the Knowledge Web import.');
  }
  return result;
}

function entityClient(entityType) {
  return Object.freeze({
    async filter(filter) {
      const result = await requireDesktopEntities().listLocalEntities(entityType, { filter });
      if (!result?.ok || !Array.isArray(result.records)) {
        throw responseError(result, 'BEX could not read the local records.');
      }
      return result.records;
    },
    async list(sort = '-updated_date', limit = 5000) {
      const result = await requireDesktopEntities().listLocalEntities(entityType, { limit, sort });
      if (!result?.ok || !Array.isArray(result.records)) {
        throw responseError(result, 'BEX could not read the local records.');
      }
      return result.records;
    },
    /**
     * Reads one stable, id-ordered page.
     *
     * Ordinary `list` calls intentionally keep their bounded API. Workflows
     * that must visit every record (for example Mass Backup) use this cursor
     * form repeatedly instead of treating the 5,000-row safety ceiling as the
     * end of the collection. The cursor is the last local entity id returned,
     * so deletions or insertions before it cannot shift later pages.
     */
    async listPage({ cursor = null, filter = {}, limit = 1000 } = {}) {
      const result = await requireDesktopEntities().listLocalEntities(entityType, {
        cursor,
        filter,
        limit,
        sort: 'id',
      });
      if (!result?.ok || !Array.isArray(result.records)) {
        throw responseError(result, 'BEX could not read the local records.');
      }
      const records = result.records;
      const lastId = records.at(-1)?.id;
      return {
        records,
        // A full page may be the final page. Returning its last id causes one
        // cheap empty read, which proves completion without a separate count
        // query or a race-prone offset.
        nextCursor: records.length === limit && lastId != null ? lastId : null,
      };
    },
    async get(entityId) {
      const result = await requireDesktopEntities().getLocalEntity(entityType, entityId);
      return requireRecord(result, 'BEX could not read the local record.');
    },
    async create(value) {
      return trackMutation(entityType, 'create', null, async () => requireRecord(
        await requireDesktopEntities().createLocalEntity(entityType, value),
        'BEX could not create the local record.',
      ));
    },
    async update(entityId, patch) {
      return trackMutation(entityType, 'update', entityId, async () => requireRecord(
        await requireDesktopEntities().updateLocalEntity(entityType, entityId, patch),
        'BEX could not update the local record.',
      ), { fields: Object.keys(patch || {}) });
    },
    async reorder(entityIds, containerId = null) {
      return trackMutation(entityType, 'reorder', containerId, async () => {
        const result = await requireDesktopEntities().reorderLocalEntities(
          entityType,
          entityIds,
          containerId,
        );
        if (!result?.ok || !Array.isArray(result.records)) {
          throw responseError(result, 'BEX could not save the local record order.');
        }
        return result.records;
      });
    },
    async delete(entityId) {
      return trackMutation(entityType, 'delete', entityId, async () => {
        const result = await requireDesktopEntities().deleteLocalEntity(entityType, entityId);
        if (!result?.ok || !result.result?.deleted) {
          throw responseError(result, 'BEX could not delete the local record.');
        }
        return result.result;
      }, { supersedesEntityFailures: true });
    },
  });
}

const clientCache = new Map();

export const localEntities = new Proxy(Object.create(null), {
  get(_target, entityType) {
    if (typeof entityType !== 'string') return undefined;
    if (!clientCache.has(entityType)) clientCache.set(entityType, entityClient(entityType));
    return clientCache.get(entityType);
  },
});
