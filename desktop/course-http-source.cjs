'use strict';

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function safeHttpsUrl(value) {
  let parsed;
  try { parsed = new URL(value); }
  catch { throw codedError('BEX_COURSE_CATALOG_INVALID', 'A Course mirror address is invalid.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
    throw codedError('BEX_COURSE_CATALOG_INVALID', 'A Course mirror must use a safe HTTPS address.');
  }
  return parsed.toString();
}

function normalizeObjects(objects) {
  if (!Array.isArray(objects)) throw codedError('BEX_COURSE_CATALOG_INVALID', 'The Course catalog has no downloadable objects.');
  const result = new Map();
  for (const object of objects) {
    if (!object || typeof object.sha256 !== 'string' || !Number.isSafeInteger(object.byteSize) || object.byteSize < 1 || !Array.isArray(object.mirrors)) {
      throw codedError('BEX_COURSE_CATALOG_INVALID', 'A Course catalog object is invalid.');
    }
    if (!object.mirrors.length) continue;
    if (result.has(object.sha256)) throw codedError('BEX_COURSE_CATALOG_INVALID', 'A Course catalog object is duplicated.');
    result.set(object.sha256, { byteSize: object.byteSize, mirrors: object.mirrors.map(safeHttpsUrl) });
  }
  return result;
}

function parseContentRange(value) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value || '');
  if (!match) return null;
  return { start: Number(match[1]), end: Number(match[2]), total: Number(match[3]) };
}

async function discard(response) {
  try { await response?.body?.cancel(); } catch {}
}

class HttpMirrorObjectSource {
  constructor(objects, options = {}) {
    this.objects = normalizeObjects(objects);
    this.fetch = options.fetchImpl || globalThis.fetch;
    this.signal = options.signal;
    if (typeof this.fetch !== 'function') throw new TypeError('BEX needs HTTPS download support.');
  }

  async open(asset) {
    const declared = this.objects.get(asset.sha256);
    if (!declared || declared.byteSize !== asset.byteSize) {
      throw codedError('BEX_COURSE_ASSET_MISSING', 'The signed Course catalog has no matching download source.', { assetId: asset.id });
    }
    let preferredMirror = 0;
    return {
      size: declared.byteSize,
      read: async (offset, length) => {
        if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || offset + length > declared.byteSize) {
          throw codedError('BEX_COURSE_DOWNLOAD_STATE_INVALID', 'BEX requested an invalid Course byte range.');
        }
        const failures = [];
        for (let attempt = 0; attempt < declared.mirrors.length; attempt += 1) {
          if (this.signal?.aborted) throw codedError('BEX_COURSE_DOWNLOAD_PAUSED', 'Course download paused.');
          const mirrorIndex = (preferredMirror + attempt) % declared.mirrors.length;
          const url = declared.mirrors[mirrorIndex];
          try {
            const response = await this.fetch(url, {
              cache: 'no-store',
              headers: { Range: 'bytes=' + offset + '-' + (offset + length - 1) },
              redirect: 'follow',
              signal: this.signal,
            });
            const range = parseContentRange(response.headers.get('content-range'));
            if (response.status !== 206 || !range || range.start !== offset || range.end !== offset + length - 1 || range.total !== declared.byteSize) {
              await discard(response);
              throw new Error('The mirror did not return the requested bytes.');
            }
            const bytes = Buffer.from(await response.arrayBuffer());
            if (bytes.length !== length) throw new Error('The mirror returned an incomplete byte range.');
            preferredMirror = mirrorIndex;
            return bytes;
          } catch (error) {
            if (this.signal?.aborted) throw codedError('BEX_COURSE_DOWNLOAD_PAUSED', 'Course download paused.');
            failures.push({ url, message: error?.message || 'Download failed.' });
          }
        }
        throw codedError('BEX_COURSE_SOURCE_UNAVAILABLE', 'Every Course download source is currently unavailable.', { assetId: asset.id, failures });
      },
      close: async () => {},
    };
  }
}

module.exports = { HttpMirrorObjectSource, parseContentRange };
