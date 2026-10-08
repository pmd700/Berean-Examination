'use strict';

const PRIVACY_CHANNELS = Object.freeze({
  changePin: 'privacy:change-pin',
  disablePin: 'privacy:disable-pin',
  enablePin: 'privacy:enable-pin',
  get: 'privacy:get-status',
  replaceRecovery: 'privacy:replace-recovery',
  unlockAutomatic: 'privacy:unlock-automatic',
  unlockPin: 'privacy:unlock-pin',
  unlockRecovery: 'privacy:unlock-recovery',
});
const PRIVACY_STATUS_CHANGED_CHANNEL = 'privacy:status-changed';

const PUBLIC_ERROR_MESSAGES = Object.freeze({
  BEX_DATABASE_NOT_OPEN: 'Choose or reconnect the Berean Library before checking privacy.',
  BEX_PRIVACY_NOT_OPEN: 'The local privacy vault is unavailable.',
  BEX_PROTECTED_STORAGE_UNAVAILABLE: 'This Mac could not open protected system storage.',
  BEX_PIN_REQUIRED: 'This library requires its privacy PIN.',
  BEX_PIN_DELAY: 'Wait before trying the PIN again.',
  BEX_PIN_NOT_ENABLED: 'This library does not use a privacy PIN.',
  BEX_PRIVACY_INPUT_INVALID: 'Use a PIN containing 4 to 12 digits.',
  BEX_RECOVERY_NOT_ENABLED: 'This library has no recovery code.',
  BEX_RECOVERY_CODE_INVALID: 'That recovery code is not in the expected format.',
  BEX_UNTRUSTED_SENDER: 'BEX blocked a request from an untrusted page.',
  BEX_WRONG_PIN: 'That PIN is incorrect.',
  BEX_WRONG_RECOVERY_CODE: 'That recovery code is incorrect.',
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
    throw codedError('BEX_UNTRUSTED_SENDER', 'Blocked a privacy request from an untrusted page.');
  }
}

function publicStatus(status) {
  return Object.freeze({
    ...status,
    encryption: 'AES-256-GCM',
    localOnly: true,
    protectedBy: process.platform === 'darwin'
      ? 'macOS Keychain'
      : process.platform === 'win32'
        ? 'Windows protected storage'
        : 'system protected storage',
  });
}

function errorResponse(error, fallbackMessage) {
  const publicMessage = error && typeof error.code === 'string'
    ? PUBLIC_ERROR_MESSAGES[error.code]
    : null;
  return {
    ok: false,
    error: publicMessage || fallbackMessage,
    code: typeof error?.code === 'string' ? error.code : null,
    attempts: Number.isFinite(error?.attempts) ? error.attempts : null,
    delayMs: Number.isFinite(error?.delayMs) ? error.delayMs : null,
    retryAfterMs: Number.isFinite(error?.retryAfterMs) ? error.retryAfterMs : null,
  };
}

function registerPrivacyHandlers(options) {
  const {
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
  } = options || {};
  if (typeof appUrl !== 'string' || !ipcMain) {
    throw new TypeError('The privacy bridge requires the BEX application URL and Electron IPC.');
  }
  const privacyActions = [
    changePrivacyPin,
    disablePrivacyPin,
    enablePrivacyPin,
    getPrivacyStatus,
    replacePrivacyRecoveryCode,
    unlockPrivacyAutomatically,
    unlockPrivacyWithPin,
    unlockPrivacyWithRecoveryCode,
  ];
  if (privacyActions.some((action) => typeof action !== 'function')) {
    throw new TypeError('The privacy bridge is missing its local vault functions.');
  }

  const trustedOrigin = new URL(appUrl).origin;
  for (const channel of Object.values(PRIVACY_CHANNELS)) ipcMain.removeHandler(channel);

  ipcMain.handle(PRIVACY_CHANNELS.get, async (event) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      return { ok: true, status: publicStatus(await getPrivacyStatus()) };
    } catch (error) {
      return errorResponse(error, 'BEX could not check local privacy.');
    }
  });

  ipcMain.handle(PRIVACY_CHANNELS.unlockAutomatic, async (event) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      return { ok: true, status: publicStatus(await unlockPrivacyAutomatically()) };
    } catch (error) {
      return errorResponse(error, 'BEX could not unlock the local privacy vault.');
    }
  });

  const registerStatusAction = (channel, action, fallbackMessage) => {
    ipcMain.handle(channel, async (event, value) => {
      try {
        assertTrustedSender(event, trustedOrigin);
        const status = await action(value);
        publishPrivacyStatus?.(status);
        return { ok: true, status: publicStatus(status) };
      } catch (error) {
        return errorResponse(error, fallbackMessage);
      }
    });
  };

  const registerRecoveryAction = (channel, action, fallbackMessage) => {
    ipcMain.handle(channel, async (event, value) => {
      try {
        assertTrustedSender(event, trustedOrigin);
        const result = await action(value);
        publishPrivacyStatus?.(result.status);
        return {
          ok: true,
          recoveryCode: result.recoveryCode,
          status: publicStatus(result.status),
        };
      } catch (error) {
        return errorResponse(error, fallbackMessage);
      }
    });
  };

  registerRecoveryAction(
    PRIVACY_CHANNELS.enablePin,
    enablePrivacyPin,
    'BEX could not enable the privacy PIN.',
  );
  registerStatusAction(
    PRIVACY_CHANNELS.unlockPin,
    unlockPrivacyWithPin,
    'BEX could not unlock the library with that PIN.',
  );
  registerStatusAction(
    PRIVACY_CHANNELS.unlockRecovery,
    unlockPrivacyWithRecoveryCode,
    'BEX could not unlock the library with that recovery code.',
  );
  registerStatusAction(
    PRIVACY_CHANNELS.changePin,
    changePrivacyPin,
    'BEX could not change the privacy PIN.',
  );
  registerRecoveryAction(
    PRIVACY_CHANNELS.replaceRecovery,
    replacePrivacyRecoveryCode,
    'BEX could not replace the recovery code.',
  );
  registerStatusAction(
    PRIVACY_CHANNELS.disablePin,
    disablePrivacyPin,
    'BEX could not remove the privacy PIN.',
  );
}

module.exports = {
  PRIVACY_CHANNELS,
  PRIVACY_STATUS_CHANGED_CHANNEL,
  publicStatus,
  registerPrivacyHandlers,
};
