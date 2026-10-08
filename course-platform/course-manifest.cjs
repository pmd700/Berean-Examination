'use strict';

const COURSE_MANIFEST_FORMAT = 'bex-course';
const COURSE_MANIFEST_VERSION = 1;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,79}$/;
const VERSION_PATTERN = /^[0-9]+(?:\.[0-9]+){0,3}(?:-[a-z0-9.-]+)?$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{40,200}$/;
const MAX_MANIFEST_BYTES = 1024 * 1024;

const ROLE_MIME_TYPES = Object.freeze({
  artwork: new Set(['image/jpeg', 'image/png', 'image/webp']),
  attachment: new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'text/markdown',
    'text/plain',
  ]),
  caption: new Set(['text/vtt']),
  poster: new Set(['image/jpeg', 'image/png', 'image/webp']),
  transcript: new Set(['application/pdf', 'text/markdown', 'text/plain']),
  video: new Set(['video/mp4']),
});

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw codedError('BEX_COURSE_MANIFEST_INVALID', label + ' must be an object.');
  }
  return value;
}

function requiredText(value, label, maxLength = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw codedError('BEX_COURSE_MANIFEST_INVALID', label + ' is invalid.');
  }
  return value.trim();
}

function optionalText(value, label, maxLength = 10000) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || value.length > maxLength) {
    throw codedError('BEX_COURSE_MANIFEST_INVALID', label + ' is invalid.');
  }
  return value.trim();
}

function stableId(value, label) {
  const id = requiredText(value, label, 80);
  if (!ID_PATTERN.test(id) || id !== id.toLowerCase()) {
    throw codedError(
      'BEX_COURSE_MANIFEST_INVALID',
      label + ' must be a stable lowercase identifier.',
    );
  }
  return id;
}

function versionNumber(value, label) {
  const version = requiredText(value, label, 80);
  if (!VERSION_PATTERN.test(version)) {
    throw codedError('BEX_COURSE_MANIFEST_INVALID', label + ' is invalid.');
  }
  return version;
}

function nonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw codedError('BEX_COURSE_MANIFEST_INVALID', label + ' is invalid.');
  }
  return number;
}

function positiveInteger(value, label) {
  const number = nonNegativeInteger(value, label);
  if (number < 1) {
    throw codedError('BEX_COURSE_MANIFEST_INVALID', label + ' must be greater than zero.');
  }
  return number;
}

function isoDate(value, label) {
  const text = requiredText(value, label, 80);
  if (!Number.isFinite(Date.parse(text))) {
    throw codedError('BEX_COURSE_MANIFEST_INVALID', label + ' is invalid.');
  }
  return text;
}

function safeRelativePath(value) {
  const relativePath = requiredText(value, 'Course asset path', 500).replaceAll('\\', '/');
  if (
    relativePath.startsWith('/')
    || relativePath === '.'
    || relativePath === '..'
    || relativePath.split('/').some((part) => !part || part === '.' || part === '..')
    || relativePath.includes('\0')
  ) {
    throw codedError('BEX_COURSE_MANIFEST_INVALID', 'Course asset path is unsafe.');
  }
  return relativePath;
}

function optionalId(value, label) {
  return value == null || value === '' ? '' : stableId(value, label);
}

function idList(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 100) {
    throw codedError('BEX_COURSE_MANIFEST_INVALID', label + ' must be a short list.');
  }
  const values = value.map((entry) => stableId(entry, label));
  if (new Set(values).size !== values.length) {
    throw codedError('BEX_COURSE_MANIFEST_INVALID', label + ' contains a duplicate.');
  }
  return values;
}

function normalizeProtection(value) {
  const protection = value == null ? { mode: 'none' } : plainObject(value, 'Content protection');
  const mode = requiredText(protection.mode, 'Content protection mode', 80);
  if (mode === 'none') return { mode };
  if (mode !== 'bex-chunked-aes-gcm-v1') {
    throw codedError('BEX_COURSE_MANIFEST_INVALID', 'Content protection mode is unsupported.');
  }
  return {
    mode,
    keyId: requiredText(protection.keyId, 'Content key ID', 200),
    chunkBytes: nonNegativeInteger(protection.chunkBytes, 'Encrypted chunk size'),
  };
}

function normalizeSignature(value) {
  if (value == null) return null;
  const signature = plainObject(value, 'Course signature');
  const algorithm = requiredText(signature.algorithm, 'Signature algorithm', 40).toLowerCase();
  if (algorithm !== 'ed25519') {
    throw codedError('BEX_COURSE_MANIFEST_INVALID', 'Course signature algorithm is unsupported.');
  }
  const encodedValue = requiredText(signature.value, 'Course signature', 200);
  if (!SIGNATURE_PATTERN.test(encodedValue)) {
    throw codedError('BEX_COURSE_MANIFEST_INVALID', 'Course signature is invalid.');
  }
  return {
    algorithm,
    keyId: requiredText(signature.keyId, 'Course signing key ID', 200),
    value: encodedValue,
  };
}

function assertAssetRole(asset, assetId, expectedRoles, label) {
  if (!assetId) return;
  const assetRecord = asset.get(assetId);
  if (!assetRecord) {
    throw codedError('BEX_COURSE_MANIFEST_INVALID', label + ' references a missing asset.');
  }
  if (!expectedRoles.includes(assetRecord.role)) {
    throw codedError('BEX_COURSE_MANIFEST_INVALID', label + ' references the wrong asset type.');
  }
}

function normalizeCourseManifest(input) {
  const manifest = plainObject(input, 'Course manifest');
  if (manifest.format !== COURSE_MANIFEST_FORMAT) {
    throw codedError('BEX_COURSE_MANIFEST_INVALID', 'This is not a BEX course package.');
  }
  if (manifest.manifestVersion !== COURSE_MANIFEST_VERSION) {
    throw codedError('BEX_COURSE_MANIFEST_UNSUPPORTED', 'This course package needs a newer BEX version.');
  }

  const assetsInput = Array.isArray(manifest.assets) ? manifest.assets : null;
  if (!assetsInput || assetsInput.length > 10000) {
    throw codedError('BEX_COURSE_MANIFEST_INVALID', 'Course assets must be a list.');
  }
  const assetIds = new Set();
  const assetPaths = new Set();
  const assets = assetsInput.map((assetValue) => {
    const asset = plainObject(assetValue, 'Course asset');
    const id = stableId(asset.id, 'Course asset ID');
    if (assetIds.has(id)) {
      throw codedError('BEX_COURSE_MANIFEST_INVALID', 'Course asset IDs must be unique.');
    }
    assetIds.add(id);
    const role = requiredText(asset.role, 'Course asset role', 40).toLowerCase();
    const allowedMimeTypes = ROLE_MIME_TYPES[role];
    if (!allowedMimeTypes) {
      throw codedError('BEX_COURSE_MANIFEST_INVALID', 'Course asset role is unsupported.');
    }
    const mimeType = requiredText(asset.mimeType, 'Course asset media type', 120).toLowerCase();
    if (!allowedMimeTypes.has(mimeType)) {
      throw codedError(
        'BEX_COURSE_MANIFEST_INVALID',
        role + ' assets do not support the media type ' + mimeType + '.',
      );
    }
    const sha256 = requiredText(asset.sha256, 'Course asset fingerprint', 64).toLowerCase();
    if (!SHA256_PATTERN.test(sha256)) {
      throw codedError('BEX_COURSE_MANIFEST_INVALID', 'Course asset fingerprint is invalid.');
    }
    const relativePath = safeRelativePath(asset.relativePath);
    if (assetPaths.has(relativePath)) {
      throw codedError('BEX_COURSE_MANIFEST_INVALID', 'Course asset paths must be unique.');
    }
    assetPaths.add(relativePath);
    return {
      id,
      role,
      sha256,
      byteSize: positiveInteger(asset.byteSize, 'Course asset size'),
      mimeType,
      relativePath,
    };
  });
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));

  const modulesInput = Array.isArray(manifest.modules) ? manifest.modules : null;
  if (!modulesInput || modulesInput.length < 1 || modulesInput.length > 1000) {
    throw codedError('BEX_COURSE_MANIFEST_INVALID', 'A course needs at least one module.');
  }
  const moduleIds = new Set();
  const lessonIds = new Set();
  const modules = modulesInput.map((moduleValue) => {
    const module = plainObject(moduleValue, 'Course module');
    const id = stableId(module.id, 'Course module ID');
    if (moduleIds.has(id)) {
      throw codedError('BEX_COURSE_MANIFEST_INVALID', 'Course module IDs must be unique.');
    }
    moduleIds.add(id);
    const lessonsInput = Array.isArray(module.lessons) ? module.lessons : null;
    if (!lessonsInput || lessonsInput.length < 1 || lessonsInput.length > 1000) {
      throw codedError('BEX_COURSE_MANIFEST_INVALID', 'Every course module needs a lesson.');
    }
    const lessons = lessonsInput.map((lessonValue) => {
      const lesson = plainObject(lessonValue, 'Course lesson');
      const lessonId = stableId(lesson.id, 'Course lesson ID');
      if (lessonIds.has(lessonId)) {
        throw codedError('BEX_COURSE_MANIFEST_INVALID', 'Course lesson IDs must be unique.');
      }
      lessonIds.add(lessonId);
      const mediaAssetId = optionalId(lesson.mediaAssetId, 'Lesson video asset ID');
      const posterAssetId = optionalId(lesson.posterAssetId, 'Lesson poster asset ID');
      const transcriptAssetId = optionalId(
        lesson.transcriptAssetId,
        'Lesson transcript asset ID',
      );
      const captionAssetIds = idList(lesson.captionAssetIds, 'Lesson caption asset ID');
      const attachmentAssetIds = idList(
        lesson.attachmentAssetIds,
        'Lesson attachment asset ID',
      );
      assertAssetRole(assetMap, mediaAssetId, ['video'], 'Lesson video');
      assertAssetRole(assetMap, posterAssetId, ['poster'], 'Lesson poster');
      assertAssetRole(assetMap, transcriptAssetId, ['transcript'], 'Lesson transcript');
      for (const assetId of captionAssetIds) {
        assertAssetRole(assetMap, assetId, ['caption'], 'Lesson caption');
      }
      for (const assetId of attachmentAssetIds) {
        assertAssetRole(assetMap, assetId, ['attachment'], 'Lesson attachment');
      }
      return {
        id: lessonId,
        title: requiredText(lesson.title, 'Course lesson title', 300),
        description: optionalText(lesson.description, 'Course lesson description', 20000),
        durationSeconds: nonNegativeInteger(lesson.durationSeconds, 'Course lesson duration'),
        mediaAssetId,
        posterAssetId,
        transcriptAssetId,
        captionAssetIds,
        attachmentAssetIds,
      };
    });
    return {
      id,
      title: requiredText(module.title, 'Course module title', 300),
      description: optionalText(module.description, 'Course module description', 10000),
      lessons,
    };
  });

  const artworkAssetId = optionalId(manifest.artworkAssetId, 'Course artwork asset ID');
  assertAssetRole(assetMap, artworkAssetId, ['artwork'], 'Course artwork');
  const language = requiredText(manifest.language, 'Course language', 40);
  if (!LANGUAGE_PATTERN.test(language)) {
    throw codedError('BEX_COURSE_MANIFEST_INVALID', 'Course language is invalid.');
  }
  const accent = optionalText(manifest.accent, 'Course accent color', 20) || '#8B6BC2';
  if (!/^#[a-f0-9]{6}$/i.test(accent)) {
    throw codedError('BEX_COURSE_MANIFEST_INVALID', 'Course accent color is invalid.');
  }

  return {
    format: COURSE_MANIFEST_FORMAT,
    manifestVersion: COURSE_MANIFEST_VERSION,
    courseId: stableId(manifest.courseId, 'Course ID'),
    version: versionNumber(manifest.version, 'Course version'),
    title: requiredText(manifest.title, 'Course title', 300),
    description: optionalText(manifest.description, 'Course description', 20000),
    author: requiredText(manifest.author, 'Course author', 300),
    language,
    accent,
    artworkAssetId,
    publishedAt: isoDate(manifest.publishedAt, 'Course publication time'),
    minimumBexVersion: versionNumber(manifest.minimumBexVersion, 'Minimum BEX version'),
    releaseNotes: optionalText(manifest.releaseNotes, 'Course release notes', 10000),
    contentProtection: normalizeProtection(manifest.contentProtection),
    modules,
    assets,
    signature: normalizeSignature(manifest.signature),
  };
}

function canonicalizeJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalizeJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) => (
      JSON.stringify(key) + ':' + canonicalizeJson(value[key])
    )).join(',') + '}';
  }
  return JSON.stringify(value);
}

function canonicalManifestJson(value, { includeSignature = true } = {}) {
  const manifest = normalizeCourseManifest(value);
  const signingValue = includeSignature ? manifest : { ...manifest, signature: null };
  const json = canonicalizeJson(signingValue);
  if (Buffer.byteLength(json, 'utf8') > MAX_MANIFEST_BYTES) {
    throw codedError('BEX_COURSE_MANIFEST_INVALID', 'Course manifest is too large.');
  }
  return json;
}

function objectRelativePath(sha256) {
  return 'objects/sha256/' + sha256.slice(0, 2) + '/' + sha256;
}

function courseDefinitionFromManifest(value) {
  const manifest = normalizeCourseManifest(value);
  const canonicalJson = canonicalManifestJson(manifest);
  return {
    id: manifest.courseId,
    version: manifest.version,
    title: manifest.title,
    description: manifest.description,
    author: manifest.author,
    artworkUrl: '',
    accent: manifest.accent,
    installState: 'installed',
    downloadBytes: manifest.assets.reduce((total, asset) => total + asset.byteSize, 0),
    downloadedBytes: manifest.assets.reduce((total, asset) => total + asset.byteSize, 0),
    releaseNotes: manifest.releaseNotes,
    updatedAt: manifest.publishedAt,
    modules: manifest.modules,
    assets: manifest.assets.map((asset) => ({
      ...asset,
      relativePath: objectRelativePath(asset.sha256),
    })),
    sourceManifestJson: canonicalJson,
    manifestSignature: manifest.signature?.value || '',
  };
}

module.exports = {
  COURSE_MANIFEST_FORMAT,
  COURSE_MANIFEST_VERSION,
  MAX_MANIFEST_BYTES,
  canonicalManifestJson,
  courseDefinitionFromManifest,
  normalizeCourseManifest,
  objectRelativePath,
};
