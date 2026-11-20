'use strict';
// Disposable renderer fixtures. Never opens the user's library or credentials.
const { contextBridge, ipcRenderer } = require('electron');
const privacy = { locked: false, mode: 'automatic', encryption: 'AES-256-GCM', localOnly: true, pinEnabled: false };
contextBridge.exposeInMainWorld('bexDesktop', {
  isDesktop: true,
  getLibraryStatus: async () => ({ ok: true, status: { available: true } }),
  getPrivacyStatus: async () => ({ ok: true, status: privacy }),
  unlockPrivacyAutomatically: async () => ({ ok: true, status: privacy }),
  onPrivacyStatusChanged: () => () => {},
  getLocalOwner: () => ipcRenderer.invoke('local-owner:get'),
  updateLocalOwner: patch => ipcRenderer.invoke('local-owner:update', patch),
  getScriptureCatalog: async () => ({ ok: true, result: { data: [{ id: '317e03834065a236-01', abbreviation: 'BSB', name: 'Berean Standard Bible' }, { id: 'b8ee27bcd1cae43a-01', abbreviation: 'NASB1995', name: 'New American Standard Bible 1995' }] } }),
  getScriptureCredentialStatus: async () => ({ ok: true, status: { configured: true } }),
  getScriptureStatus: async () => ({ ok: true, status: { configured: true } }),
  fetchScriptureContent: options => ipcRenderer.invoke('scripture:fetch-content', options),
  cancelScriptureRequest: id => ipcRenderer.invoke('scripture:cancel-request', id),
  listLocalEntities: (type, query) => ipcRenderer.invoke('local-entity:list', type, query),
  readLocalEntitySnapshot: types => ipcRenderer.invoke('local-entity:snapshot', types),
  getLocalEntity: (type, id) => ipcRenderer.invoke('local-entity:get', type, id),
  updateLocalEntity: (type, id, patch) => ipcRenderer.invoke('local-entity:update', type, id, patch),
  createLocalEntity: (type, patch) => ipcRenderer.invoke('local-entity:create', type, patch),
  deleteLocalEntity: (type, id) => ipcRenderer.invoke('local-entity:delete', type, id),
  saveExportFile: payload => ipcRenderer.invoke('export:save-file', payload),
});
