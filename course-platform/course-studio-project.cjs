'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createCourseMediaUrl } = require('../desktop/course-media-protocol.cjs');

const PROJECT_FILE_NAME = 'course-project.json';
const PROJECT_FORMAT = 'bex-course-studio-project';
const PROJECT_VERSION = 1;
const MAX_PROJECT_BYTES = 5 * 1024 * 1024;
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,79}$/;

const ASSET_TYPES = Object.freeze({
  artwork: Object.freeze({ extensions: new Set(['.jpg', '.jpeg', '.png', '.webp']), mimes: { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' } }),
  caption: Object.freeze({ extensions: new Set(['.vtt']), mimes: { '.vtt': 'text/vtt' } }),
  poster: Object.freeze({ extensions: new Set(['.jpg', '.jpeg', '.png', '.webp']), mimes: { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' } }),
  video: Object.freeze({ extensions: new Set(['.mp4']), mimes: { '.mp4': 'video/mp4' } }),
});

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw codedError('BEX_STUDIO_INVALID', label + ' is invalid.');
  return value;
}

function text(value, label, maximum, required = false) {
  if (value == null) value = '';
  if (typeof value !== 'string' || value.length > maximum || (required && !value.trim())) {
    throw codedError('BEX_STUDIO_INVALID', label + ' is invalid.');
  }
  return value;
}

function id(value, label) {
  const result = text(value, label, 80, true);
  if (!ID_PATTERN.test(result)) throw codedError('BEX_STUDIO_INVALID', label + ' is invalid.');
  return result;
}

function timestamp(value, label) {
  const result = text(value, label, 80, true);
  if (!Number.isFinite(Date.parse(result))) throw codedError('BEX_STUDIO_INVALID', label + ' is invalid.');
  return result;
}

function normalizeAsset(value, expectedKind) {
  if (value == null) return null;
  const asset = object(value, 'Course asset');
  const kind = text(asset.kind, 'Course asset type', 20, true);
  if (kind !== expectedKind || !ASSET_TYPES[kind]) throw codedError('BEX_STUDIO_INVALID', 'Course asset type is invalid.');
  const byteSize = Number(asset.byteSize);
  if (!Number.isSafeInteger(byteSize) || byteSize < 1) throw codedError('BEX_STUDIO_INVALID', 'Course asset size is invalid.');
  return {
    id: id(asset.id, 'Course asset ID'),
    kind,
    sourcePath: text(asset.sourcePath, 'Course asset location', 4096, true),
    fileName: text(asset.fileName, 'Course asset name', 500, true),
    mimeType: text(asset.mimeType, 'Course asset media type', 120, true),
    byteSize,
    modifiedAt: timestamp(asset.modifiedAt, 'Course asset modification time'),
  };
}

function normalizeLesson(value, seenIds) {
  const lesson = object(value, 'Course lesson');
  const lessonId = id(lesson.id, 'Course lesson ID');
  if (seenIds.has(lessonId)) throw codedError('BEX_STUDIO_INVALID', 'Course lesson IDs must be unique.');
  seenIds.add(lessonId);
  const captions = Array.isArray(lesson.captions) ? lesson.captions : [];
  if (captions.length > 20) throw codedError('BEX_STUDIO_INVALID', 'A lesson has too many caption files.');
  return {
    id: lessonId,
    title: text(lesson.title, 'Course lesson title', 300),
    description: text(lesson.description, 'Course lesson description', 20000),
    durationSeconds: Number.isSafeInteger(Number(lesson.durationSeconds)) && Number(lesson.durationSeconds) >= 0 ? Number(lesson.durationSeconds) : 0,
    video: normalizeAsset(lesson.video, 'video'),
    poster: normalizeAsset(lesson.poster, 'poster'),
    captions: captions.map((caption) => normalizeAsset(caption, 'caption')),
  };
}

function normalizeProject(value) {
  const project = object(value, 'Course Studio project');
  if (project.format !== PROJECT_FORMAT || project.projectVersion !== PROJECT_VERSION) {
    throw codedError('BEX_STUDIO_UNSUPPORTED', 'This Course Studio project uses an unsupported format.');
  }
  const course = object(project.course, 'Course');
  const modules = Array.isArray(course.modules) ? course.modules : [];
  if (modules.length > 1000) throw codedError('BEX_STUDIO_INVALID', 'The course has too many modules.');
  const seenModuleIds = new Set();
  const seenLessonIds = new Set();
  return {
    format: PROJECT_FORMAT,
    projectVersion: PROJECT_VERSION,
    projectId: id(project.projectId, 'Course project ID'),
    createdAt: timestamp(project.createdAt, 'Course project creation time'),
    updatedAt: timestamp(project.updatedAt, 'Course project update time'),
    publishing: {
      catalogFolder: text(project.publishing?.catalogFolder, 'Local catalog folder', 4096),
      lastExportFolder: text(project.publishing?.lastExportFolder, 'Last export folder', 4096),
    },
    course: {
      courseId: id(course.courseId, 'Course ID'),
      version: text(course.version, 'Course version', 80, true),
      title: text(course.title, 'Course title', 300),
      description: text(course.description, 'Course description', 20000),
      author: text(course.author, 'Course author', 300),
      language: text(course.language, 'Course language', 40, true),
      accent: /^#[a-f0-9]{6}$/i.test(course.accent) ? course.accent : '#8B6BC2',
      artwork: normalizeAsset(course.artwork, 'artwork'),
      modules: modules.map((moduleValue) => {
        const module = object(moduleValue, 'Course module');
        const moduleId = id(module.id, 'Course module ID');
        if (seenModuleIds.has(moduleId)) throw codedError('BEX_STUDIO_INVALID', 'Course module IDs must be unique.');
        seenModuleIds.add(moduleId);
        const lessons = Array.isArray(module.lessons) ? module.lessons : [];
        if (lessons.length > 1000) throw codedError('BEX_STUDIO_INVALID', 'A module has too many lessons.');
        return {
          id: moduleId,
          title: text(module.title, 'Course module title', 300),
          description: text(module.description, 'Course module description', 10000),
          lessons: lessons.map((lesson) => normalizeLesson(lesson, seenLessonIds)),
        };
      }),
    },
  };
}

function freshProject(title = 'Untitled Course') {
  const now = new Date().toISOString();
  const suffix = crypto.randomUUID();
  return normalizeProject({
    format: PROJECT_FORMAT,
    projectVersion: PROJECT_VERSION,
    projectId: 'project-' + suffix,
    createdAt: now,
    updatedAt: now,
    publishing: { catalogFolder: '', lastExportFolder: '' },
    course: {
      courseId: 'course-' + suffix,
      version: '1.0.0',
      title,
      description: '',
      author: 'David Martinez',
      language: 'en',
      accent: '#8B6BC2',
      artwork: null,
      modules: [],
    },
  });
}

function atomicJsonWrite(filePath, value) {
  const json = JSON.stringify(value, null, 2) + '\n';
  if (Buffer.byteLength(json, 'utf8') > MAX_PROJECT_BYTES) throw codedError('BEX_STUDIO_INVALID', 'The Course Studio project is too large.');
  const temporaryPath = filePath + '.tmp-' + crypto.randomUUID();
  fs.writeFileSync(temporaryPath, json, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  try {
    fs.renameSync(temporaryPath, filePath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function assetAvailable(asset) {
  if (!asset) return false;
  try {
    const stats = fs.lstatSync(asset.sourcePath);
    return stats.isFile() && !stats.isSymbolicLink() && stats.size === asset.byteSize;
  } catch {
    return false;
  }
}

function visitAssets(project, callback) {
  callback(project.course.artwork);
  for (const module of project.course.modules) {
    for (const lesson of module.lessons) {
      callback(lesson.video);
      callback(lesson.poster);
      lesson.captions.forEach(callback);
    }
  }
}

class CourseStudioProjectStore {
  constructor({ recentFilePath }) {
    this.recentFilePath = recentFilePath;
    this.sessions = new Map();
  }

  create(projectFolder, title) {
    const folder = path.resolve(projectFolder);
    fs.mkdirSync(folder, { recursive: true });
    const projectPath = path.join(folder, PROJECT_FILE_NAME);
    if (fs.existsSync(projectPath)) throw codedError('BEX_STUDIO_EXISTS', 'That folder already contains a Course Studio project.');
    const project = freshProject(title || path.basename(folder));
    atomicJsonWrite(projectPath, project);
    this.sessions.set(project.projectId, { folder, project });
    this.remember(folder, project);
    return this.publicProject(project, folder);
  }

  open(projectFolder) {
    const folder = path.resolve(projectFolder);
    const projectPath = path.join(folder, PROJECT_FILE_NAME);
    const stats = fs.lstatSync(projectPath);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_PROJECT_BYTES) throw codedError('BEX_STUDIO_INVALID', 'That folder does not contain a valid Course Studio project.');
    const project = normalizeProject(JSON.parse(fs.readFileSync(projectPath, 'utf8')));
    this.sessions.set(project.projectId, { folder, project });
    this.remember(folder, project);
    return this.publicProject(project, folder);
  }

  save(value) {
    const project = normalizeProject({ ...value, updatedAt: new Date().toISOString() });
    const session = this.sessions.get(project.projectId);
    if (!session) throw codedError('BEX_STUDIO_NOT_OPEN', 'Open this Course Studio project before saving it.');
    atomicJsonWrite(path.join(session.folder, PROJECT_FILE_NAME), project);
    session.project = project;
    this.remember(session.folder, project);
    return this.publicProject(project, session.folder);
  }

  describeAsset(projectId, kind, sourcePath) {
    if (!this.sessions.has(projectId) || !ASSET_TYPES[kind]) throw codedError('BEX_STUDIO_INVALID', 'That Course asset selection is invalid.');
    const resolved = fs.realpathSync(sourcePath);
    const stats = fs.lstatSync(resolved);
    const extension = path.extname(resolved).toLowerCase();
    const type = ASSET_TYPES[kind];
    if (!stats.isFile() || stats.isSymbolicLink() || !type.extensions.has(extension)) {
      throw codedError('BEX_STUDIO_ASSET_INVALID', 'Choose a supported finished media file.');
    }
    const assetId = kind + '-' + crypto.randomUUID();
    return {
      id: assetId,
      kind,
      sourcePath: resolved,
      fileName: path.basename(resolved),
      mimeType: type.mimes[extension],
      byteSize: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      available: true,
      previewUrl: createCourseMediaUrl(projectId, '1', assetId),
    };
  }

  resolveAsset({ courseId, assetId }) {
    const session = this.sessions.get(courseId);
    if (!session) throw codedError('BEX_STUDIO_NOT_OPEN', 'That Course Studio project is not open.');
    let found = null;
    visitAssets(session.project, (asset) => {
      if (asset?.id === assetId) found = asset;
    });
    if (!found || !assetAvailable(found)) throw codedError('BEX_STUDIO_ASSET_INVALID', 'That source file is unavailable.');
    return { path: fs.realpathSync(found.sourcePath), byteSize: found.byteSize, mimeType: found.mimeType };
  }

  publicProject(project, folder) {
    const clone = structuredClone(project);
    visitAssets(clone, (asset) => {
      if (!asset) return;
      asset.available = assetAvailable(asset);
      asset.previewUrl = asset.available ? createCourseMediaUrl(project.projectId, '1', asset.id) : '';
    });
    clone.projectFolder = folder;
    return clone;
  }

  recent() {
    try {
      const entries = JSON.parse(fs.readFileSync(this.recentFilePath, 'utf8'));
      return Array.isArray(entries) ? entries.filter((entry) => fs.existsSync(path.join(entry.folder, PROJECT_FILE_NAME))).slice(0, 12) : [];
    } catch {
      return [];
    }
  }

  remember(folder, project) {
    const entries = this.recent().filter((entry) => entry.folder !== folder);
    entries.unshift({ folder, projectId: project.projectId, title: project.course.title || 'Untitled Course', updatedAt: project.updatedAt });
    fs.mkdirSync(path.dirname(this.recentFilePath), { recursive: true });
    atomicJsonWrite(this.recentFilePath, entries.slice(0, 12));
  }
}

module.exports = {
  CourseStudioProjectStore,
  PROJECT_FILE_NAME,
  PROJECT_FORMAT,
  PROJECT_VERSION,
  freshProject,
  normalizeProject,
};
