// HTTP Loopback Bridge for BEX inside Antigravity's Side Pane (`127.0.0.1` only).
// Mirrors 100% of `window.bexDesktop` over authenticated `/__bex_rpc/<cmd>` calls
// and transparently rewrites `bex-media://` URLs to `/__bex_media/...`.
(function () {
  if (typeof window === 'undefined' || window.bexDesktop) return;

  var TOKEN = window.__BEX_HTTP_TOKEN__ || '';

  // Clean `?bex_token=...` from the visible URL bar without losing other query params
  try {
    var u = new URL(window.location.href);
    if (u.searchParams.has('bex_token')) {
      u.searchParams.delete('bex_token');
      var cleanPath = u.pathname === '/index.html' ? '/' : u.pathname;
      var qs = u.searchParams.toString();
      window.history.replaceState(null, '', cleanPath + (qs ? '?' + qs : '') + (u.hash || ''));
    } else if (u.pathname === '/index.html') {
      window.history.replaceState(null, '', '/' + (u.search || '') + (u.hash || ''));
    }
  } catch (e) {}

  // Support live zero-reload navigation driven by Antigravity MCP `bex_open_pane({ route })`
  window.addEventListener('message', function (ev) {
    var d = ev && ev.data;
    if (d && d.type === 'bex-navigate' && typeof d.route === 'string' && d.route.startsWith('/')) {
      try {
        if (window.location.pathname + window.location.search !== d.route) {
          window.history.pushState(null, '', d.route);
          window.dispatchEvent(new PopStateEvent('popstate'));
        }
      } catch (e) {}
    }
  });

  function rewriteMediaUrl(url) {
    if (typeof url !== 'string' || !url.startsWith('bex-media://')) return url;
    var rest = url.slice('bex-media://'.length);
    var sep = rest.indexOf('?') >= 0 ? '&' : '?';
    return '/__bex_media/' + rest + sep + 't=' + encodeURIComponent(TOKEN);
  }

  // Intercept `fetch('bex-media://...')`
  var origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    if (typeof input === 'string' && input.startsWith('bex-media://')) {
      return origFetch(rewriteMediaUrl(input), init);
    }
    if (input && typeof input === 'object' && typeof input.url === 'string' && input.url.startsWith('bex-media://')) {
      return origFetch(rewriteMediaUrl(input.url), init);
    }
    return origFetch(input, init);
  };

  // Intercept `img.src = 'bex-media://...'` / `setAttribute('src', ...)` + DOM mutations
  function patchMediaAttrs(root) {
    if (!root || !root.querySelectorAll) return;
    var els = root.querySelectorAll('img[src^="bex-media://"], video[src^="bex-media://"], audio[src^="bex-media://"], source[src^="bex-media://"]');
    for (var i = 0; i < els.length; i++) {
      var cur = els[i].getAttribute('src');
      if (cur && cur.startsWith('bex-media://')) {
        els[i].setAttribute('src', rewriteMediaUrl(cur));
      }
    }
  }
  try {
    var origSetAttr = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if ((name === 'src' || name === 'SRC') && typeof value === 'string' && value.startsWith('bex-media://')) {
        return origSetAttr.call(this, name, rewriteMediaUrl(value));
      }
      return origSetAttr.call(this, name, value);
    };
    [HTMLImageElement, HTMLMediaElement, HTMLSourceElement].forEach(function (Ctor) {
      if (!Ctor || !Ctor.prototype) return;
      var desc = Object.getOwnPropertyDescriptor(Ctor.prototype, 'src');
      if (desc && desc.set) {
        Object.defineProperty(Ctor.prototype, 'src', {
          get: desc.get,
          set: function (v) { desc.set.call(this, rewriteMediaUrl(v)); },
          configurable: true,
          enumerable: true,
        });
      }
    });
    if (typeof MutationObserver !== 'undefined') {
      var obs = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
          var m = mutations[i];
          if (m.type === 'attributes' && m.target) {
            var v = m.target.getAttribute && m.target.getAttribute('src');
            if (v && v.startsWith('bex-media://')) m.target.setAttribute('src', rewriteMediaUrl(v));
          } else if (m.addedNodes) {
            for (var j = 0; j < m.addedNodes.length; j++) {
              var n = m.addedNodes[j];
              if (n.nodeType === 1) {
                var sv = n.getAttribute && n.getAttribute('src');
                if (sv && sv.startsWith('bex-media://')) n.setAttribute('src', rewriteMediaUrl(sv));
                patchMediaAttrs(n);
              }
            }
          }
        }
      });
      if (document.documentElement) {
        obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
      }
    }
  } catch (e) {}

  function invoke(cmd, args) {
    return origFetch('/__bex_rpc/' + encodeURIComponent(cmd), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bex-Token': TOKEN,
      },
      body: JSON.stringify(args || {}),
    }).then(function (resp) {
      if (!resp.ok) throw new Error('BEX loopback RPC failed (HTTP ' + resp.status + ')');
      return resp.json();
    });
  }

  var listeners = Object.create(null);
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
    isAntigravityPane: true,

    getLibraryStatus: function () { return invoke('library_get_status'); },
    chooseLibrary: function () { return invoke('library_choose'); },

    getPrivacyStatus: function () { return invoke('privacy_get_status'); },
    unlockPrivacyAutomatically: function () { return invoke('privacy_unlock_automatic'); },
    unlockPrivacyWithPin: function (pin) { return invoke('privacy_unlock_pin', { pin: pin }); },
    unlockPrivacyWithRecoveryCode: function (recoveryCode) { return invoke('privacy_unlock_recovery', { recoveryCode: recoveryCode }); },
    enablePrivacyPin: function (pin) { return invoke('privacy_enable_pin', { pin: pin }); },
    changePrivacyPin: function (pin) { return invoke('privacy_change_pin', { pin: pin }); },
    disablePrivacyPin: function () { return invoke('privacy_disable_pin'); },
    replacePrivacyRecoveryCode: function () { return invoke('privacy_replace_recovery'); },
    onPrivacyStatusChanged: function (cb) { return subscribe('privacy:status-changed', cb); },

    getLocalOwner: function () { return invoke('local_owner_get'); },
    updateLocalOwner: function (patch) { return invoke('local_owner_update', { patch: patch }); },

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

    searchGlobalLibrary: function (query, limit) {
      return invoke('search_global_library', { query: String(query || ''), limit: limit || 60 });
    },

    exportBrainTransplant: function () { return invoke('brain_transplant_export'); },
    importBrainTransplant: function () { return invoke('brain_transplant_import'); },

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

    saveLocalImage: function (payload) {
      var safePayload = payload ? Object.assign({}, payload, { bytes: bytesToArray(payload.bytes) }) : null;
      return invoke('local_media_save_image', { payload: safePayload });
    },
    deleteLocalImage: function (mediaUrl) {
      return invoke('local_media_delete_image', { mediaUrl: mediaUrl });
    },
    importLocalFiles: function () { return invoke('local_attachments_import'); },
    openLocalFile: function (mediaUrl) { return invoke('local_attachments_open', { mediaUrl: mediaUrl }); },

    getLocalBibleChapter: function (request) { return invoke('local_bible_get_chapter', { request: request }); },
    getLocalMamChapter: function (request) { return invoke('local_mam_get_chapter', { request: request }); },

    getScriptureStatus: function () { return invoke('scripture_get_status'); },
    saveScriptureKey: function (key) { return invoke('scripture_save_key', { key: key }); },
    clearScriptureKey: function () { return invoke('scripture_clear_key'); },
    getScriptureCatalog: function (options) { return invoke('scripture_get_catalog', { options: options || {} }); },
    getScriptureBooks: function (options) { return invoke('scripture_get_books', { options: options || {} }); },
    fetchScriptureContent: function (options) { return invoke('scripture_fetch_content', { options: options || {} }); },
    searchScriptureWords: function (options) { return invoke('scripture_search_words', { options: options || {} }); },
    cancelScriptureRequest: function (requestId) { return invoke('scripture_cancel_request', { requestId: requestId }); },
    getScriptureUsage: function () { return invoke('scripture_get_usage'); },

    listCourses: function () { return invoke('courses_list'); },
    installCoursePackage: function () { return invoke('courses_install_package'); },
    connectLocalCourseCatalog: function () { return invoke('courses_connect_local_catalog'); },
    installCatalogCourse: function (courseId) { return invoke('courses_install_catalog_course', { courseId: courseId }); },
    cancelCatalogCourse: function (courseId) { return invoke('courses_cancel_catalog_course', { courseId: courseId }); },
    saveCourseProgress: function (courseId, lessonId, progress) {
      return invoke('courses_save_progress', { courseId: courseId, lessonId: lessonId, progress: progress });
    },
    onCourseDownloadProgress: function (cb) { return subscribe('courses:download-progress', cb); },

    syncStatus: function () { return invoke('sync_status'); },
    syncEnable: function () { return invoke('sync_enable'); },
    syncNow: function () { return invoke('sync_now'); },
    syncInvite: function () { return invoke('sync_invite'); },
    syncConflicts: function () { return invoke('sync_conflicts'); },
    syncResolve: function (payload) { return invoke('sync_resolve', { payload: payload }); },
    syncDevices: function () { return invoke('sync_devices'); },
    syncRevoke: function (deviceId) { return invoke('sync_revoke', { deviceId: deviceId }); },
    syncPause: function (paused) { return invoke('sync_pause', { paused: Boolean(paused) }); },

    writeClipboardText: function (text) { return invoke('clipboard_write_text', { text: String(text || '') }); },
    restartApp: function () { window.location.reload(); return Promise.resolve({ ok: true }); },
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
    checkForUpdates: function () { return Promise.resolve({ ok: true, updateAvailable: false }); },
  });

  Object.defineProperty(window, 'bexDesktop', {
    value: desktopApi,
    writable: false,
    configurable: false,
    enumerable: true,
  });
})();
