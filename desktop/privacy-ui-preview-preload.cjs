'use strict';

const { contextBridge } = require('electron');

const pinPreview = process.env.BEX_PRIVACY_PREVIEW_MODE === 'pin';
const readyPrivacyStatus = Object.freeze({
  attempts: 0,
  encryption: 'AES-256-GCM',
  localOnly: true,
  locked: pinPreview,
  mode: pinPreview ? 'pin' : 'automatic',
  pinEnabled: pinPreview,
  protectedBy: 'macOS Keychain',
  retryAfterMs: 0,
});

const previewApi = Object.freeze({
  getLibraryStatus: async () => ({
    ok: true,
    status: { available: true, configured: true, path: '/Disposable Preview Library' },
  }),
  getLocalOwner: async () => ({
    ok: true,
    owner: { is_local_owner: true, owner_id: 'privacy-ui-preview', theme: 'dark' },
  }),
  getPrivacyStatus: async () => {
    await new Promise((resolve) => setTimeout(resolve, 650));
    return { ok: true, status: readyPrivacyStatus };
  },
  isDesktop: true,
  onPrivacyStatusChanged: () => () => {},
  unlockPrivacyAutomatically: async () => ({ ok: true, status: readyPrivacyStatus }),
  unlockPrivacyWithPin: async () => ({
    ok: true,
    status: { ...readyPrivacyStatus, locked: false },
  }),
  unlockPrivacyWithRecoveryCode: async () => ({
    ok: true,
    status: { ...readyPrivacyStatus, locked: false },
  }),
  updateLocalOwner: async () => ({
    ok: true,
    owner: { is_local_owner: true, owner_id: 'privacy-ui-preview', theme: 'dark' },
  }),
});

contextBridge.exposeInMainWorld('bexDesktop', previewApi);
