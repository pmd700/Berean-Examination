'use strict';

const OPEN_EXTERNAL_URL_CHANNEL = 'external-link:open';

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
    throw codedError('BEX_UNTRUSTED_SENDER', 'BEX blocked a link request from an untrusted page.');
  }
}

function validateExternalUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) {
    throw codedError('BEX_EXTERNAL_URL_INVALID', 'Choose a valid secure web address.');
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw codedError('BEX_EXTERNAL_URL_INVALID', 'Choose a valid secure web address.');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw codedError('BEX_EXTERNAL_URL_INVALID', 'BEX opens only secure public web addresses.');
  }
  return url.href;
}

function registerExternalLinkHandlers({ appUrl, ipcMain, openExternal }) {
  if (typeof appUrl !== 'string' || !ipcMain || typeof openExternal !== 'function') {
    throw new TypeError('The external-link bridge is missing a required dependency.');
  }
  const trustedOrigin = new URL(appUrl).origin;
  ipcMain.removeHandler(OPEN_EXTERNAL_URL_CHANNEL);
  ipcMain.handle(OPEN_EXTERNAL_URL_CHANNEL, async (event, targetUrl) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      const validatedUrl = validateExternalUrl(targetUrl);
      await openExternal(validatedUrl);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        code: typeof error?.code === 'string' ? error.code : null,
        error: error?.code === 'BEX_UNTRUSTED_SENDER'
          ? 'BEX blocked a link request from an untrusted page.'
          : error?.code === 'BEX_EXTERNAL_URL_INVALID'
            ? error.message
            : 'BEX could not open that page in the default browser.',
      };
    }
  });
}

module.exports = {
  OPEN_EXTERNAL_URL_CHANNEL,
  registerExternalLinkHandlers,
  validateExternalUrl,
};
