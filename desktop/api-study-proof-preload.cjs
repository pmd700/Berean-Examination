'use strict';
// Disposable renderer fixtures. Never opens the user's library or credentials.
const { contextBridge, ipcRenderer } = require('electron');
let owner = { is_local_owner: true, owner_id: 'split-view-proof', theme: 'dark' };
const privacy = { locked: false, mode: 'automatic', encryption: 'AES-256-GCM', localOnly: true, pinEnabled: false };
contextBridge.exposeInMainWorld('bexDesktop', {
  isDesktop: true,
  getLibraryStatus: async () => ({ ok: true, status: { available: true } }),
  getActivationStatus: async () => ({ ok: true, status: { activated: true } }),
  getPrivacyStatus: async () => ({ ok: true, status: privacy }),
  unlockPrivacyAutomatically: async () => ({ ok: true, status: privacy }),
  onPrivacyStatusChanged: () => () => {},
  getLocalOwner: async () => ({ ok: true, owner }),
  updateLocalOwner: async (patch) => ({ ok: true, owner: (owner = { ...owner, ...patch }) }),
  getScriptureCatalog: async () => ({ ok: true, result: { data: [{ id: '317e03834065a236-01', abbreviation: 'BSB', name: 'Berean Standard Bible' }] } }),
  getScriptureCredentialStatus: async () => ({ ok: true, status: { configured: true } }),
  getScriptureStatus: async () => ({ ok: true, status: { configured: true } }),
  fetchScriptureContent: async ({ id }) => ({ ok: true, result: { data: { content: [{ type: 'tag', name: 'para', attrs: { style: 'p' }, items: [
    { type: 'tag', name: 'verse', attrs: { number: '1' } },
    { type: 'text', text: 'Paul, a servant of Christ Jesus. Chapter ' + id },
  ] }] } } }),
  listLocalEntities: (type, query) => ipcRenderer.invoke('local-entity:list', type, query),
  getLocalEntity: (type, id) => ipcRenderer.invoke('local-entity:get', type, id),
  updateLocalEntity: (type, id, patch) => ipcRenderer.invoke('local-entity:update', type, id, patch),
  createLocalEntity: (type, patch) => ipcRenderer.invoke('local-entity:create', type, patch),
  deleteLocalEntity: (type, id) => ipcRenderer.invoke('local-entity:delete', type, id),
});
