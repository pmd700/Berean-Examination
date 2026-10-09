'use strict';

const API_BASE = 'https://rest.api.bible/v1';

class ScriptureApi {
  constructor({ settings, cache, ledger }) {
    this.settings = settings;
    this.cache = cache;
    this.ledger = ledger;
    this.inFlightRequests = new Map(); // requestId -> AbortController
    this.dedupeMap = new Map(); // signature -> Promise
  }

  cancelRequest(requestId) {
    if (!requestId) return false;
    const controller = this.inFlightRequests.get(requestId);
    if (controller) {
      controller.abort();
      this.inFlightRequests.delete(requestId);
      return true;
    }
    return false;
  }

  async _fetch(endpoint, { queryParams = {}, requestId, endpointType = 'content', timeoutMs = 8000 } = {}) {
    const key = this.settings.getKey();
    const fingerprint = this.settings.getFingerprint();

    const url = new URL(`${API_BASE}/${endpoint.replace(/^\//, '')}`);
    for (const [k, v] of Object.entries(queryParams)) {
      if (v !== undefined && v !== null && v !== '') {
        url.searchParams.set(k, String(v));
      }
    }

    const controller = new AbortController();
    if (requestId) {
      this.inFlightRequests.set(requestId, controller);
    }

    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const start = Date.now();
    let status = 0;

    try {
      const resp = await fetch(url.toString(), {
        headers: {
          'api-key': key,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      status = resp.status;
      clearTimeout(timer);

      if (requestId) {
        this.inFlightRequests.delete(requestId);
      }

      const durationMs = Date.now() - start;
      if (this.ledger) {
        this.ledger.recordRequest({ fingerprint, endpointType, status, durationMs });
      }

      if (!resp.ok) {
        if (resp.status === 401 || resp.status === 403) {
          throw new Error('API key is invalid or lacks access to this Scripture edition.');
        }
        if (resp.status === 404) {
          throw new Error('The requested Scripture reference or version was not found.');
        }
        if (resp.status === 429) {
          throw new Error('Scripture request limit exceeded (429). Please wait before trying again.');
        }
        throw new Error(`API.Bible returned HTTP ${resp.status}`);
      }

      const json = await resp.json();
      return json;
    } catch (err) {
      clearTimeout(timer);
      if (requestId) {
        this.inFlightRequests.delete(requestId);
      }
      const durationMs = Date.now() - start;
      if (this.ledger) {
        this.ledger.recordRequest({ fingerprint, endpointType, status: status || 500, durationMs });
      }

      if (err.name === 'AbortError') {
        const abortedErr = new Error('Scripture request cancelled or timed out.');
        abortedErr.code = 'ABORTED';
        throw abortedErr;
      }
      // Never leak sensitive info or credentials
      throw new Error(err.message.replace(key, '***'));
    }
  }

  async getCatalog({ refresh = false } = {}) {
    if (!refresh && this.cache) {
      const cached = this.cache.getCatalog();
      if (cached) return { data: cached, cached: true };
    }

    const json = await this._fetch('bibles', {
      queryParams: { 'include-full-details': 'true' },
      endpointType: 'catalog',
    });

    if (json?.data && this.cache) {
      this.cache.setCatalog(json.data);
    }
    return { data: json?.data || [], cached: false };
  }

  async getBooks({ bibleId, refresh = false } = {}) {
    if (!bibleId) throw new Error('Bible ID is required.');
    if (!refresh && this.cache) {
      const cached = this.cache.getBooks(bibleId);
      if (cached) return { data: cached, cached: true };
    }

    const json = await this._fetch(`bibles/${encodeURIComponent(bibleId)}/books`, {
      queryParams: { 'include-chapters': 'true' },
      endpointType: 'metadata',
    });

    if (json?.data && this.cache) {
      this.cache.setBooks(bibleId, json.data);
    }
    return { data: json?.data || [], cached: false };
  }

  async fetchContent({ bibleId, type, id, requestId } = {}) {
    if (!bibleId || !type || !id) {
      throw new Error('Bible ID, content type, and reference ID are required.');
    }

    // Check cache
    if (this.cache) {
      const cached = this.cache.getContent(bibleId, type, id);
      if (cached) return { data: cached, meta: null, cached: true };
    }

    let endpoint;
    const queryParams = {
      'content-type': 'json',
      'include-notes': 'true',
      'include-titles': 'true',
      'include-chapter-numbers': 'false',
      'include-verse-numbers': 'true',
      'include-verse-spans': 'true',
    };

    if (type === 'passage') {
      endpoint = `bibles/${encodeURIComponent(bibleId)}/passages/${encodeURIComponent(id)}`;
    } else if (type === 'verse') {
      endpoint = `bibles/${encodeURIComponent(bibleId)}/verses/${encodeURIComponent(id)}`;
    } else if (type === 'chapter') {
      endpoint = `bibles/${encodeURIComponent(bibleId)}/chapters/${encodeURIComponent(id)}`;
    } else {
      throw new Error(`Unsupported content type: ${type}`);
    }

    const dedupeKey = `${bibleId}:${type}:${id}`;
    let fetchPromise = this.dedupeMap.get(dedupeKey);
    if (!fetchPromise) {
      fetchPromise = this._fetch(endpoint, {
        queryParams,
        requestId,
        endpointType: 'content',
      });
      this.dedupeMap.set(dedupeKey, fetchPromise);
      fetchPromise.finally(() => this.dedupeMap.delete(dedupeKey));
    }

    const json = await fetchPromise;
    if (json?.data && this.cache) {
      this.cache.setContent(bibleId, type, id, json.data, json.data.verseCount || 1);
    }

    return {
      data: json?.data,
      meta: json?.meta || null,
      cached: false,
    };
  }

  async searchWords({ bibleId, query, limit = 20, offset = 0, sort, requestId } = {}) {
    if (!bibleId || !query) throw new Error('Bible ID and query are required for search.');

    const json = await this._fetch(`bibles/${encodeURIComponent(bibleId)}/search`, {
      queryParams: {
        query,
        limit,
        offset,
        sort: sort || undefined,
      },
      requestId,
      endpointType: 'search',
    });

    return {
      data: json?.data || null,
      meta: json?.meta || null,
    };
  }

  getUsage() {
    const fingerprint = this.settings.getFingerprint();
    return this.ledger ? this.ledger.getSummary(fingerprint) : { totalRequests: 0, requestsToday: 0 };
  }
}

module.exports = { ScriptureApi };
