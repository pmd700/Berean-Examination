'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const { ENTITY_CONFIG } = require('../local-entity-store.cjs');
const { installEntityJournal, bootstrapEntityJournal } = require('./entity-journal.cjs');
const { EntitySyncAdapter } = require('./entity-adapter.cjs');
const { SqliteReplicaStore } = require('./replica-store.cjs');
const { FileBlobStore } = require('./blob-store.cjs');
const { VaultFileIndex } = require('./file-index.cjs');
const { applyFiles } = require('./file-apply.cjs');
const { installAuxiliaryJournal, bootstrapAuxiliaryJournal } = require('./auxiliary.cjs');
const CONFIG_ID = 'bex-device-sync-v1';
class DesktopSyncController {
  constructor({ database, privacyVault, entityStore, libraryPath, backup, cachePath = null, flushEditors = async () => {}, prepareApply = async () => {}, finishApply = async () => {}, notify = () => {} }) {
    Object.assign(this, { database, privacyVault, entityStore, libraryPath, backup, cachePath, flushEditors, prepareApply, finishApply, notify });
    this.replica = null; this.busy = null; this.lastError = ''; this.lastExchange = null;
  }
  async open() {
    this.privacyVault.assertUnlocked();
    if (this.replica) return true;
    const secrets = this.privacyVault.readRecord(CONFIG_ID);
    if (!secrets) return false;
    if (secrets.paused) return false;
    if (!this.database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='local_sync_config'").get()) return false;
    const state = this.database.prepare('SELECT enabled FROM local_sync_config WHERE id=1').get();
    if (!state?.enabled) return false;
    const { SyncReplica } = await import('../../shared/sync/replica.js');
    const { importSyncKey } = await import('../../shared/sync/crypto.js');
    const { RelayClient } = await import('../../shared/sync/relay-client.js');
    const maxJournal = this.database.prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM local_sync_journal').get().n;
    this.secrets = secrets;
    this.replicaStore = new SqliteReplicaStore(path.join(this.libraryPath, 'Database', 'sync-replica.sqlite'), secrets.identity);
    if (this.replicaStore.meta().sequence > maxJournal) { this.replicaStore.close(); this.replicaStore = null; throw new Error('This database was restored to an earlier sync checkpoint. Sync is paused to preserve newer phone changes. Use sync recovery before reconnecting.'); }
    this.replica = new SyncReplica(this.replicaStore, await importSyncKey(secrets.syncKey));
    this.relay = new RelayClient(secrets.relay, secrets.token);
    this.adapter = new EntitySyncAdapter(this.database, this.privacyVault, this.entityStore, secrets.identity, this.replica);
    installAuxiliaryJournal(this.database);
    bootstrapAuxiliaryJournal(this.database, this.privacyVault, secrets.identity);
    this.blobs = new FileBlobStore(this.cachePath || path.join(this.libraryPath, 'Database', 'sync-file-cache'));
    this.files = new VaultFileIndex(this.database, this.privacyVault, this.libraryPath, this.blobs);
    this.entityStore.syncAllocation = secrets.identity;
    return true;
  }
  async enroll(provisioning) {
    this.privacyVault.assertUnlocked();
    if (await this.open()) return this.status();
    await this.flushEditors();
    if (typeof this.backup === 'function') await this.backup();
    const { randomSecret } = await import('../../shared/sync/crypto.js');
    const { RelayClient, hexDigest } = await import('../../shared/sync/relay-client.js');
    const ids = Object.values(ENTITY_CONFIG).flatMap(config => this.database.prepare(`SELECT id FROM ${config.table}`).all().map(row => Number(row.id)));
    const slot = Math.max(0, ...ids.map(id => Math.floor(id / (2 ** 32)))) + 1;
    if (slot > 2097151) throw new Error('No safe device ID range remains.');
    const staged = this.privacyVault.readRecord(CONFIG_ID);
    const identity = staged?.identity || { vaultId: crypto.randomUUID(), epoch: crypto.randomUUID(), deviceId: crypto.randomUUID(), slot };
    const secrets = staged || { identity, token: randomSecret(), syncKey: randomSecret(), relay: provisioning.relay };
    this.privacyVault.saveRecord(CONFIG_ID, 'device_sync_credentials', secrets);
    const admin = new RelayClient(provisioning.relay, provisioning.bootstrapSecret);
    try { await admin.request('/api/libraries', { method: 'POST', body: { ...identity, tokenHash: await hexDigest(new TextEncoder().encode(secrets.token)) } }); }
    catch (error) {
      const status = await new RelayClient(secrets.relay, secrets.token).request('/api/status').catch(() => { throw error; });
      if (status.vaultId !== identity.vaultId || status.epoch !== identity.epoch || status.deviceId !== identity.deviceId) throw error;
    }
    installEntityJournal(this.database, identity);
    bootstrapEntityJournal(this.database, identity);
    this.privacyVault.saveRecord(CONFIG_ID, 'device_sync_credentials', secrets);
    await this.open();
    return this.status();
  }
  async tick() {
    if (this.busy) return this.busy;
    const operation = (async () => {
      if (!(await this.open())) return this.status();
      await this.flushEditors();
      await this.files.scan(this.replica.key, this.secrets.identity, progress => { this.fileProgress = progress; });
      await this.adapter.drain();
      const { exchangeReplica } = await import('../../shared/sync/relay-client.js');
      const { pushFileOperation } = await import('../../shared/sync/files.js');
      const result = await exchangeReplica(this.replica, this.relay, { beforePush: row => pushFileOperation(row, this.replica, this.blobs, this.relay, progress => { this.transferProgress = progress; }) });
      // A draft typed while transport was running must reach the transactional
      // journal before incoming heads can be applied over its desktop row.
      await this.flushEditors(); await this.adapter.drain();
      await applyFiles({ database: this.database, privacyVault: this.privacyVault, libraryPath: this.libraryPath, replica: this.replica, relay: this.relay, blobs: this.blobs });
      const guarded = await this.adapter.hasIncomingChanges();
      let changes;
      try {
        if (guarded) { await this.prepareApply(); await this.flushEditors(); await this.adapter.drain(); }
        changes = await this.adapter.apply();
      } finally { if (guarded) await this.finishApply(Boolean(changes?.length)); }
      if (changes.length) this.notify(changes);
      if(!this.lastReceiptCheck||Date.now()-this.lastReceiptCheck>60000){
        try{const {readReceipts}=await import('../../shared/sync/receipts.js');this.deviceReceipts=await readReceipts(this.replica,this.secrets.identity,this.relay);this.lastReceiptCheck=Date.now();}catch{/* older relays or temporary outages cannot prevent local sync */}
      }
      this.lastExchange = new Date().toISOString(); this.lastError = '';
      return { ...(await this.status()), sent: result.sent, received: result.received };
    })().catch(error => { this.lastError = error.message; throw error; }).finally(() => { this.busy = null; });
    this.busy = operation; return operation;
  }
  async invite() {
    await this.tick();
    if (!this.replica) throw new Error('Enable sync before pairing an iPhone.');
    const { createInvitation } = await import('../../shared/sync/pairing.js');
    return createInvitation(this.relay, this.secrets);
  }
  async conflicts() {
    if (!(await this.open())) return [];
    return (await this.replica.records()).records.filter(record => record.status === 'conflict');
  }
  async resolve({ record, versionId, parents }) {
    await this.open();
    const state = await this.replica.record(record), version = state?.versions.find(op => op.id === versionId);
    if (!version || state.status !== 'conflict') throw new Error('This conflict changed. Reopen it before choosing a version.');
    // Desktop operation sequence is owned by the atomic journal. Reserve the
    // resolution there instead of allocating through the phone writer.
    const { ENTITY_CONFIG } = require('../local-entity-store.cjs');
    const original = state.versions.map(op => op.id).sort();
    if (JSON.stringify(original) !== JSON.stringify([...parents].sort())) throw new Error('The conflict changed. Both versions were preserved.');
    if (!ENTITY_CONFIG[record.kind]) throw new Error('Resolve this file or auxiliary conflict on the paired iPhone.');
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare('INSERT INTO local_sync_heads VALUES(?,?,?) ON CONFLICT(kind,record_id) DO UPDATE SET heads=excluded.heads').run(record.kind,Number(record.id),JSON.stringify(original));
      if (version.action === 'delete') this.entityStore.delete(record.kind,Number(record.id));
      else this.entityStore.applySyncPut(record.kind,version.payload);
      this.database.exec('COMMIT');
    } catch(error) { this.database.exec('ROLLBACK'); throw error; }
    await this.tick(); return this.status();
  }
  async devices() { if (!(await this.open())) return []; return (await this.relay.request('/api/devices')).devices; }
  async setPaused(paused) {
    await this.flushEditors(); if(this.busy)await this.busy.catch(()=>{});
    const secrets=this.privacyVault.readRecord(CONFIG_ID);if(!secrets)throw new Error('Sync is not enrolled.');
    this.privacyVault.saveRecord(CONFIG_ID,'device_sync_credentials',{...secrets,paused:Boolean(paused)});
    // Capture stays enabled while transport is paused, so offline edits queue.
    this.close();if(!paused)void this.tick().catch(()=>{});return this.status();
  }
  async revoke(deviceId) { if (!(await this.open())) throw new Error('Sync is not enabled.'); return this.relay.request('/api/devices/revoke',{method:'POST',body:{deviceId}}); }
  async status() {
    const locked = this.privacyVault.isLocked();
    if (locked) return { enabled: false, locked: true };
    const secrets = this.privacyVault.readRecord(CONFIG_ID);
    if (!secrets) return { enabled: false, locked: false, lastError: this.lastError };
    const configured = this.database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='local_sync_config'").get();
    if (!configured || !this.database.prepare('SELECT enabled FROM local_sync_config WHERE id=1').get()?.enabled) return { enabled: false, preparing: true, locked: false, lastError: this.lastError };
    const conflicts = this.database.prepare('SELECT count(*) AS n FROM local_sync_conflicts').get().n;
    let pending;
    if(this.replicaStore)pending=this.replicaStore.pendingCount()+Number(this.database.prepare('SELECT count(*) AS n FROM local_sync_journal WHERE sequence>?').get(this.replicaStore.meta().sequence).n);
    else {
      const {DatabaseSync}=require('node:sqlite');let observer;
      try{observer=new DatabaseSync(path.join(this.libraryPath,'Database','sync-replica.sqlite'),{readOnly:true});const meta=JSON.parse(observer.prepare('SELECT value FROM replica_meta WHERE id=1').get().value);pending=Number(observer.prepare('SELECT count(*) AS n FROM replica_ops WHERE pending=1').get().n)+Number(this.database.prepare('SELECT count(*) AS n FROM local_sync_journal WHERE sequence>?').get(meta.sequence).n);}
      catch{pending=Number(this.database.prepare('SELECT count(*) AS n FROM local_sync_journal').get().n);}
      finally{observer?.close();}
    }
    return { enabled: true, paused:Boolean(secrets.paused), locked: false, deviceId: secrets.identity.deviceId, slot: secrets.identity.slot, pending, conflicts, busy: Boolean(this.busy), fileProgress: this.fileProgress, transferProgress: this.transferProgress, deviceReceipts:this.deviceReceipts||[], lastExchange: this.lastExchange, lastError: this.lastError, relay: secrets.relay };
  }
  close() {
    this.replica?.lock(); this.replica = null; this.blobs?.close(); this.replicaStore?.close(); this.replicaStore = null; this.secrets = null;
  }
}
module.exports = { DesktopSyncController, CONFIG_ID };
