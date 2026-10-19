'use strict';

const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  powerMonitor,
  protocol,
  safeStorage,
  session,
  shell,
} = require('electron');
const { ScriptureSettings } = require('./scripture-settings.cjs');
const { ScriptureApi } = require('./scripture-api.cjs');
const { ScriptureCache } = require('./scripture-cache.cjs');
const { ScriptureUsageLedger } = require('./scripture-usage.cjs');
const { registerScriptureHandlers } = require('./scripture-ipc.cjs');
const { registerAppRestartHandler } = require('./app-restart-ipc.cjs');
const { installApplicationMenu } = require('./app-menu.cjs');
const { installContextMenu } = require('./context-menu.cjs');
const { createMachineRequest } = require('./activation.cjs');
const { registerActivationHandlers } = require('./activation-ipc.cjs');
const { registerClipboardHandlers } = require('./clipboard-ipc.cjs');
const { registerExportFileHandlers } = require('./export-file-ipc.cjs');
const { registerContactHandlers } = require('./contact-ipc.cjs');
const { registerExternalLinkHandlers, validateExternalUrl } = require('./external-link-ipc.cjs');
const { COURSE_DOWNLOAD_PROGRESS_CHANNEL, registerCourseHandlers } = require('./course-ipc.cjs');
const { LocalCatalogObjectSource, downloadCourseVersion, mergeCourseDownloadStates, readCourseDownloadStates } = require('./course-download.cjs');
const { verifyCourseManifestSignature } = require('./course-signing.cjs');
const { LocalCourseCatalogConnection } = require('./local-course-catalog-connection.cjs');
const {
  registerCourseMediaProtocol,
  registerCourseMediaScheme,
} = require('./course-media-protocol.cjs');
const { registerLibraryHandlers } = require('./library.cjs');
const { readLocalBibleChapter } = require('./local-bible.cjs');
const { registerLocalBibleHandlers } = require('./local-bible-ipc.cjs');
const { registerLocalBackupHandlers } = require('./local-backup-ipc.cjs');
const { registerLocalEntityHandlers } = require('./local-entity-ipc.cjs');
const { registerLocalMediaHandlers } = require('./local-media-ipc.cjs');
const { registerLocalAttachmentHandlers } = require('./local-attachments-ipc.cjs');
const { AttachmentExternalCopies } = require('./local-attachments.cjs');
const { readLocalMamChapter } = require('./local-mam.cjs');
const { registerLocalMamHandlers } = require('./local-mam-ipc.cjs');
const {
  registerLocalMediaProtocol,
  registerLocalMediaScheme,
} = require('./local-media-protocol.cjs');
const { registerLocalOwnerHandlers } = require('./local-owner-ipc.cjs');
const { createNormalCloseHandler } = require('./normal-close-backup.cjs');
const {
  PRIVACY_STATUS_CHANGED_CHANNEL,
  publicStatus,
  registerPrivacyHandlers,
} = require('./privacy-ipc.cjs');
const { createSafeStorageProtector } = require('./privacy-vault.cjs');
const {
  activateInstallation,
  assertLocalFilesAvailable,
  changePrivacyPin,
  closeDatabase,
  createLocalBackup,
  createLocalEntity,
  deleteLocalImage,
  deleteLocalEntity,
  disablePrivacyPin,
  enablePrivacyPin,
  getActivationState,
  getActiveLibraryPath,
  getLocalEntity,
  getLocalBackupFolder,
  getLocalOwner,
  getPrivacyStatus,
  importKnowledgeWebGraph,
  installCoursePackage,
  installCourseVersion,
  initializeDatabase,
  inspectLocalBackupForRestore,
  lockPrivacyVault,
  listLocalEntities,
  readLocalEntitySnapshot,
  listCourseLibrary,
  readLocalMedia,
  resolveCourseAsset,
  reorderLocalEntities,
  replacePrivacyRecoveryCode,
  restoreKnowledgeWebGraph,
  restoreLocalBackup,
  rollbackLocalFile,
  saveLocalImage,
  saveLocalFile,
  saveCourseProgress,
  unlockPrivacyAutomatically,
  unlockPrivacyWithPin,
  unlockPrivacyWithRecoveryCode,
  updateLocalEntity,
  updateLocalOwner,
} = require('./database.cjs');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const APP_NAME = 'BEX Launcher Official';
const LOOPBACK_HOST = '127.0.0.1';
const BUILT_MODE_FLAG = '--built';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

let mainWindow = null;
let devServerProcess = null;
let builtServer = null;
let isQuitting = false;
let privacyLifecycleRegistered = false;
let mediaProtocolRegistered = false;
let attachmentExternalCopies = null;

registerLocalMediaScheme(protocol);
registerCourseMediaScheme(protocol);

app.setName(APP_NAME);

function publishPrivacyStatus(status) {
  if (status?.locked) attachmentExternalCopies?.cleanup();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(PRIVACY_STATUS_CHANGED_CHANNEL, publicStatus(status));
}

function registerPrivacyLifecycle() {
  if (privacyLifecycleRegistered) return;
  privacyLifecycleRegistered = true;

  powerMonitor.on('suspend', () => {
    try {
      publishPrivacyStatus(lockPrivacyVault());
    } catch (error) {
      if (error?.code !== 'BEX_PRIVACY_NOT_OPEN') {
        console.error('[desktop] Could not lock the privacy vault for sleep:', error);
      }
    }
  });

  powerMonitor.on('resume', () => {
    try {
      publishPrivacyStatus(unlockPrivacyAutomatically());
    } catch (error) {
      console.error('[desktop] Could not reopen the privacy vault after wake:', error);
      publishPrivacyStatus({ locked: true, mode: 'automatic', pinEnabled: false });
    }
  });
}

function registerMediaProtocol(appUrl) {
  if (mediaProtocolRegistered) return;
  mediaProtocolRegistered = true;
  registerLocalMediaProtocol({ protocol, readLocalMedia, trustedOrigin: new URL(appUrl).origin });
  registerCourseMediaProtocol({
    protocol,
    resolveCourseAsset,
    trustedOrigin: new URL(appUrl).origin,
  });
}

function waitForUrl(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
      });

      request.setTimeout(1000, () => request.destroy());
      request.on('error', () => {
        if (Date.now() >= deadline) {
          reject(new Error('The development page did not become ready within 30 seconds.'));
          return;
        }
        setTimeout(attempt, 250);
      });
    };

    attempt();
  });
}

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, LOOPBACK_HOST, () => {
      const address = probe.address();
      const availablePort = address && typeof address === 'object' ? address.port : null;
      probe.close((closeError) => {
        if (closeError) {
          reject(closeError);
        } else if (!availablePort) {
          reject(new Error('BEX could not reserve a private development address.'));
        } else {
          resolve(availablePort);
        }
      });
    });
  });
}


async function startDevelopmentServer() {
  const projectRoot = app.getAppPath();
  const viteEntry = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  const devPort = await findAvailablePort();
  const devUrl = 'http://' + LOOPBACK_HOST + ':' + devPort;

  if (!fs.existsSync(viteEntry)) {
    throw new Error('Vite is missing. Run npm install before launching the desktop app.');
  }

  const nodeExecutable = process.env.npm_node_execpath || process.execPath;
  const childEnvironment = { ...process.env };
  if (nodeExecutable === process.execPath) {
    childEnvironment.ELECTRON_RUN_AS_NODE = '1';
  }

  devServerProcess = spawn(
    nodeExecutable,
    [viteEntry, '--host', LOOPBACK_HOST, '--port', String(devPort), '--strictPort'],
    {
      cwd: projectRoot,
      env: childEnvironment,
      stdio: 'inherit',
    },
  );

  devServerProcess.once('exit', (code, signal) => {
    if (!isQuitting && code !== 0) {
      console.error('[desktop] Development page stopped unexpectedly:', { code, signal });
    }
  });

  await waitForUrl(devUrl);
  return devUrl;
}

function resolveBuiltFile(distRoot, requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname);
  } catch {
    return null;
  }

  const candidate = path.resolve(distRoot, '.' + pathname);
  const staysInsideDist = candidate === distRoot || candidate.startsWith(distRoot + path.sep);
  if (!staysInsideDist) return null;

  try {
    if (fs.statSync(candidate).isFile()) return candidate;
  } catch {
    // A route such as /KnowledgeWeb is expected to have no matching file.
  }

  if (path.extname(pathname)) return null;
  return path.join(distRoot, 'index.html');
}

function sendBuiltFile(filePath, requestMethod, response) {
  const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
  });

  if (requestMethod === 'HEAD') {
    response.end();
    return;
  }

  const stream = fs.createReadStream(filePath);
  stream.on('error', () => response.destroy());
  stream.pipe(response);
}

function startBuiltServer() {
  const distRoot = path.join(app.getAppPath(), 'dist');
  const indexPath = path.join(distRoot, 'index.html');

  if (!fs.existsSync(indexPath)) {
    throw new Error('The built app is missing. Run npm run build before npm run desktop:built.');
  }

  builtServer = http.createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end('Method not allowed');
      return;
    }

    const filePath = resolveBuiltFile(distRoot, request.url || '/');
    if (!filePath) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    sendBuiltFile(filePath, request.method, response);
  });

  return new Promise((resolve, reject) => {
    builtServer.once('error', reject);
    builtServer.listen(0, LOOPBACK_HOST, () => {
      const address = builtServer.address();
      resolve('http://' + LOOPBACK_HOST + ':' + address.port);
    });
  });
}

async function createMainWindow(appUrl) {
  const allowedOrigin = new URL(appUrl).origin;

  mainWindow = new BrowserWindow({
    title: APP_NAME,
    ...require('./window-options.cjs'),
    backgroundColor: '#0B0D11',
    show: false,
    webPreferences: {
      allowRunningInsecureContent: false,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true,
      // Stated rather than left to the default: the right-click menu is built
      // out of the suggestions this produces, so turning it off would quietly
      // empty that menu rather than fail in any visible way.
      spellcheck: true,
      webSecurity: true,
    },
  });

  // Electron provides no context menu of its own, so the spellchecker's
  // suggestions had nowhere to appear and no word could ever be added to the
  // dictionary. See context-menu.cjs.
  installContextMenu({ Menu, webContents: mainWindow.webContents, window: mainWindow });

  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
    mainWindow.setTitle(APP_NAME);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      void shell.openExternal(validateExternalUrl(url)).catch(() => {});
    } catch {
      // Unsafe or malformed links remain blocked.
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    try {
      if (new URL(targetUrl).origin !== allowedOrigin) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    // Keep the renderer alive until its pending view/editor saves have drained.
    event.preventDefault();
    app.quit();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(appUrl);
}

async function launch() {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  const useBuiltMode = app.isPackaged || process.argv.includes(BUILT_MODE_FLAG);
  attachmentExternalCopies = new AttachmentExternalCopies({
    tempRoot: path.join(app.getPath('userData'), 'bex-open-files'),
    readLocalMedia,
    assertUnlocked: assertLocalFilesAvailable,
  });
  const appUrl = useBuiltMode ? await startBuiltServer() : await startDevelopmentServer();
  const localCourseCatalog = new LocalCourseCatalogConnection({
    configPath: path.join(app.getPath('userData'), 'local-course-catalog.json'),
    verifySignature: verifyCourseManifestSignature,
  });
  const activeCourseDownloads = new Map();
  const privacyProtector = createSafeStorageProtector(safeStorage);
  const chooseAndRestoreLocalBackup = async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      buttonLabel: 'Choose Backup',
      defaultPath: getLocalBackupFolder(),
      filters: [{ name: 'BEX encrypted backup', extensions: ['db'] }],
      message: 'Choose a BEX backup from this Berean Library Backups folder.',
      properties: ['openFile'],
      title: 'Restore Berean Library',
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };

    const backupPath = result.filePaths[0];
    const preview = inspectLocalBackupForRestore(backupPath);
    const modifiedAt = new Date(preview.modifiedAt).toLocaleString();
    const confirmation = await dialog.showMessageBox(mainWindow, {
      buttons: ['Cancel', 'Restore Backup'],
      cancelId: 0,
      defaultId: 0,
      detail: `${preview.fileName}\nSaved ${modifiedAt}\n\nBEX will first preserve your current database as an emergency backup.`,
      message: 'Replace the current library with this backup?',
      noLink: true,
      title: 'Confirm Restore',
      type: 'warning',
    });
    if (confirmation.response !== 1) return { canceled: true };

    return {
      canceled: false,
      restored: await restoreLocalBackup(backupPath, { privacyProtector }),
    };
  };
  const chooseAndInstallCoursePackage = async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      buttonLabel: 'Install Course Package',
      defaultPath: app.getPath('documents'),
      message: 'Choose a BEX Course package folder containing manifest.json.',
      properties: ['openDirectory'],
      title: 'Install Course Package',
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    return {
      canceled: false,
      ...(await installCoursePackage(result.filePaths[0], {
        allowUnsigned: !app.isPackaged,
        currentBexVersion: app.getVersion(),
        verifyManifestSignature: verifyCourseManifestSignature,
      })),
    };
  };
  const connectLocalCourseCatalog = async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      buttonLabel: 'Connect Test Catalog',
      defaultPath: app.getPath('documents'),
      message: 'Choose the same local publishing folder used by BEX Course Studio.',
      properties: ['openDirectory'],
      title: 'Connect Local Course Catalog',
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    return { canceled: false, connection: localCourseCatalog.connect(result.filePaths[0]) };
  };
  const installCatalogCourse = async (courseId) => {
    if (activeCourseDownloads.has(courseId)) {
      const error = new Error('That Course is already downloading.');
      error.code = 'BEX_COURSE_DOWNLOAD_ACTIVE';
      throw error;
    }
    const delivery = localCourseCatalog.deliveryFor(courseId);
    const controller = new AbortController();
    activeCourseDownloads.set(courseId, controller);
    try {
      return {
        canceled: false,
        ...(await downloadCourseVersion({
          currentBexVersion: app.getVersion(),
          installCourseVersion,
          libraryPath: getActiveLibraryPath(),
          manifest: delivery.manifest,
          objectSource: new LocalCatalogObjectSource(delivery.catalogRoot),
          onProgress: (progress) => {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(COURSE_DOWNLOAD_PROGRESS_CHANNEL, progress);
          },
          signal: controller.signal,
          verifyManifestSignature: verifyCourseManifestSignature,
        })),
      };
    } finally {
      activeCourseDownloads.delete(courseId);
    }
  };
  const cancelCatalogCourse = async (courseId) => {
    const controller = activeCourseDownloads.get(courseId);
    if (controller) controller.abort();
    return { paused: Boolean(controller) };
  };
  const listCoursesWithDownloads = () => {
    const library = localCourseCatalog.merge(listCourseLibrary());
    return mergeCourseDownloadStates(library, readCourseDownloadStates(getActiveLibraryPath()));
  };
  registerLibraryHandlers({
    appUrl,
    getMainWindow: () => mainWindow,
    onLibraryReady: (libraryPath) => {
      let currentLibrary = null;
      try { currentLibrary = getActiveLibraryPath(); } catch { /* No library is open yet. */ }
      if (currentLibrary !== libraryPath) attachmentExternalCopies.cleanup();
      return initializeDatabase(libraryPath, { privacyProtector });
    },
  });
  registerActivationHandlers({
    activateInstallation,
    appUrl,
    createMachineRequest,
    getActivationState,
    ipcMain,
  });
  registerClipboardHandlers({ appUrl, ipcMain, clipboard });
  registerExportFileHandlers({
    appUrl,
    ipcMain,
    showSaveDialog: (event, options) => {
      const parent = BrowserWindow.fromWebContents(event.sender);
      return parent ? dialog.showSaveDialog(parent, options) : dialog.showSaveDialog(options);
    },
  });
  const scriptureSettings = new ScriptureSettings({
    filePath: path.join(app.getPath('userData'), 'scripture-credentials.json'),
    safeStorage,
  });
  const scriptureCache = new ScriptureCache();
  const scriptureUsageLedger = new ScriptureUsageLedger({
    storageDir: app.getPath('userData'),
  });
  const scriptureApi = new ScriptureApi({
    settings: scriptureSettings,
    cache: scriptureCache,
    ledger: scriptureUsageLedger,
  });
  registerScriptureHandlers({
    appUrl,
    ipcMain,
    settings: scriptureSettings,
    api: scriptureApi,
  });
  registerAppRestartHandler({ appUrl, ipcMain, app });
  registerContactHandlers({
    appUrl,
    ipcMain,
    openExternal: (targetUrl) => shell.openExternal(targetUrl),
  });
  registerExternalLinkHandlers({
    appUrl,
    ipcMain,
    openExternal: (targetUrl) => shell.openExternal(targetUrl),
  });
  registerCourseHandlers({
    appUrl,
    chooseAndInstallCoursePackage,
    cancelCatalogCourse,
    connectLocalCourseCatalog,
    installCatalogCourse,
    ipcMain,
    listCourseLibrary: listCoursesWithDownloads,
    saveCourseProgress,
  });
  registerLocalOwnerHandlers({
    appUrl,
    getLocalOwner,
    ipcMain,
    updateLocalOwner,
  });
  registerLocalBibleHandlers({
    appUrl,
    ipcMain,
    readLocalBibleChapter,
  });
  registerLocalMamHandlers({
    appUrl,
    ipcMain,
    readLocalMamChapter,
  });
  registerLocalBackupHandlers({
    appUrl,
    chooseAndRestoreLocalBackup,
    createLocalBackup,
    ipcMain,
  });
  registerLocalEntityHandlers({
    appUrl,
    createLocalEntity,
    deleteLocalEntity,
    getLocalEntity,
    ipcMain,
    importKnowledgeWebGraph,
    listLocalEntities,
    readLocalEntitySnapshot,
    reorderLocalEntities,
    restoreKnowledgeWebGraph,
    updateLocalEntity,
  });
  registerLocalMediaHandlers({
    appUrl,
    deleteLocalImage,
    ipcMain,
    saveLocalImage,
  });
  registerLocalAttachmentHandlers({
    appUrl,
    ipcMain,
    assertUnlocked: assertLocalFilesAvailable,
    chooseFiles: (event) => {
      const parent = BrowserWindow.fromWebContents(event.sender);
      const options = {
        buttonLabel: 'Add Files',
        defaultPath: app.getPath('documents'),
        properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
        title: 'Add Files to Note',
      };
      return parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options);
    },
    saveLocalFile,
    rollbackLocalFile,
    openLocalFile: (mediaUrl) => attachmentExternalCopies.open(mediaUrl, (target) => shell.openPath(target)),
  });
  registerPrivacyHandlers({
    appUrl,
    changePrivacyPin,
    disablePrivacyPin,
    enablePrivacyPin,
    getPrivacyStatus,
    ipcMain,
    publishPrivacyStatus,
    replacePrivacyRecoveryCode,
    unlockPrivacyAutomatically,
    unlockPrivacyWithPin,
    unlockPrivacyWithRecoveryCode,
  });
  registerPrivacyLifecycle();
  registerMediaProtocol(appUrl);
  await createMainWindow(appUrl);
}

app.whenReady().then(async () => {
  try {
    // Before the window: this frees Cmd+H, which the default macOS menu
    // otherwise takes for Hide Application before the editor can see it.
    installApplicationMenu({ app, Menu });
    await launch();
  } catch (error) {
    console.error('[desktop] Launch failed:', error);
    dialog.showErrorBox(APP_NAME, error instanceof Error ? error.message : String(error));
    app.quit();
  }
});

const handleNormalClose = createNormalCloseHandler({
  app,
  prepareForShutdown: async () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
    let timeout;
    try {
      await Promise.race([
        mainWindow.webContents.executeJavaScript('window.__bexFlushPendingEditorSaves?.()'),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Saving timed out.')), 15000); }),
      ]);
    } finally { clearTimeout(timeout); }
  },
  onPreparationFailed: () => dialog.showErrorBox('BEX is still saving', 'Your workspace has been kept open because a recent save could not finish. Resolve the save error or wait for saving to finish, then quit again.'),
  closeDatabase,
  closeServices: () => {
    attachmentExternalCopies?.cleanup();
    if (devServerProcess && !devServerProcess.killed) devServerProcess.kill();
    if (builtServer) builtServer.close();
  },
  createLocalBackup,
  onShutdownStarted: () => {
    isQuitting = true;
    attachmentExternalCopies?.cleanup();
  },
});

app.on('before-quit', handleNormalClose);

app.on('window-all-closed', () => app.quit());
