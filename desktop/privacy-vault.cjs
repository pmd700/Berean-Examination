'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync, backup } = require('node:sqlite');

const DATA_KEY_BYTES = 32;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const ENCRYPTED_FORMAT_VERSION = 1;
const PIN_KEY_PURPOSE = 'bex:library-key:pin:v1';
const RECOVERY_KEY_PURPOSE = 'bex:library-key:recovery:v1';
const RECOVERY_PREFIX = 'BEX-RCV1';
const SCRYPT_OPTIONS = Object.freeze({ N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const WRONG_PIN_DELAYS_MS = Object.freeze({
  5: 60 * 1000,
  6: 10 * 60 * 1000,
  7: 0,
  8: 60 * 60 * 1000,
  9: 24 * 60 * 60 * 1000,
  10: 12 * 60 * 60 * 1000,
});
const PRIVACY_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS privacy_vault (
    singleton_id INTEGER PRIMARY KEY NOT NULL CHECK (singleton_id = 1),
    format_version INTEGER NOT NULL CHECK (format_version = 1),
    protection_mode TEXT NOT NULL CHECK (protection_mode IN ('automatic', 'pin')),
    automatic_key_envelope BLOB,
    pin_salt BLOB,
    pin_key_envelope BLOB,
    recovery_salt BLOB,
    recovery_key_envelope BLOB,
    failed_pin_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_pin_attempts BETWEEN 0 AND 10),
    pin_blocked_until_ms INTEGER NOT NULL DEFAULT 0 CHECK (pin_blocked_until_ms >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (
      (protection_mode = 'automatic' AND automatic_key_envelope IS NOT NULL
        AND pin_salt IS NULL AND pin_key_envelope IS NULL
        AND recovery_salt IS NULL AND recovery_key_envelope IS NULL)
      OR
      (protection_mode = 'pin' AND automatic_key_envelope IS NULL
        AND pin_salt IS NOT NULL AND pin_key_envelope IS NOT NULL
        AND recovery_salt IS NOT NULL AND recovery_key_envelope IS NOT NULL)
    )
  ) STRICT;

  CREATE TABLE IF NOT EXISTS private_records (
    record_id TEXT PRIMARY KEY NOT NULL CHECK (length(record_id) BETWEEN 1 AND 200),
    record_type TEXT NOT NULL CHECK (length(record_type) BETWEEN 1 AND 100),
    encrypted_payload BLOB NOT NULL CHECK (length(encrypted_payload) > 29),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
`;

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function validateDataKey(dataKey) {
  if (!Buffer.isBuffer(dataKey) || dataKey.length !== DATA_KEY_BYTES) {
    throw codedError('BEX_PRIVACY_KEY_INVALID', 'The library privacy key is invalid.');
  }
}

function validateSecret(secret, label) {
  if (typeof secret !== 'string' || secret.length < 4 || secret.length > 256) {
    throw codedError('BEX_PRIVACY_INPUT_INVALID', `${label} must contain between 4 and 256 characters.`);
  }
}

function validatePin(pin) {
  if (typeof pin !== 'string' || !/^\d{4,12}$/.test(pin)) {
    throw codedError('BEX_PRIVACY_INPUT_INVALID', 'PIN must contain 4 to 12 digits.');
  }
}

function validateRecordIdentity(recordId, recordType) {
  if (typeof recordId !== 'string' || !recordId.trim() || recordId.length > 200) {
    throw codedError('BEX_PRIVACY_RECORD_INVALID', 'The encrypted record ID is invalid.');
  }
  if (typeof recordType !== 'string' || !recordType.trim() || recordType.length > 100) {
    throw codedError('BEX_PRIVACY_RECORD_INVALID', 'The encrypted record type is invalid.');
  }
}

function encryptionPurpose(recordId, recordType) {
  return `bex:private-record:v1:${recordType}:${recordId}`;
}

function encryptBytes(key, plaintext, purpose) {
  validateDataKey(key);
  const nonce = crypto.randomBytes(NONCE_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(purpose, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([
    Buffer.from([ENCRYPTED_FORMAT_VERSION]),
    nonce,
    authTag,
    ciphertext,
  ]);
}

function decryptBytes(key, encrypted, purpose) {
  validateDataKey(key);
  const bytes = Buffer.from(encrypted || []);
  const minimumLength = 1 + NONCE_BYTES + AUTH_TAG_BYTES;
  if (bytes.length < minimumLength || bytes[0] !== ENCRYPTED_FORMAT_VERSION) {
    throw codedError('BEX_PRIVACY_DATA_INVALID', 'The encrypted library data is invalid.');
  }

  const nonceStart = 1;
  const tagStart = nonceStart + NONCE_BYTES;
  const ciphertextStart = tagStart + AUTH_TAG_BYTES;
  const nonce = bytes.subarray(nonceStart, tagStart);
  const authTag = bytes.subarray(tagStart, ciphertextStart);
  const ciphertext = bytes.subarray(ciphertextStart);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(Buffer.from(purpose, 'utf8'));
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function deriveWrappingKey(secret, salt) {
  return crypto.scryptSync(secret, Buffer.from(salt), DATA_KEY_BYTES, SCRYPT_OPTIONS);
}

function wrapDataKey(dataKey, secret, salt, purpose) {
  const wrappingKey = deriveWrappingKey(secret, salt);
  try {
    return encryptBytes(wrappingKey, dataKey, purpose);
  } finally {
    wrappingKey.fill(0);
  }
}

function unwrapDataKey(envelope, secret, salt, purpose) {
  const wrappingKey = deriveWrappingKey(secret, salt);
  try {
    const dataKey = decryptBytes(wrappingKey, envelope, purpose);
    validateDataKey(dataKey);
    return dataKey;
  } finally {
    wrappingKey.fill(0);
  }
}

function encodeBase32(bytes) {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function generateRecoveryCode() {
  const encoded = encodeBase32(crypto.randomBytes(20));
  return `${RECOVERY_PREFIX}-${encoded.match(/.{1,4}/g).join('-')}`;
}

function normalizeRecoveryCode(recoveryCode) {
  if (typeof recoveryCode !== 'string' || recoveryCode.length < 4 || recoveryCode.length > 256) {
    throw codedError('BEX_RECOVERY_CODE_INVALID', 'The recovery code format is invalid.');
  }
  const normalized = recoveryCode.toUpperCase().replace(/[\s-]/g, '');
  if (!normalized.startsWith(RECOVERY_PREFIX.replace('-', ''))) {
    throw codedError('BEX_RECOVERY_CODE_INVALID', 'The recovery code format is invalid.');
  }
  return normalized;
}

function createSafeStorageProtector(safeStorage) {
  if (!safeStorage) {
    throw codedError('BEX_PROTECTED_STORAGE_UNAVAILABLE', 'Protected system storage is unavailable.');
  }

  // On macOS every safeStorage entry point reaches into the login keychain, and
  // each reach is a separate access the OS may prompt for. Asking
  // `isEncryptionAvailable()` immediately before every encrypt/decrypt therefore
  // doubled the prompts: unlocking a library asked twice for the same key.
  //
  // A positive answer is cached for the life of the process — protected storage
  // does not stop existing while the app is running. A negative answer is not
  // cached, so a library opened before the keychain was ready still recovers.
  // Availability is re-checked only when an operation actually fails, which is
  // what turns a raw platform error back into our coded one.
  let available = null;
  const isAvailable = () => {
    if (available === true) return true;
    available = safeStorage.isEncryptionAvailable();
    return available;
  };
  const unavailable = () => codedError(
    'BEX_PROTECTED_STORAGE_UNAVAILABLE',
    'Protected system storage is unavailable.',
  );

  return Object.freeze({
    isAvailable,
    protect(dataKey) {
      validateDataKey(dataKey);
      if (!isAvailable()) throw unavailable();
      try {
        return safeStorage.encryptString(dataKey.toString('base64'));
      } catch (error) {
        available = null;
        if (!safeStorage.isEncryptionAvailable()) throw unavailable();
        throw error;
      }
    },
    unprotect(envelope) {
      if (!isAvailable()) throw unavailable();
      let plaintext;
      try {
        plaintext = safeStorage.decryptString(Buffer.from(envelope));
      } catch (error) {
        available = null;
        if (!safeStorage.isEncryptionAvailable()) throw unavailable();
        throw error;
      }
      const dataKey = Buffer.from(plaintext, 'base64');
      validateDataKey(dataKey);
      return dataKey;
    },
  });
}

function openPrivacyDatabase(databasePath) {
  if (typeof databasePath !== 'string' || !databasePath.trim()) {
    throw codedError('BEX_PRIVACY_DATABASE_INVALID', 'A privacy database path is required.');
  }
  const resolvedPath = path.resolve(databasePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const database = new DatabaseSync(resolvedPath);
  try {
    database.exec('PRAGMA foreign_keys = ON');
    database.exec('PRAGMA journal_mode = DELETE');
    database.exec('PRAGMA synchronous = FULL');
    database.exec('PRAGMA secure_delete = ON');
    database.exec('PRAGMA trusted_schema = OFF');
    database.exec(PRIVACY_SCHEMA_SQL);
    if (process.platform !== 'win32') fs.chmodSync(resolvedPath, 0o600);
    return { database, resolvedPath };
  } catch (error) {
    database.close();
    throw error;
  }
}

class PrivacyVault {
  constructor(database, databasePath, protector, now, ownsDatabase) {
    this.database = database;
    this.databasePath = databasePath;
    this.protector = protector;
    this.now = now;
    this.ownsDatabase = ownsDatabase;
    this.dataKey = null;
    this.closed = false;
  }

  static open({ databasePath, protector, now = () => Date.now() }) {
    const { database, resolvedPath } = openPrivacyDatabase(databasePath);
    try {
      return PrivacyVault.attach({
        database,
        databasePath: resolvedPath,
        now,
        ownsDatabase: true,
        protector,
      });
    } catch (error) {
      database.close();
      throw error;
    }
  }

  static attach({ database, databasePath, protector, now = () => Date.now(), ownsDatabase = false }) {
    if (!protector || typeof protector.protect !== 'function' || typeof protector.unprotect !== 'function') {
      throw codedError('BEX_PROTECTED_STORAGE_UNAVAILABLE', 'A protected-storage provider is required.');
    }
    if (!database || typeof database.prepare !== 'function') {
      throw codedError('BEX_PRIVACY_DATABASE_INVALID', 'An open SQLite database is required.');
    }
    const vault = new PrivacyVault(
      database,
      path.resolve(databasePath),
      protector,
      now,
      ownsDatabase,
    );
    const existing = vault.readVaultRow();
    if (existing) return { vault, created: false };

    const dataKey = crypto.randomBytes(DATA_KEY_BYTES);
    try {
      const automaticEnvelope = protector.protect(dataKey);
      const timestamp = new Date(now()).toISOString();
      database.prepare(`
        INSERT INTO privacy_vault (
          singleton_id, format_version, protection_mode, automatic_key_envelope,
          created_at, updated_at
        ) VALUES (1, 1, 'automatic', ?, ?, ?)
      `).run(automaticEnvelope, timestamp, timestamp);
      vault.setDataKey(dataKey);
      return { vault, created: true };
    } finally {
      dataKey.fill(0);
    }
  }

  assertOpen() {
    if (this.closed) throw codedError('BEX_PRIVACY_VAULT_CLOSED', 'The privacy vault is closed.');
  }

  readVaultRow() {
    this.assertOpen();
    return this.database.prepare('SELECT * FROM privacy_vault WHERE singleton_id = 1').get() || null;
  }

  requireDataKey() {
    this.assertOpen();
    if (!this.dataKey) throw codedError('BEX_PRIVACY_LOCKED', 'The Berean Library is locked.');
    return this.dataKey;
  }

  assertUnlocked() {
    this.requireDataKey();
  }

  encryptValue(value, purpose) {
    if (typeof purpose !== 'string' || !purpose || purpose.length > 500) {
      throw codedError('BEX_PRIVACY_PURPOSE_INVALID', 'The encryption purpose is invalid.');
    }
    let serialized;
    try {
      serialized = JSON.stringify(value);
    } catch {
      throw codedError('BEX_PRIVACY_DATA_INVALID', 'The private value could not be encoded.');
    }
    if (serialized === undefined) {
      throw codedError('BEX_PRIVACY_DATA_INVALID', 'The private value could not be encoded.');
    }
    const plaintext = Buffer.from(serialized, 'utf8');
    try {
      return encryptBytes(this.requireDataKey(), plaintext, purpose);
    } finally {
      plaintext.fill(0);
    }
  }

  encryptBinary(value, purpose) {
    if (typeof purpose !== 'string' || !purpose || purpose.length > 500) {
      throw codedError('BEX_PRIVACY_PURPOSE_INVALID', 'The encryption purpose is invalid.');
    }
    const plaintext = Buffer.from(value || []);
    try {
      return encryptBytes(this.requireDataKey(), plaintext, purpose);
    } finally {
      plaintext.fill(0);
    }
  }

  decryptValue(encrypted, purpose) {
    if (typeof purpose !== 'string' || !purpose || purpose.length > 500) {
      throw codedError('BEX_PRIVACY_PURPOSE_INVALID', 'The encryption purpose is invalid.');
    }
    const plaintext = decryptBytes(this.requireDataKey(), encrypted, purpose);
    try {
      return JSON.parse(plaintext.toString('utf8'));
    } catch {
      throw codedError('BEX_PRIVACY_DATA_INVALID', 'The private value could not be decoded.');
    } finally {
      plaintext.fill(0);
    }
  }

  decryptBinary(encrypted, purpose) {
    if (typeof purpose !== 'string' || !purpose || purpose.length > 500) {
      throw codedError('BEX_PRIVACY_PURPOSE_INVALID', 'The encryption purpose is invalid.');
    }
    return decryptBytes(this.requireDataKey(), encrypted, purpose);
  }

  setDataKey(dataKey) {
    validateDataKey(dataKey);
    this.lock();
    this.dataKey = Buffer.from(dataKey);
  }

  isLocked() {
    return !this.dataKey;
  }

  getProtectionMode() {
    const row = this.readVaultRow();
    return row?.protection_mode || null;
  }

  getStatus() {
    const row = this.readVaultRow();
    const attemptState = this.getPinAttemptState();
    return Object.freeze({
      locked: this.isLocked(),
      mode: row?.protection_mode || null,
      pinEnabled: row?.protection_mode === 'pin',
      attempts: attemptState.attempts,
      retryAfterMs: attemptState.retryAfterMs,
    });
  }

  lock() {
    if (this.dataKey) this.dataKey.fill(0);
    this.dataKey = null;
  }

  unlockAutomatically() {
    const row = this.readVaultRow();
    if (!row || row.protection_mode !== 'automatic') {
      throw codedError('BEX_PIN_REQUIRED', 'This Berean Library requires its privacy PIN.');
    }
    const dataKey = this.protector.unprotect(row.automatic_key_envelope);
    try {
      this.setDataKey(dataKey);
    } finally {
      dataKey.fill(0);
    }
  }

  unlockWithPin(pin) {
    validatePin(pin);
    let row = this.readVaultRow();
    if (!row || row.protection_mode !== 'pin') {
      throw codedError('BEX_PIN_NOT_ENABLED', 'This Berean Library does not use a privacy PIN.');
    }

    const currentTime = Number(this.now());
    if (Number(row.pin_blocked_until_ms) > currentTime) {
      throw codedError('BEX_PIN_DELAY', 'Wait before trying the PIN again.', {
        attempts: Number(row.failed_pin_attempts),
        retryAfterMs: Number(row.pin_blocked_until_ms) - currentTime,
      });
    }

    if (Number(row.failed_pin_attempts) >= 10) {
      this.resetPinFailures();
      row = this.readVaultRow();
    }

    let dataKey;
    try {
      dataKey = unwrapDataKey(row.pin_key_envelope, pin, row.pin_salt, PIN_KEY_PURPOSE);
    } catch {
      const attempts = Number(row.failed_pin_attempts) + 1;
      const delayMs = WRONG_PIN_DELAYS_MS[attempts] || 0;
      const blockedUntilMs = delayMs ? currentTime + delayMs : 0;
      this.database.prepare(`
        UPDATE privacy_vault
        SET failed_pin_attempts = ?, pin_blocked_until_ms = ?, updated_at = ?
        WHERE singleton_id = 1
      `).run(attempts, blockedUntilMs, new Date(currentTime).toISOString());
      throw codedError('BEX_WRONG_PIN', 'The privacy PIN is incorrect.', {
        attempts,
        delayMs,
        blockedUntilMs,
      });
    }

    try {
      this.setDataKey(dataKey);
      this.resetPinFailures();
    } finally {
      dataKey.fill(0);
    }
  }

  unlockWithRecoveryCode(recoveryCode) {
    const normalizedCode = normalizeRecoveryCode(recoveryCode);
    const row = this.readVaultRow();
    if (!row || row.protection_mode !== 'pin') {
      throw codedError('BEX_RECOVERY_NOT_ENABLED', 'This Berean Library has no recovery code.');
    }

    let dataKey;
    try {
      dataKey = unwrapDataKey(
        row.recovery_key_envelope,
        normalizedCode,
        row.recovery_salt,
        RECOVERY_KEY_PURPOSE,
      );
    } catch {
      throw codedError('BEX_WRONG_RECOVERY_CODE', 'The recovery code is incorrect.');
    }

    try {
      this.setDataKey(dataKey);
      this.resetPinFailures();
    } finally {
      dataKey.fill(0);
    }
  }

  resetPinFailures() {
    this.assertOpen();
    this.database.prepare(`
      UPDATE privacy_vault
      SET failed_pin_attempts = 0, pin_blocked_until_ms = 0, updated_at = ?
      WHERE singleton_id = 1
    `).run(new Date(this.now()).toISOString());
  }

  getPinAttemptState() {
    const row = this.readVaultRow();
    const currentTime = Number(this.now());
    return Object.freeze({
      attempts: Number(row?.failed_pin_attempts || 0),
      retryAfterMs: Math.max(0, Number(row?.pin_blocked_until_ms || 0) - currentTime),
    });
  }

  enablePin(pin) {
    validatePin(pin);
    const dataKey = this.requireDataKey();
    const recoveryCode = generateRecoveryCode();
    const normalizedRecoveryCode = normalizeRecoveryCode(recoveryCode);
    const pinSalt = crypto.randomBytes(SALT_BYTES);
    const recoverySalt = crypto.randomBytes(SALT_BYTES);
    const pinEnvelope = wrapDataKey(dataKey, pin, pinSalt, PIN_KEY_PURPOSE);
    const recoveryEnvelope = wrapDataKey(
      dataKey,
      normalizedRecoveryCode,
      recoverySalt,
      RECOVERY_KEY_PURPOSE,
    );
    this.database.prepare(`
      UPDATE privacy_vault
      SET protection_mode = 'pin', automatic_key_envelope = NULL,
          pin_salt = ?, pin_key_envelope = ?,
          recovery_salt = ?, recovery_key_envelope = ?,
          failed_pin_attempts = 0, pin_blocked_until_ms = 0, updated_at = ?
      WHERE singleton_id = 1
    `).run(pinSalt, pinEnvelope, recoverySalt, recoveryEnvelope, new Date(this.now()).toISOString());
    return recoveryCode;
  }

  changePin(newPin) {
    validatePin(newPin);
    const dataKey = this.requireDataKey();
    const row = this.readVaultRow();
    if (!row || row.protection_mode !== 'pin') {
      throw codedError('BEX_PIN_NOT_ENABLED', 'This Berean Library does not use a privacy PIN.');
    }
    const pinSalt = crypto.randomBytes(SALT_BYTES);
    const pinEnvelope = wrapDataKey(dataKey, newPin, pinSalt, PIN_KEY_PURPOSE);
    this.database.prepare(`
      UPDATE privacy_vault
      SET pin_salt = ?, pin_key_envelope = ?,
          failed_pin_attempts = 0, pin_blocked_until_ms = 0, updated_at = ?
      WHERE singleton_id = 1
    `).run(pinSalt, pinEnvelope, new Date(this.now()).toISOString());
  }

  replaceRecoveryCode() {
    const dataKey = this.requireDataKey();
    const row = this.readVaultRow();
    if (!row || row.protection_mode !== 'pin') {
      throw codedError('BEX_RECOVERY_NOT_ENABLED', 'This Berean Library has no recovery code.');
    }
    const recoveryCode = generateRecoveryCode();
    const normalizedCode = normalizeRecoveryCode(recoveryCode);
    const recoverySalt = crypto.randomBytes(SALT_BYTES);
    const recoveryEnvelope = wrapDataKey(
      dataKey,
      normalizedCode,
      recoverySalt,
      RECOVERY_KEY_PURPOSE,
    );
    this.database.prepare(`
      UPDATE privacy_vault
      SET recovery_salt = ?, recovery_key_envelope = ?, updated_at = ?
      WHERE singleton_id = 1
    `).run(recoverySalt, recoveryEnvelope, new Date(this.now()).toISOString());
    return recoveryCode;
  }

  disablePin() {
    const dataKey = this.requireDataKey();
    const automaticEnvelope = this.protector.protect(dataKey);
    this.database.prepare(`
      UPDATE privacy_vault
      SET protection_mode = 'automatic', automatic_key_envelope = ?,
          pin_salt = NULL, pin_key_envelope = NULL,
          recovery_salt = NULL, recovery_key_envelope = NULL,
          failed_pin_attempts = 0, pin_blocked_until_ms = 0, updated_at = ?
      WHERE singleton_id = 1
    `).run(automaticEnvelope, new Date(this.now()).toISOString());
  }

  saveRecord(recordId, recordType, value) {
    validateRecordIdentity(recordId, recordType);
    const encryptedPayload = this.encryptValue(value, encryptionPurpose(recordId, recordType));
    const timestamp = new Date(this.now()).toISOString();
    this.database.prepare(`
      INSERT INTO private_records (
        record_id, record_type, encrypted_payload, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(record_id) DO UPDATE SET
        record_type = excluded.record_type,
        encrypted_payload = excluded.encrypted_payload,
        updated_at = excluded.updated_at
    `).run(recordId, recordType, encryptedPayload, timestamp, timestamp);
  }

  readRecord(recordId) {
    if (typeof recordId !== 'string' || !recordId.trim()) {
      throw codedError('BEX_PRIVACY_RECORD_INVALID', 'The encrypted record ID is invalid.');
    }
    const row = this.database.prepare(`
      SELECT record_type, encrypted_payload
      FROM private_records
      WHERE record_id = ?
    `).get(recordId);
    if (!row) return null;
    return this.decryptValue(
      row.encrypted_payload,
      encryptionPurpose(recordId, row.record_type),
    );
  }

  getRecordCiphertextFingerprint(recordId) {
    this.assertOpen();
    const row = this.database.prepare(`
      SELECT encrypted_payload FROM private_records WHERE record_id = ?
    `).get(recordId);
    if (!row) return null;
    return crypto.createHash('sha256').update(Buffer.from(row.encrypted_payload)).digest('hex');
  }

  countRecords() {
    this.assertOpen();
    return Number(this.database.prepare('SELECT COUNT(*) AS count FROM private_records').get().count);
  }

  async createEncryptedBackup(destinationPath) {
    this.assertOpen();
    const resolvedDestination = path.resolve(destinationPath);
    if (resolvedDestination === this.databasePath) {
      throw codedError('BEX_BACKUP_PATH_INVALID', 'The backup must use a different file path.');
    }
    if (fs.existsSync(resolvedDestination)) {
      throw codedError('BEX_BACKUP_EXISTS', 'The backup file already exists.');
    }
    fs.mkdirSync(path.dirname(resolvedDestination), { recursive: true });
    await backup(this.database, resolvedDestination);
    if (process.platform !== 'win32') fs.chmodSync(resolvedDestination, 0o600);
    return resolvedDestination;
  }

  close() {
    if (this.closed) return;
    this.lock();
    if (this.ownsDatabase) this.database.close();
    this.closed = true;
  }
}

module.exports = {
  createSafeStorageProtector,
  PRIVACY_SCHEMA_SQL,
  PrivacyVault,
  WRONG_PIN_DELAYS_MS,
};
