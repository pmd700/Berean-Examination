'use strict';
const { ENTITY_CONFIG } = require('../local-entity-store.cjs');
const ID_RANGE = 2 ** 32;
function installEntityJournal(database, identity) {
  if (!/^[0-9a-f-]{36}$/.test(identity.deviceId) || !Number.isSafeInteger(identity.slot) || identity.slot < 1 || identity.slot > 2097151) throw new TypeError('Invalid journal identity.');
  database.exec(`
    CREATE TABLE IF NOT EXISTS local_sync_config (id INTEGER PRIMARY KEY CHECK(id=1), identity TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, suppress INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS local_sync_heads (kind TEXT NOT NULL, record_id INTEGER NOT NULL, heads TEXT NOT NULL, PRIMARY KEY(kind,record_id));
    CREATE TABLE IF NOT EXISTS local_sync_journal (sequence INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, record_id INTEGER NOT NULL, action TEXT NOT NULL, encrypted_payload BLOB NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, parents TEXT NOT NULL, envelope TEXT, acknowledged INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS local_sync_journal_pending ON local_sync_journal(acknowledged,sequence);
    CREATE TABLE IF NOT EXISTS local_sync_conflicts (record_key TEXT PRIMARY KEY, encrypted_versions BLOB NOT NULL);
  `);
  const prior = database.prepare('SELECT identity FROM local_sync_config WHERE id=1').get();
  if (prior && prior.identity !== JSON.stringify(identity)) throw new Error('This Vault is already enrolled as another sync device.');
  database.prepare('INSERT OR IGNORE INTO local_sync_config(id,identity) VALUES(1,?)').run(JSON.stringify(identity));
  for (const [kind, config] of Object.entries(ENTITY_CONFIG)) {
    for (const action of ['INSERT', 'UPDATE', 'DELETE']) {
      const source = action === 'DELETE' ? 'OLD' : 'NEW';
      database.exec(`CREATE TRIGGER IF NOT EXISTS sync_${config.table}_${action.toLowerCase()} AFTER ${action} ON ${config.table}
        WHEN (SELECT enabled=1 AND suppress=0 FROM local_sync_config WHERE id=1)
        BEGIN
          INSERT INTO local_sync_journal(kind,record_id,action,encrypted_payload,created_at,updated_at,parents)
          VALUES('${kind}',${source}.id,'${action === 'DELETE' ? 'delete' : 'put'}',${source}.encrypted_payload,${source}.created_at,${source}.updated_at,COALESCE((SELECT heads FROM local_sync_heads WHERE kind='${kind}' AND record_id=${source}.id),'[]'));
          INSERT INTO local_sync_heads VALUES('${kind}',${source}.id,json_array(json_extract((SELECT identity FROM local_sync_config WHERE id=1),'$.deviceId')||':'||last_insert_rowid()))
          ON CONFLICT(kind,record_id) DO UPDATE SET heads=excluded.heads;
        END;`);
    }
  }
}
function syncAllocation(database) {
  const exists = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='local_sync_config'").get();
  if (!exists) return null;
  const row = database.prepare('SELECT identity FROM local_sync_config WHERE id=1 AND enabled=1').get();
  return row ? JSON.parse(row.identity) : null;
}
function reserveDeviceIds(database, identity) {
  const start = identity.slot * ID_RANGE;
  for (const kind of Object.keys(ENTITY_CONFIG)) {
    const config = ENTITY_CONFIG[kind];
    if (database.prepare(`SELECT 1 FROM ${config.table} WHERE id>=? AND id<? LIMIT 1`).get(start, start + ID_RANGE)) throw new Error('Device ID range is already used. Reserve a different slot.');
    database.prepare('INSERT INTO local_entity_sequences(entity_type,last_id) VALUES(?,?) ON CONFLICT(entity_type) DO UPDATE SET last_id=excluded.last_id').run(kind, start);
  }
}
function bootstrapEntityJournal(database, identity) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const state = database.prepare('SELECT enabled FROM local_sync_config WHERE id=1').get();
    if (state.enabled) throw new Error('The existing enrollment must not be bootstrapped again.');
    reserveDeviceIds(database, identity);
    for (const [kind, config] of Object.entries(ENTITY_CONFIG)) {
      for (const row of database.prepare(`SELECT * FROM ${config.table} ORDER BY id`).all()) {
        const inserted = database.prepare("INSERT INTO local_sync_journal(kind,record_id,action,encrypted_payload,created_at,updated_at,parents) VALUES(?,?,'put',?,?,?,'[]')").run(kind, row.id, row.encrypted_payload, row.created_at, row.updated_at);
        database.prepare('INSERT INTO local_sync_heads VALUES(?,?,?)').run(kind, row.id, JSON.stringify([`${identity.deviceId}:${inserted.lastInsertRowid}`]));
      }
    }
    database.prepare('UPDATE local_sync_config SET enabled=1 WHERE id=1').run();
    database.exec('COMMIT');
  } catch (error) { database.exec('ROLLBACK'); throw error; }
}
module.exports = { installEntityJournal, bootstrapEntityJournal, syncAllocation, ID_RANGE };
