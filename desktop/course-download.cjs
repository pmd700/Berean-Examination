'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { canonicalManifestJson, normalizeCourseManifest, objectRelativePath } = require('../course-platform/course-manifest.cjs');
const { activateVerifiedCourseManifest, versionIsAtLeast } = require('./course-package.cjs');

const DOWNLOAD_STATE_FORMAT = 'bex-course-download';
const DOWNLOAD_STATE_VERSION = 1;
const DEFAULT_CHUNK_BYTES = 8 * 1024 * 1024;

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function inside(parent, candidate) {
  return candidate === parent || candidate.startsWith(parent + path.sep);
}

function fingerprint(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  let byteSize = 0;
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk);
    byteSize += chunk.length;
  }
  return { byteSize, sha256: hash.digest('hex') };
}

function assertMatches(asset, actual) {
  if (actual.byteSize !== asset.byteSize || actual.sha256 !== asset.sha256) {
    throw codedError('BEX_COURSE_ASSET_MISMATCH', 'A Course file was changed or damaged.', { assetId: asset.id });
  }
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = filePath + '.tmp-' + crypto.randomUUID();
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function uniqueAssets(manifest) {
  return [...new Map(manifest.assets.map((asset) => [asset.sha256, asset])).values()];
}

function publicDownloadState(state) {
  const downloadedBytes = state.assets.reduce((total, asset) => total + Math.min(asset.byteSize, asset.downloadedBytes), 0);
  const totalBytes = state.assets.reduce((total, asset) => total + asset.byteSize, 0);
  return {
    courseId: state.courseId,
    version: state.courseVersion,
    status: state.status === 'downloading' ? 'downloading' : 'paused',
    downloadedBytes,
    totalBytes,
    progressPercent: totalBytes ? Math.min(100, (downloadedBytes / totalBytes) * 100) : 100,
    completedAssets: state.assets.filter((asset) => asset.complete).length,
    totalAssets: state.assets.length,
    updatedAt: state.updatedAt,
  };
}

function createState(manifest, manifestSha256) {
  return {
    format: DOWNLOAD_STATE_FORMAT,
    stateVersion: DOWNLOAD_STATE_VERSION,
    courseId: manifest.courseId,
    courseVersion: manifest.version,
    manifestSha256,
    status: 'paused',
    updatedAt: new Date().toISOString(),
    assets: uniqueAssets(manifest).map((asset) => ({
      sha256: asset.sha256,
      byteSize: asset.byteSize,
      downloadedBytes: 0,
      complete: false,
    })),
  };
}

function readCompatibleState(filePath, manifest, manifestSha256) {
  if (!fs.existsSync(filePath)) return createState(manifest, manifestSha256);
  let value;
  try { value = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { throw codedError('BEX_COURSE_DOWNLOAD_STATE_INVALID', 'The saved Course download state is damaged.'); }
  if (
    value?.format !== DOWNLOAD_STATE_FORMAT
    || value?.stateVersion !== DOWNLOAD_STATE_VERSION
    || value?.courseId !== manifest.courseId
    || value?.courseVersion !== manifest.version
    || value?.manifestSha256 !== manifestSha256
  ) {
    throw codedError('BEX_COURSE_VERSION_CONFLICT', 'The saved Course download belongs to different content.');
  }
  const expected = new Map(uniqueAssets(manifest).map((asset) => [asset.sha256, asset]));
  if (!Array.isArray(value.assets) || value.assets.length !== expected.size) {
    throw codedError('BEX_COURSE_DOWNLOAD_STATE_INVALID', 'The saved Course download state is incomplete.');
  }
  const assets = value.assets.map((item) => {
    const asset = expected.get(item?.sha256);
    const downloadedBytes = Number(item?.downloadedBytes);
    if (!asset || item.byteSize !== asset.byteSize || !Number.isSafeInteger(downloadedBytes) || downloadedBytes < 0 || downloadedBytes > asset.byteSize) {
      throw codedError('BEX_COURSE_DOWNLOAD_STATE_INVALID', 'The saved Course download state is invalid.');
    }
    expected.delete(item.sha256);
    return { sha256: item.sha256, byteSize: asset.byteSize, downloadedBytes, complete: Boolean(item.complete) };
  });
  if (expected.size) throw codedError('BEX_COURSE_DOWNLOAD_STATE_INVALID', 'The saved Course download state is incomplete.');
  return { ...value, status: 'paused', assets };
}

async function availableBytes(folder) {
  if (typeof fs.promises.statfs !== 'function') return Number.POSITIVE_INFINITY;
  const stats = await fs.promises.statfs(folder);
  return Number(stats.bavail) * Number(stats.bsize);
}

async function assertEnoughSpace(folder, requiredBytes, getAvailableBytes = availableBytes) {
  const available = await getAvailableBytes(folder);
  if (Number.isFinite(available) && available < requiredBytes) {
    throw codedError('BEX_COURSE_DISK_FULL', 'There is not enough free space to download this course.', { availableBytes: available, requiredBytes });
  }
}

class LocalCatalogObjectSource {
  constructor(catalogRoot) {
    this.catalogRoot = fs.realpathSync(catalogRoot);
  }

  async open(asset) {
    const objectPath = path.join(this.catalogRoot, objectRelativePath(asset.sha256));
    const stats = await fs.promises.lstat(objectPath).catch((error) => {
      if (error?.code === 'ENOENT') throw codedError('BEX_COURSE_ASSET_MISSING', 'A published Course file is missing.', { assetId: asset.id });
      throw error;
    });
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size !== asset.byteSize) {
      throw codedError('BEX_COURSE_ASSET_MISMATCH', 'A published Course file is unsafe or has the wrong size.', { assetId: asset.id });
    }
    const realPath = await fs.promises.realpath(objectPath);
    if (!inside(this.catalogRoot, realPath)) throw codedError('BEX_COURSE_PACKAGE_INVALID', 'A published Course object leaves its catalog.');
    const handle = await fs.promises.open(realPath, 'r');
    return {
      size: stats.size,
      read: async (offset, length) => {
        const buffer = Buffer.allocUnsafe(length);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        return buffer.subarray(0, bytesRead);
      },
      close: () => handle.close(),
    };
  }
}

async function existingVerifiedObject(coursesRoot, asset) {
  const destinationPath = path.join(coursesRoot, objectRelativePath(asset.sha256));
  try {
    const stats = await fs.promises.lstat(destinationPath);
    if (!stats.isFile() || stats.isSymbolicLink()) throw codedError('BEX_COURSE_ASSET_MISMATCH', 'A stored Course object is unsafe.');
    assertMatches(asset, await hashFile(destinationPath));
    return destinationPath;
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

async function publishStagedObject(stagePath, destinationPath, asset) {
  await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
  try { await fs.promises.link(stagePath, destinationPath); }
  catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    assertMatches(asset, await hashFile(destinationPath));
  }
  await fs.promises.unlink(stagePath).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
}

async function downloadCourseVersion(options = {}) {
  const manifest = normalizeCourseManifest(options.manifest);
  if (!manifest.signature || typeof options.verifyManifestSignature !== 'function') {
    throw codedError('BEX_COURSE_SIGNATURE_REQUIRED', 'A catalog Course must be signed before downloading.');
  }
  const signatureValid = await options.verifyManifestSignature({
    canonicalJson: canonicalManifestJson(manifest, { includeSignature: false }),
    signature: manifest.signature,
  });
  if (!signatureValid) throw codedError('BEX_COURSE_SIGNATURE_INVALID', 'This Course signature is invalid.');
  if (!versionIsAtLeast(options.currentBexVersion || '0.0.0', manifest.minimumBexVersion)) {
    throw codedError('BEX_COURSE_APP_UPDATE_REQUIRED', 'Update BEX before downloading this Course.');
  }
  if (!options.objectSource || typeof options.objectSource.open !== 'function') throw new TypeError('The Course downloader needs an object source.');
  if (typeof options.installCourseVersion !== 'function') throw new TypeError('The Course downloader needs the local Course store.');

  const libraryRoot = await fs.promises.realpath(path.resolve(options.libraryPath));
  const coursesRoot = await fs.promises.realpath(path.join(libraryRoot, 'Courses'));
  if (!inside(libraryRoot, coursesRoot)) throw codedError('BEX_COURSE_PACKAGE_INVALID', 'The Berean Library Courses folder is unsafe.');
  const stageRoot = path.join(coursesRoot, 'staging', 'downloads', manifest.courseId, manifest.version);
  const statePath = path.join(stageRoot, 'download-state.json');
  const manifestJson = canonicalManifestJson(manifest) + '\n';
  const manifestSha256 = fingerprint(Buffer.from(manifestJson));
  await fs.promises.mkdir(stageRoot, { recursive: true, mode: 0o700 });
  const state = readCompatibleState(statePath, manifest, manifestSha256);
  const assetsByHash = new Map(uniqueAssets(manifest).map((asset) => [asset.sha256, asset]));
  const chunkBytes = Number.isSafeInteger(options.chunkBytes) && options.chunkBytes > 0 ? options.chunkBytes : DEFAULT_CHUNK_BYTES;
  const notify = () => {
    state.updatedAt = new Date().toISOString();
    atomicWriteJson(statePath, state);
    try { options.onProgress?.(publicDownloadState(state)); } catch {}
  };

  try {
    let requiredBytes = 0;
    for (const stateAsset of state.assets) {
      const asset = assetsByHash.get(stateAsset.sha256);
      if (await existingVerifiedObject(coursesRoot, asset)) {
        stateAsset.downloadedBytes = asset.byteSize;
        stateAsset.complete = true;
        continue;
      }
      const partialPath = path.join(stageRoot, asset.sha256 + '.part');
      const partialSize = await fs.promises.stat(partialPath).then((stats) => stats.size).catch((error) => error?.code === 'ENOENT' ? 0 : Promise.reject(error));
      if (partialSize > asset.byteSize) throw codedError('BEX_COURSE_DOWNLOAD_STATE_INVALID', 'A partial Course file is larger than expected.');
      stateAsset.downloadedBytes = partialSize;
      stateAsset.complete = false;
      requiredBytes += asset.byteSize - partialSize;
    }
    await assertEnoughSpace(coursesRoot, requiredBytes, options.getAvailableBytes);
    state.status = 'downloading';
    notify();

    for (const stateAsset of state.assets) {
      if (stateAsset.complete) continue;
      const asset = assetsByHash.get(stateAsset.sha256);
      const partialPath = path.join(stageRoot, asset.sha256 + '.part');
      const source = await options.objectSource.open(asset);
      if (source.size !== asset.byteSize) { await source.close(); throw codedError('BEX_COURSE_ASSET_MISMATCH', 'A Course source file has the wrong size.'); }
      const target = await fs.promises.open(partialPath, 'a+', 0o600);
      try {
        let offset = (await target.stat()).size;
        while (offset < asset.byteSize) {
          if (options.signal?.aborted) throw codedError('BEX_COURSE_DOWNLOAD_PAUSED', 'Course download paused.');
          const length = Math.min(chunkBytes, asset.byteSize - offset);
          const bytes = await source.read(offset, length);
          if (!bytes.length) throw codedError('BEX_COURSE_ASSET_MISMATCH', 'A Course source file ended early.');
          await target.write(bytes, 0, bytes.length, offset);
          await target.sync();
          offset += bytes.length;
          stateAsset.downloadedBytes = offset;
          notify();
        }
      } finally {
        await target.close();
        await source.close();
      }
      assertMatches(asset, await hashFile(partialPath));
      await publishStagedObject(partialPath, path.join(coursesRoot, objectRelativePath(asset.sha256)), asset);
      stateAsset.complete = true;
      stateAsset.downloadedBytes = asset.byteSize;
      notify();
    }

    const installed = await activateVerifiedCourseManifest({
      allowUnsigned: false,
      currentBexVersion: options.currentBexVersion,
      installCourseVersion: options.installCourseVersion,
      libraryPath: libraryRoot,
      manifest,
      verifyManifestSignature: options.verifyManifestSignature,
    });
    const completed = { ...publicDownloadState(state), status: 'completed', progressPercent: 100 };
    try { options.onProgress?.(completed); } catch {}
    await fs.promises.rm(stageRoot, { force: true, recursive: true });
    return { ...installed, download: completed, paused: false };
  } catch (error) {
    state.status = 'paused';
    state.lastErrorCode = error?.code || 'BEX_COURSE_DOWNLOAD_FAILED';
    notify();
    if (error?.code === 'BEX_COURSE_DOWNLOAD_PAUSED') return { download: publicDownloadState(state), paused: true };
    throw error;
  }
}

function readCourseDownloadStates(libraryPath) {
  const downloadsRoot = path.join(path.resolve(libraryPath), 'Courses', 'staging', 'downloads');
  if (!fs.existsSync(downloadsRoot)) return [];
  const states = [];
  for (const courseId of fs.readdirSync(downloadsRoot)) {
    const courseFolder = path.join(downloadsRoot, courseId);
    if (!fs.statSync(courseFolder).isDirectory()) continue;
    for (const version of fs.readdirSync(courseFolder)) {
      const filePath = path.join(courseFolder, version, 'download-state.json');
      try {
        const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (value?.format === DOWNLOAD_STATE_FORMAT && value?.stateVersion === DOWNLOAD_STATE_VERSION) states.push(publicDownloadState({ ...value, status: 'paused' }));
      } catch {}
    }
  }
  return states;
}

function mergeCourseDownloadStates(library, states) {
  const byCourse = new Map(states.map((state) => [state.courseId + '@' + state.version, state]));
  return {
    ...library,
    courses: library.courses.map((course) => {
      const state = byCourse.get(course.id + '@' + course.version);
      return state ? { ...course, installState: 'downloading', downloadStatus: state.status, downloadedBytes: state.downloadedBytes, downloadBytes: state.totalBytes, downloadProgressPercent: state.progressPercent } : course;
    }),
  };
}

module.exports = {
  DEFAULT_CHUNK_BYTES,
  LocalCatalogObjectSource,
  downloadCourseVersion,
  mergeCourseDownloadStates,
  readCourseDownloadStates,
};
