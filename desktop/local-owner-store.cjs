'use strict';

const { randomUUID } = require('node:crypto');

const MAX_PREFERENCES_BYTES = 64 * 1024;
const MAX_PREFERENCE_KEYS = 256;
const PREFERENCE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const PROTECTED_OWNER_KEYS = new Set([
  'avatar_path',
  'created_at',
  'display_name',
  'email',
  'full_name',
  'id',
  'is_admin',
  'is_local_owner',
  'owner_id',
  'role',
  'updated_at',
  'username',
]);

function assertDatabase(database) {
  if (!database || typeof database.prepare !== 'function') {
    throw new TypeError('An open BEX SQLite database is required.');
  }
}

function ownerStateError(message) {
  const error = new Error(message);
  error.code = 'BEX_LOCAL_OWNER_INVALID';
  return error;
}

function readOwnerRow(database) {
  assertDatabase(database);
  const row = database.prepare([
    'SELECT',
    '  owner_id AS ownerId,',
    '  display_name AS displayName,',
    '  avatar_path AS avatarPath,',
    '  preferences_json AS preferencesJson,',
    '  created_at AS createdAt,',
    '  updated_at AS updatedAt',
    'FROM local_owner',
    'WHERE singleton_id = 1',
  ].join('\n')).get();

  if (!row) {
    throw ownerStateError('The local owner record is unavailable.');
  }
  return row;
}

function ensureLocalOwner(database) {
  assertDatabase(database);
  const existing = database.prepare('SELECT 1 FROM local_owner WHERE singleton_id = 1').get();
  if (existing) return readLocalOwnerProfile(database);

  const now = new Date().toISOString();
  database.prepare(`
    INSERT OR IGNORE INTO local_owner (
      singleton_id, owner_id, display_name, avatar_path, created_at, updated_at
    ) VALUES (1, ?, NULL, NULL, ?, ?)
  `).run(randomUUID(), now, now);

  return readLocalOwnerProfile(database);
}

function parsePreferences(serialized) {
  try {
    const preferences = JSON.parse(serialized);
    if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
      throw new Error('Preferences must be an object.');
    }
    return preferences;
  } catch {
    throw ownerStateError('The saved local owner preferences are invalid.');
  }
}

function normalizePreferencePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw ownerStateError('Local owner settings must be an object.');
  }

  const keys = Object.keys(patch);
  if (keys.length > MAX_PREFERENCE_KEYS) {
    throw ownerStateError('Too many local owner settings were submitted at once.');
  }
  for (const key of keys) {
    if (!PREFERENCE_KEY_PATTERN.test(key) || PROTECTED_OWNER_KEYS.has(key)) {
      throw ownerStateError('A protected or invalid local owner setting was rejected.');
    }
  }

  let serialized;
  try {
    serialized = JSON.stringify(patch);
  } catch {
    throw ownerStateError('Local owner settings must contain plain data.');
  }
  if (!serialized || Buffer.byteLength(serialized, 'utf8') > MAX_PREFERENCES_BYTES) {
    throw ownerStateError('Local owner settings are too large.');
  }

  return parsePreferences(serialized);
}

function toOwnerProfile(row, preferences) {
  return Object.freeze({
    ...preferences,
    avatar_path: row.avatarPath ?? null,
    created_at: row.createdAt,
    full_name: row.displayName || 'Local Owner',
    id: row.ownerId,
    is_admin: false,
    is_local_owner: true,
    owner_id: row.ownerId,
    role: 'owner',
    updated_at: row.updatedAt,
    username: 'local-owner',
  });
}

function readLocalOwnerProfile(database) {
  const row = readOwnerRow(database);
  return toOwnerProfile(row, parsePreferences(row.preferencesJson));
}

function updateLocalOwnerPreferences(database, patch) {
  const row = readOwnerRow(database);
  const current = parsePreferences(row.preferencesJson);
  const normalizedPatch = normalizePreferencePatch(patch);
  const next = { ...current, ...normalizedPatch };
  const serialized = JSON.stringify(next);

  if (
    Object.keys(next).length > MAX_PREFERENCE_KEYS
    || Buffer.byteLength(serialized, 'utf8') > MAX_PREFERENCES_BYTES
  ) {
    throw ownerStateError('The saved local owner settings would be too large.');
  }

  const updatedAt = new Date().toISOString();
  database.prepare([
    'UPDATE local_owner',
    'SET preferences_json = ?, updated_at = ?',
    'WHERE singleton_id = 1',
  ].join('\n')).run(serialized, updatedAt);

  return readLocalOwnerProfile(database);
}

module.exports = {
  ensureLocalOwner,
  readLocalOwnerProfile,
  updateLocalOwnerPreferences,
};
