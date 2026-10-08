'use strict';

const CREATE_LOCAL_BACKUP_CHANNEL = 'local-backup:create';
const RESTORE_LOCAL_BACKUP_CHANNEL = 'local-backup:restore';

const PUBLIC_ERROR_MESSAGES = Object.freeze({
  BEX_BACKUP_DATABASE_INVALID: 'BEX stopped because the library did not pass its safety check.',
  BEX_BACKUP_EXISTS: 'That backup already exists. Try again.',
  BEX_BACKUP_FOLDER_INVALID: 'The Berean Library Backups folder is unavailable.',
  BEX_BACKUP_VERIFICATION_FAILED: 'BEX stopped because the backup did not match the library.',
  BEX_DATABASE_NOT_OPEN: 'Choose or reconnect the Berean Library before making a backup.',
  BEX_PRIVACY_NOT_OPEN: 'The encrypted Berean Library is unavailable.',
  BEX_RESTORE_BACKUP_INVALID: 'Choose a valid BEX backup from this library Backups folder.',
  BEX_RESTORE_BACKUP_NEWER: 'Update BEX before restoring this newer backup.',
  BEX_RESTORE_FAILED: 'The restore failed, so BEX put your original database back.',
  BEX_RESTORE_ROLLBACK_FAILED: 'BEX could not safely finish or roll back the restore.',
  BEX_RESTORE_VERIFICATION_FAILED: 'The restored records did not pass verification.',
  BEX_UNTRUSTED_SENDER: 'BEX blocked a backup request from an untrusted page.',
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
    throw codedError('BEX_UNTRUSTED_SENDER', 'Blocked a backup request from an untrusted page.');
  }
}

function errorResponse(error) {
  const message = error && typeof error.code === 'string'
    ? PUBLIC_ERROR_MESSAGES[error.code]
    : null;
  return {
    ok: false,
    code: typeof error?.code === 'string' ? error.code : null,
    error: message || 'BEX could not create the encrypted backup.',
    rolledBack: error?.rolledBack === true,
  };
}

function registerLocalBackupHandlers({
  appUrl,
  chooseAndRestoreLocalBackup,
  createLocalBackup,
  ipcMain,
} = {}) {
  if (
    typeof appUrl !== 'string'
    || typeof chooseAndRestoreLocalBackup !== 'function'
    || typeof createLocalBackup !== 'function'
    || !ipcMain
    || typeof ipcMain.handle !== 'function'
    || typeof ipcMain.removeHandler !== 'function'
  ) {
    throw new TypeError('The local backup bridge is missing a required dependency.');
  }

  const trustedOrigin = new URL(appUrl).origin;
  ipcMain.removeHandler(CREATE_LOCAL_BACKUP_CHANNEL);
  ipcMain.removeHandler(RESTORE_LOCAL_BACKUP_CHANNEL);
  ipcMain.handle(CREATE_LOCAL_BACKUP_CHANNEL, async (event) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      return { ok: true, backup: await createLocalBackup() };
    } catch (error) {
      return errorResponse(error);
    }
  });
  ipcMain.handle(RESTORE_LOCAL_BACKUP_CHANNEL, async (event) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      return { ok: true, ...(await chooseAndRestoreLocalBackup()) };
    } catch (error) {
      return errorResponse(error);
    }
  });
}

module.exports = {
  CREATE_LOCAL_BACKUP_CHANNEL,
  RESTORE_LOCAL_BACKUP_CHANNEL,
  registerLocalBackupHandlers,
};
