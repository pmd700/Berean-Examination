// Tauri v2 Native Rust Bridge for BEX — injected BEFORE React mounts via initialization_script.
// Implements 100% of Electron's `window.bexDesktop` API + Rust fast-path accelerators
// (`searchGlobalLibrary`, `exportBrainTransplant`, `importBrainTransplant`, `importXlsxFast`, `exportXlsxFast`).
(function () {
  if (typeof window === 'undefined' || window.bexDesktop) return;

  // Normalize `/index.html` initial path to `/` so React Router BrowserRouter opens Library Home cleanly.
  try {
    if (window.location && window.location.pathname === '/index.html') {
      window.history.replaceState(null, '', '/' + (window.location.search || '') + (window.location.hash || ''));
    }
  } catch (e) {}

  function invoke(cmd, args) {
    var internals = window.__TAURI_INTERNALS__;
    if (!internals || typeof internals.invoke !== 'function') {
      return Promise.reject(new Error('BEX native Rust bridge is not initialized.'));
    }
    return internals.invoke(cmd, args || {});
  }

  // Lightweight event pub/sub driven by Rust `window.eval("window.__bexEmitEvent(...)")`
  var listeners = Object.create(null);
  window.__bexEmitEvent = function (channel, payload) {
    var list = listeners[channel];
    if (!Array.isArray(list)) return;
    for (var i = 0; i < list.length; i++) {
      try { list[i](payload); } catch (e) { console.error('[bex-bridge] event listener error:', e); }
    }
  };
  function subscribe(channel, cb) {
    if (typeof cb !== 'function') return function () {};
    if (!listeners[channel]) listeners[channel] = [];
    listeners[channel].push(cb);
    return function () {
      var arr = listeners[channel];
      if (!arr) return;
      var idx = arr.indexOf(cb);
      if (idx >= 0) arr.splice(idx, 1);
    };
  }

  // Convert ArrayBuffer / TypedArray cleanly into number[] for serde_json
  function bytesToArray(value) {
    if (!value) return [];
    if (value instanceof Uint8Array) return Array.from(value);
    if (value instanceof ArrayBuffer) return Array.from(new Uint8Array(value));
    if (ArrayBuffer.isView(value)) {
      return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    }
    if (Array.isArray(value)) return value;
    return [];
  }

  var desktopApi = Object.freeze({
    isDesktop: true,
    isTauriRust: true,

    // ── Library & Vault ──
    getLibraryStatus: function () { return invoke('library_get_status'); },
    chooseLibrary: function () { return invoke('library_choose'); },

    // ── Privacy & Keychain ──
    getPrivacyStatus: function () { return invoke('privacy_get_status'); },
    unlockPrivacyAutomatically: function () { return invoke('privacy_unlock_automatic'); },
    unlockPrivacyWithPin: function (pin) { return invoke('privacy_unlock_pin', { pin: pin }); },
    unlockPrivacyWithRecoveryCode: function (recoveryCode) { return invoke('privacy_unlock_recovery', { recoveryCode: recoveryCode }); },
    enablePrivacyPin: function (pin) { return invoke('privacy_enable_pin', { pin: pin }); },
    changePrivacyPin: function (pin) { return invoke('privacy_change_pin', { pin: pin }); },
    disablePrivacyPin: function () { return invoke('privacy_disable_pin'); },
    replacePrivacyRecoveryCode: function () { return invoke('privacy_replace_recovery'); },
    onPrivacyStatusChanged: function (callback) { return subscribe('privacy:status-changed', callback); },

    // ── Local Owner ──
    getLocalOwner: function () { return invoke('local_owner_get'); },
    updateLocalOwner: function (patch) { return invoke('local_owner_update', { patch: patch }); },

    // ── Local Entities (Rust SQLite + In-Memory Cache + FTS5) ──
    listLocalEntities: function (entityType, query) {
      return invoke('local_entity_list', { entityType: entityType, query: query || {} });
    },
    getLocalEntity: function (entityType, entityId) {
      return invoke('local_entity_get', { entityType: entityType, entityId: entityId });
    },
    createLocalEntity: function (entityType, value) {
      return invoke('local_entity_create', { entityType: entityType, value: value });
    },
    updateLocalEntity: function (entityType, entityId, patch) {
      return invoke('local_entity_update', { entityType: entityType, entityId: entityId, patch: patch });
    },
    deleteLocalEntity: function (entityType, entityId) {
      return invoke('local_entity_delete', { entityType: entityType, entityId: entityId });
    },
    reorderLocalEntities: function (entityType, entityIds, containerId) {
      return invoke('local_entity_reorder', {
        entityType: entityType,
        entityIds: entityIds,
        containerId: containerId === undefined ? null : containerId,
      });
    },
    readLocalEntitySnapshot: function (entityTypes) {
      return invoke('local_entity_snapshot', { entityTypes: entityTypes || null });
    },
    importKnowledgeWebGraph: function (webId, importValue, options) {
      return invoke('local_entity_import_knowledge_web_graph', {
        webId: webId,
        importValue: importValue,
        options: options || {},
      });
    },
    restoreKnowledgeWebGraph: function (webId, snapshot) {
      return invoke('local_entity_restore_knowledge_web_graph', {
        webId: webId,
        snapshot: snapshot,
      });
    },

    // ── Rust FTS5 Global Search Fast-Path (< 2ms, Zero Full-Vault IPC Dump) ──
    searchGlobalLibrary: function (query, limit) {
      return invoke('search_global_library', { query: String(query || ''), limit: limit || 60 });
    },

    // ── 1-Click Brain Transplant (.bexbrain) ──
    exportBrainTransplant: function () { return invoke('brain_transplant_export'); },
    importBrainTransplant: function () { return invoke('brain_transplant_import'); },

    // ── Rust Spreadsheet XLSX Fast-Path ──
    importXlsxFast: function (bytes, fileName) {
      return invoke('sheet_import_xlsx_fast', { bytes: bytesToArray(bytes), fileName: fileName || 'workbook.xlsx' });
    },
    exportXlsxFast: function (workbook) {
      return invoke('sheet_export_xlsx_fast', { workbook: workbook }).then(function (res) {
        if (res && res.ok && Array.isArray(res.bytes)) {
          return Object.assign({}, res, { bytes: new Uint8Array(res.bytes) });
        }
        return res;
      });
    },

    // ── Local Media & Attachments ──
    saveLocalImage: function (payload) {
      var safePayload = payload ? Object.assign({}, payload, { bytes: bytesToArray(payload.bytes) }) : null;
      return invoke('local_media_save_image', { payload: safePayload });
    },
    deleteLocalImage: function (mediaUrl) {
      return invoke('local_media_delete_image', { mediaUrl: mediaUrl });
    },
    importLocalFiles: function () { return invoke('local_attachments_import'); },
    openLocalFile: function (mediaUrl) { return invoke('local_attachments_open', { mediaUrl: mediaUrl }); },

    // ── Local Bible & MAM Hebrew ──
    getLocalBibleChapter: function (request) { return invoke('local_bible_get_chapter', { request: request }); },
    getLocalMamChapter: function (request) { return invoke('local_mam_get_chapter', { request: request }); },

    // ── API.Bible Scripture Handlers ──
    getScriptureStatus: function () { return invoke('scripture_get_status'); },
    saveScriptureKey: function (key) { return invoke('scripture_save_key', { key: key }); },
    clearScriptureKey: function () { return invoke('scripture_clear_key'); },
    getScriptureCatalog: function (options) { return invoke('scripture_get_catalog', { options: options || {} }); },
    getScriptureBooks: function (options) { return invoke('scripture_get_books', { options: options || {} }); },
    fetchScriptureContent: function (options) { return invoke('scripture_fetch_content', { options: options || {} }); },
    searchScriptureWords: function (options) { return invoke('scripture_search_words', { options: options || {} }); },
    cancelScriptureRequest: function (requestId) { return invoke('scripture_cancel_request', { requestId: requestId }); },
    getScriptureUsage: function () { return invoke('scripture_get_usage'); },

    // ── Courses ──
    listCourses: function () { return invoke('courses_list'); },
    installCoursePackage: function () { return invoke('courses_install_package'); },
    connectLocalCourseCatalog: function () { return invoke('courses_connect_local_catalog'); },
    installCatalogCourse: function (courseId) { return invoke('courses_install_catalog_course', { courseId: courseId }); },
    cancelCatalogCourse: function (courseId) { return invoke('courses_cancel_catalog_course', { courseId: courseId }); },
    saveCourseProgress: function (courseId, lessonId, progress) {
      return invoke('courses_save_progress', { courseId: courseId, lessonId: lessonId, progress: progress });
    },
    onCourseDownloadProgress: function (callback) { return subscribe('courses:download-progress', callback); },

    // ── Sync ──
    syncStatus: function () { return invoke('sync_status'); },
    syncEnable: function () { return invoke('sync_enable'); },
    syncNow: function () { return invoke('sync_now'); },
    syncInvite: function () { return invoke('sync_invite'); },
    syncConflicts: function () { return invoke('sync_conflicts'); },
    syncResolve: function (payload) { return invoke('sync_resolve', { payload: payload }); },
    syncDevices: function () { return invoke('sync_devices'); },
    syncRevoke: function (deviceId) { return invoke('sync_revoke', { deviceId: deviceId }); },
    syncPause: function (paused) { return invoke('sync_pause', { paused: Boolean(paused) }); },

    // ── Exports, Clipboard, Links, Emoji & App Lifecycle ──
    writeClipboardText: function (text) { return invoke('clipboard_write_text', { text: String(text || '') }); },
    restartApp: function () { return invoke('app_restart'); },
    getNativeEmojiFont: function () { return invoke('emoji_get_native_font'); },
    openContactEmail: function () { return invoke('contact_open_email'); },
    openExternalUrl: function (targetUrl) { return invoke('external_link_open', { targetUrl: targetUrl }); },
    chooseExportFile: function (payload) { return invoke('export_choose_file', { payload: payload || {} }); },
    cancelExportFile: function (payload) { return invoke('export_cancel_selection', { payload: payload || {} }); },
    saveExportFile: function (payload) {
      var safePayload = payload ? Object.assign({}, payload, { bytes: bytesToArray(payload.bytes) }) : null;
      return invoke('export_save_file', { payload: safePayload });
    },
    renderNotePdf: function (payload) { return invoke('export_render_note_pdf', { payload: payload || {} }); },
    readPdfImage: function (payload) { return invoke('export_read_pdf_image', { payload: payload || {} }); },
    checkForUpdates: function () { return invoke('updater_check'); },
  });

  Object.defineProperty(window, 'bexDesktop', {
    value: desktopApi,
    writable: false,
    configurable: false,
    enumerable: true,
  });
})();
