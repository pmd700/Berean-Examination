'use strict';
const { AUX, decodeAuxiliary, applyAuxiliary } = require('./auxiliary.cjs');
const { ENTITY_CONFIG } = require('../local-entity-store.cjs');
const DEPENDENCIES = ['OwnerProfile','PrivateRecord','CourseVersion','CourseCatalog','CourseModule','CourseAsset','CourseLesson','CourseProgressIndex','WebFolder','KnowledgeWeb','MindNote','Timegraph','Spreadsheet','BrainSource','Asset','ChapterArtCatalog','StudyChapter','Annotation','StudyCanvasObject','WebCard','CanvasObject','WebVersion','Drawing','TextHighlight','DailyActivity','Keyword','MindLink','WebConnection','StudyConnection'];
class EntitySyncAdapter {
  constructor(database, vault, store, identity, replica) { Object.assign(this, { database, vault, store, identity, replica }); }
  async drain() {
    this.vault.assertUnlocked();
    const { createOperation, recordKey } = await import('../../shared/sync/protocol.js');
    const { sealJson, operationPurpose, hashBytes } = await import('../../shared/sync/crypto.js');
    const watermark=(await this.replica.store.meta()).sequence;
    const rows = this.database.prepare('SELECT * FROM local_sync_journal WHERE sequence>? ORDER BY sequence').all(watermark);
    for (const row of rows) {
      this.vault.assertUnlocked();
      const existing = this.replica.store.database.prepare('SELECT 1 FROM replica_ops WHERE id=?').get(`${this.identity.deviceId}:${row.sequence}`);
      if (existing) continue;
      const config = ENTITY_CONFIG[row.kind];
      if (!config && row.kind !== 'VaultFile' && !AUX[row.kind]) throw new Error('Unclassified journal record kind.');
      const record = { kind: row.kind, id: String(row.record_id) };
      const payload = row.action === 'delete' ? null : AUX[row.kind] ? decodeAuxiliary(row, this.vault) : row.kind === 'VaultFile' ? this.vault.decryptValue(row.encrypted_payload, 'bex:sync:file-manifest:v1') : this.store.decodeRow(row.kind, { id: row.record_id, encrypted_payload: row.encrypted_payload, created_at: row.created_at, updated_at: row.updated_at, ...(config.scopeField ? { [config.scopeField]: this.vault.decryptValue(row.encrypted_payload, `bex:local-entity:v1:${row.kind}:${row.record_id}`)[config.scopeField] } : {}) }, { readOnly: true });
      const op = createOperation({ ...this.identity, sequence: row.sequence, record, parents: JSON.parse(row.parents), action: row.action, payload });
      let envelope = row.envelope && JSON.parse(row.envelope);
      if (!envelope) {
        const sealed = await sealJson(this.replica.key, op, operationPurpose(this.identity, op.id));
        this.vault.assertUnlocked();
        this.database.prepare('UPDATE local_sync_journal SET envelope=? WHERE sequence=? AND envelope IS NULL').run(JSON.stringify(sealed), row.sequence);
        envelope = JSON.parse(this.database.prepare('SELECT envelope FROM local_sync_journal WHERE sequence=?').get(row.sequence).envelope);
      }
      const key = await hashBytes(new TextEncoder().encode(recordKey(record)));
      for (let attempt = 0; attempt < 20; attempt++) {
        const meta = await this.replica.store.meta();
        if (await this.replica.store.commit(meta.version, { rows: [{ id: op.id, key, envelope, pending: 1 }], sequence: Math.max(meta.sequence, row.sequence) })) break;
        if (attempt === 19) throw new Error('Sync journal is busy. Retry without discarding queued work.');
      }
    }
  }
  async hasIncomingChanges() {
    const state = await this.replica.records(), known = new Set(state.operations.map(op => op.id));
    return state.records.some(record => {
      if ((!ENTITY_CONFIG[record.record.kind] && !AUX[record.record.kind]) || record.status === 'conflict') return false;
      const prior = this.database.prepare('SELECT heads FROM local_sync_heads WHERE kind=? AND record_id=?').get(record.record.kind,record.record.id);
      return (!prior || JSON.parse(prior.heads).every(head => known.has(head))) && (!prior || JSON.stringify(JSON.parse(prior.heads).sort()) !== JSON.stringify(record.versions.map(op => op.id).sort()));
    });
  }
  async apply() {
    this.vault.assertUnlocked();
    const state = await this.replica.records(), known = new Set(state.operations.map(op => op.id)), changed = [];
    const relevant = state.records.filter(record => Object.hasOwn(ENTITY_CONFIG, record.record.kind) || Object.hasOwn(AUX, record.record.kind));
    relevant.sort((a, b) => {
      const rank = record => { const index = DEPENDENCIES.indexOf(record.record.kind); return record.status === 'deleted' ? 100 - index : index; };
      return rank(a) - rank(b);
    });
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare('UPDATE local_sync_config SET suppress=1 WHERE id=1').run();
      for (const record of relevant) {
        const kind = record.record.kind, id = AUX[record.record.kind] ? record.record.id : Number(record.record.id), config = ENTITY_CONFIG[kind];
        const prior = this.database.prepare('SELECT heads FROM local_sync_heads WHERE kind=? AND record_id=?').get(kind, id);
        const heads = record.versions.map(op => op.id).sort();
        if (prior && JSON.stringify(JSON.parse(prior.heads).sort()) === JSON.stringify(heads)) continue;
        if (prior && JSON.parse(prior.heads).some(head => !known.has(head))) continue; // a local edit has not drained yet
        if (record.status === 'conflict') {
          const encrypted = this.vault.encryptValue(record, 'bex:sync:conflict:v1');
          this.database.prepare('INSERT INTO local_sync_conflicts VALUES(?,?) ON CONFLICT(record_key) DO UPDATE SET encrypted_versions=excluded.encrypted_versions').run(record.key, encrypted);
          continue;
        }
        if (AUX[kind]) {
          applyAuxiliary(this.database, this.vault, record);
          changed.push({ entityType: kind, id, operation: record.status === 'deleted' ? 'delete' : 'update' });
        } else if (record.status === 'deleted') {
          this.database.prepare(`DELETE FROM ${config.table} WHERE id=?`).run(id);
          changed.push({ entityType: kind, id, operation: 'delete' });
        } else {
          const value = this.store.applySyncPut(kind, record.versions[0].payload);
          changed.push({ entityType: kind, id, operation: 'update', record: value });
        }
        this.database.prepare('INSERT INTO local_sync_heads VALUES(?,?,?) ON CONFLICT(kind,record_id) DO UPDATE SET heads=excluded.heads').run(kind, id, JSON.stringify(heads));
        this.database.prepare('DELETE FROM local_sync_conflicts WHERE record_key=?').run(record.key);
      }
      this.database.prepare('UPDATE local_sync_config SET suppress=0 WHERE id=1').run();
      this.database.exec('COMMIT'); return changed;
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
}
module.exports = { EntitySyncAdapter };
