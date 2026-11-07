'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const {
  app,
  BrowserWindow,
  protocol,
  safeStorage,
} = require('electron');
const {
  CURRENT_SCHEMA_VERSION,
  closeDatabase,
  initializeDatabase,
  installCoursePackage,
  listCourseLibrary,
  resolveCourseAsset,
  saveCourseProgress,
} = require('./database.cjs');
const {
  COURSE_MEDIA_SCHEME,
  createCourseMediaResponse,
  registerCourseMediaScheme,
} = require('./course-media-protocol.cjs');
const { createSafeStorageProtector } = require('./privacy-vault.cjs');
const { verifyCourseManifestSignature } = require('./course-signing.cjs');

registerCourseMediaScheme(protocol);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function startLocalPage() {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; media-src bex-course:; script-src 'self' 'unsafe-inline'",
      'Content-Type': 'text/html; charset=utf-8',
    });
    response.end('<!doctype html><html><body style="background:#000"></body></html>');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, origin: 'http://127.0.0.1:' + address.port });
    });
  });
}

async function runPlayback(origin, lesson) {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  try {
    await window.loadURL(origin);
    return await window.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.muted = true;
        video.preload = 'auto';
        video.playsInline = true;
        const track = document.createElement('track');
        track.kind = 'captions';
        track.src = ${JSON.stringify(lesson.captions[0].url)};
        track.srclang = 'en';
        track.label = 'Captions';
        track.default = true;
        video.appendChild(track);
        document.body.appendChild(video);
        track.track.mode = 'hidden';
        let captionText = '';
        let playedTime = 0;
        let seekFinished = false;
        let trackFinished = false;
        const timeout = setTimeout(() => reject(new Error('Playback proof timed out.')), 15000);
        const finishIfReady = () => {
          if (!seekFinished || !trackFinished) return;
          clearTimeout(timeout);
          resolve({
            captionText,
            currentTime: video.currentTime,
            duration: video.duration,
            paused: video.paused,
            playbackRate: video.playbackRate,
            playedTime,
          });
        };
        track.addEventListener('load', () => {
          const textTrack = video.textTracks[0];
          textTrack.mode = 'hidden';
          captionText = Array.from(textTrack.cues || []).map((cue) => cue.text).join(' ');
          trackFinished = true;
          finishIfReady();
        });
        track.addEventListener('error', () => {
          clearTimeout(timeout);
          reject(new Error('Electron could not load the disposable offline caption file.'));
        });
        video.addEventListener('error', () => {
          clearTimeout(timeout);
          const mediaError = video.error;
          reject(new Error(
            'Electron could not decode the disposable H.264/AAC lesson. '
            + 'code=' + (mediaError?.code || 0)
            + ' message=' + (mediaError?.message || '')
            + ' networkState=' + video.networkState
            + ' readyState=' + video.readyState
          ));
        });
        video.addEventListener('loadedmetadata', async () => {
          try {
            video.playbackRate = 1.5;
            await video.play();
            setTimeout(() => {
              playedTime = video.currentTime;
              video.pause();
              video.currentTime = Math.min(1.2, Math.max(0.2, video.duration / 2));
            }, 450);
          } catch (error) {
            clearTimeout(timeout);
            reject(error);
          }
        }, { once: true });
        video.addEventListener('seeked', () => {
          seekFinished = true;
          finishIfReady();
        }, { once: true });
        video.src = ${JSON.stringify(lesson.mediaUrl)};
      })
    `, true);
  } finally {
    window.destroy();
  }
}

async function main() {
  const libraryPath = path.resolve(process.argv[2] || '');
  const packagePath = path.resolve(process.argv[3] || '');
  assert.ok(libraryPath && packagePath);
  assert.equal(safeStorage.isEncryptionAvailable(), true);
  const protector = createSafeStorageProtector(safeStorage);
  assert.equal(initializeDatabase(libraryPath, { privacyProtector: protector }).schemaVersion, CURRENT_SCHEMA_VERSION);
  await installCoursePackage(packagePath, {
    allowUnsigned: process.argv[4] !== '--signed',
    currentBexVersion: '0.0.0',
    verifyManifestSignature: verifyCourseManifestSignature,
  });
  const course = listCourseLibrary().courses[0];
  const lesson = course.modules[0].lessons[0];
  assert.ok(lesson.mediaUrl);
  assert.equal(lesson.captions.length, 1);

  const { server, origin } = await startLocalPage();
  let rangeRequests = 0;
  const requestLog = [];
  protocol.handle(COURSE_MEDIA_SCHEME, async (request) => {
    if (request.headers.get('range')) rangeRequests += 1;
    const response = await createCourseMediaResponse(request, resolveCourseAsset, origin);
    requestLog.push({
      origin: request.headers.get('origin'),
      refererHeader: request.headers.get('referer'),
      referrer: request.referrer,
      range: request.headers.get('range'),
      status: response.status,
    });
    return response;
  });
  try {
    let result;
    try {
      result = await runPlayback(origin, lesson);
    } catch (error) {
      throw new Error((error?.message || error) + ' requests=' + JSON.stringify(requestLog));
    }
    assert.ok(result.duration > 1);
    assert.ok(result.playedTime > 0);
    assert.ok(result.currentTime >= 0.2);
    assert.equal(result.paused, true);
    assert.equal(result.playbackRate, 1.5);
    assert.match(result.captionText, /Offline captions work/);
    assert.ok(rangeRequests > 0);
    saveCourseProgress(course.id, lesson.id, {
      completed: false,
      progressSeconds: Math.max(1, Math.floor(result.currentTime)),
    });
    closeDatabase();
    initializeDatabase(libraryPath, { privacyProtector: protector });
    const reopenedLesson = listCourseLibrary().courses[0].modules[0].lessons[0];
    assert.ok(reopenedLesson.progressSeconds >= 1);
    process.stdout.write('BEX_PLAYBACK_PROOF ' + JSON.stringify({
      checks: [
        'Electron decodes and plays a real local H.264/AAC lesson',
        'seeking uses byte-range requests instead of loading the full video into memory',
        '1.5x playback, pause, and resume position work locally',
        'WebVTT captions load from the Berean Library without Internet',
        'saved progress survives a full database restart',
      ],
    }) + '\n');
  } finally {
    server.close();
    closeDatabase();
  }
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
