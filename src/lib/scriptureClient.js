/**
 * Scripture Client
 * Bridges the React renderer to the desktop process for API.Bible operations.
 */

let deviceBackend=null;
export function installScriptureBackend(backend){deviceBackend=backend;}
function getDesktopApi() {
  if(deviceBackend)return deviceBackend;
  if (typeof window === 'undefined' || !window.bexDesktop?.isDesktop) {
    return null;
  }
  return window.bexDesktop;
}

export async function getScriptureCatalog({ refresh = false } = {}) {
  const api = getDesktopApi();
  if (!api || typeof api.getScriptureCatalog !== 'function') {
    throw new Error('Scripture catalog is unavailable in this environment.');
  }
  const result = await api.getScriptureCatalog({ refresh });
  if (!result?.ok) {
    throw new Error(result?.error || 'Failed to load Bible catalog.');
  }
  return result.result; // { data, cached }
}

export async function getScriptureBooks({ bibleId, refresh = false } = {}) {
  const api = getDesktopApi();
  if (!api || typeof api.getScriptureBooks !== 'function') {
    throw new Error('Scripture books metadata is unavailable.');
  }
  const result = await api.getScriptureBooks({ bibleId, refresh });
  if (!result?.ok) {
    throw new Error(result?.error || 'Failed to load Bible books.');
  }
  return result.result; // { data, cached }
}

export async function fetchScriptureContent({ bibleId, type, id, requestId } = {}) {
  const api = getDesktopApi();
  if (!api || typeof api.fetchScriptureContent !== 'function') {
    throw new Error('Scripture retrieval is unavailable.');
  }
  const result = await api.fetchScriptureContent({ bibleId, type, id, requestId });
  if (!result?.ok) {
    throw new Error(result?.error || `Failed to load Scripture ${id}`);
  }
  return result.result; // { data, meta, cached }
}

export async function searchScriptureWords({ bibleId, query, limit = 20, offset = 0, sort, requestId } = {}) {
  const api = getDesktopApi();
  if (!api || typeof api.searchScriptureWords !== 'function') {
    throw new Error('Scripture search is unavailable.');
  }
  const result = await api.searchScriptureWords({ bibleId, query, limit, offset, sort, requestId });
  if (!result?.ok) {
    throw new Error(result?.error || 'Failed to search Scripture.');
  }
  return result.result; // { data, meta }
}

export async function cancelScriptureRequest(requestId) {
  const api = getDesktopApi();
  if (api && typeof api.cancelScriptureRequest === 'function') {
    try {
      await api.cancelScriptureRequest(requestId);
    } catch {
      // Ignore
    }
  }
}

export async function getScriptureUsage() {
  const api = getDesktopApi();
  if (!api || typeof api.getScriptureUsage !== 'function') {
    return { totalRequests: 0, requestsToday: 0 };
  }
  const result = await api.getScriptureUsage();
  return result?.ok ? result.result : { totalRequests: 0, requestsToday: 0 };
}

/**
 * A bounded, cancellable batch. Completed units survive cancellation/retry and
 * every progress snapshot uses the original request order, not completion order.
 * @param {Array<{id: string, type: string}>} requests
 * @param {{bibleId?: string, onProgress?: (snapshot: any) => void, batchId?: string,
 * signal?: AbortSignal, initialResults?: any[], indexes?: number[], timeoutMs?: number}} options
 */
export async function fetchScriptureBatch(requests, {
  bibleId, onProgress, batchId = crypto.randomUUID(), signal,
  initialResults = [], indexes = requests.map((_, index) => index), timeoutMs = 20000,
} = {}) {
  const controller = new AbortController();
  const activeRequests = new Set();
  const results = requests.map((req, index) => initialResults[index] || { req, status: 'pending', data: null });
  let cursor = 0;
  let timedOut = false;
  const report = () => onProgress?.({
    completed: results.filter(result => result.status === 'success' || result.status === 'error').length,
    total: requests.length, results: [...results],
  });
  const abort = () => {
    controller.abort();
    for (const id of activeRequests) void cancelScriptureRequest(id);
  };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
  for (const index of indexes) results[index] = { req: requests[index], status: 'pending', data: null };
  report();
  async function worker() {
    while (cursor < indexes.length && !controller.signal.aborted) {
      const index = indexes[cursor++];
      const req = requests[index];
      const requestId = `${batchId}-${index}`;
      activeRequests.add(requestId);
      results[index] = { req, status: 'loading', data: null };
      report();
      let onAbort;
      try {
        const aborted = new Promise((_, reject) => {
          onAbort = () => reject(new Error(timedOut ? 'This search timed out. Retry this passage.' : 'Loading cancelled.'));
          controller.signal.addEventListener('abort', onAbort, { once: true });
          if (controller.signal.aborted) onAbort();
        });
        const response = await Promise.race([
          fetchScriptureContent({ bibleId, type: req.type, id: req.id, requestId }), aborted,
        ]);
        results[index] = { req, ...response, status: 'success', error: null };
      } catch (error) {
        results[index] = { req, data: null, status: controller.signal.aborted ? 'cancelled' : 'error', error: error.message };
      } finally {
        controller.signal.removeEventListener('abort', onAbort);
        activeRequests.delete(requestId);
        report();
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(2, indexes.length) }, () => worker()));
    if (controller.signal.aborted) {
      for (const index of indexes) if (results[index].status === 'pending') {
        results[index] = { req: requests[index], data: null, status: 'cancelled',
          error: timedOut ? 'This search timed out. Retry this passage.' : 'Loading cancelled.' };
      }
    }
    report();
    return results;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
