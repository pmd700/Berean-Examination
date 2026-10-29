'use strict';

const { app, BrowserWindow, dialog, ipcMain, protocol, session } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { CourseStudioProjectStore, PROJECT_FILE_NAME } = require('../course-platform/course-studio-project.cjs');
const { exportCourseStudioProject, validateCourseStudioProject } = require('../course-platform/course-studio-export.cjs');
const { registerCourseStudioHandlers } = require('./course-studio-ipc.cjs');
const { registerEmojiHandlers } = require('./emoji.cjs');
const { signCourseCatalogWithKeychain, signCourseManifestWithKeychain, verifyCourseManifestSignature } = require('./course-signing.cjs');
const { catalogLibrary, publishPackage, setCatalogVersion } = require('../course-platform/local-course-publisher.cjs');
const { registerCourseMediaProtocol, registerCourseMediaScheme } = require('./course-media-protocol.cjs');

const HOST = '127.0.0.1';
let window = null;
let devProcess = null;
let builtServer = null;

registerCourseMediaScheme(protocol);
app.setName('BEX Course Studio');

function availablePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, HOST, () => {
      const port = probe.address().port;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function waitFor(url, deadline = Date.now() + 30000) {
  return new Promise((resolve, reject) => {
    const tryNow = () => {
      const request = http.get(url, (response) => { response.resume(); resolve(); });
      request.on('error', () => Date.now() > deadline ? reject(new Error('Course Studio did not start.')) : setTimeout(tryNow, 200));
    };
    tryNow();
  });
}

async function developmentUrl() {
  const port = await availablePort();
  const root = app.getAppPath();
  const executable = process.env.npm_node_execpath || process.execPath;
  const environment = { ...process.env };
  if (executable === process.execPath) environment.ELECTRON_RUN_AS_NODE = '1';
  devProcess = spawn(executable, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', HOST, '--port', String(port)], { cwd: root, env: environment, stdio: 'ignore' });
  const url = 'http://' + HOST + ':' + port;
  await waitFor(url + '/studio.html');
  return url + '/studio.html';
}

async function builtUrl() {
  const root = path.join(app.getAppPath(), 'dist');
  const port = await availablePort();
  builtServer = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://' + HOST).pathname);
    const relative = pathname === '/' ? 'studio.html' : pathname.replace(/^\/+/, '');
    const target = path.resolve(root, relative);
    if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      response.writeHead(404); response.end(); return;
    }
    const mime = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2' }[path.extname(target)] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
    fs.createReadStream(target).pipe(response);
  });
  await new Promise((resolve, reject) => { builtServer.once('error', reject); builtServer.listen(port, HOST, resolve); });
  return 'http://' + HOST + ':' + port + '/studio.html';
}

async function launch() {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const appUrl = app.isPackaged || process.argv.includes('--built') ? await builtUrl() : await developmentUrl();
  registerEmojiHandlers({ appUrl, ipcMain, cacheFolder: path.join(app.getPath('userData'), 'Emoji') });
  const store = new CourseStudioProjectStore({ recentFilePath: path.join(app.getPath('userData'), 'course-studio-recent.json') });
  const chooseProjectFolder = async (mode) => {
    const result = await dialog.showOpenDialog(window, {
      buttonLabel: mode === 'create' ? 'Use This Folder' : 'Open Project',
      defaultPath: app.getPath('documents'),
      message: mode === 'create' ? 'Choose a folder for this Course Studio project.' : 'Choose a folder containing ' + PROJECT_FILE_NAME + '.',
      properties: ['openDirectory', 'createDirectory'],
      title: mode === 'create' ? 'Create Course Studio Project' : 'Open Course Studio Project',
    });
    return result.canceled ? '' : result.filePaths[0] || '';
  };
  const chooseAsset = async (kind) => {
    const filters = {
      artwork: [{ name: 'Course artwork', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
      caption: [{ name: 'WebVTT captions', extensions: ['vtt'] }],
      poster: [{ name: 'Lesson thumbnail', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
      video: [{ name: 'Finished MP4 video', extensions: ['mp4'] }],
    };
    const result = await dialog.showOpenDialog(window, { buttonLabel: 'Use This File', filters: filters[kind] || [], properties: ['openFile'], title: 'Choose ' + kind });
    return result.canceled ? '' : result.filePaths[0] || '';
  };
  const chooseExportFolder = async () => {
    const result = await dialog.showOpenDialog(window, {
      buttonLabel: 'Export Here',
      defaultPath: app.getPath('documents'),
      message: 'Choose where Course Studio should create the separate installable package folder.',
      properties: ['openDirectory', 'createDirectory'],
      title: 'Export BEX Course Package',
    });
    return result.canceled ? '' : result.filePaths[0] || '';
  };
  const chooseCatalogFolder = async () => {
    const result = await dialog.showOpenDialog(window, {
      buttonLabel: 'Use as Test Catalog',
      defaultPath: app.getPath('documents'),
      message: 'Choose or create the local folder that will imitate future course hosting.',
      properties: ['openDirectory', 'createDirectory'],
      title: 'Local Course Publishing Catalog',
    });
    return result.canceled ? '' : result.filePaths[0] || '';
  };
  const readPublishingStatus = (catalogFolder, courseId) => {
    const readChannel = (channel) => {
      try { return catalogLibrary({ catalogRoot: catalogFolder, channel, verifySignature: verifyCourseManifestSignature }); }
      catch (error) { if (error?.code === 'ENOENT') return { courses: [] }; throw error; }
    };
    const beta = readChannel('beta');
    const stable = readChannel('stable');
    const versionsFolder = path.join(fs.realpathSync(catalogFolder), 'manifests', courseId);
    const versions = fs.existsSync(versionsFolder)
      ? fs.readdirSync(versionsFolder).filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -5)).sort().reverse()
      : [];
    return {
      catalogFolder: fs.realpathSync(catalogFolder),
      betaVersion: beta.courses.find((course) => course.id === courseId)?.version || '',
      stableVersion: stable.courses.find((course) => course.id === courseId)?.version || '',
      versions,
    };
  };
  registerCourseMediaProtocol({ protocol, resolveCourseAsset: (identity) => store.resolveAsset(identity), trustedOrigin: new URL(appUrl).origin });
  registerCourseStudioHandlers({
    appUrl,
    chooseAsset,
    chooseCatalogFolder,
    chooseExportFolder,
    chooseProjectFolder,
    exportProject: (project, destination) => exportCourseStudioProject(project, destination, {
      signManifest: signCourseManifestWithKeychain,
    }),
    ipcMain,
    projectStore: store,
    publishBeta: async (packageFolder, catalogFolder) => {
      const result = await publishPackage({ catalogRoot: catalogFolder, channel: 'beta', packagePath: packageFolder, signCatalog: signCourseCatalogWithKeychain, verifySignature: verifyCourseManifestSignature });
      return { ...result, status: readPublishingStatus(catalogFolder, result.manifest.courseId) };
    },
    publishingStatus: readPublishingStatus,
    setChannelVersion: async (catalogFolder, courseId, version, channel) => {
      const result = await setCatalogVersion({ catalogRoot: catalogFolder, channel, courseId, version, signCatalog: signCourseCatalogWithKeychain, verifySignature: verifyCourseManifestSignature });
      return { ...result, status: readPublishingStatus(catalogFolder, courseId) };
    },
    validateProject: validateCourseStudioProject,
  });
  window = new BrowserWindow({
    width: 1500, height: 940, minWidth: 1200, minHeight: 720, show: false,
    title: 'BEX Course Studio',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'course-studio-preload.cjs') },
  });
  const origin = new URL(appUrl).origin;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, target) => { try { if (new URL(target).origin !== origin) event.preventDefault(); } catch { event.preventDefault(); } });
  window.once('ready-to-show', () => window.show());
  await window.loadURL(appUrl);
}

app.whenReady().then(launch).catch((error) => { console.error(error); app.quit(); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { if (devProcess) devProcess.kill(); if (builtServer) builtServer.close(); });
