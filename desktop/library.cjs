'use strict';

const { app, dialog, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const GET_STATUS_CHANNEL = 'library:get-status';
const CHOOSE_LIBRARY_CHANNEL = 'library:choose';
const CONFIG_FILE_NAME = 'library-config.json';
const LIBRARY_FOLDERS = Object.freeze([
  'Database',
  'Courses',
  'Media',
  'Imports',
  'Exports',
]);

function configPath() {
  return path.join(app.getPath('userData'), CONFIG_FILE_NAME);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function readLibraryConfig() {
  try {
    const text = await fs.promises.readFile(configPath(), 'utf8');
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed.libraryPath !== 'string' || !parsed.libraryPath.trim()) {
      return {
        config: null,
        error: 'The saved library setting is incomplete. Choose the library folder again.',
      };
    }
    return { config: parsed, error: null };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { config: null, error: null };
    console.warn('[desktop] Could not read the library setting:', error);
    return {
      config: null,
      error: 'BEX could not read the saved library setting. Choose the library folder again.',
    };
  }
}

async function folderIsDirectory(folderPath) {
  try {
    const stats = await fs.promises.stat(folderPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

async function getLibraryStatus() {
  const { config, error } = await readLibraryConfig();

  if (!config) {
    return {
      available: false,
      configured: false,
      folders: LIBRARY_FOLDERS,
      issue: error ? 'config_unreadable' : 'not_configured',
      message: error,
      missingFolders: [],
      path: null,
    };
  }

  const libraryPath = path.resolve(config.libraryPath);
  if (!(await folderIsDirectory(libraryPath))) {
    return {
      available: false,
      configured: true,
      folders: LIBRARY_FOLDERS,
      issue: 'library_unavailable',
      message: 'The saved Berean Library folder is missing or unavailable. Nothing was deleted.',
      missingFolders: [],
      path: libraryPath,
    };
  }

  const missingFolders = [];
  for (const folderName of LIBRARY_FOLDERS) {
    const expectedPath = path.join(libraryPath, folderName);
    if (!(await folderIsDirectory(expectedPath))) missingFolders.push(folderName);
  }

  return {
    available: missingFolders.length === 0,
    configured: true,
    folders: LIBRARY_FOLDERS,
    issue: missingFolders.length ? 'folders_missing' : null,
    message: missingFolders.length
      ? 'Some Berean Library folders are missing. Choose this folder again to restore only the missing folders.'
      : null,
    missingFolders,
    path: libraryPath,
  };
}

async function fileExists(filePath) {
  try {
    const stats = await fs.promises.stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

async function isExistingBereanLibrary(folderPath) {
  return fileExists(path.join(folderPath, 'Database', 'berean.db'));
}

async function resolveLibraryRoot(selectedPath) {
  const candidate = path.resolve(selectedPath);
  if (await isExistingBereanLibrary(candidate)) return candidate;

  // If the user selected a subfolder inside an existing Berean Library
  // (e.g. Vault/Backups, Vault/Backups/Archives, Vault/Database, Vault/Media),
  // automatically resolve to the parent Vault folder instead of creating
  // nested empty folders inside it.
  let current = candidate;
  for (let depth = 0; depth < 3; depth += 1) {
    const parent = path.dirname(current);
    if (parent === current) break;
    if (await isExistingBereanLibrary(parent)) return parent;
    current = parent;
  }

  return candidate;
}

async function createLibraryStructure(libraryPath) {
  const resolvedPath = await resolveLibraryRoot(libraryPath);
  const rootStats = await fs.promises.stat(resolvedPath);
  if (!rootStats.isDirectory()) {
    throw new Error('The selected location is not a folder.');
  }

  for (const folderName of LIBRARY_FOLDERS) {
    await fs.promises.mkdir(path.join(resolvedPath, folderName), { recursive: true });
  }

  const savedConfig = {
    libraryPath: resolvedPath,
    selectedAt: new Date().toISOString(),
    version: 1,
  };
  await fs.promises.writeFile(configPath(), JSON.stringify(savedConfig, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  });

  return getLibraryStatus();
}

function assertTrustedSender(event, trustedOrigin) {
  const senderUrl = event.senderFrame && event.senderFrame.url
    ? event.senderFrame.url
    : event.sender.getURL();

  let senderOrigin = null;
  try {
    senderOrigin = new URL(senderUrl).origin;
  } catch {
    // A malformed sender URL is never trusted.
  }

  if (senderOrigin !== trustedOrigin) {
    throw new Error('Blocked a library request from an untrusted page.');
  }
}

function registerLibraryHandlers({ appUrl, getMainWindow, onLibraryReady }) {
  const trustedOrigin = new URL(appUrl).origin;

  ipcMain.removeHandler(GET_STATUS_CHANNEL);
  ipcMain.removeHandler(CHOOSE_LIBRARY_CHANNEL);

  ipcMain.handle(GET_STATUS_CHANNEL, async (event) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      const status = await getLibraryStatus();
      if (status.available && onLibraryReady) await onLibraryReady(status.path);
      return { ok: true, status };
    } catch (error) {
      console.error('[desktop] Library status failed:', error);
      return { ok: false, error: errorMessage(error) };
    }
  });

  ipcMain.handle(CHOOSE_LIBRARY_CHANNEL, async (event) => {
    try {
      assertTrustedSender(event, trustedOrigin);

      const current = await readLibraryConfig();
      const defaultPath = current.config?.libraryPath
        ? path.dirname(path.resolve(current.config.libraryPath))
        : app.getPath('desktop');

      const result = await dialog.showOpenDialog(getMainWindow(), {
        buttonLabel: 'Choose Berean Library',
        defaultPath,
        message: 'Choose or create the folder BEX will use as your Berean Library.',
        properties: ['openDirectory', 'createDirectory'],
        title: 'Choose Berean Library',
      });

      if (result.canceled || !result.filePaths[0]) {
        return { ok: true, canceled: true };
      }

      const status = await createLibraryStructure(result.filePaths[0]);
      if (status.available && onLibraryReady) await onLibraryReady(status.path);
      return { ok: true, canceled: false, status };
    } catch (error) {
      console.error('[desktop] Library selection failed:', error);
      return {
        ok: false,
        error: 'BEX could not prepare that folder. No existing files were removed. ' + errorMessage(error),
      };
    }
  });
}

module.exports = {
  LIBRARY_FOLDERS,
  getLibraryStatus,
  registerLibraryHandlers,
  resolveLibraryRoot,
};
