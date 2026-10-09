/**
 * Scripture Client
 * Bridges the React renderer to the desktop process for API.Bible operations.
 */

function getDesktopApi() {
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
 * Dispatches a queue of content units with a max concurrency of 2.
 * Calls onProgress({ completed, total, currentResult }) as each unit completes.
 */
export async function fetchScriptureBatch(requests, { bibleId, onProgress, batchId } = {}) {
  const results = new Array(requests.length);
  let completedCount = 0;
  const total = requests.length;

  let nextIndex = 0;
  const maxConcurrency = 2;

  async function worker() {
    while (nextIndex < requests.length) {
      const idx = nextIndex++;
      const req = requests[idx];
      const reqId = `${batchId || 'batch'}-${idx}-${req.id}`;

      try {
        const res = await fetchScriptureContent({
          bibleId,
          type: req.type,
          id: req.id,
          requestId: reqId,
        });
        results[idx] = { req, data: res.data, meta: res.meta, cached: res.cached, error: null };
      } catch (err) {
        results[idx] = { req, data: null, meta: null, cached: false, error: err.message };
      }

      completedCount += 1;
      if (typeof onProgress === 'function') {
        onProgress({
          completed: completedCount,
          total,
          latest: results[idx],
          results: [...results],
        });
      }
    }
  }

  const workers = [];
  for (let w = 0; w < Math.min(maxConcurrency, requests.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  return results;
}
