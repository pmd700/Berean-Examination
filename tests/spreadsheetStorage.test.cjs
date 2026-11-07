'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { deflateRawSync } = require('node:zlib');
const { applyMigrations } = require('../desktop/database.cjs');
const { PrivacyVault } = require('../desktop/privacy-vault.cjs');
const { LocalEntityStore } = require('../desktop/local-entity-store.cjs');
const { createEncryptedLocalBackup } = require('../desktop/local-backup.cjs');
const { encodeSpreadsheetPayload, decodeSpreadsheetPayload, MAX_WORKBOOK_BYTES } = require('../desktop/spreadsheet-storage.cjs');

// Substitute only OS Keychain access; real PrivacyVault authenticated encryption,
// SQLite migrations, CRUD and whole-library backup run unchanged.
function testProtector() {
  const key = crypto.randomBytes(32);
  return {
    protect(value) {
      const nonce = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
      return Buffer.concat([nonce, cipher.update(value), cipher.final(), cipher.getAuthTag()]);
    },
    unprotect(value) {
      const bytes = Buffer.from(value), decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(-16));
      return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]);
    },
  };
}
function workbook(rows = 1024) {
  const cells = {};
  for (let row = 1; row <= rows; row++) {
    cells[`A${row}`] = { v: `DISPOSABLE-PRIVATE-SOURCE-${row}`, style: { bold: true } };
    cells[`B${row}`] = { v: row };
    cells[`C${row}`] = { v: row * 2, f: `B${row}*2` };
  }
  return { version: 1, activeSheetId: 'sources', sheets: [{ id: 'sources', name: 'Sources', rowCount: rows + 100, columnCount: 26, cells, columnWidths: { 0: 240 }, rowHeights: { 0: 36 }, merges: [], freezeRows: 1, freezeColumns: 0 }] };
}
async function fixture(run) {
  const library = fs.mkdtempSync(path.join(os.tmpdir(), 'bex-spreadsheet-storage-'));
  for (const name of ['Database', 'Media', 'Backups']) fs.mkdirSync(path.join(library, name));
  const databasePath = path.join(library, 'Database', 'berean.db'), protector = testProtector();
  let database, vault;
  const open = (target = databasePath) => {
    vault?.close(); database?.close();
    database = new DatabaseSync(target);
    database.exec('PRAGMA foreign_keys = ON');
    assert.equal(applyMigrations(database), 17);
    const attached = PrivacyVault.attach({ database, databasePath: target, protector });
    vault = attached.vault;
    if (!attached.created) vault.unlockAutomatically();
    return new LocalEntityStore(database, vault);
  };
  try { return await run({ library, databasePath, protector, open, get database() { return database; }, get vault() { return vault; } }); }
  finally { vault?.close(); database?.close(); fs.rmSync(library, { recursive: true, force: true }); }
}

describe('encrypted spreadsheet storage', () => {
  it('persists 1024 source rows, formulas, styling and sizes losslessly across reopen with compressed ciphertext', () => fixture(state => {
    let store = state.open();
    const source = workbook(), created = store.create('Spreadsheet', { title: 'Evidence sources', workbook: source });
    assert.equal(created.folder_id, null);
    assert.deepEqual(store.get('Spreadsheet', created.id).workbook, source);
    const encrypted = Buffer.from(state.database.prepare('SELECT encrypted_payload FROM local_spreadsheets WHERE id = ?').get(created.id).encrypted_payload);
    const originalBytes = Buffer.byteLength(JSON.stringify(source));
    assert.ok(encrypted.length < originalBytes / 3, `${encrypted.length} encrypted bytes vs ${originalBytes} raw bytes`);
    assert.equal(encrypted.includes(Buffer.from('DISPOSABLE-PRIVATE-SOURCE')), false);
    assert.equal(state.vault.decryptValue(encrypted, `bex:local-entity:v1:Spreadsheet:${created.id}`).workbook.storage, 'bex-spreadsheet-deflate-v1');
    store.update('Spreadsheet', created.id, { title: 'Renamed evidence' });
    store = state.open();
    assert.equal(store.get('Spreadsheet', created.id).title, 'Renamed evidence');
    assert.deepEqual(store.get('Spreadsheet', created.id).workbook, source);
    console.log(`Spreadsheet fixture: ${originalBytes} raw workbook bytes -> ${encrypted.length} encrypted stored bytes`);
  }));

  it('lists only metadata but includes full workbooks in the atomic AI snapshot', () => fixture(state => {
    const store = state.open(), source = workbook();
    const item = store.create('Spreadsheet', { title: 'Sources', workbook: source });
    assert.equal(store.list('Spreadsheet')[0].workbook, undefined);
    assert.equal(store.list('Spreadsheet')[0].id, item.id);
    assert.deepEqual(store.readSnapshot(['Spreadsheet']).Spreadsheet[0].workbook, source);
    state.vault.lock();
    assert.throws(() => store.get('Spreadsheet', item.id), { code: 'BEX_PRIVACY_LOCKED' });
    assert.throws(() => store.list('Spreadsheet'), { code: 'BEX_PRIVACY_LOCKED' });
  }));

  it('includes spreadsheets in verified encrypted backups and reopens the backup with exact cell contents', () => fixture(async state => {
    const store = state.open(), source = workbook();
    const item = store.create('Spreadsheet', { title: 'Backed-up sources', workbook: source });
    const backup = await createEncryptedLocalBackup({ database: state.database, privacyVault: state.vault, libraryPath: state.library });
    const backupBytes = fs.readFileSync(backup.path);
    assert.equal(backupBytes.includes(Buffer.from('DISPOSABLE-PRIVATE-SOURCE')), false);
    const backedUpStore = state.open(backup.path);
    assert.deepEqual(backedUpStore.get('Spreadsheet', item.id).workbook, source);
  }));

  it('preserves existing records while migrating schema16 to17 and permits folder moves/reorder/root recovery', () => fixture(state => {
    let store = state.open();
    const note = store.create('MindNote', { title: 'Existing note', content: '<p>Preserve me</p>' });
    state.database.exec('DROP TABLE local_spreadsheets; DELETE FROM schema_migrations WHERE version = 17');
    assert.equal(applyMigrations(state.database), 17);
    assert.equal(store.get('MindNote', note.id).content, '<p>Preserve me</p>');
    const folder = store.create('WebFolder', { title: 'Research', category: 'spreadsheet' });
    const a = store.create('Spreadsheet', { title: 'A', workbook: workbook(2), folder_id: folder.id });
    const b = store.create('Spreadsheet', { title: 'B', workbook: workbook(2), folder_id: folder.id });
    store.reorder('Spreadsheet', [b.id, a.id], folder.id);
    assert.deepEqual(store.list('Spreadsheet', { sort: 'sort_order' }).map(item => item.id), [b.id, a.id]);
    store.delete('WebFolder', folder.id);
    assert.equal(store.get('Spreadsheet', a.id).folder_id, null);
    assert.deepEqual(store.get('Spreadsheet', a.id).workbook, workbook(2));
    store.delete('Spreadsheet', b.id);
    assert.throws(() => store.get('Spreadsheet', b.id), { code: 'BEX_ENTITY_NOT_FOUND' });
    store = state.open();
    assert.equal(store.list('Spreadsheet').length, 1);
  }));

  it('rejects malformed workbook dimensions/cells atomically and retains the prior document', () => fixture(state => {
    const store = state.open(), source = workbook(2);
    const item = store.create('Spreadsheet', { title: 'Safe', workbook: source });
    for (const patch of [
      { workbook: { sheets: [] } },
      { workbook: { ...source, sheets: [{ ...source.sheets[0], rowCount: -1 }] } },
      { workbook: { ...source, sheets: [{ ...source.sheets[0], cells: { XFE1: { v: 1 } } }] } },
      { workbook: { ...source, sheets: [{ ...source.sheets[0], cells: { A1: { v: NaN } } }] } },
      { workbook: { ...source, sheets: [{ ...source.sheets[0], cells: { A1: { f: {} } } }] } },
      { workbook: { ...source, sheets: [{ ...source.sheets[0], columnWidths: { 30: 100 } }] } },
    ]) assert.throws(() => store.update('Spreadsheet', item.id, patch), { code: 'BEX_ENTITY_INVALID' });
    assert.deepEqual(store.get('Spreadsheet', item.id).workbook, source);
  }));

  it('bounds decoded compressed storage and rejects corruption without changing unrelated entity payloads', () => {
    const payload = { title: 'Source', workbook: workbook() };
    assert.deepEqual(decodeSpreadsheetPayload(encodeSpreadsheetPayload(payload)), payload);
    for (const encoded of [
      { storage: 'bex-spreadsheet-deflate-v1', size: MAX_WORKBOOK_BYTES + 1, data: 'AAAA' },
      { storage: 'bex-spreadsheet-deflate-v1', size: 1, data: deflateRawSync(Buffer.alloc(5000)).toString('base64') },
      { storage: 'bex-spreadsheet-deflate-v1', size: 100, data: 'broken!!' },
    ]) assert.throws(() => decodeSpreadsheetPayload({ workbook: encoded }), { code: 'BEX_ENTITY_INVALID' });
    assert.deepEqual(decodeSpreadsheetPayload(payload), payload);
    assert.equal(decodeSpreadsheetPayload(encodeSpreadsheetPayload(payload), { omitWorkbook: true }).workbook, undefined);
  });

  it('retains original-package metadata, charts, dropdowns, notes, links and custom workbook fields losslessly', () => fixture(state => {
    const store = state.open(), source = workbook(3);
    Object.assign(source, {
      sourceXlsx: Buffer.from('disposable-original-xlsx-package-bytes').toString('base64'),
      hasMacros: true,
      importWarnings: ['VBA is retained without execution.'],
      charts: [{ id: 'chart-1', sheetId: 'sources', range: 'A1:C3', title: 'Evidence comparison' }],
      metadata: { provenance: 'Synthetic fixture', revision: 1 },
    });
    source.sheets[0].conditionalRules = [{ range: 'B1:C3', greaterThan: 1, color: '#164e3f' }];
    Object.assign(source.sheets[0].cells.A1, {
      note: 'Independent source notes', link: '/notes/12', choices: ['Primary', 'Secondary'], rawStyle: 2,
    });
    source.sheets.push({ ...workbook(2).sheets[0], id: 'comparison', name: 'Comparison' });
    const record = store.create('Spreadsheet', { title: 'Rich workbook', workbook: source });
    assert.deepEqual(store.get('Spreadsheet', record.id).workbook, source);
    const reopened = state.open();
    assert.deepEqual(reopened.get('Spreadsheet', record.id).workbook, source);
  }));
});
