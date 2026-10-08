'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { objectRelativePath } = require('../course-platform/course-manifest.cjs');
const { LocalCatalogObjectSource, downloadCourseVersion, mergeCourseDownloadStates, readCourseDownloadStates } = require('../desktop/course-download.cjs');
const { canonicalCourseCatalogJson, normalizeCourseCatalog } = require('../course-platform/course-catalog.cjs');
const { HttpMirrorObjectSource } = require('../desktop/course-http-source.cjs');

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

function fixtureManifest(bytes, version = '1.0.0') {
  return {
    format: 'bex-course', manifestVersion: 1, courseId: 'resume-proof', version,
    title: 'Resume Proof', description: 'A disposable interrupted download.', author: 'Berean Examination',
    language: 'en', accent: '#8B6BC2', artworkAssetId: '', publishedAt: '2026-08-01T12:00:00.000Z',
    minimumBexVersion: '0.0.0', releaseNotes: '', contentProtection: { mode: 'none' },
    modules: [{ id: 'module-one', title: 'One', description: '', lessons: [{ id: 'lesson-one', title: 'One', description: '', durationSeconds: 1, mediaAssetId: 'video-one', posterAssetId: '', transcriptAssetId: '', captionAssetIds: [], attachmentAssetIds: [] }] }],
    assets: [{ id: 'video-one', role: 'video', sha256: sha256(bytes), byteSize: bytes.length, mimeType: 'video/mp4', relativePath: 'assets/video.mp4' }],
    signature: { algorithm: 'ed25519', keyId: 'test-course-key', value: 'A'.repeat(86) },
  };
}

function createFolders(root, bytes, manifest) {
  const catalogRoot = path.join(root, 'Catalog');
  const libraryPath = path.join(root, 'Library');
  fs.mkdirSync(path.join(libraryPath, 'Courses'), { recursive: true });
  const sourcePath = path.join(catalogRoot, objectRelativePath(manifest.assets[0].sha256));
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, bytes);
  return { catalogRoot, libraryPath, sourcePath };
}

function countingSource(catalogRoot, counter) {
  const local = new LocalCatalogObjectSource(catalogRoot);
  return {
    open: async (asset) => {
      const opened = await local.open(asset);
      return { ...opened, read: async (offset, length) => { const bytes = await opened.read(offset, length); counter.bytes += bytes.length; return bytes; } };
    },
  };
}

test('Course download pauses, survives restart, resumes from the saved byte, and activates only when complete', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bex-course-resume-'));
  try {
    const bytes = crypto.randomBytes(512 * 1024 + 17);
    const manifest = fixtureManifest(bytes);
    const { catalogRoot, libraryPath } = createFolders(root, bytes, manifest);
    const controller = new AbortController();
    let installations = 0;
    const firstCounter = { bytes: 0 };
    const first = await downloadCourseVersion({
      chunkBytes: 64 * 1024,
      currentBexVersion: '0.0.0',
      installCourseVersion: async (course) => { installations += 1; return course; },
      libraryPath,
      manifest,
      objectSource: countingSource(catalogRoot, firstCounter),
      onProgress: (progress) => { if (progress.downloadedBytes >= 64 * 1024 && progress.downloadedBytes < progress.totalBytes) controller.abort(); },
      signal: controller.signal,
      verifyManifestSignature: () => true,
    });
    assert.equal(first.paused, true);
    assert.equal(installations, 0);
    assert.equal(first.download.downloadedBytes, 64 * 1024);
    const saved = readCourseDownloadStates(libraryPath);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].status, 'paused');
    const merged = mergeCourseDownloadStates({ courses: [{ id: manifest.courseId, version: manifest.version, installState: 'available' }] }, saved);
    assert.equal(merged.courses[0].installState, 'downloading');
    assert.equal(merged.courses[0].downloadedBytes, 64 * 1024);

    const secondCounter = { bytes: 0 };
    const resumed = await downloadCourseVersion({
      chunkBytes: 64 * 1024,
      currentBexVersion: '0.0.0',
      installCourseVersion: async (course) => { installations += 1; return course; },
      libraryPath,
      manifest,
      objectSource: countingSource(catalogRoot, secondCounter),
      verifyManifestSignature: () => true,
    });
    assert.equal(resumed.paused, false);
    assert.equal(installations, 1);
    assert.equal(secondCounter.bytes, bytes.length - 64 * 1024);
    assert.deepEqual(fs.readFileSync(path.join(libraryPath, 'Courses', objectRelativePath(manifest.assets[0].sha256))), bytes);
    assert.equal(readCourseDownloadStates(libraryPath).length, 0);
  } finally { fs.rmSync(root, { force: true, recursive: true }); }
});

test('Course download checks disk space before copying and never activates damaged media', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bex-course-download-safety-'));
  try {
    const bytes = crypto.randomBytes(192 * 1024);
    const manifest = fixtureManifest(bytes);
    const disk = createFolders(path.join(root, 'disk'), bytes, manifest);
    let installations = 0;
    await assert.rejects(downloadCourseVersion({
      currentBexVersion: '0.0.0', getAvailableBytes: async () => 0,
      installCourseVersion: async (course) => { installations += 1; return course; },
      libraryPath: disk.libraryPath, manifest, objectSource: new LocalCatalogObjectSource(disk.catalogRoot), verifyManifestSignature: () => true,
    }), (error) => error?.code === 'BEX_COURSE_DISK_FULL');
    assert.equal(installations, 0);

    const damaged = createFolders(path.join(root, 'damaged'), bytes, manifest);
    const altered = Buffer.from(bytes); altered[0] ^= 0xff; fs.writeFileSync(damaged.sourcePath, altered);
    await assert.rejects(downloadCourseVersion({
      chunkBytes: 32 * 1024, currentBexVersion: '0.0.0',
      installCourseVersion: async (course) => { installations += 1; return course; },
      libraryPath: damaged.libraryPath, manifest, objectSource: new LocalCatalogObjectSource(damaged.catalogRoot), verifyManifestSignature: () => true,
    }), (error) => error?.code === 'BEX_COURSE_ASSET_MISMATCH');
    assert.equal(installations, 0);
    assert.equal(fs.existsSync(path.join(damaged.libraryPath, 'Courses', objectRelativePath(manifest.assets[0].sha256))), false);
  } finally { fs.rmSync(root, { force: true, recursive: true }); }
});

test('Signed catalog mirrors are strict, ordered, and covered by the catalog signature text', () => {
  const bytes = Buffer.from('signed mirror proof');
  const manifest = fixtureManifest(bytes);
  const entry = {
    courseId: manifest.courseId, version: manifest.version,
    manifestPath: 'manifests/resume-proof/1.0.0.json', packagePath: 'packages/resume-proof/1.0.0',
    manifestSha256: 'b'.repeat(64), downloadBytes: bytes.length,
    objects: [{ sha256: manifest.assets[0].sha256, byteSize: bytes.length, mirrors: ['https://github.com/example/BEX/releases/download/course-1/video.mp4', 'https://mirror.example/video.mp4'] }],
  };
  const catalog = { format: 'bex-course-catalog', catalogVersion: 1, channel: 'stable', updatedAt: '2026-08-01T12:00:00.000Z', courses: [entry], signature: null };
  const normalized = normalizeCourseCatalog(catalog);
  assert.deepEqual(normalized.courses[0].objects[0].mirrors, entry.objects[0].mirrors);
  const original = canonicalCourseCatalogJson(catalog, { includeSignature: false });
  const changed = structuredClone(catalog); changed.courses[0].objects[0].mirrors.reverse();
  assert.notEqual(canonicalCourseCatalogJson(changed, { includeSignature: false }), original);
  const unsafe = structuredClone(catalog); unsafe.courses[0].objects[0].mirrors = ['http://github.com/example/video.mp4'];
  assert.throws(() => normalizeCourseCatalog(unsafe), (error) => error?.code === 'BEX_COURSE_CATALOG_INVALID');
});

test('Course download resumes from its saved byte through a different HTTPS mirror', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bex-course-mirror-resume-'));
  try {
    const bytes = crypto.randomBytes(256 * 1024 + 31);
    const manifest = fixtureManifest(bytes, '2.0.0');
    const libraryPath = path.join(root, 'Library');
    fs.mkdirSync(path.join(libraryPath, 'Courses'), { recursive: true });
    const mirrors = ['https://first.example/video.mp4', 'https://second.example/video.mp4'];
    const objects = [{ sha256: manifest.assets[0].sha256, byteSize: bytes.length, mirrors }];
    const requests = [];
    let firstMirrorAvailable = true;
    const fetchImpl = async (url, options) => {
      const match = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range);
      const start = Number(match[1]); const end = Number(match[2]);
      requests.push({ url, start, end });
      if (url === mirrors[0] && !firstMirrorAvailable) return new Response('', { status: 503 });
      return new Response(bytes.subarray(start, end + 1), { status: 206, headers: { 'Content-Range': 'bytes ' + start + '-' + end + '/' + bytes.length } });
    };
    const controller = new AbortController();
    let installations = 0;
    const first = await downloadCourseVersion({
      chunkBytes: 64 * 1024, currentBexVersion: '0.0.0', libraryPath, manifest,
      installCourseVersion: async (course) => { installations += 1; return course; },
      objectSource: new HttpMirrorObjectSource(objects, { fetchImpl, signal: controller.signal }),
      onProgress: (progress) => { if (progress.downloadedBytes === 64 * 1024) controller.abort(); },
      signal: controller.signal, verifyManifestSignature: () => true,
    });
    assert.equal(first.paused, true);
    assert.equal(installations, 0);
    firstMirrorAvailable = false;
    const requestCountBeforeResume = requests.length;
    const resumed = await downloadCourseVersion({
      chunkBytes: 64 * 1024, currentBexVersion: '0.0.0', libraryPath, manifest,
      installCourseVersion: async (course) => { installations += 1; return course; },
      objectSource: new HttpMirrorObjectSource(objects, { fetchImpl }),
      verifyManifestSignature: () => true,
    });
    const resumedRequests = requests.slice(requestCountBeforeResume);
    assert.equal(resumed.paused, false);
    assert.equal(installations, 1);
    assert.equal(resumedRequests[0].url, mirrors[0]);
    assert.equal(resumedRequests[0].start, 64 * 1024);
    assert.equal(resumedRequests[1].url, mirrors[1]);
    assert.equal(resumedRequests[1].start, 64 * 1024);
    assert.deepEqual(fs.readFileSync(path.join(libraryPath, 'Courses', objectRelativePath(manifest.assets[0].sha256))), bytes);
  } finally { fs.rmSync(root, { force: true, recursive: true }); }
});
