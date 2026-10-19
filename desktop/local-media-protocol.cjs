'use strict';

const MEDIA_SCHEME = 'bex-media';
const { parseByteRange, requestComesFromTrustedOrigin } = require('./course-media-protocol.cjs');

function registerLocalMediaScheme(protocol) {
  if (!protocol || typeof protocol.registerSchemesAsPrivileged !== 'function') {
    throw new TypeError('Electron protocol support is unavailable.');
  }
  protocol.registerSchemesAsPrivileged([{
    scheme: MEDIA_SCHEME,
    privileges: {
      bypassCSP: false,
      corsEnabled: true,
      secure: true,
      standard: true,
      stream: true,
      supportFetchAPI: true,
    },
  }]);
}

async function createLocalMediaResponse(request, readLocalMedia, trustedOrigin) {
  const cors = trustedOrigin ? {
    'Access-Control-Allow-Origin': trustedOrigin,
    'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Range, Content-Length',
  } : {};
  if (trustedOrigin && !requestComesFromTrustedOrigin(request, trustedOrigin)) {
    return new Response('Local media request blocked', { status: 403 });
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, HEAD', 'Access-Control-Allow-Headers': 'Range' } });
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  let media;
  try {
    media = readLocalMedia(request.url, { range: request.headers.get('range'), head: request.method === 'HEAD' });
    const size = media.size ?? media.bytes.length;
    let range = media.range;
    if (media.bytes) {
      try { range = parseByteRange(request.headers.get('range'), size); } catch {
        const error = new Error(String(size)); error.code = 'BEX_MEDIA_RANGE_INVALID'; throw error;
      }
    }
    const length = range ? range.end - range.start + 1 : size;
    const headers = {
      ...cors,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'Content-Length': String(length),
      'Content-Security-Policy': "default-src 'none'",
      'Content-Type': media.mimeType,
      'X-Content-Type-Options': 'nosniff',
    };
    if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
    let body = media.body;
    if (media.bytes) body = Uint8Array.from(range ? media.bytes.subarray(range.start, range.end + 1) : media.bytes);
    if (request.method === 'HEAD') body = null;
    return new Response(body, { headers, status: range ? 206 : 200 });
  } catch (error) {
    if (error?.code === 'BEX_MEDIA_RANGE_INVALID') return new Response(null, { status: 416, headers: { ...cors, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes */${error.message}` } });
    const status = error?.code === 'BEX_PRIVACY_LOCKED' ? 423 : 404;
    return new Response('Local media unavailable', { headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, status });
  } finally { media?.bytes?.fill(0); }
}

function registerLocalMediaProtocol({ protocol, readLocalMedia, trustedOrigin }) {
  if (!protocol || typeof protocol.handle !== 'function' || typeof readLocalMedia !== 'function') {
    throw new TypeError('The local media display route is incomplete.');
  }
  protocol.handle(MEDIA_SCHEME, (request) => createLocalMediaResponse(request, readLocalMedia, trustedOrigin));
}

module.exports = {
  MEDIA_SCHEME,
  createLocalMediaResponse,
  registerLocalMediaProtocol,
  registerLocalMediaScheme,
};
