'use strict';

const ACTIVATION_CHANNELS = Object.freeze({
  getRequest: 'activation:get-request',
  getStatus: 'activation:get-status',
  submit: 'activation:submit',
});
const MAX_ACTIVATION_CODE_LENGTH = 4096;
const REQUEST_CODE_PATTERN = /^BEX-REQ-1\.[A-Za-z0-9_-]{43}$/;
const PUBLIC_ERROR_MESSAGES = Object.freeze({
  BEX_ACTIVATION_INPUT_INVALID: 'Enter the activation code exactly as David sent it.',
  BEX_ACTIVATION_INVALID: 'That activation code is not valid.',
  BEX_ACTIVATION_STATE_INVALID: 'The saved activation could not be verified. Nothing was changed.',
  BEX_ACTIVATION_WRONG_MACHINE: 'That activation code was created for a different computer.',
  BEX_DATABASE_NOT_OPEN: 'Choose or reconnect the Berean Library before activation.',
  BEX_UNTRUSTED_SENDER: 'BEX blocked a request from an untrusted page.',
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
    throw codedError('BEX_UNTRUSTED_SENDER', 'Blocked an activation request from an untrusted page.');
  }
}

function errorResponse(error, fallbackMessage) {
  const publicMessage = error && typeof error.code === 'string'
    ? PUBLIC_ERROR_MESSAGES[error.code]
    : null;
  return { ok: false, error: publicMessage || fallbackMessage };
}

function activatedOnly(state) {
  if (!state || typeof state.activated !== 'boolean') {
    throw new Error('BEX returned an invalid activation state.');
  }
  return { activated: state.activated };
}

function validateDependencies(options) {
  if (!options || typeof options.appUrl !== 'string') {
    throw new TypeError('The activation bridge requires the BEX application URL.');
  }
  if (
    !options.ipcMain
    || typeof options.ipcMain.handle !== 'function'
    || typeof options.ipcMain.removeHandler !== 'function'
  ) {
    throw new TypeError('The activation bridge requires Electron IPC.');
  }
  for (const dependency of ['createMachineRequest', 'getActivationState', 'activateInstallation']) {
    if (typeof options[dependency] !== 'function') {
      throw new TypeError(`The activation bridge is missing ${dependency}.`);
    }
  }
}

function registerActivationHandlers(options) {
  validateDependencies(options);
  const {
    activateInstallation,
    appUrl,
    createMachineRequest,
    getActivationState,
    ipcMain,
  } = options;
  const trustedOrigin = new URL(appUrl).origin;

  for (const channel of Object.values(ACTIVATION_CHANNELS)) {
    ipcMain.removeHandler(channel);
  }

  ipcMain.handle(ACTIVATION_CHANNELS.getRequest, async (event) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      const request = await createMachineRequest();
      if (!request || !REQUEST_CODE_PATTERN.test(request.requestCode)) {
        throw new Error('BEX created an invalid machine request code.');
      }
      return { ok: true, requestCode: request.requestCode };
    } catch (error) {
      return errorResponse(error, 'BEX could not create this computer\'s request code.');
    }
  });

  ipcMain.handle(ACTIVATION_CHANNELS.getStatus, async (event) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      const status = activatedOnly(await getActivationState());
      return { ok: true, status };
    } catch (error) {
      return errorResponse(error, 'BEX could not read the activation status.');
    }
  });

  ipcMain.handle(ACTIVATION_CHANNELS.submit, async (event, activationCode) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      if (typeof activationCode !== 'string') {
        throw codedError('BEX_ACTIVATION_INPUT_INVALID', 'Activation input must be text.');
      }
      const normalizedCode = activationCode.trim();
      if (!normalizedCode || normalizedCode.length > MAX_ACTIVATION_CODE_LENGTH) {
        throw codedError('BEX_ACTIVATION_INPUT_INVALID', 'Activation input has an invalid length.');
      }

      const status = activatedOnly(await activateInstallation(normalizedCode));
      return { ok: true, status };
    } catch (error) {
      return errorResponse(error, 'BEX could not save the activation. Nothing was changed.');
    }
  });
}

module.exports = {
  ACTIVATION_CHANNELS,
  registerActivationHandlers,
};
