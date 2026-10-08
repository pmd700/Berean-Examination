'use strict';

const fs = require('node:fs');
const { Readable } = require('node:stream');

const COURSE_MEDIA_SCHEME = 'bex-course';
const COURSE_MEDIA_HOST = 'asset';
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,79}$/;
const VERSION_PATTERN = /^[0-9]+(?:\.[0-9]+){0,3}(?:-[a-z0-9.-]+)?$/i;

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createCourseMediaUrl(courseId, version, assetId) {
  if (!ID_PATTERN.test(courseId) || !VERSION_PATTERN.test(version) || !ID_PATTERN.test(assetId)) {
    throw codedError('BEX_COURSE_ASSET_INVALID', 'The Course media identity is invalid.');
  }
  return COURSE_MEDIA_SCHEME + '://' + COURSE_MEDIA_HOST + '/'
    + [courseId, version, assetId].map(encodeURIComponent).join('/');
}

function parseCourseMediaUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw codedError('BEX_COURSE_ASSET_INVALID', 'The Course media address is invalid.');
  }
  const parts = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (
    parsed.protocol !== COURSE_MEDIA_SCHEME + ':'
    || parsed.hostname !== COURSE_MEDIA_HOST
    || parsed.search
    || parsed.hash
    || parts.length !== 3
    || !ID_PATTERN.test(parts[0])
    || !VERSION_PATTERN.test(parts[1])
    || !ID_PATTERN.test(parts[2])
  ) {
    throw codedError('BEX_COURSE_ASSET_INVALID', 'The Course media address is invalid.');
  }
  return { courseId: parts[0], version: parts[1], assetId: parts[2] };
}

function parseByteRange(value, byteSize) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || byteSize < 1) {
    throw codedError('BEX_COURSE_RANGE_INVALID', 'The requested Course media range is invalid.');
  }
  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength < 1) {
      throw codedError('BEX_COURSE_RANGE_INVALID', 'The requested Course media range is invalid.');
    }
    start = Math.max(0, byteSize - suffixLength);
    end = byteSize - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : byteSize - 1;
  }
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(end)
    || start < 0
    || start >= byteSize
    || end < start
  ) {
    throw codedError('BEX_COURSE_RANGE_INVALID', 'The requested Course media range is invalid.');
  }
  return { start, end: Math.min(end, byteSize - 1) };
}

function responseHeaders(asset, range, trustedOrigin) {
  const start = range?.start ?? 0;
  const end = range?.end ?? asset.byteSize - 1;
  const headers = {
    'Access-Control-Allow-Origin': trustedOrigin,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store',
    'Content-Length': String(end - start + 1),
    'Content-Security-Policy': "default-src 'none'",
    'Content-Type': asset.mimeType,
    'X-Content-Type-Options': 'nosniff',
  };
  if (range) headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + asset.byteSize;
  return headers;
}

function requestComesFromTrustedOrigin(request, trustedOrigin) {
  if (typeof trustedOrigin !== 'string') return false;
  const candidates = [
    request.headers.get('origin'),
    request.referrer,
    request.headers.get('referer'),
  ];
  return candidates.some((value) => {
    if (!value) return false;
    try {
      return new URL(value).origin === trustedOrigin;
    } catch {
      return false;
    }
  });
}

async function createCourseMediaResponse(request, resolveCourseAsset, trustedOrigin) {
  if (typeof resolveCourseAsset !== 'function') {
    throw new TypeError('The Course media route needs the local Course store.');
  }
  if (!requestComesFromTrustedOrigin(request, trustedOrigin)) {
    return new Response('Course media request blocked', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      status: 403,
    });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', {
      headers: { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' },
      status: 405,
    });
  }
  let identity;
  let asset;
  try {
    identity = parseCourseMediaUrl(request.url);
    asset = await resolveCourseAsset(identity);
  } catch {
    return new Response('Course media unavailable', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      status: 404,
    });
  }

  let range;
  try {
    range = parseByteRange(request.headers.get('range'), asset.byteSize);
  } catch {
    return new Response(null, {
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Range': 'bytes */' + asset.byteSize,
      },
      status: 416,
    });
  }
  const headers = responseHeaders(asset, range, trustedOrigin);
  if (request.method === 'HEAD') {
    return new Response(null, { headers, status: range ? 206 : 200 });
  }
  const stream = fs.createReadStream(asset.path, range || undefined);
  return new Response(Readable.toWeb(stream), {
    headers,
    status: range ? 206 : 200,
  });
}

function registerCourseMediaScheme(protocol) {
  if (!protocol || typeof protocol.registerSchemesAsPrivileged !== 'function') {
    throw new TypeError('Electron protocol support is unavailable.');
  }
  protocol.registerSchemesAsPrivileged([{
    scheme: COURSE_MEDIA_SCHEME,
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

function registerCourseMediaProtocol({ protocol, resolveCourseAsset, trustedOrigin }) {
  if (!protocol || typeof protocol.handle !== 'function') {
    throw new TypeError('The Course media route is incomplete.');
  }
  protocol.handle(COURSE_MEDIA_SCHEME, (request) => (
    createCourseMediaResponse(request, resolveCourseAsset, trustedOrigin)
  ));
}

module.exports = {
  COURSE_MEDIA_SCHEME,
  createCourseMediaResponse,
  createCourseMediaUrl,
  parseByteRange,
  parseCourseMediaUrl,
  requestComesFromTrustedOrigin,
  registerCourseMediaProtocol,
  registerCourseMediaScheme,
};
