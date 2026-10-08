'use strict';

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,79}$/;
const VERSION_PATTERN = /^[0-9]+(?:\.[0-9]+){0,3}(?:-[a-z0-9.-]+)?$/i;
const SHA_PATTERN = /^[a-f0-9]{64}$/;
const MAX_MIRRORS_PER_OBJECT = 8;

function fail(message) { const error = new Error(message); error.code = 'BEX_COURSE_CATALOG_INVALID'; throw error; }
function required(value, label, max = 500) { if (typeof value !== 'string' || !value.trim() || value.length > max) fail(label + ' is invalid.'); return value.trim(); }
function id(value, label) { const result = required(value, label, 80); if (!ID_PATTERN.test(result)) fail(label + ' is invalid.'); return result; }
function version(value) { const result = required(value, 'Catalog course version', 80); if (!VERSION_PATTERN.test(result)) fail('Catalog course version is invalid.'); return result; }
function relative(value, label) { const result = required(value, label, 500).replaceAll('\\', '/'); if (result.startsWith('/') || result.split('/').some((part) => !part || part === '.' || part === '..')) fail(label + ' is unsafe.'); return result; }
function httpsUrl(value) {
  const raw = required(value, 'Catalog mirror URL', 2048);
  let parsed;
  try { parsed = new URL(raw); }
  catch { fail('Catalog mirror URL is invalid.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) fail('Catalog mirror URL must be a safe HTTPS address.');
  return parsed.toString();
}
function objects(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 10000) fail('Catalog objects are invalid.');
  const seen = new Set();
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('Catalog object is invalid.');
    const objectSha256 = required(item.sha256, 'Catalog object fingerprint', 64).toLowerCase();
    if (!SHA_PATTERN.test(objectSha256) || seen.has(objectSha256)) fail('Catalog object fingerprint is invalid or duplicated.');
    seen.add(objectSha256);
    const byteSize = Number(item.byteSize);
    if (!Number.isSafeInteger(byteSize) || byteSize < 1) fail('Catalog object size is invalid.');
    if (!Array.isArray(item.mirrors) || item.mirrors.length > MAX_MIRRORS_PER_OBJECT) fail('Catalog object mirrors are invalid.');
    const mirrors = item.mirrors.map(httpsUrl);
    if (new Set(mirrors).size !== mirrors.length) fail('Catalog object mirrors must be unique.');
    return { sha256: objectSha256, byteSize, mirrors };
  }).sort((a, b) => a.sha256.localeCompare(b.sha256));
}
function signature(value) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || value.algorithm !== 'ed25519' || typeof value.keyId !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(value.value)) fail('Catalog signature is invalid.');
  return { algorithm: 'ed25519', keyId: required(value.keyId, 'Catalog key ID', 200), value: value.value };
}

function normalizeCourseCatalog(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.format !== 'bex-course-catalog' || value.catalogVersion !== 1) fail('This is not a supported BEX Course catalog.');
  if (!['beta', 'stable'].includes(value.channel)) fail('Catalog channel is invalid.');
  const updatedAt = required(value.updatedAt, 'Catalog update time', 80);
  if (!Number.isFinite(Date.parse(updatedAt))) fail('Catalog update time is invalid.');
  if (!Array.isArray(value.courses) || value.courses.length > 10000) fail('Catalog courses are invalid.');
  const seen = new Set();
  const courses = value.courses.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('Catalog course is invalid.');
    const courseId = id(entry.courseId, 'Catalog course ID');
    if (seen.has(courseId)) fail('Catalog course IDs must be unique.');
    seen.add(courseId);
    const manifestSha256 = required(entry.manifestSha256, 'Catalog manifest fingerprint', 64).toLowerCase();
    if (!SHA_PATTERN.test(manifestSha256)) fail('Catalog manifest fingerprint is invalid.');
    const downloadBytes = Number(entry.downloadBytes);
    if (!Number.isSafeInteger(downloadBytes) || downloadBytes < 1) fail('Catalog course size is invalid.');
    const catalogObjects = objects(entry.objects);
    return {
      courseId,
      version: version(entry.version),
      manifestPath: relative(entry.manifestPath, 'Catalog manifest path'),
      packagePath: relative(entry.packagePath, 'Catalog package path'),
      manifestSha256,
      downloadBytes,
      ...(catalogObjects === undefined ? {} : { objects: catalogObjects }),
    };
  }).sort((a, b) => a.courseId.localeCompare(b.courseId));
  return { format: 'bex-course-catalog', catalogVersion: 1, channel: value.channel, updatedAt, courses, signature: signature(value.signature) };
}

function canonicalize(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonicalize(value[key])).join(',') + '}';
  return JSON.stringify(value);
}

function canonicalCourseCatalogJson(value, { includeSignature = true } = {}) {
  const catalog = normalizeCourseCatalog(value);
  return canonicalize(includeSignature ? catalog : { ...catalog, signature: null });
}

module.exports = { MAX_MIRRORS_PER_OBJECT, canonicalCourseCatalogJson, normalizeCourseCatalog };
