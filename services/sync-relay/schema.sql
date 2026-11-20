PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS libraries (id TEXT PRIMARY KEY, epoch TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS devices (vault_id TEXT NOT NULL REFERENCES libraries(id), id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('owner','device')), slot INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(vault_id,id), UNIQUE(vault_id,slot));
CREATE TABLE IF NOT EXISTS invitations (ticket TEXT PRIMARY KEY, vault_id TEXT NOT NULL REFERENCES libraries(id), proof_hash TEXT NOT NULL, bundle TEXT NOT NULL, expires INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS operations (cursor INTEGER PRIMARY KEY AUTOINCREMENT, vault_id TEXT NOT NULL REFERENCES libraries(id), id TEXT NOT NULL, digest TEXT NOT NULL, descriptor TEXT NOT NULL, UNIQUE(vault_id,id));
CREATE INDEX IF NOT EXISTS operations_pull ON operations(vault_id,cursor);
CREATE TABLE IF NOT EXISTS capacity (id INTEGER PRIMARY KEY CHECK(id=1), bytes INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO capacity VALUES(1,0);
CREATE TRIGGER IF NOT EXISTS operations_capacity BEFORE INSERT ON operations WHEN NOT EXISTS(SELECT 1 FROM operations WHERE vault_id=NEW.vault_id AND id=NEW.id) BEGIN
 SELECT CASE WHEN (SELECT bytes FROM capacity WHERE id=1)+length(NEW.descriptor)>400000000 THEN RAISE(ABORT,'BEX_CAPACITY') END;
 UPDATE capacity SET bytes=bytes+length(NEW.descriptor) WHERE id=1;
END;
CREATE TABLE IF NOT EXISTS blobs (vault_id TEXT NOT NULL, hash TEXT NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY(vault_id,hash));
CREATE TRIGGER IF NOT EXISTS blobs_capacity BEFORE INSERT ON blobs WHEN NOT EXISTS(SELECT 1 FROM blobs WHERE vault_id=NEW.vault_id AND hash=NEW.hash) BEGIN
 SELECT CASE WHEN (SELECT bytes FROM capacity WHERE id=1)+length(NEW.bytes)>400000000 THEN RAISE(ABORT,'BEX_CAPACITY') END;
 UPDATE capacity SET bytes=bytes+length(NEW.bytes) WHERE id=1;
END;
CREATE TABLE IF NOT EXISTS scripture_budget (vault_id TEXT NOT NULL, month TEXT NOT NULL, used INTEGER NOT NULL, PRIMARY KEY(vault_id,month));
CREATE TABLE IF NOT EXISTS scripture_views (vault_id TEXT NOT NULL, device_id TEXT NOT NULL, id TEXT NOT NULL, delivered INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(vault_id,device_id,id));
CREATE TABLE IF NOT EXISTS receipts (vault_id TEXT NOT NULL, device_id TEXT NOT NULL, envelope TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(vault_id,device_id));
