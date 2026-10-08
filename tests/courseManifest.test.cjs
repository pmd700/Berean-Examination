'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {
  canonicalManifestJson,
  courseDefinitionFromManifest,
  normalizeCourseManifest,
} = require('../course-platform/course-manifest.cjs');
const { versionIsAtLeast } = require('../desktop/course-package.cjs');

function fixtureManifest() {
  const video = Buffer.from('tiny course video proof');
  return {
    format: 'bex-course',
    manifestVersion: 1,
    courseId: 'course-proof',
    version: '1.2.0',
    title: 'Course Proof',
    description: 'A strict manifest fixture.',
    author: 'Berean Examination',
    language: 'en-US',
    accent: '#8B6BC2',
    artworkAssetId: '',
    publishedAt: '2026-07-31T12:00:00.000Z',
    minimumBexVersion: '0.0.0',
    releaseNotes: 'Proof release.',
    contentProtection: { mode: 'none' },
    modules: [
      {
        id: 'module-one',
        title: 'Module One',
        description: '',
        lessons: [
          {
            id: 'lesson-one',
            title: 'Lesson One',
            description: '',
            durationSeconds: 60,
            mediaAssetId: 'lesson-video',
          },
        ],
      },
    ],
    assets: [
      {
        id: 'lesson-video',
        role: 'video',
        sha256: crypto.createHash('sha256').update(video).digest('hex'),
        byteSize: video.length,
        mimeType: 'video/mp4',
        relativePath: 'assets/lesson.mp4',
      },
    ],
    signature: null,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('Course Manifest v1 normalizes and produces deterministic signing text', () => {
  const manifest = fixtureManifest();
  const normalized = normalizeCourseManifest(manifest);
  assert.equal(normalized.courseId, 'course-proof');
  assert.equal(normalized.modules[0].lessons[0].mediaAssetId, 'lesson-video');
  assert.equal(canonicalManifestJson(manifest), canonicalManifestJson({ ...manifest }));
  const course = courseDefinitionFromManifest(manifest);
  assert.equal(course.id, manifest.courseId);
  assert.match(course.assets[0].relativePath, /^objects\/sha256\/[a-f0-9]{2}\/[a-f0-9]{64}$/);
});

test('Course Manifest v1 rejects traversal and unsupported video formats', () => {
  const traversal = clone(fixtureManifest());
  traversal.assets[0].relativePath = '../outside.mp4';
  assert.throws(
    () => normalizeCourseManifest(traversal),
    (error) => error?.code === 'BEX_COURSE_MANIFEST_INVALID',
  );

  const unsupportedVideo = clone(fixtureManifest());
  unsupportedVideo.assets[0].mimeType = 'video/quicktime';
  assert.throws(
    () => normalizeCourseManifest(unsupportedVideo),
    (error) => error?.code === 'BEX_COURSE_MANIFEST_INVALID',
  );
});

test('Course Manifest v1 rejects duplicate IDs and invalid asset references', () => {
  const duplicateLesson = clone(fixtureManifest());
  duplicateLesson.modules.push({
    id: 'module-two',
    title: 'Module Two',
    lessons: [{ id: 'lesson-one', title: 'Duplicate Lesson', durationSeconds: 1 }],
  });
  assert.throws(
    () => normalizeCourseManifest(duplicateLesson),
    (error) => error?.code === 'BEX_COURSE_MANIFEST_INVALID',
  );

  const missingAsset = clone(fixtureManifest());
  missingAsset.modules[0].lessons[0].mediaAssetId = 'missing-video';
  assert.throws(
    () => normalizeCourseManifest(missingAsset),
    (error) => error?.code === 'BEX_COURSE_MANIFEST_INVALID',
  );
});

test('Course Manifest versions and BEX compatibility are enforced', () => {
  const futureManifest = clone(fixtureManifest());
  futureManifest.manifestVersion = 2;
  assert.throws(
    () => normalizeCourseManifest(futureManifest),
    (error) => error?.code === 'BEX_COURSE_MANIFEST_UNSUPPORTED',
  );
  assert.equal(versionIsAtLeast('1.4.0', '1.3.9'), true);
  assert.equal(versionIsAtLeast('1.3.9', '1.4.0'), false);
  assert.equal(versionIsAtLeast('2.0.0', '1.99.99'), true);
});
