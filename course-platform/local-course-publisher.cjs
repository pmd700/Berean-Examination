'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { canonicalManifestJson, courseDefinitionFromManifest, normalizeCourseManifest, objectRelativePath } = require('./course-manifest.cjs');
const { canonicalCourseCatalogJson, normalizeCourseCatalog } = require('./course-catalog.cjs');

function coded(code, message) { const error = new Error(message); error.code = code; return error; }
function inside(parent, candidate) { return candidate === parent || candidate.startsWith(parent + path.sep); }
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
async function hashFile(filePath) { const hash = crypto.createHash('sha256'); let size = 0; for await (const chunk of fs.createReadStream(filePath)) { hash.update(chunk); size += chunk.length; } return { sha256: hash.digest('hex'), byteSize: size }; }

function atomicWrite(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = filePath + '.tmp-' + crypto.randomUUID();
  fs.writeFileSync(temporary, contents, { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function linkWithoutOverwrite(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  try { fs.linkSync(source, destination); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}

function verifySignedDocument(document, canonicalJson, verifySignature, errorCode) {
  if (!document.signature || typeof verifySignature !== 'function' || !verifySignature({ canonicalJson, signature: document.signature })) throw coded(errorCode, 'The published Course document did not pass David\'s signature check.');
}

function readPublishedCatalog(catalogRoot, channel, verifySignature, { allowMissing = false } = {}) {
  const filePath = path.join(catalogRoot, 'catalog', channel + '.json');
  if (!fs.existsSync(filePath)) {
    if (!allowMissing) throw coded('ENOENT', 'That Course catalog channel does not exist.');
    return { format: 'bex-course-catalog', catalogVersion: 1, channel, updatedAt: new Date(0).toISOString(), courses: [], signature: null };
  }
  const catalog = normalizeCourseCatalog(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  verifySignedDocument(catalog, canonicalCourseCatalogJson(catalog, { includeSignature: false }), verifySignature, 'BEX_COURSE_CATALOG_SIGNATURE_INVALID');
  return catalog;
}

function readPublishedManifest(catalogRoot, relativePath, expectedHash, verifySignature) {
  const root = fs.realpathSync(catalogRoot);
  const filePath = path.resolve(root, relativePath);
  if (!inside(root, filePath)) throw coded('BEX_COURSE_CATALOG_INVALID', 'A published manifest path is unsafe.');
  const bytes = fs.readFileSync(filePath);
  if (expectedHash && sha256(bytes) !== expectedHash) throw coded('BEX_COURSE_CATALOG_INVALID', 'A published manifest was changed.');
  const manifest = normalizeCourseManifest(JSON.parse(bytes.toString('utf8')));
  verifySignedDocument(manifest, canonicalManifestJson(manifest, { includeSignature: false }), verifySignature, 'BEX_COURSE_SIGNATURE_INVALID');
  return manifest;
}

async function pointCatalogAtVersion({ root, channel, manifest, manifestRelative, packageRelative, signCatalog, verifySignature }) {
  const catalog = readPublishedCatalog(root, channel, verifySignature, { allowMissing: true });
  const canonicalSigned = canonicalManifestJson(manifest) + '\n';
  const previous = catalog.courses.find((course) => course.courseId === manifest.courseId);
  const previousMirrors = new Map((previous?.objects || []).map((object) => [object.sha256, object.mirrors]));
  const entry = {
    courseId: manifest.courseId,
    version: manifest.version,
    manifestPath: manifestRelative,
    packagePath: packageRelative,
    manifestSha256: sha256(Buffer.from(canonicalSigned)),
    downloadBytes: manifest.assets.reduce((sum, asset) => sum + asset.byteSize, 0),
    objects: [...new Map(manifest.assets.map((asset) => [asset.sha256, asset])).values()].map((asset) => ({
      sha256: asset.sha256,
      byteSize: asset.byteSize,
      mirrors: previousMirrors.get(asset.sha256) || [],
    })),
  };
  const courses = catalog.courses.filter((course) => course.courseId !== manifest.courseId).concat(entry);
  const unsigned = normalizeCourseCatalog({ format: 'bex-course-catalog', catalogVersion: 1, channel, updatedAt: new Date().toISOString(), courses, signature: null });
  const signature = await signCatalog(canonicalCourseCatalogJson(unsigned, { includeSignature: false }));
  const signed = normalizeCourseCatalog({ ...unsigned, signature });
  const catalogJson = canonicalCourseCatalogJson(signed) + '\n';
  const catalogPath = path.join(root, 'catalog', channel + '.json');
  const historyPath = path.join(root, 'catalog', 'history', channel, Date.now() + '-' + sha256(Buffer.from(catalogJson)).slice(0, 12) + '.json');
  atomicWrite(historyPath, catalogJson);
  atomicWrite(catalogPath, catalogJson);
  return signed;
}

async function publishPackage({ catalogRoot, channel = 'beta', packagePath, signCatalog, verifySignature }) {
  if (!['beta', 'stable'].includes(channel)) throw coded('BEX_COURSE_CATALOG_INVALID', 'Publishing channel is invalid.');
  const root = fs.realpathSync(catalogRoot);
  const packageRoot = fs.realpathSync(packagePath);
  const manifestSource = path.join(packageRoot, 'manifest.json');
  const sourceBytes = fs.readFileSync(manifestSource);
  const manifest = normalizeCourseManifest(JSON.parse(sourceBytes.toString('utf8')));
  verifySignedDocument(manifest, canonicalManifestJson(manifest, { includeSignature: false }), verifySignature, 'BEX_COURSE_SIGNATURE_INVALID');
  let reusedObjects = 0;
  let addedObjects = 0;
  for (const asset of manifest.assets) {
    const source = path.resolve(packageRoot, asset.relativePath);
    if (!inside(packageRoot, source)) throw coded('BEX_COURSE_PACKAGE_INVALID', 'A Course asset path is unsafe.');
    const actual = await hashFile(source);
    if (actual.sha256 !== asset.sha256 || actual.byteSize !== asset.byteSize) throw coded('BEX_COURSE_ASSET_MISMATCH', 'A Course asset changed before publishing.');
    const objectPath = path.join(root, objectRelativePath(asset.sha256));
    if (fs.existsSync(objectPath)) {
      const existing = await hashFile(objectPath);
      if (existing.sha256 !== asset.sha256 || existing.byteSize !== asset.byteSize) throw coded('BEX_COURSE_ASSET_MISMATCH', 'A published object is damaged.');
      reusedObjects += 1;
    } else {
      fs.mkdirSync(path.dirname(objectPath), { recursive: true });
      const temporary = objectPath + '.tmp-' + crypto.randomUUID();
      fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
      fs.renameSync(temporary, objectPath);
      addedObjects += 1;
    }
  }
  const manifestRelative = 'manifests/' + manifest.courseId + '/' + manifest.version + '.json';
  const manifestDestination = path.join(root, manifestRelative);
  const canonicalSigned = canonicalManifestJson(manifest) + '\n';
  if (fs.existsSync(manifestDestination) && fs.readFileSync(manifestDestination, 'utf8') !== canonicalSigned) throw coded('BEX_COURSE_VERSION_CONFLICT', 'That published course version already has different content.');
  if (!fs.existsSync(manifestDestination)) atomicWrite(manifestDestination, canonicalSigned);

  const packageRelative = 'packages/' + manifest.courseId + '/' + manifest.version;
  const packageDestination = path.join(root, packageRelative);
  if (!fs.existsSync(packageDestination)) {
    const temporary = packageDestination + '.tmp-' + crypto.randomUUID();
    fs.mkdirSync(temporary, { recursive: true });
    try {
      fs.writeFileSync(path.join(temporary, 'manifest.json'), canonicalSigned, { flag: 'wx', mode: 0o600 });
      for (const asset of manifest.assets) linkWithoutOverwrite(path.join(root, objectRelativePath(asset.sha256)), path.join(temporary, asset.relativePath));
      fs.mkdirSync(path.dirname(packageDestination), { recursive: true });
      fs.renameSync(temporary, packageDestination);
    } catch (error) { fs.rmSync(temporary, { force: true, recursive: true }); throw error; }
  }
  const signed = await pointCatalogAtVersion({ root, channel, manifest, manifestRelative, packageRelative, signCatalog, verifySignature });
  return { catalog: signed, manifest, catalogRoot: root, packagePath: packageDestination, addedObjects, reusedObjects };
}

async function setCatalogVersion({ catalogRoot, channel, courseId, version, signCatalog, verifySignature }) {
  const root = fs.realpathSync(catalogRoot);
  const manifestRelative = 'manifests/' + courseId + '/' + version + '.json';
  const manifestPath = path.join(root, manifestRelative);
  if (!fs.existsSync(manifestPath)) throw coded('BEX_COURSE_NOT_FOUND', 'That published Course version does not exist.');
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = readPublishedManifest(root, manifestRelative, sha256(manifestBytes), verifySignature);
  const packageRelative = 'packages/' + courseId + '/' + version;
  const packagePath = path.join(root, packageRelative);
  if (!fs.existsSync(packagePath)) throw coded('BEX_COURSE_NOT_FOUND', 'That published Course package does not exist.');
  const catalog = await pointCatalogAtVersion({ root, channel, manifest, manifestRelative, packageRelative, signCatalog, verifySignature });
  return { catalog, manifest, catalogRoot: root, packagePath, addedObjects: 0, reusedObjects: 0 };
}

function catalogLibrary({ catalogRoot, channel = 'stable', verifySignature }) {
  const root = fs.realpathSync(catalogRoot);
  const catalog = readPublishedCatalog(root, channel, verifySignature);
  const courses = catalog.courses.map((entry) => {
    const manifest = readPublishedManifest(root, entry.manifestPath, entry.manifestSha256, verifySignature);
    return { ...courseDefinitionFromManifest(manifest), installState: 'available', packagePath: path.join(root, entry.packagePath) };
  });
  return { courses, catalogCheckedAt: catalog.updatedAt, onlineModeEnabled: false, catalogRoot: root, channel };
}

module.exports = { catalogLibrary, publishPackage, readPublishedCatalog, readPublishedManifest, setCatalogVersion };
