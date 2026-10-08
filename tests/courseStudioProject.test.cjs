'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { CourseStudioProjectStore, PROJECT_FILE_NAME } = require('../course-platform/course-studio-project.cjs');
const { parseCourseMediaUrl } = require('../desktop/course-media-protocol.cjs');
const { exportCourseStudioProject, validateCourseStudioProject } = require('../course-platform/course-studio-export.cjs');
const { normalizeCourseManifest } = require('../course-platform/course-manifest.cjs');
const { installLocalCoursePackage } = require('../desktop/course-package.cjs');

test('Course Studio saves atomically and reopens the exact ordered draft', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bex-studio-project-'));
  try {
    const store = new CourseStudioProjectStore({ recentFilePath: path.join(root, 'recent.json') });
    const folder = path.join(root, 'My Course');
    const created = store.create(folder, 'My Course');
    created.course.description = 'A durable local draft.';
    created.course.modules = [{
      id: 'module-first', title: 'First', description: '', lessons: [
        { id: 'lesson-second', title: 'Second', description: '', durationSeconds: 0, video: null, poster: null, captions: [] },
        { id: 'lesson-first', title: 'First', description: '', durationSeconds: 0, video: null, poster: null, captions: [] },
      ],
    }];
    store.save(created);
    const reopenedStore = new CourseStudioProjectStore({ recentFilePath: path.join(root, 'recent.json') });
    const reopened = reopenedStore.open(folder);
    assert.equal(reopened.course.description, 'A durable local draft.');
    assert.deepEqual(reopened.course.modules[0].lessons.map((lesson) => lesson.id), ['lesson-second', 'lesson-first']);
    assert.equal(reopenedStore.recent()[0].title, 'My Course');
    assert.equal(fs.existsSync(path.join(folder, PROJECT_FILE_NAME)), true);
    assert.equal(fs.readdirSync(folder).some((name) => name.includes('.tmp-')), false);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('Course Studio never copies or changes a selected finished video', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bex-studio-media-'));
  try {
    const store = new CourseStudioProjectStore({ recentFilePath: path.join(root, 'recent.json') });
    const project = store.create(path.join(root, 'Project'), 'Video Course');
    const videoPath = path.join(root, 'finished.mp4');
    fs.writeFileSync(videoPath, Buffer.from('finished-video-bytes'));
    const before = fs.readFileSync(videoPath);
    const selected = store.describeAsset(project.projectId, 'video', videoPath);
    assert.equal(selected.sourcePath, fs.realpathSync(videoPath));
    assert.deepEqual(fs.readFileSync(videoPath), before);
    assert.deepEqual(fs.readdirSync(path.join(root, 'Project')), [PROJECT_FILE_NAME]);
    project.course.modules = [{ id: 'module-one', title: 'One', description: '', lessons: [{ id: 'lesson-one', title: 'One', description: '', durationSeconds: 0, video: selected, poster: null, captions: [] }] }];
    const saved = store.save(project);
    const identity = parseCourseMediaUrl(saved.course.modules[0].lessons[0].video.previewUrl);
    const resolved = store.resolveAsset(identity);
    assert.equal(resolved.path, fs.realpathSync(videoPath));
    assert.deepEqual(fs.readFileSync(resolved.path), before);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('Course Studio validation names incomplete learner-visible material', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bex-studio-validation-'));
  try {
    const store = new CourseStudioProjectStore({ recentFilePath: path.join(root, 'recent.json') });
    const project = store.create(path.join(root, 'Project'), 'Temporary title');
    project.course.title = '';
    const validation = validateCourseStudioProject(project);
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some((entry) => entry.code === 'course-title'));
    assert.ok(validation.errors.some((entry) => entry.code === 'course-artwork'));
    assert.ok(validation.errors.some((entry) => entry.code === 'course-modules'));
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

test('Course Studio exports an installer-approved package without changing sources', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bex-studio-export-'));
  try {
    const store = new CourseStudioProjectStore({ recentFilePath: path.join(root, 'recent.json') });
    const projectFolder = path.join(root, 'Project');
    const exportParent = path.join(root, 'Exports');
    const libraryPath = path.join(root, 'Library');
    fs.mkdirSync(exportParent);
    for (const folder of ['Database', 'Courses', 'Media', 'Imports', 'Exports', 'Backups']) fs.mkdirSync(path.join(libraryPath, folder), { recursive: true });
    const sourceFolder = path.join(root, 'Sources');
    fs.mkdirSync(sourceFolder);
    const sourcePaths = {
      artwork: path.join(sourceFolder, 'course.png'),
      caption: path.join(sourceFolder, 'lesson.vtt'),
      poster: path.join(sourceFolder, 'lesson.png'),
      video: path.join(sourceFolder, 'lesson.mp4'),
    };
    fs.writeFileSync(sourcePaths.artwork, Buffer.from('course-artwork'));
    fs.writeFileSync(sourcePaths.poster, Buffer.from('lesson-poster'));
    fs.writeFileSync(sourcePaths.video, Buffer.from('finished-video-source'));
    fs.writeFileSync(sourcePaths.caption, 'WEBVTT\n\n00:00.000 --> 00:01.000\nTruth matters.\n');
    const originalBytes = Object.fromEntries(Object.entries(sourcePaths).map(([key, filePath]) => [key, fs.readFileSync(filePath)]));
    const project = store.create(projectFolder, 'Studio Export Proof');
    project.course.description = 'A complete course created without editing source media.';
    project.course.artwork = store.describeAsset(project.projectId, 'artwork', sourcePaths.artwork);
    project.course.modules = [{
      id: 'module-proof', title: 'Proof Module', description: 'The module description.', lessons: [{
        id: 'lesson-proof', title: 'Proof Lesson', description: 'The lesson description.', durationSeconds: 1,
        video: store.describeAsset(project.projectId, 'video', sourcePaths.video),
        poster: store.describeAsset(project.projectId, 'poster', sourcePaths.poster),
        captions: [store.describeAsset(project.projectId, 'caption', sourcePaths.caption)],
      }],
    }];
    const saved = store.save(project);
    assert.equal(validateCourseStudioProject(saved).valid, true);
    const exported = await exportCourseStudioProject(saved, exportParent);
    const manifest = normalizeCourseManifest(JSON.parse(fs.readFileSync(path.join(exported.folder, 'manifest.json'), 'utf8')));
    assert.equal(manifest.courseId, saved.course.courseId);
    assert.equal(manifest.modules[0].lessons[0].mediaAssetId, saved.course.modules[0].lessons[0].video.id);
    assert.equal(manifest.assets.length, 4);
    const installed = await installLocalCoursePackage({
      allowUnsigned: true,
      currentBexVersion: '0.0.0',
      installCourseVersion: async (course) => course,
      libraryPath,
      packagePath: exported.folder,
    });
    assert.equal(installed.course.id, saved.course.courseId);
    assert.equal(installed.assetCount, 4);
    for (const [key, filePath] of Object.entries(sourcePaths)) assert.deepEqual(fs.readFileSync(filePath), originalBytes[key]);
    assert.deepEqual(fs.readdirSync(projectFolder), [PROJECT_FILE_NAME]);
    assert.equal(fs.readdirSync(exportParent).some((name) => name.includes('.tmp-')), false);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});
