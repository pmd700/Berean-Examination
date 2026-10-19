'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const desktopApi = Object.freeze({
  cancelCatalogCourse: (courseId) => ipcRenderer.invoke('courses:cancel-catalog-course', courseId),
  changePrivacyPin: (pin) => ipcRenderer.invoke('privacy:change-pin', pin),
  chooseLibrary: () => ipcRenderer.invoke('library:choose'),
  createLocalBackup: () => ipcRenderer.invoke('local-backup:create'),
  createLocalEntity: (entityType, value) => ipcRenderer.invoke('local-entity:create', entityType, value),
  deleteLocalImage: (mediaUrl) => ipcRenderer.invoke('local-media:delete-image', mediaUrl),
  deleteLocalEntity: (entityType, entityId) => ipcRenderer.invoke('local-entity:delete', entityType, entityId),
  disablePrivacyPin: () => ipcRenderer.invoke('privacy:disable-pin'),
  enablePrivacyPin: (pin) => ipcRenderer.invoke('privacy:enable-pin', pin),
  getActivationRequest: () => ipcRenderer.invoke('activation:get-request'),
  getActivationStatus: () => ipcRenderer.invoke('activation:get-status'),
  getLibraryStatus: () => ipcRenderer.invoke('library:get-status'),
  getLocalBibleChapter: (request) => ipcRenderer.invoke('local-bible:get-chapter', request),
  getLocalMamChapter: (request) => ipcRenderer.invoke('local-mam:get-chapter', request),
  getLocalEntity: (entityType, entityId) => ipcRenderer.invoke('local-entity:get', entityType, entityId),
  getLocalOwner: () => ipcRenderer.invoke('local-owner:get'),
  getPrivacyStatus: () => ipcRenderer.invoke('privacy:get-status'),
  getScriptureStatus: () => ipcRenderer.invoke('scripture:get-status'),
  saveScriptureKey: (key) => ipcRenderer.invoke('scripture:save-key', key),
  clearScriptureKey: () => ipcRenderer.invoke('scripture:clear-key'),
  getScriptureCatalog: (options) => ipcRenderer.invoke('scripture:get-catalog', options),
  getScriptureBooks: (options) => ipcRenderer.invoke('scripture:get-books', options),
  fetchScriptureContent: (options) => ipcRenderer.invoke('scripture:fetch-content', options),
  searchScriptureWords: (options) => ipcRenderer.invoke('scripture:search-words', options),
  cancelScriptureRequest: (requestId) => ipcRenderer.invoke('scripture:cancel-request', requestId),
  getScriptureUsage: () => ipcRenderer.invoke('scripture:get-usage'),
  isDesktop: true,
  writeClipboardText: (text) => ipcRenderer.invoke('clipboard:write-text', text),
  restartApp: () => ipcRenderer.invoke('app:restart'),
  saveExportFile: (payload) => ipcRenderer.invoke('export:save-file', payload),
  importKnowledgeWebGraph: (webId, importValue, options) => (
    ipcRenderer.invoke('local-entity:import-knowledge-web-graph', webId, importValue, options)
  ),
  importLocalFiles: () => ipcRenderer.invoke('local-attachments:import'),
  connectLocalCourseCatalog: () => ipcRenderer.invoke('courses:connect-local-catalog'),
  installCatalogCourse: (courseId) => ipcRenderer.invoke('courses:install-catalog-course', courseId),
  installCoursePackage: () => ipcRenderer.invoke('courses:install-package'),
  listLocalEntities: (entityType, query) => ipcRenderer.invoke('local-entity:list', entityType, query),
  readLocalEntitySnapshot: entityTypes => ipcRenderer.invoke('local-entity:snapshot', entityTypes),
  listCourses: () => ipcRenderer.invoke('courses:list'),
  openContactEmail: () => ipcRenderer.invoke('contact:open-email'),
  openExternalUrl: (targetUrl) => ipcRenderer.invoke('external-link:open', targetUrl),
  openLocalFile: (mediaUrl) => ipcRenderer.invoke('local-attachments:open', mediaUrl),
  onPrivacyStatusChanged: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('privacy:status-changed', listener);
    return () => ipcRenderer.removeListener('privacy:status-changed', listener);
  },
  onCourseDownloadProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('courses:download-progress', listener);
    return () => ipcRenderer.removeListener('courses:download-progress', listener);
  },
  submitActivationCode: (activationCode) => ipcRenderer.invoke('activation:submit', activationCode),
  replacePrivacyRecoveryCode: () => ipcRenderer.invoke('privacy:replace-recovery'),
  restoreLocalBackup: () => ipcRenderer.invoke('local-backup:restore'),
  reorderLocalEntities: (entityType, entityIds, containerId) => (
    ipcRenderer.invoke('local-entity:reorder', entityType, entityIds, containerId)
  ),
  restoreKnowledgeWebGraph: (webId, snapshot) => (
    ipcRenderer.invoke('local-entity:restore-knowledge-web-graph', webId, snapshot)
  ),
  saveLocalImage: (payload) => ipcRenderer.invoke('local-media:save-image', payload),
  saveCourseProgress: (courseId, lessonId, progress) => (
    ipcRenderer.invoke('courses:save-progress', courseId, lessonId, progress)
  ),
  unlockPrivacyAutomatically: () => ipcRenderer.invoke('privacy:unlock-automatic'),
  unlockPrivacyWithPin: (pin) => ipcRenderer.invoke('privacy:unlock-pin', pin),
  unlockPrivacyWithRecoveryCode: (recoveryCode) => ipcRenderer.invoke('privacy:unlock-recovery', recoveryCode),
  updateLocalEntity: (entityType, entityId, patch) => ipcRenderer.invoke('local-entity:update', entityType, entityId, patch),
  updateLocalOwner: (patch) => ipcRenderer.invoke('local-owner:update', patch),
});

contextBridge.exposeInMainWorld('bexDesktop', desktopApi);
