'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const proofRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bex-playback-proof-'));
const libraryPath = path.join(proofRoot, 'Disposable Berean Library');
const packagePath = path.join(proofRoot, 'Disposable Course Package');
const videoPath = path.join(packagePath, 'assets', 'lesson.mp4');
const captionPath = path.join(packagePath, 'assets', 'lesson.vtt');

for (const folderName of ['Database', 'Courses', 'Media', 'Imports', 'Exports', 'Backups']) {
  fs.mkdirSync(path.join(libraryPath, folderName), { recursive: true });
}
fs.mkdirSync(path.dirname(videoPath), { recursive: true });

function hashFile(filePath) {
  const bytes = fs.readFileSync(filePath);
  return { byteSize: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

try {
  const encoded = spawnSync('ffmpeg', [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-f', 'lavfi',
    '-i', 'color=c=black:s=320x180:r=24:d=2',
    '-f', 'lavfi',
    '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-shortest',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-movflags', '+faststart',
    videoPath,
  ], { cwd: projectRoot, encoding: 'utf8', timeout: 120000 });
  if (encoded.status !== 0) {
    throw new Error('The real playback proof needs the existing ffmpeg tool.\n' + (encoded.stderr || ''));
  }
  fs.writeFileSync(captionPath, 'WEBVTT\n\n00:00.000 --> 00:02.000\nOffline captions work.\n');
  const video = hashFile(videoPath);
  const captions = hashFile(captionPath);
  const manifest = {
    format: 'bex-course',
    manifestVersion: 1,
    courseId: 'playback-proof',
    version: '1.0.0',
    title: 'Playback Proof',
    description: 'A temporary real-codec playback proof.',
    author: 'Berean Examination',
    language: 'en',
    accent: '#8B6BC2',
    artworkAssetId: '',
    publishedAt: '2026-07-31T12:00:00.000Z',
    minimumBexVersion: '0.0.0',
    releaseNotes: 'Disposable playback proof.',
    contentProtection: { mode: 'none' },
    modules: [{
      id: 'proof-module',
      title: 'Proof Module',
      lessons: [{
        id: 'proof-lesson',
        title: 'Proof Lesson',
        durationSeconds: 2,
        mediaAssetId: 'proof-video',
        captionAssetIds: ['proof-captions'],
      }],
    }],
    assets: [
      {
        id: 'proof-video',
        role: 'video',
        mimeType: 'video/mp4',
        relativePath: 'assets/lesson.mp4',
        ...video,
      },
      {
        id: 'proof-captions',
        role: 'caption',
        mimeType: 'text/vtt',
        relativePath: 'assets/lesson.vtt',
        ...captions,
      },
    ],
    signature: null,
  };
  fs.writeFileSync(path.join(packagePath, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(
    require('electron'),
    [path.join(projectRoot, 'desktop', 'course-playback-proof-runner.cjs'), libraryPath, packagePath],
    { cwd: projectRoot, encoding: 'utf8', env: environment, timeout: 120000 },
  );
  if (result.status !== 0) {
    throw new Error('Real Course playback proof failed.\n' + (result.stdout || '') + (result.stderr || ''));
  }
  const marker = result.stdout.split(/\r?\n/)
    .find((line) => line.startsWith('BEX_PLAYBACK_PROOF '));
  assert.ok(marker, 'Real Course playback proof returned no result.');
  const proof = JSON.parse(marker.slice('BEX_PLAYBACK_PROOF '.length));
  for (const check of proof.checks) process.stdout.write('PASS: ' + check + '\n');
  process.stdout.write('PASS: disposable real-video package and Berean Library removed\n');
} finally {
  fs.rmSync(proofRoot, { force: true, recursive: true });
}
