'use strict';

const MASS_BACKUP_CHANNELS = Object.freeze({
  chooseFolder: 'mass-backup:choose-folder',
  getSettings: 'mass-backup:get-settings',
  revealFolder: 'mass-backup:reveal-folder',
  setReplacePrevious: 'mass-backup:set-replace-previous',
  writeArchives: 'mass-backup:write-archives',
});

const PUBLIC_ERROR_MESSAGES = Object.freeze({
  BEX_MASS_BACKUP_ACTIVE: 'A Mass Backup is already being saved.',
  BEX_MASS_BACKUP_ARCHIVE_INVALID: 'BEX could not verify one of the Mass Backup ZIP files.',
  BEX_MASS_BACKUP_CONFIG_INVALID: 'The saved Mass Backup setting is invalid. Choose the folder again.',
  BEX_MASS_BACKUP_FOLDER_UNAVAILABLE: 'The saved Mass Backup folder is unavailable. Choose it again.',
  BEX_MASS_BACKUP_NOT_CONFIGURED: 'Choose a Mass Backup folder first.',
  BEX_MASS_BACKUP_REVEAL_FAILED: 'BEX could not show the saved Mass Backup folder.',
  BEX_MASS_BACKUP_SETTING_INVALID: 'The Mass Backup replacement setting is invalid.',
  BEX_MASS_BACKUP_WRITE_FAILED: 'BEX could not save the Mass Backup ZIP files.',
  BEX_UNTRUSTED_SENDER: 'BEX blocked a Mass Backup request from an untrusted page.',
});

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertTrustedSender(event, trustedOrigin) {
  const senderUrl = event?.senderFrame?.url
    || (event?.sender && typeof event.sender.getURL === 'function' ? event.sender.getURL() : '');
  let senderOrigin = null;
  try {
    senderOrigin = new URL(senderUrl).origin;
  } catch {
    // A malformed sender URL is never trusted.
  }
  if (senderOrigin !== trustedOrigin) {
    throw codedError('BEX_UNTRUSTED_SENDER', 'Blocked a Mass Backup request from an untrusted page.');
  }
}

function errorResponse(error, fallbackMessage) {
  const code = typeof error?.code === 'string' ? error.code : null;
  return {
    ok: false,
    code,
    error: PUBLIC_ERROR_MESSAGES[code] || fallbackMessage,
  };
}

function registerMassBackupHandlers({
  appUrl,
  chooseFolder,
  ipcMain,
  manager,
  revealFolder,
} = {}) {
  if (
    typeof appUrl !== 'string'
    || typeof chooseFolder !== 'function'
    || !ipcMain
    || typeof ipcMain.handle !== 'function'
    || typeof ipcMain.removeHandler !== 'function'
    || !manager
    || typeof manager.getSettings !== 'function'
    || typeof manager.setDestination !== 'function'
    || typeof manager.setReplacePrevious !== 'function'
    || typeof manager.writeArchives !== 'function'
    || typeof revealFolder !== 'function'
  ) {
    throw new TypeError('The Mass Backup bridge is missing a required dependency.');
  }

  const trustedOrigin = new URL(appUrl).origin;
  for (const channel of Object.values(MASS_BACKUP_CHANNELS)) ipcMain.removeHandler(channel);

  ipcMain.handle(MASS_BACKUP_CHANNELS.getSettings, async (event) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      return { ok: true, settings: await manager.getSettings() };
    } catch (error) {
      return errorResponse(error, 'BEX could not read the Mass Backup settings.');
    }
  });

  ipcMain.handle(MASS_BACKUP_CHANNELS.chooseFolder, async (event) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      // Folder selection is the recovery route for a malformed persisted
      // config. Repair it to conservative defaults before opening the chooser,
      // so even canceling leaves the feature usable and replacement disabled.
      const current = await manager.getSettings({ repairInvalid: true });
      const selection = await chooseFolder(current);
      if (!selection || selection.canceled || !selection.destinationPath) {
        return { ok: true, canceled: true, settings: current };
      }
      return {
        ok: true,
        canceled: false,
        settings: await manager.setDestination(selection.destinationPath),
      };
    } catch (error) {
      return errorResponse(error, 'BEX could not save that Mass Backup folder.');
    }
  });

  ipcMain.handle(MASS_BACKUP_CHANNELS.setReplacePrevious, async (event, replacePrevious) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      return {
        ok: true,
        settings: await manager.setReplacePrevious(replacePrevious),
      };
    } catch (error) {
      return errorResponse(error, 'BEX could not update the Mass Backup setting.');
    }
  });

  ipcMain.handle(MASS_BACKUP_CHANNELS.writeArchives, async (event, archives) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      return { ok: true, result: await manager.writeArchives(archives) };
    } catch (error) {
      return errorResponse(error, 'BEX could not save the Mass Backup ZIP files.');
    }
  });

  ipcMain.handle(MASS_BACKUP_CHANNELS.revealFolder, async (event) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      const settings = await manager.getSettings();
      if (!settings.available || !settings.destinationPath) {
        throw codedError('BEX_MASS_BACKUP_FOLDER_UNAVAILABLE', 'The Mass Backup folder is unavailable.');
      }
      const revealError = await revealFolder(settings.destinationPath);
      if (typeof revealError === 'string' && revealError) {
        throw codedError('BEX_MASS_BACKUP_REVEAL_FAILED', revealError);
      }
      return { ok: true, revealed: true };
    } catch (error) {
      return errorResponse(error, 'BEX could not show the Mass Backup folder.');
    }
  });
}

module.exports = {
  MASS_BACKUP_CHANNELS,
  registerMassBackupHandlers,
};
