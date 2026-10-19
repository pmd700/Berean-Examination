'use strict';

const { randomUUID } = require('node:crypto');
const API_BASE = 'https://rest.api.bible/v1';
const cancelled = () => Object.assign(new Error('Scripture request cancelled.'), { code: 'ABORTED' });

function countVerses(data, type) {
  if (Number.isSafeInteger(data?.verseCount) && data.verseCount > 0) return data.verseCount;
  let count = 0;
  const spanCount = number => {
    const match = String(number || '').match(/^(\d+)(?:[-–](\d+))?$/);
    return match ? Math.max(1, Number(match[2] || match[1]) - Number(match[1]) + 1) : 0;
  };
  const walk = node => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    if (node.name === 'verse' || node.attrs?.style === 'v') {
      count += spanCount(node.attrs?.number || node.attrs?.verseId?.split('.').at(-1)
        || node.items?.filter(item => item.type === 'text').map(item => item.text).join(''));
    } else if (Array.isArray(node.items)) node.items.forEach(walk);
  };
  walk(data?.content);
  // Without reliable coverage, leave the response outside the reusable cache.
  if (count) return count;
  const span = String(data?.id || '').match(/^([A-Z0-9]+)\.(\d+)\.(\d+)(?:-\1\.\2\.(\d+))?$/);
  return span ? Math.max(1, Number(span[4] || span[3]) - Number(span[3]) + 1) : null;
}

class ScriptureApi {
  constructor({ settings, cache, ledger }) {
    this.settings = settings;
    this.cache = cache;
    this.ledger = ledger;
    this.inFlightRequests = new Map(); // subscriber requestId -> shared entry
    this.dedupeMap = new Map();
    this.queue = [];
    this.active = 0;
    this.generation = 0;
    this.fingerprint = settings.getFingerprint();
  }

  reset() {
    this.generation += 1;
    for (const id of [...this.inFlightRequests.keys()]) this.cancelRequest(id);
    this.cache?.clear();
    this.fingerprint = this.settings.getFingerprint();
  }

  cancelOwner(prefix) {
    for (const id of [...this.inFlightRequests.keys()]) if (id.startsWith(prefix)) this.cancelRequest(id);
  }

  checkIdentity() {
    if (this.settings.getFingerprint() !== this.fingerprint) this.reset();
  }

  cancelRequest(requestId) {
    const entry = this.inFlightRequests.get(requestId);
    if (!entry) return false;
    entry.subscribers.get(requestId)?.reject(cancelled());
    entry.subscribers.delete(requestId);
    this.inFlightRequests.delete(requestId);
    if (!entry.subscribers.size) {
      entry.controller.abort();
      if (this.dedupeMap.get(entry.signature) === entry) this.dedupeMap.delete(entry.signature);
      this.queue = this.queue.filter(item => item !== entry);
    }
    return true;
  }

  subscribe(signature, operation, requestId = randomUUID()) {
    this.checkIdentity();
    if (this.inFlightRequests.has(requestId)) throw new Error('Scripture request ID is already active.');
    let entry = this.dedupeMap.get(signature);
    if (!entry) {
      entry = { signature, operation, controller: new AbortController(), subscribers: new Map() };
      this.dedupeMap.set(signature, entry);
      this.queue.push(entry);
    }
    const promise = new Promise((resolve, reject) => entry.subscribers.set(requestId, { resolve, reject }));
    this.inFlightRequests.set(requestId, entry);
    this.drain();
    return promise;
  }

  drain() {
    while (this.active < 2 && this.queue.length) {
      const entry = this.queue.shift();
      if (!entry.subscribers.size || entry.controller.signal.aborted) continue;
      this.active += 1;
      Promise.resolve().then(() => entry.operation(entry.controller.signal)).then(
        value => this.finish(entry, null, value), error => this.finish(entry, error),
      );
    }
  }

  finish(entry, error, value) {
    if (this.dedupeMap.get(entry.signature) === entry) this.dedupeMap.delete(entry.signature);
    for (const [id, subscriber] of entry.subscribers) {
      this.inFlightRequests.delete(id);
      if (error) subscriber.reject(error); else subscriber.resolve(value);
    }
    entry.subscribers.clear();
    this.active -= 1;
    this.drain();
  }

  async _fetch(endpoint, { queryParams = {}, signal, endpointType = 'content', timeoutMs = 8000 } = {}) {
    const key = this.settings.getKey();
    const fingerprint = this.settings.getFingerprint();
    const url = new URL(`${API_BASE}/${endpoint.replace(/^\//, '')}`);
    for (const [name, value] of Object.entries(queryParams)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(name, String(value));
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const start = Date.now();
    let status = 0, dispatched = false;
    try {
      if (controller.signal.aborted) throw cancelled();
      dispatched = true;
      const response = await fetch(url.toString(), {
        headers: { 'api-key': key, Accept: 'application/json' },
        signal: controller.signal, redirect: 'error',
      });
      status = response.status;
      if (!response.ok) {
        const messages = {
          401: 'API key is invalid or lacks access to this Scripture edition.',
          403: 'API key is invalid or lacks access to this Scripture edition.',
          404: 'The requested Scripture reference or version was not found.',
          429: 'Scripture request limit exceeded. Please wait before retrying.',
        };
        throw new Error(messages[status] || `API.Bible returned HTTP ${status}`);
      }
      const json = await response.json(); // Timeout/cancellation covers the body too.
      if (controller.signal.aborted) throw cancelled();
      return json;
    } catch (error) {
      if (controller.signal.aborted || error.name === 'AbortError') {
        throw Object.assign(new Error(signal?.aborted ? 'Scripture request cancelled.' : 'Scripture request timed out. Please retry.'), { code: 'ABORTED' });
      }
      throw new Error(String(error.message || 'Scripture retrieval failed.').split(key).join('***'));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (dispatched) this.ledger?.recordRequest({ fingerprint, endpointType, status, durationMs: Date.now() - start });
    }
  }

  async getCatalog({ refresh = false, requestId } = {}) {
    this.checkIdentity();
    const generation = this.generation;
    const cached = !refresh && this.cache?.getCatalog();
    if (cached) return { data: cached, cached: true };
    const json = await this.subscribe('catalog', signal => this._fetch('bibles', {
      queryParams: { 'include-full-details': 'true' }, signal, endpointType: 'catalog',
    }), requestId);
    if (generation !== this.generation) throw cancelled();
    if (json?.data) this.cache?.setCatalog(json.data);
    return { data: json?.data || [], cached: false };
  }

  async getBooks({ bibleId, refresh = false, requestId } = {}) {
    this.checkIdentity();
    const generation = this.generation;
    if (!bibleId) throw new Error('Bible ID is required.');
    const cached = !refresh && this.cache?.getBooks(bibleId);
    if (cached) return { data: cached, cached: true };
    const json = await this.subscribe(`books:${bibleId}`, signal => this._fetch(`bibles/${encodeURIComponent(bibleId)}/books`, {
      queryParams: { 'include-chapters': 'true' }, signal, endpointType: 'metadata',
    }), requestId);
    if (generation !== this.generation) throw cancelled();
    if (json?.data) this.cache?.setBooks(bibleId, json.data);
    return { data: json?.data || [], cached: false };
  }

  async fetchContent({ bibleId, type, id, requestId } = {}) {
    this.checkIdentity();
    const generation = this.generation;
    const resources = { passage: 'passages', verse: 'verses', chapter: 'chapters' };
    if (!bibleId || !id || !resources[type]) throw new Error('A valid Bible ID, content type, and reference ID are required.');
    const cached = this.cache?.getContent(bibleId, type, id);
    if (cached) return { ...cached, cached: true };
    const json = await this.subscribe(`${bibleId}:${type}:${id}`, signal => this._fetch(
      `bibles/${encodeURIComponent(bibleId)}/${resources[type]}/${encodeURIComponent(id)}`, {
        signal, queryParams: { 'content-type': 'json', 'include-notes': 'true', 'include-titles': 'true',
          'include-chapter-numbers': 'false', 'include-verse-numbers': 'true', 'include-verse-spans': 'true' },
      }), requestId);
    if (generation !== this.generation) throw cancelled();
    const result = { data: json?.data, meta: json?.meta || null, fetchedAt: Date.now(), cached: false };
    if (json?.data) this.cache?.setContent(bibleId, type, id, result, countVerses(json.data, type));
    return result;
  }

  async searchWords({ bibleId, query, limit = 20, offset = 0, sort, requestId } = {}) {
    this.checkIdentity();
    const generation = this.generation;
    if (!bibleId || !query) throw new Error('Bible ID and query are required for search.');
    const json = await this.subscribe(`search:${bibleId}:${query}:${limit}:${offset}:${sort}`, signal => this._fetch(
      `bibles/${encodeURIComponent(bibleId)}/search`, { signal, endpointType: 'search', queryParams: { query, limit, offset, sort } }), requestId);
    if (generation !== this.generation) throw cancelled();
    return { data: json?.data || null, meta: json?.meta || null };
  }

  getUsage() {
    return this.ledger?.getSummary(this.settings.getFingerprint()) || { totalRequests: 0, requestsToday: 0 };
  }
}
module.exports = { ScriptureApi, countVerses };
