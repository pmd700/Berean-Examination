'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
// Separate disposable/local replica database. No access to the user's Vault or
// its encryption key; the caller supplies already encrypted operations.
class SqliteReplicaStore {
  constructor(filename, identity) {
    this.database = new DatabaseSync(filename);
    this.database.exec(`PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS replica_meta (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS replica_ops (id TEXT PRIMARY KEY, record_key TEXT NOT NULL, envelope TEXT NOT NULL, pending INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS replica_ops_record ON replica_ops(record_key);
      CREATE INDEX IF NOT EXISTS replica_ops_pending ON replica_ops(pending);`);
    if (filename !== ':memory:' && process.platform !== 'win32') fs.chmodSync(filename, 0o600);
    const prior = this.database.prepare('SELECT value FROM replica_meta WHERE id=1').get();
    if (!prior) this.database.prepare('INSERT INTO replica_meta VALUES(1,?)').run(JSON.stringify({ identity, version: 0, sequence: 0, counter: 0, cursor: 0 }));
    else if (JSON.stringify(JSON.parse(prior.value).identity) !== JSON.stringify(identity)) { this.database.close(); throw new Error('Replica identity changed. Pair as a new device.'); }
  }
  meta() { return JSON.parse(this.database.prepare('SELECT value FROM replica_meta WHERE id=1').get().value); }
  decode(row) { return { id: row.id, key: row.record_key, envelope: JSON.parse(row.envelope), pending: row.pending }; }
  record(key) { return this.database.prepare('SELECT * FROM replica_ops WHERE record_key=?').all(key).map(row => this.decode(row)); }
  all() { return this.database.prepare('SELECT * FROM replica_ops').all().map(row => this.decode(row)); }
  rowsAfter(cursor=0) {
    const rows=this.database.prepare('SELECT rowid AS storage_cursor,* FROM replica_ops WHERE rowid>? ORDER BY rowid LIMIT 8').all(cursor);
    return {cursor:rows.at(-1)?.storage_cursor??cursor,hasMore:rows.length===8,rows:rows.map(row=>this.decode(row))};
  }
  pendingCount() { return Number(this.database.prepare('SELECT count(*) AS n FROM replica_ops WHERE pending=1').get().n); }
  pending(limit = 16) { return this.database.prepare('SELECT * FROM replica_ops WHERE pending=1 ORDER BY rowid LIMIT ?').all(limit).map(row => this.decode(row)); }
  commit(version, changes) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const meta = this.meta();
      if (meta.version !== version) { this.database.exec('ROLLBACK'); return false; }
      for (const row of changes.rows || []) {
        const old = this.database.prepare('SELECT * FROM replica_ops WHERE id=?').get(row.id);
        // A changed replay is checked on decrypted canonical operations before
        // commit. Fresh encryption of the same operation may use another nonce.
        if (!old) this.database.prepare('INSERT INTO replica_ops VALUES(?,?,?,?)').run(row.id, row.key, JSON.stringify(row.envelope), row.pending);
      }
      for (const id of changes.ack || []) this.database.prepare('UPDATE replica_ops SET pending=0 WHERE id=?').run(id);
      for (const field of ['sequence', 'counter', 'cursor', 'recoveryImports']) if (changes[field] !== undefined) meta[field] = changes[field];
      meta.version++;
      this.database.prepare('UPDATE replica_meta SET value=? WHERE id=1').run(JSON.stringify(meta));
      this.database.exec('COMMIT'); return true;
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
  close() { this.database.close(); }
}
module.exports = { SqliteReplicaStore };
