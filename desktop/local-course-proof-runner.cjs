'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app, safeStorage } = require('electron');
const {
  closeDatabase,
  initializeDatabase,
  installCoursePackage,
  installCourseVersion,
  listCourseLibrary,
  resolveCourseAsset,
  saveCourseProgress,
} = require('./database.cjs');
const { COURSE_CHANNELS, registerCourseHandlers } = require('./course-ipc.cjs');
const { createCourseMediaResponse } = require('./course-media-protocol.cjs');
const { createSafeStorageProtector } = require('./privacy-vault.cjs');

const APP_URL = 'http://127.0.0.1:4173';
const COURSE_ID = 'bex-foundations';
const PUBLISHED_AT = '2026-07-31T12:00:00.000Z';

function createIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      handlers.delete(channel);
    },
  };
}

function trustedEvent() {
  return { senderFrame: { url: APP_URL + '/courses' } };
}

function registerHandlers(chooseAndInstallCoursePackage = async () => ({ canceled: true })) {
  const ipcMain = createIpcMain();
  registerCourseHandlers({
    appUrl: APP_URL,
    cancelCatalogCourse: async () => ({ paused: false }),
    chooseAndInstallCoursePackage,
    connectLocalCourseCatalog: async () => ({ canceled: true }),
    installCatalogCourse: async () => ({ canceled: true }),
    ipcMain,
    listCourseLibrary,
    saveCourseProgress,
  });
  return ipcMain.handlers;
}

function fingerprint(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function writeFixturePackage(packagePath, options = {}) {
  const courseId = options.courseId || COURSE_ID;
  const files = {
    'assets/lesson.mp4': Buffer.from('DISPOSABLE-BEX-COURSE-VIDEO-' + courseId),
    'assets/lesson.vtt': Buffer.from('WEBVTT\n\n00:00.000 --> 00:01.000\nWelcome.\n'),
    'assets/transcript.md': Buffer.from('# Welcome\n\nA disposable transcript.\n'),
    'assets/handout.pdf': Buffer.from('%PDF-1.4\n% disposable course handout\n'),
  };
  for (const [relativePath, bytes] of Object.entries(files)) {
    const filePath = path.join(packagePath, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, bytes);
  }
  const assets = [
    ['lesson-video', 'video', 'video/mp4', 'assets/lesson.mp4'],
    ['lesson-captions', 'caption', 'text/vtt', 'assets/lesson.vtt'],
    ['lesson-transcript', 'transcript', 'text/markdown', 'assets/transcript.md'],
    ['lesson-handout', 'attachment', 'application/pdf', 'assets/handout.pdf'],
  ].map(([id, role, mimeType, relativePath]) => ({
    id,
    role,
    mimeType,
    relativePath,
    byteSize: files[relativePath].length,
    sha256: fingerprint(files[relativePath]),
  }));
  const manifest = {
    format: 'bex-course',
    manifestVersion: 1,
    courseId,
    version: '1.0.0',
    title: options.title || 'BEX Foundations',
    description: 'A disposable package proving the real local Course installer.',
    author: 'Berean Examination',
    language: 'en',
    accent: '#8B6BC2',
    artworkAssetId: '',
    publishedAt: PUBLISHED_AT,
    minimumBexVersion: options.minimumBexVersion || '0.0.0',
    releaseNotes: 'Initial local package proof.',
    contentProtection: { mode: 'none' },
    modules: [
      {
        id: 'foundations',
        title: 'Foundations',
        description: 'Begin here.',
        lessons: [
          {
            id: 'welcome',
            title: 'Welcome',
            description: 'Meet the course.',
            durationSeconds: 120,
            mediaAssetId: 'lesson-video',
            posterAssetId: '',
            captionAssetIds: ['lesson-captions'],
            transcriptAssetId: 'lesson-transcript',
            attachmentAssetIds: ['lesson-handout'],
          },
          {
            id: 'method',
            title: 'The Berean Method',
            description: 'Learn the method.',
            durationSeconds: 300,
          },
        ],
      },
      {
        id: 'practice',
        title: 'Practice',
        description: 'Put it into practice.',
        lessons: [
          {
            id: 'review',
            title: 'Review',
            description: 'Review the essentials.',
            durationSeconds: 180,
          },
        ],
      },
    ],
    assets,
    signature: null,
  };
  fs.writeFileSync(path.join(packagePath, 'manifest.json'), JSON.stringify(manifest, null, 2));
  if (options.damageVideo) {
    fs.appendFileSync(path.join(packagePath, 'assets/lesson.mp4'), '-DAMAGED');
  }
  return manifest;
}

function fixtureCourse() {
  return {
    id: COURSE_ID,
    version: '1.0.0',
    title: 'BEX Foundations',
    description: 'A disposable course used to prove local validation.',
    author: 'Berean Examination',
    accent: '#8B6BC2',
    installState: 'installed',
    downloadBytes: 0,
    downloadedBytes: 0,
    updatedAt: PUBLISHED_AT,
    releaseNotes: 'Local validation proof.',
    modules: [
      {
        id: 'foundations',
        title: 'Foundations',
        lessons: [
          { id: 'welcome', title: 'Welcome', durationSeconds: 120 },
        ],
      },
      {
        id: 'practice',
        title: 'Practice',
        lessons: [
          { id: 'welcome', title: 'Duplicate', durationSeconds: 1 },
        ],
      },
    ],
    assets: [],
  };
}

function allFiles(folderPath) {
  if (!fs.existsSync(folderPath)) return [];
  return fs.readdirSync(folderPath, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(folderPath, entry.name);
    return entry.isDirectory() ? allFiles(entryPath) : [entryPath];
  });
}

function assertProgressPlaintextAbsent(libraryPath) {
  const databaseFolder = path.join(libraryPath, 'Database');
  for (const fileName of fs.readdirSync(databaseFolder)) {
    const filePath = path.join(databaseFolder, fileName);
    if (!fs.statSync(filePath).isFile()) continue;
    const bytes = fs.readFileSync(filePath);
    assert.equal(bytes.includes(Buffer.from('"progressSeconds":60')), false);
    assert.equal(bytes.includes(Buffer.from('"completed":true')), false);
  }
}

async function createPhase(libraryPath, protector) {
  const proofRoot = path.dirname(libraryPath);
  const packagePath = path.join(proofRoot, 'Valid Course Package');
  const damagedPackagePath = path.join(proofRoot, 'Damaged Course Package');
  const conflictingPackagePath = path.join(proofRoot, 'Conflicting Course Package');
  const manifest = writeFixturePackage(packagePath);
  writeFixturePackage(damagedPackagePath, { courseId: 'damaged-course', damageVideo: true });
  writeFixturePackage(conflictingPackagePath, { title: 'Silently changed title' });

  const opened = initializeDatabase(libraryPath, { privacyProtector: protector });
  assert.equal(opened.schemaVersion, 15);
  const handlers = registerHandlers(async () => ({
    canceled: false,
    ...(await installCoursePackage(packagePath, {
      allowUnsigned: true,
      currentBexVersion: '0.0.0',
    })),
  }));
  const installHandler = handlers.get(COURSE_CHANNELS.installPackage);
  const listHandler = handlers.get(COURSE_CHANNELS.list);
  const saveHandler = handlers.get(COURSE_CHANNELS.saveProgress);

  const emptyResult = await listHandler(trustedEvent());
  assert.equal(emptyResult.ok, true);
  assert.deepEqual(emptyResult.library.courses, []);
  const blockedResult = await listHandler({ senderFrame: { url: 'https://example.com' } });
  assert.equal(blockedResult.ok, false);
  assert.match(blockedResult.error, /untrusted/i);

  const installedResult = await installHandler(trustedEvent());
  assert.equal(installedResult.ok, true);
  assert.equal(installedResult.canceled, false);
  assert.equal(installedResult.course.id, COURSE_ID);
  assert.equal(installedResult.signatureStatus, 'unsigned-development');
  assert.equal(installedResult.assetCount, manifest.assets.length);
  assert.equal(
    installedResult.installedBytes,
    manifest.assets.reduce((total, asset) => total + asset.byteSize, 0),
  );

  for (const asset of manifest.assets) {
    const objectPath = path.join(
      libraryPath,
      'Courses',
      'objects',
      'sha256',
      asset.sha256.slice(0, 2),
      asset.sha256,
    );
    assert.equal(fs.existsSync(objectPath), true);
    assert.equal(fingerprint(fs.readFileSync(objectPath)), asset.sha256);
  }
  assert.equal(
    fs.existsSync(path.join(libraryPath, 'Courses', 'manifests', COURSE_ID, '1.0.0.json')),
    true,
  );

  await assert.rejects(
    () => installCoursePackage(packagePath, {
      allowUnsigned: false,
      currentBexVersion: '0.0.0',
    }),
    (error) => error?.code === 'BEX_COURSE_SIGNATURE_REQUIRED',
  );
  await assert.rejects(
    () => installCoursePackage(damagedPackagePath, {
      allowUnsigned: true,
      currentBexVersion: '0.0.0',
    }),
    (error) => error?.code === 'BEX_COURSE_ASSET_MISMATCH',
  );
  await assert.rejects(
    () => installCoursePackage(conflictingPackagePath, {
      allowUnsigned: true,
      currentBexVersion: '0.0.0',
    }),
    (error) => error?.code === 'BEX_COURSE_VERSION_CONFLICT',
  );
  assert.equal(listCourseLibrary().courses.length, 1);
  assert.deepEqual(allFiles(path.join(libraryPath, 'Courses', 'staging')), []);
  assert.throws(
    () => installCourseVersion(fixtureCourse()),
    (error) => error?.code === 'BEX_COURSE_INVALID',
  );

  const firstProgress = await saveHandler(
    trustedEvent(),
    COURSE_ID,
    'welcome',
    { progressSeconds: 120 },
  );
  assert.equal(firstProgress.ok, true);
  assert.equal(firstProgress.progress.completed, true);
  const secondProgress = await saveHandler(
    trustedEvent(),
    COURSE_ID,
    'method',
    { progressSeconds: 60 },
  );
  assert.equal(secondProgress.ok, true);
  assert.equal(secondProgress.progress.completed, false);

  const course = (await listHandler(trustedEvent())).library.courses[0];
  assert.deepEqual(course.modules.map((module) => module.id), ['foundations', 'practice']);
  assert.deepEqual(
    course.modules.flatMap((module) => module.lessons.map((lesson) => lesson.id)),
    ['welcome', 'method', 'review'],
  );
  assert.equal(course.completedLessons, 1);
  assert.equal(course.progressPercent, 33);
  assert.equal(course.modules[0].lessons[1].progressSeconds, 60);
  const playableLesson = course.modules[0].lessons[0];
  assert.equal(playableLesson.mediaUrl.startsWith('bex-course://asset/'), true);
  assert.equal(playableLesson.captions.length, 1);
  const sourceVideo = fs.readFileSync(path.join(packagePath, 'assets/lesson.mp4'));
  const rangeResponse = await createCourseMediaResponse(
    new Request(playableLesson.mediaUrl, {
      headers: { Origin: APP_URL, Range: 'bytes=5-15' },
    }),
    resolveCourseAsset,
    APP_URL,
  );
  assert.equal(rangeResponse.status, 206);
  assert.equal(rangeResponse.headers.get('accept-ranges'), 'bytes');
  assert.equal(rangeResponse.headers.get('content-range'), 'bytes 5-15/' + sourceVideo.length);
  assert.deepEqual(
    Buffer.from(await rangeResponse.arrayBuffer()),
    sourceVideo.subarray(5, 16),
  );
  const referrerRangeResponse = await createCourseMediaResponse(
    new Request(playableLesson.mediaUrl, {
      headers: { Range: 'bytes=0-4' },
      referrer: APP_URL + '/courses',
    }),
    resolveCourseAsset,
    APP_URL,
  );
  assert.equal(referrerRangeResponse.status, 206);
  assert.deepEqual(
    Buffer.from(await referrerRangeResponse.arrayBuffer()),
    sourceVideo.subarray(0, 5),
  );
  const captionResponse = await createCourseMediaResponse(
    new Request(playableLesson.captions[0].url, { headers: { Origin: APP_URL } }),
    resolveCourseAsset,
    APP_URL,
  );
  assert.equal(captionResponse.status, 200);
  assert.equal(captionResponse.headers.get('content-type'), 'text/vtt');
  assert.match(await captionResponse.text(), /Welcome\./);
  const invalidRangeResponse = await createCourseMediaResponse(
    new Request(playableLesson.mediaUrl, {
      headers: { Origin: APP_URL, Range: 'bytes=999999-' },
    }),
    resolveCourseAsset,
    APP_URL,
  );
  assert.equal(invalidRangeResponse.status, 416);
  const untrustedMediaResponse = await createCourseMediaResponse(
    new Request(playableLesson.mediaUrl, { headers: { Origin: 'https://example.com' } }),
    resolveCourseAsset,
    APP_URL,
  );
  assert.equal(untrustedMediaResponse.status, 403);

  closeDatabase();
  assertProgressPlaintextAbsent(libraryPath);
  return [
    'schema 15 starts with an honest empty Course library',
    'the real desktop install action accepts a valid local development package',
    'every Course file is fingerprinted and stored once by its fingerprint',
    'release mode blocks unsigned packages before installation',
    'damaged files and conflicting immutable versions are rejected without partial database changes',
    'temporary staging files are removed after success and failure',
    'the desktop bridge rejects requests from pages outside BEX',
    'one complete course keeps exact module and lesson ordering',
    'video seeking reads only the requested byte range and captions stay fully local',
    'Electron media requests are accepted only when their BEX page referrer is exact',
    'pages outside BEX cannot request installed Course media',
    'lesson progress is saved through the desktop bridge and absent from plaintext storage',
    'malformed course data is rejected before it reaches SQLite',
  ];
}

async function reopenPhase(libraryPath, protector) {
  const opened = initializeDatabase(libraryPath, { privacyProtector: protector });
  assert.equal(opened.schemaVersion, 15);
  const handlers = registerHandlers();
  const listHandler = handlers.get(COURSE_CHANNELS.list);
  const saveHandler = handlers.get(COURSE_CHANNELS.saveProgress);
  const reopenedCourse = (await listHandler(trustedEvent())).library.courses[0];
  assert.equal(reopenedCourse.id, COURSE_ID);
  assert.equal(reopenedCourse.completedLessons, 1);
  assert.equal(reopenedCourse.modules[0].lessons[1].progressSeconds, 60);

  const completedResult = await saveHandler(
    trustedEvent(),
    COURSE_ID,
    'method',
    { progressSeconds: 300 },
  );
  assert.equal(completedResult.ok, true);
  assert.equal(completedResult.progress.completed, true);
  const finalCourse = (await listHandler(trustedEvent())).library.courses[0];
  assert.equal(finalCourse.completedLessons, 2);
  assert.equal(finalCourse.progressPercent, 67);

  closeDatabase();
  assertProgressPlaintextAbsent(libraryPath);
  return [
    'a second Electron launch reopens the exact installed package and encrypted progress',
    'new progress after restart is saved and recalculates completion correctly',
  ];
}

async function main() {
  const phase = process.argv[2];
  const libraryPath = path.resolve(process.argv[3] || '');
  assert.ok(phase === 'create' || phase === 'reopen');
  assert.ok(libraryPath);
  assert.equal(safeStorage.isEncryptionAvailable(), true);
  const protector = createSafeStorageProtector(safeStorage);
  const checks = phase === 'create'
    ? await createPhase(libraryPath, protector)
    : await reopenPhase(libraryPath, protector);
  process.stdout.write('BEX_COURSE_PROOF ' + JSON.stringify({ phase, checks }) + '\n');
}

app.setName('BEX Launcher Official');
if (process.platform === 'darwin' && app.dock) app.dock.hide();
app.whenReady().then(async () => {
  try {
    await main();
    app.exit(0);
  } catch (error) {
    closeDatabase();
    process.stderr.write((error?.stack || error) + '\n');
    app.exit(1);
  }
});
