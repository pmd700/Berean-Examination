'use strict';

const CONTACT_EMAIL = 'simonbarjona@atomicmail.io';
const CONTACT_MAILTO = 'mailto:' + CONTACT_EMAIL + '?subject=Berean%20Examination%20Feedback';
const OPEN_CONTACT_EMAIL_CHANNEL = 'contact:open-email';

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
    const error = new Error('BEX blocked an email request from an untrusted page.');
    error.code = 'BEX_UNTRUSTED_SENDER';
    throw error;
  }
}

function registerContactHandlers({ appUrl, ipcMain, openExternal }) {
  if (typeof appUrl !== 'string' || !ipcMain || typeof openExternal !== 'function') {
    throw new TypeError('The contact bridge is missing a required dependency.');
  }
  const trustedOrigin = new URL(appUrl).origin;
  ipcMain.removeHandler(OPEN_CONTACT_EMAIL_CHANNEL);
  ipcMain.handle(OPEN_CONTACT_EMAIL_CHANNEL, async (event) => {
    try {
      assertTrustedSender(event, trustedOrigin);
      await openExternal(CONTACT_MAILTO);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error?.code === 'BEX_UNTRUSTED_SENDER'
          ? 'BEX blocked an email request from an untrusted page.'
          : 'BEX could not open the installed email app.',
      };
    }
  });
}

module.exports = {
  CONTACT_EMAIL,
  CONTACT_MAILTO,
  OPEN_CONTACT_EMAIL_CHANNEL,
  registerContactHandlers,
};
