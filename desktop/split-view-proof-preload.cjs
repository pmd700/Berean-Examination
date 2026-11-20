'use strict';
// Disposable renderer fixtures. Never opens the user's library or credentials.
const { contextBridge } = require('electron');
const records = {
  StudyChapter: [{ id: 1, title: 'Romans 3', book: 'Romans', chapter_number: 3, version: 'BSB', raw_text: '### God Remains Faithful\n~1 What, then, is the advantage of being a Jew? Or what is the value of circumcision?\n~2 Much in every way. First of all, they have been entrusted with the very words of God.\n~3 ' + 'Scripture remains readable while the window resizes. '.repeat(30), notes: '', context: '', application: '' }],
  MindNote: [{ id: 1, title: 'Split View research', content: '<details><summary>Gutter controls</summary><div data-type="detailsContent"><p>Hidden writing stays intact.</p></div></details><p>A note stays editable across window sizes.</p><p>' + 'LongWord'.repeat(100) + '</p>' }],
  KnowledgeWeb: [{ id: 1, title: 'Split View knowledge web', name: 'Split View knowledge web', viewport_x: 0, viewport_y: 0, viewport_zoom: 1 }],
  Timegraph: [{ id: 1, title: 'Split View timeline', events: [{ id: 'event-1', title: 'Study event', start: '2026', description: '<p>Event details remain editable.</p>' }] }],
};
// This fixture also exercises the legacy annotation popup's resize controls.
let owner = { is_local_owner: true, owner_id: 'split-view-proof', theme: 'dark', scripture_annotation_display: 'hover' };
const privacy = { locked: false, mode: 'automatic', encryption: 'AES-256-GCM', localOnly: true, pinEnabled: false };
contextBridge.exposeInMainWorld('bexDesktop', {
  isDesktop: true,
  getLibraryStatus: async () => ({ ok: true, status: { available: true } }),
  getPrivacyStatus: async () => ({ ok: true, status: privacy }),
  unlockPrivacyAutomatically: async () => ({ ok: true, status: privacy }),
  onPrivacyStatusChanged: () => () => {},
  getLocalOwner: async () => ({ ok: true, owner }),
  updateLocalOwner: async (patch) => ({ ok: true, owner: (owner = { ...owner, ...patch }) }),
  getScriptureCatalog: async () => ({ ok: true, result: { data: [{ id: 'bsb', abbreviation: 'BSB', name: 'Berean Standard Bible' }] } }),
  getScriptureCredentialStatus: async () => ({ ok: true, status: { configured: false } }),
  listLocalEntities: async (type, query) => ({ ok: true, records: (records[type] || []).filter(record => Object.entries(query?.filter || {}).every(([key, value]) => String(record[key]) === String(value))) }),
  getLocalEntity: async (type, id) => ({ ok: true, record: (records[type] || []).find(record => String(record.id) === String(id)) }),
  updateLocalEntity: async (type, id, patch) => {
    const record = (records[type] || []).find(item => String(item.id) === String(id));
    Object.assign(record, patch);
    return { ok: true, record };
  },
  createLocalEntity: async (type, patch) => {
    const record = { id: 100, ...patch };
    (records[type] ||= []).push(record);
    return { ok: true, record };
  },
});
