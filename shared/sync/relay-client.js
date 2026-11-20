import { canonicalJson, syncError } from './protocol.js';
const encoder = new TextEncoder();
export async function hexDigest(bytes) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
export class RelayClient {
  constructor(url, token, fetcher = fetch) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(parsed.hostname)) throw new TypeError('Sync requires HTTPS.');
    if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new TypeError('Use a relay origin without credentials or query parameters.');
    this.origin = parsed.origin; this.token = token; this.fetcher = fetcher.bind(globalThis);
  }
  async request(path, { method = 'GET', body = undefined, binary = false } = {}) {
    const retryable = method === 'GET' || method === 'PUT' || (method === 'POST' && path === '/api/operations');
    let failure;
    for (let attempt = 0; attempt < (retryable ? 5 : 1); attempt++) {
      try {
        const response = await this.fetcher(this.origin + path, { method, body: body === undefined ? undefined : binary ? body : JSON.stringify(body), headers: { Authorization: `Bearer ${this.token}`, ...(body !== undefined && !binary ? { 'Content-Type': 'application/json' } : {}) }, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(30000) });
        if (!response.ok) {
          let code = 'BEX_SYNC_SERVICE_UNAVAILABLE';
          try { code = (await response.json()).error || code; } catch { /* no response body is trusted */ }
          const error = syncError(code, response.status === 507 ? 'Encrypted cloud storage is full. Changes remain saved locally.' : `Sync could not finish (${response.status}). Your local changes remain queued.`);
          error.status = response.status;
          if (![408,429,500,502,503,504].includes(response.status)) throw error;
          failure = error;
        } else return binary && method === 'GET' ? new Uint8Array(await response.arrayBuffer()) : await response.json();
      } catch (error) {
        if (error.status && ![408,429,500,502,503,504].includes(error.status)) throw error;
        failure = error;
      }
      if (attempt < (retryable ? 4 : 0)) await new Promise(resolve => setTimeout(resolve, Math.min(8000, 500 * 2 ** attempt)));
    }
    throw failure;
  }
  async push(row) {
    const bytes = encoder.encode(canonicalJson(row.envelope, 48 * 1024 * 1024));
    const chunks = [];
    for (let offset = 0; offset < bytes.length; offset += 512 * 1024) {
      const block = bytes.slice(offset, offset + 512 * 1024), hash = await hexDigest(block);
      await this.request(`/api/blobs/${hash}`, { method: 'PUT', body: block, binary: true }); chunks.push(hash);
    }
    await this.request('/api/operations', { method: 'POST', body: { id: row.id, descriptor: { chunks, bytes: bytes.length, digest: await hexDigest(bytes) } } });
  }
  async pull(cursor) {
    const result = await this.request(`/api/operations?cursor=${cursor}`), operations = [];
    if (!Array.isArray(result.operations) || result.operations.length > 16) throw new TypeError('Invalid relay batch.');
    for (const item of result.operations) {
      const descriptor = item.descriptor;
      if (!Array.isArray(descriptor.chunks) || descriptor.chunks.length > 96 || !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes > 48 * 1024 * 1024 || descriptor.bytes < 1) throw new TypeError('Invalid encrypted manifest.');
      const bytes = new Uint8Array(descriptor.bytes); let offset = 0;
      for (const hash of descriptor.chunks) {
        if (!/^[a-f0-9]{64}$/.test(hash)) throw new TypeError('Invalid chunk address.');
        const block = await this.request(`/api/blobs/${hash}`, { binary: true });
        if (block.length > 512 * 1024 || offset + block.length > bytes.length || await hexDigest(block) !== hash) throw syncError('BEX_SYNC_CHUNK_CORRUPT', 'An encrypted chunk failed its integrity check.');
        bytes.set(block, offset); offset += block.length;
      }
      if (offset !== bytes.length || await hexDigest(bytes) !== descriptor.digest) throw syncError('BEX_SYNC_CHUNK_CORRUPT', 'The encrypted manifest is incomplete.');
      operations.push({ id: item.id, envelope: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) });
    }
    return { ...result, operations };
  }
}
export async function exchangeReplica(replica, relay, { signal = null, onProgress = () => {}, beforePush = async () => {}, maxBatches = 100 } = {}) {
  const check = () => { if (signal?.aborted) throw syncError('BEX_SYNC_CANCELLED', 'Sync paused; pending work remains saved.'); if (!replica.key) throw syncError('BEX_SYNC_LOCKED', 'Unlock before syncing.'); };
  let sent = 0, received = 0, hasMore = false;
  // One caller owns a drain. Multiple calls share it rather than overlapping
  // cursor writes or recreating transport work on every editor render.
  if (replica.exchangeInFlight) return replica.exchangeInFlight;
  const operation = (async () => {
    for (let batch = 0; batch < maxBatches; batch++) {
      check(); const rows = await replica.store.pending();
      if (!rows.length) break;
      for (const row of rows) { check(); await beforePush(row); check(); await relay.push(row); check(); await replica.acknowledge([row.id]); sent++; onProgress({ sent, received }); }
    }
    for (let batch = 0; batch < maxBatches; batch++) {
      check(); const { cursor } = await replica.store.meta(), result = await relay.pull(cursor);
      check(); await replica.receive(result.operations, { baseCursor: cursor, cursor: result.cursor });
      hasMore=Boolean(result.hasMore);received += result.operations.length; onProgress({ sent, received });
      if (!result.hasMore) break;
    }
    return { sent, received, hasMore, pending: replica.store.pendingCount ? await replica.store.pendingCount() : (await replica.store.pending()).length };
  })().finally(() => { replica.exchangeInFlight = null; });
  replica.exchangeInFlight = operation; return operation;
}
