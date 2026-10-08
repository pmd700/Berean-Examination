'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const {
  MAX_MANIFEST_BYTES,
  canonicalManifestJson,
  courseDefinitionFromManifest,
  normalizeCourseManifest,
  objectRelativePath,
} = require('../course-platform/course-manifest.cjs');

const MANIFEST_FILE_NAME = 'manifest.json';

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function numericVersionParts(value) {
  return String(value).split('-', 1)[0].split('.').map((part) => Number(part));
}

function versionIsAtLeast(currentVersion, minimumVersion) {
  const current = numericVersionParts(currentVersion);
  const minimum = numericVersionParts(minimumVersion);
  for (let index = 0; index < Math.max(current.length, minimum.length); index += 1) {
    const currentPart = current[index] || 0;
    const minimumPart = minimum[index] || 0;
    if (currentPart > minimumPart) return true;
    if (currentPart < minimumPart) return false;
  }
  return true;
}

function staysInside(parentPath, candidatePath) {
  return candidatePath === parentPath || candidatePath.startsWith(parentPath + path.sep);
}

async function readManifest(packagePath) {
  const packageRoot = await fs.promises.realpath(path.resolve(packagePath));
  const rootStats = await fs.promises.stat(packageRoot);
  if (!rootStats.isDirectory()) {
    throw codedError('BEX_COURSE_PACKAGE_INVALID', 'Choose a Course package folder.');
  }
  const manifestPath = path.join(packageRoot, MANIFEST_FILE_NAME);
  const manifestStats = await fs.promises.lstat(manifestPath).catch((error) => {
    if (error?.code === 'ENOENT') {
      throw codedError('BEX_COURSE_PACKAGE_INVALID', 'That folder has no manifest.json file.');
    }
    throw error;
  });
  if (!manifestStats.isFile() || manifestStats.isSymbolicLink()) {
    throw codedError('BEX_COURSE_PACKAGE_INVALID', 'The Course manifest must be a regular file.');
  }
  if (manifestStats.size < 2 || manifestStats.size > MAX_MANIFEST_BYTES) {
    throw codedError('BEX_COURSE_PACKAGE_INVALID', 'The Course manifest size is invalid.');
  }
  let parsed;
  try {
    parsed = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
  } catch {
    throw codedError('BEX_COURSE_PACKAGE_INVALID', 'The Course manifest is not valid JSON.');
  }
  return { manifest: normalizeCourseManifest(parsed), packageRoot };
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  let byteSize = 0;
  const reader = fs.createReadStream(filePath);
  for await (const chunk of reader) {
    hash.update(chunk);
    byteSize += chunk.length;
  }
  return { byteSize, sha256: hash.digest('hex') };
}

async function copyAndHashFile(sourcePath, destinationPath) {
  const hash = crypto.createHash('sha256');
  let byteSize = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      byteSize += chunk.length;
      callback(null, chunk);
    },
  });
  await pipeline(
    fs.createReadStream(sourcePath),
    meter,
    fs.createWriteStream(destinationPath, { flags: 'wx', mode: 0o600 }),
  );
  return { byteSize, sha256: hash.digest('hex') };
}

function assertAssetMatches(asset, actual) {
  if (actual.byteSize !== asset.byteSize) {
    throw codedError(
      'BEX_COURSE_ASSET_MISMATCH',
      'Course file ' + asset.id + ' has the wrong size.',
      { assetId: asset.id },
    );
  }
  if (actual.sha256 !== asset.sha256) {
    throw codedError(
      'BEX_COURSE_ASSET_MISMATCH',
      'Course file ' + asset.id + ' was changed or damaged.',
      { assetId: asset.id },
    );
  }
}

async function assertEnoughDiskSpace(coursesRoot, requiredBytes) {
  if (!requiredBytes || typeof fs.promises.statfs !== 'function') return;
  const stats = await fs.promises.statfs(coursesRoot);
  const availableBytes = Number(stats.bavail) * Number(stats.bsize);
  if (Number.isFinite(availableBytes) && availableBytes < requiredBytes) {
    throw codedError(
      'BEX_COURSE_DISK_FULL',
      'There is not enough free space to install this course.',
      { availableBytes, requiredBytes },
    );
  }
}

async function publishFileWithoutOverwrite(sourcePath, destinationPath) {
  await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
  try {
    await fs.promises.link(sourcePath, destinationPath);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
  await fs.promises.unlink(sourcePath).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
}

async function publishManifest(manifest, coursesRoot) {
  const canonicalJson = canonicalManifestJson(manifest) + '\n';
  const manifestFolder = path.join(coursesRoot, 'manifests', manifest.courseId);
  const manifestPath = path.join(manifestFolder, manifest.version + '.json');
  await fs.promises.mkdir(manifestFolder, { recursive: true });
  try {
    const existing = await fs.promises.readFile(manifestPath, 'utf8');
    if (existing !== canonicalJson) {
      throw codedError(
        'BEX_COURSE_VERSION_CONFLICT',
        'That course version is already installed with different content.',
      );
    }
    return manifestPath;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const temporaryPath = manifestPath + '.tmp-' + crypto.randomUUID();
  await fs.promises.writeFile(temporaryPath, canonicalJson, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  try {
    await fs.promises.link(temporaryPath, manifestPath);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = await fs.promises.readFile(manifestPath, 'utf8');
    if (existing !== canonicalJson) {
      throw codedError(
        'BEX_COURSE_VERSION_CONFLICT',
        'That course version is already installed with different content.',
      );
    }
  } finally {
    await fs.promises.unlink(temporaryPath).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
  return manifestPath;
}

async function verifySignature(manifest, options) {
  if (!manifest.signature) {
    if (!options.allowUnsigned) {
      throw codedError(
        'BEX_COURSE_SIGNATURE_REQUIRED',
        'This Course package is unsigned and cannot be installed by a release build.',
      );
    }
    return 'unsigned-development';
  }
  if (typeof options.verifyManifestSignature !== 'function') {
    throw codedError(
      'BEX_COURSE_SIGNATURE_UNVERIFIED',
      'BEX cannot verify this signed Course package yet.',
    );
  }
  const verified = await options.verifyManifestSignature({
    canonicalJson: canonicalManifestJson(manifest, { includeSignature: false }),
    signature: manifest.signature,
  });
  if (!verified) {
    throw codedError('BEX_COURSE_SIGNATURE_INVALID', 'This Course package signature is invalid.');
  }
  return 'verified';
}

async function installLocalCoursePackage(options = {}) {
  if (typeof options.packagePath !== 'string' || !options.packagePath.trim()) {
    throw codedError('BEX_COURSE_PACKAGE_INVALID', 'Choose a Course package folder.');
  }
  if (typeof options.libraryPath !== 'string' || !options.libraryPath.trim()) {
    throw codedError('BEX_DATABASE_NOT_OPEN', 'Choose the Berean Library before installing a course.');
  }
  if (typeof options.installCourseVersion !== 'function') {
    throw new TypeError('The Course package installer needs the local Course store.');
  }

  const { manifest, packageRoot } = await readManifest(options.packagePath);
  const currentBexVersion = options.currentBexVersion || '0.0.0';
  if (!versionIsAtLeast(currentBexVersion, manifest.minimumBexVersion)) {
    throw codedError(
      'BEX_COURSE_APP_UPDATE_REQUIRED',
      'Update BEX before installing this Course package.',
    );
  }
  const signatureStatus = await verifySignature(manifest, options);
  const libraryRoot = path.resolve(options.libraryPath);
  const coursesRoot = path.join(libraryRoot, 'Courses');
  const realLibraryRoot = await fs.promises.realpath(libraryRoot);
  const realCoursesRoot = await fs.promises.realpath(coursesRoot);
  if (!staysInside(realLibraryRoot, realCoursesRoot)) {
    throw codedError('BEX_COURSE_PACKAGE_INVALID', 'The Berean Library Courses folder is unsafe.');
  }

  const stageRoot = path.join(
    coursesRoot,
    'staging',
    manifest.courseId,
    manifest.version + '-' + crypto.randomUUID(),
  );
  await fs.promises.mkdir(stageRoot, { recursive: true, mode: 0o700 });

  const pendingAssetsByHash = new Map();
  let missingBytes = 0;
  try {
    for (const asset of manifest.assets) {
      const sourcePath = path.resolve(packageRoot, asset.relativePath);
      if (!staysInside(packageRoot, sourcePath)) {
        throw codedError('BEX_COURSE_PACKAGE_INVALID', 'A Course file path leaves its package.');
      }
      const sourceStats = await fs.promises.lstat(sourcePath).catch((error) => {
        if (error?.code === 'ENOENT') {
          throw codedError(
            'BEX_COURSE_ASSET_MISSING',
            'Course file ' + asset.id + ' is missing.',
            { assetId: asset.id },
          );
        }
        throw error;
      });
      if (!sourceStats.isFile() || sourceStats.isSymbolicLink()) {
        throw codedError('BEX_COURSE_PACKAGE_INVALID', 'Course files must be regular files.');
      }
      const realSourcePath = await fs.promises.realpath(sourcePath);
      if (!staysInside(packageRoot, realSourcePath)) {
        throw codedError('BEX_COURSE_PACKAGE_INVALID', 'A Course file points outside its package.');
      }

      const destinationPath = path.join(coursesRoot, objectRelativePath(asset.sha256));
      try {
        const destinationStats = await fs.promises.lstat(destinationPath);
        if (!destinationStats.isFile() || destinationStats.isSymbolicLink()) {
          throw codedError('BEX_COURSE_ASSET_MISMATCH', 'A stored Course object is unsafe.');
        }
        assertAssetMatches(asset, await hashFile(destinationPath));
        continue;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      const pending = pendingAssetsByHash.get(asset.sha256);
      if (pending) {
        pending.sources.push({ asset, sourcePath: realSourcePath });
      } else {
        pendingAssetsByHash.set(asset.sha256, {
          asset,
          destinationPath,
          sources: [{ asset, sourcePath: realSourcePath }],
        });
        missingBytes += asset.byteSize;
      }
    }

    await assertEnoughDiskSpace(coursesRoot, missingBytes);
    const pendingAssets = [...pendingAssetsByHash.values()];
    for (const pending of pendingAssets) {
      const stagePath = path.join(stageRoot, pending.asset.sha256);
      const [firstSource, ...duplicateSources] = pending.sources;
      const actual = await copyAndHashFile(firstSource.sourcePath, stagePath);
      assertAssetMatches(pending.asset, actual);
      for (const duplicate of duplicateSources) {
        assertAssetMatches(duplicate.asset, await hashFile(duplicate.sourcePath));
      }
      pending.stagePath = stagePath;
    }
    for (const pending of pendingAssets) {
      await publishFileWithoutOverwrite(pending.stagePath, pending.destinationPath);
    }
    await publishManifest(manifest, coursesRoot);
    const course = await options.installCourseVersion(courseDefinitionFromManifest(manifest));
    return {
      assetCount: manifest.assets.length,
      course,
      installedBytes: manifest.assets.reduce((total, asset) => total + asset.byteSize, 0),
      signatureStatus,
      version: manifest.version,
    };
  } finally {
    await fs.promises.rm(stageRoot, { force: true, recursive: true });
  }
}

async function activateVerifiedCourseManifest(options = {}) {
  if (typeof options.libraryPath !== 'string' || !options.libraryPath.trim()) {
    throw codedError('BEX_DATABASE_NOT_OPEN', 'Choose the Berean Library before installing a course.');
  }
  if (typeof options.installCourseVersion !== 'function') {
    throw new TypeError('Course activation needs the local Course store.');
  }
  const manifest = normalizeCourseManifest(options.manifest);
  const currentBexVersion = options.currentBexVersion || '0.0.0';
  if (!versionIsAtLeast(currentBexVersion, manifest.minimumBexVersion)) {
    throw codedError('BEX_COURSE_APP_UPDATE_REQUIRED', 'Update BEX before installing this Course package.');
  }
  const signatureStatus = await verifySignature(manifest, options);
  const libraryRoot = await fs.promises.realpath(path.resolve(options.libraryPath));
  const coursesRoot = await fs.promises.realpath(path.join(libraryRoot, 'Courses'));
  if (!staysInside(libraryRoot, coursesRoot)) {
    throw codedError('BEX_COURSE_PACKAGE_INVALID', 'The Berean Library Courses folder is unsafe.');
  }
  for (const asset of new Map(manifest.assets.map((item) => [item.sha256, item])).values()) {
    const objectPath = path.join(coursesRoot, objectRelativePath(asset.sha256));
    const stats = await fs.promises.lstat(objectPath).catch((error) => {
      if (error?.code === 'ENOENT') throw codedError('BEX_COURSE_ASSET_MISSING', 'A verified Course file is missing before activation.');
      throw error;
    });
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size !== asset.byteSize) {
      throw codedError('BEX_COURSE_ASSET_MISMATCH', 'A verified Course file changed before activation.');
    }
  }
  await publishManifest(manifest, coursesRoot);
  const course = await options.installCourseVersion(courseDefinitionFromManifest(manifest));
  return {
    assetCount: manifest.assets.length,
    course,
    installedBytes: manifest.assets.reduce((total, asset) => total + asset.byteSize, 0),
    signatureStatus,
    version: manifest.version,
  };
}

module.exports = {
  MANIFEST_FILE_NAME,
  activateVerifiedCourseManifest,
  installLocalCoursePackage,
  versionIsAtLeast,
};
