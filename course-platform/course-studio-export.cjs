'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { canonicalManifestJson, normalizeCourseManifest } = require('./course-manifest.cjs');
const { normalizeProject } = require('./course-studio-project.cjs');

const VERSION_PATTERN = /^[0-9]+(?:\.[0-9]+){0,3}(?:-[a-z0-9.-]+)?$/i;
const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;

function issue(severity, code, message, location) {
  return { severity, code, message, location };
}

function inspectAsset(asset, label, issues) {
  if (!asset) return;
  try {
    const resolved = fs.realpathSync(asset.sourcePath);
    const stats = fs.lstatSync(resolved);
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('not a regular file');
    if (stats.size !== asset.byteSize || stats.mtime.toISOString() !== asset.modifiedAt) {
      issues.push(issue('error', 'source-changed', label + ' changed after it was selected. Choose it again.', label));
    }
  } catch {
    issues.push(issue('error', 'source-missing', label + ' is missing. Reconnect the drive or choose the file again.', label));
  }
}

function validateCourseStudioProject(value) {
  let project;
  try {
    project = normalizeProject(value);
  } catch (error) {
    return { valid: false, errors: [issue('error', 'project-invalid', error.message, 'Project')], warnings: [] };
  }
  const issues = [];
  const course = project.course;
  if (!course.title.trim()) issues.push(issue('error', 'course-title', 'Add a course title.', 'Course'));
  if (!course.description.trim()) issues.push(issue('error', 'course-description', 'Add a course description.', 'Course'));
  if (!course.author.trim()) issues.push(issue('error', 'course-author', 'Add the course author.', 'Course'));
  if (!VERSION_PATTERN.test(course.version)) issues.push(issue('error', 'course-version', 'Use a version such as 1.0.0.', 'Course'));
  if (!LANGUAGE_PATTERN.test(course.language)) issues.push(issue('error', 'course-language', 'Use a language code such as en.', 'Course'));
  if (!course.artwork) issues.push(issue('error', 'course-artwork', 'Choose a course thumbnail.', 'Course'));
  inspectAsset(course.artwork, 'Course thumbnail', issues);
  if (!course.modules.length) issues.push(issue('error', 'course-modules', 'Add at least one module.', 'Course outline'));

  course.modules.forEach((module, moduleIndex) => {
    const moduleLabel = 'Module ' + (moduleIndex + 1);
    if (!module.title.trim()) issues.push(issue('error', 'module-title', 'Add a title to ' + moduleLabel.toLowerCase() + '.', moduleLabel));
    if (!module.description.trim()) issues.push(issue('warning', 'module-description', moduleLabel + ' has no description.', moduleLabel));
    if (!module.lessons.length) issues.push(issue('error', 'module-lessons', moduleLabel + ' needs at least one lesson.', moduleLabel));
    module.lessons.forEach((lesson, lessonIndex) => {
      const lessonLabel = moduleLabel + ', Lesson ' + (lessonIndex + 1);
      if (!lesson.title.trim()) issues.push(issue('error', 'lesson-title', lessonLabel + ' needs a title.', lessonLabel));
      if (!lesson.description.trim()) issues.push(issue('error', 'lesson-description', lessonLabel + ' needs a description.', lessonLabel));
      if (!lesson.video) issues.push(issue('error', 'lesson-video', lessonLabel + ' needs a finished MP4 video.', lessonLabel));
      if (!lesson.poster) issues.push(issue('error', 'lesson-poster', lessonLabel + ' needs a thumbnail.', lessonLabel));
      if (!lesson.captions.length) issues.push(issue('warning', 'lesson-captions', lessonLabel + ' has no offline captions.', lessonLabel));
      inspectAsset(lesson.video, lessonLabel + ' video', issues);
      inspectAsset(lesson.poster, lessonLabel + ' thumbnail', issues);
      lesson.captions.forEach((caption, captionIndex) => inspectAsset(caption, lessonLabel + ' captions ' + (captionIndex + 1), issues));
    });
  });
  const errors = issues.filter((entry) => entry.severity === 'error');
  return { valid: errors.length === 0, errors, warnings: issues.filter((entry) => entry.severity === 'warning') };
}

function collectAssets(project) {
  const assets = new Map();
  const add = (asset) => { if (asset) assets.set(asset.id, asset); };
  add(project.course.artwork);
  project.course.modules.forEach((module) => module.lessons.forEach((lesson) => {
    add(lesson.video); add(lesson.poster); lesson.captions.forEach(add);
  }));
  return [...assets.values()];
}

async function fingerprintAndCopy(sourcePath, destinationPath) {
  const hash = crypto.createHash('sha256');
  let byteSize = 0;
  const fingerprint = new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); byteSize += chunk.length; callback(null, chunk); } });
  await pipeline(fs.createReadStream(sourcePath), fingerprint, fs.createWriteStream(destinationPath, { flags: 'wx', mode: 0o600 }));
  return { byteSize, sha256: hash.digest('hex') };
}

async function exportCourseStudioProject(value, destinationParent, options = {}) {
  const project = normalizeProject(value);
  const validation = validateCourseStudioProject(project);
  if (!validation.valid) {
    const error = new Error('Fix the Course Studio validation errors before exporting.');
    error.code = 'BEX_STUDIO_VALIDATION_FAILED';
    error.validation = validation;
    throw error;
  }
  const parent = fs.realpathSync(destinationParent);
  if (!fs.lstatSync(parent).isDirectory()) {
    const error = new Error('Choose a folder for the exported Course package.');
    error.code = 'BEX_STUDIO_EXPORT_INVALID';
    throw error;
  }
  const finalFolder = path.join(parent, project.course.courseId + '-' + project.course.version);
  if (fs.existsSync(finalFolder)) {
    const error = new Error('That export folder already exists. Choose another destination or increase the course version.');
    error.code = 'BEX_STUDIO_EXPORT_EXISTS';
    throw error;
  }
  const temporaryFolder = path.join(parent, '.' + path.basename(finalFolder) + '.tmp-' + crypto.randomUUID());
  const assetFolder = path.join(temporaryFolder, 'assets');
  fs.mkdirSync(assetFolder, { recursive: true, mode: 0o700 });
  try {
    const exportedAssets = new Map();
    for (const asset of collectAssets(project)) {
      const extension = path.extname(asset.sourcePath).toLowerCase();
      const relativePath = 'assets/' + asset.id + extension;
      const destinationPath = path.join(temporaryFolder, relativePath);
      const fingerprint = await fingerprintAndCopy(asset.sourcePath, destinationPath);
      let sourceStats;
      try {
        sourceStats = fs.lstatSync(fs.realpathSync(asset.sourcePath));
      } catch {}
      if (
        fingerprint.byteSize !== asset.byteSize
        || !sourceStats?.isFile()
        || sourceStats.isSymbolicLink()
        || sourceStats.size !== asset.byteSize
        || sourceStats.mtime.toISOString() !== asset.modifiedAt
      ) {
        const error = new Error(asset.fileName + ' changed while it was being exported. Nothing was published.');
        error.code = 'BEX_STUDIO_SOURCE_CHANGED';
        throw error;
      }
      exportedAssets.set(asset.id, { id: asset.id, role: asset.kind, mimeType: asset.mimeType, relativePath, ...fingerprint });
    }
    const unsignedManifest = normalizeCourseManifest({
      format: 'bex-course', manifestVersion: 1,
      courseId: project.course.courseId, version: project.course.version,
      title: project.course.title, description: project.course.description, author: project.course.author,
      language: project.course.language, accent: project.course.accent,
      artworkAssetId: project.course.artwork.id,
      publishedAt: new Date().toISOString(), minimumBexVersion: '0.0.0', releaseNotes: '',
      contentProtection: { mode: 'none' }, signature: null,
      modules: project.course.modules.map((module) => ({
        id: module.id, title: module.title, description: module.description,
        lessons: module.lessons.map((lesson) => ({
          id: lesson.id, title: lesson.title, description: lesson.description,
          durationSeconds: lesson.durationSeconds,
          mediaAssetId: lesson.video.id, posterAssetId: lesson.poster.id,
          captionAssetIds: lesson.captions.map((caption) => caption.id),
          transcriptAssetId: '', attachmentAssetIds: [],
        })),
      })),
      assets: [...exportedAssets.values()],
    });
    const signature = typeof options.signManifest === 'function'
      ? await options.signManifest(canonicalManifestJson(unsignedManifest, { includeSignature: false }))
      : null;
    const manifest = normalizeCourseManifest({ ...unsignedManifest, signature });
    fs.writeFileSync(path.join(temporaryFolder, 'manifest.json'), canonicalManifestJson(manifest) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    fs.renameSync(temporaryFolder, finalFolder);
    return { folder: finalFolder, manifest, assetCount: manifest.assets.length, totalBytes: manifest.assets.reduce((sum, asset) => sum + asset.byteSize, 0), warnings: validation.warnings };
  } catch (error) {
    fs.rmSync(temporaryFolder, { force: true, recursive: true });
    throw error;
  }
}

module.exports = { exportCourseStudioProject, validateCourseStudioProject };
