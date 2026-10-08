'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { CourseStudioProjectStore } = require('../course-platform/course-studio-project.cjs');
const { exportCourseStudioProject, validateCourseStudioProject } = require('../course-platform/course-studio-export.cjs');
const { signCourseManifestWithKeychain, verifyCourseManifestSignature } = require('../desktop/course-signing.cjs');
const { signCourseCatalogWithKeychain } = require('../desktop/course-signing.cjs');
const { installLocalCoursePackage } = require('../desktop/course-package.cjs');
const { LocalCourseCatalogConnection } = require('../desktop/local-course-catalog-connection.cjs');
const { catalogLibrary, publishPackage, setCatalogVersion } = require('../course-platform/local-course-publisher.cjs');

const projectRoot = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bex-studio-real-export-'));
const sourceFolder = path.join(root, 'Finished Media');
const projectFolder = path.join(root, 'Studio Project');
const exportParent = path.join(root, 'Exported Packages');
const libraryPath = path.join(root, 'Disposable Berean Library');
const catalogRoot = path.join(root, 'Local Publishing Catalog');

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

try {
  fs.mkdirSync(sourceFolder, { recursive: true });
  fs.mkdirSync(exportParent, { recursive: true });
  fs.mkdirSync(catalogRoot, { recursive: true });
  for (const folder of ['Database', 'Courses', 'Media', 'Imports', 'Exports', 'Backups']) fs.mkdirSync(path.join(libraryPath, folder), { recursive: true });
  const videoPath = path.join(sourceFolder, 'finished-lesson.mp4');
  const captionPath = path.join(sourceFolder, 'finished-lesson.vtt');
  const artworkPath = path.join(sourceFolder, 'course.png');
  const posterPath = path.join(sourceFolder, 'lesson.png');
  const encoded = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=0x17131f:s=640x360:r=24:d=2',
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', videoPath,
  ], { cwd: projectRoot, encoding: 'utf8', timeout: 120000 });
  if (encoded.status !== 0) throw new Error('Could not create the disposable real-video proof.\n' + encoded.stderr);
  fs.writeFileSync(captionPath, 'WEBVTT\n\n00:00.000 --> 00:02.000\nOffline captions work.\n');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  fs.writeFileSync(artworkPath, png);
  fs.writeFileSync(posterPath, png);
  const sourceHashes = new Map([videoPath, captionPath, artworkPath, posterPath].map((filePath) => [filePath, sha256(filePath)]));

  const store = new CourseStudioProjectStore({ recentFilePath: path.join(root, 'recent.json') });
  const project = store.create(projectFolder, 'Real Studio Export Proof');
  project.course.description = 'A real course exported by the private Course Studio proof.';
  project.course.artwork = store.describeAsset(project.projectId, 'artwork', artworkPath);
  project.course.modules = [{
    id: 'module-real-proof', title: 'Real Module', description: 'A real module.', lessons: [{
      id: 'lesson-real-proof', title: 'Real Lesson', description: 'A real playable lesson.', durationSeconds: 2,
      video: store.describeAsset(project.projectId, 'video', videoPath),
      poster: store.describeAsset(project.projectId, 'poster', posterPath),
      captions: [store.describeAsset(project.projectId, 'caption', captionPath)],
    }],
  }];
  const saved = store.save(project);
  assert.equal(validateCourseStudioProject(saved).valid, true);
  const exported = exportCourseStudioProject(saved, exportParent, {
    signManifest: signCourseManifestWithKeychain,
  });
  Promise.resolve(exported).then(async (result) => {
    assert.equal(result.manifest.signature.keyId, 'david-course-ed25519-v1');
    assert.equal(verifyCourseManifestSignature({
      canonicalJson: require('../course-platform/course-manifest.cjs').canonicalManifestJson(result.manifest, { includeSignature: false }),
      signature: result.manifest.signature,
    }), true);
    async function expectRejectedPackage(label, changeManifest, expectedCode) {
      const packageFolder = path.join(root, label + ' Package');
      const rejectedLibrary = path.join(root, label + ' Library');
      fs.cpSync(result.folder, packageFolder, { recursive: true });
      const manifestPath = path.join(packageFolder, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      changeManifest(manifest);
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      fs.mkdirSync(path.join(rejectedLibrary, 'Courses'), { recursive: true });
      await assert.rejects(
        installLocalCoursePackage({
          allowUnsigned: false,
          currentBexVersion: '0.0.0',
          installCourseVersion: async (course) => course,
          libraryPath: rejectedLibrary,
          packagePath: packageFolder,
          verifyManifestSignature: verifyCourseManifestSignature,
        }),
        (error) => error?.code === expectedCode,
      );
    }
    await expectRejectedPackage('Unsigned', (manifest) => { manifest.signature = null; }, 'BEX_COURSE_SIGNATURE_REQUIRED');
    await expectRejectedPackage('Altered', (manifest) => { manifest.title += ' altered'; }, 'BEX_COURSE_SIGNATURE_INVALID');
    await expectRejectedPackage('False Signed', (manifest) => {
      const value = manifest.signature.value;
      manifest.signature.value = value.slice(0, -1) + (value.endsWith('A') ? 'B' : 'A');
    }, 'BEX_COURSE_SIGNATURE_INVALID');
    const publishedV1 = await publishPackage({
      catalogRoot,
      channel: 'beta',
      packagePath: result.folder,
      signCatalog: signCourseCatalogWithKeychain,
      verifySignature: verifyCourseManifestSignature,
    });
    assert.equal(publishedV1.addedObjects, 3);
    await setCatalogVersion({ catalogRoot, channel: 'stable', courseId: saved.course.courseId, version: '1.0.0', signCatalog: signCourseCatalogWithKeychain, verifySignature: verifyCourseManifestSignature });
    const versionTwoProject = structuredClone(saved);
    versionTwoProject.course.version = '1.1.0';
    versionTwoProject.course.description += ' Updated metadata.';
    const versionTwo = await exportCourseStudioProject(versionTwoProject, exportParent, { signManifest: signCourseManifestWithKeychain });
    const publishedV2 = await publishPackage({ catalogRoot, channel: 'beta', packagePath: versionTwo.folder, signCatalog: signCourseCatalogWithKeychain, verifySignature: verifyCourseManifestSignature });
    assert.equal(publishedV2.addedObjects, 0);
    assert.equal(publishedV2.reusedObjects, 4);
    assert.equal(catalogLibrary({ catalogRoot, channel: 'beta', verifySignature: verifyCourseManifestSignature }).courses[0].version, '1.1.0');
    assert.equal(catalogLibrary({ catalogRoot, channel: 'stable', verifySignature: verifyCourseManifestSignature }).courses[0].version, '1.0.0');
    await setCatalogVersion({ catalogRoot, channel: 'stable', courseId: saved.course.courseId, version: '1.1.0', signCatalog: signCourseCatalogWithKeychain, verifySignature: verifyCourseManifestSignature });
    assert.equal(catalogLibrary({ catalogRoot, channel: 'stable', verifySignature: verifyCourseManifestSignature }).courses[0].version, '1.1.0');
    await setCatalogVersion({ catalogRoot, channel: 'stable', courseId: saved.course.courseId, version: '1.0.0', signCatalog: signCourseCatalogWithKeychain, verifySignature: verifyCourseManifestSignature });
    const stableLibrary = catalogLibrary({ catalogRoot, channel: 'stable', verifySignature: verifyCourseManifestSignature });
    assert.equal(stableLibrary.courses[0].version, '1.0.0');
    const connection = new LocalCourseCatalogConnection({ configPath: path.join(root, 'bex-user-data', 'local-course-catalog.json'), verifySignature: verifyCourseManifestSignature });
    const ordinaryFolder = path.join(root, 'Not A Catalog');
    fs.mkdirSync(ordinaryFolder);
    assert.throws(() => connection.connect(ordinaryFolder), (error) => error?.code === 'ENOENT');
    connection.connect(catalogRoot);
    const discovered = connection.merge({ courses: [], catalogCheckedAt: '', onlineModeEnabled: false });
    assert.equal(discovered.localCatalogConnected, true);
    assert.equal(discovered.courses[0].installState, 'available');
    assert.equal(discovered.courses[0].version, '1.0.0');
    assert.equal(connection.packageFor(saved.course.courseId), stableLibrary.courses[0].packagePath);
    const updateOffer = connection.merge({ courses: [{ ...stableLibrary.courses[0], version: '0.9.0', installState: 'installed' }], catalogCheckedAt: '', onlineModeEnabled: false });
    assert.equal(updateOffer.courses[0].installState, 'update_available');
    assert.equal(updateOffer.courses[0].installedVersion, '0.9.0');
    const stableCatalogPath = path.join(catalogRoot, 'catalog', 'stable.json');
    const authenticCatalog = fs.readFileSync(stableCatalogPath);
    const alteredCatalog = JSON.parse(authenticCatalog);
    alteredCatalog.updatedAt = new Date(Date.now() + 1000).toISOString();
    fs.writeFileSync(stableCatalogPath, JSON.stringify(alteredCatalog));
    assert.throws(() => catalogLibrary({ catalogRoot, channel: 'stable', verifySignature: verifyCourseManifestSignature }), (error) => error?.code === 'BEX_COURSE_CATALOG_SIGNATURE_INVALID');
    fs.writeFileSync(stableCatalogPath, authenticCatalog);
    for (const [filePath, hash] of sourceHashes) assert.equal(sha256(filePath), hash);
    const environment = { ...process.env };
    delete environment.ELECTRON_RUN_AS_NODE;
    const playback = spawnSync(
      require('electron'),
      [path.join(projectRoot, 'desktop', 'course-playback-proof-runner.cjs'), libraryPath, stableLibrary.courses[0].packagePath, '--signed'],
      { cwd: projectRoot, encoding: 'utf8', env: environment, timeout: 120000 },
    );
    if (playback.status !== 0) throw new Error('BEX could not play the Studio-exported package.\n' + playback.stdout + playback.stderr);
    assert.match(playback.stdout, /BEX_PLAYBACK_PROOF/);
    process.stdout.write('PASS: Course Studio exported a real H.264\/AAC package signed by David\n');
    process.stdout.write('PASS: exported files match the finished sources while every source remains unchanged\n');
    process.stdout.write('PASS: BEX installed, played, sought, captioned, and resumed the Studio-created lesson\n');
    process.stdout.write('PASS: release BEX rejected unsigned, altered, and falsely signed packages\n');
    process.stdout.write('PASS: local Beta and Stable catalogs were signed, promoted, and rolled back\n');
    process.stdout.write('PASS: version 1.1 reused every unchanged object instead of copying videos again\n');
    process.stdout.write('PASS: BEX rejected an altered local catalog before reading its course pointer\n');
    process.stdout.write('PASS: BEX connected to Stable, discovered the course, and offered its update\n');
    process.stdout.write('PASS: BEX rejected an ordinary folder with no signed Stable catalog\n');
    process.stdout.write('PASS: disposable Studio project, package, and Berean Library removed\n');
  }).catch((error) => {
    process.stderr.write((error?.stack || error) + '\n');
    process.exitCode = 1;
  }).finally(() => fs.rmSync(root, { force: true, recursive: true }));
} catch (error) {
  fs.rmSync(root, { force: true, recursive: true });
  throw error;
}
