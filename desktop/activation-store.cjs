'use strict';

const { randomUUID } = require('node:crypto');
const { verifyActivationCode } = require('./activation.cjs');
const { TRUSTED_ACTIVATION_PUBLIC_KEYS } = require('./activation-public-key.cjs');

function assertDatabase(database) {
  if (!database || typeof database.prepare !== 'function' || typeof database.exec !== 'function') {
    throw new TypeError('An open BEX SQLite database is required.');
  }
}

function activationStateError(message) {
  const error = new Error(message);
  error.code = 'BEX_ACTIVATION_STATE_INVALID';
  return error;
}

function isExactIsoTimestamp(value) {
  if (typeof value !== 'string' || !value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function readActivationState(database) {
  assertDatabase(database);

  const activationRow = database.prepare(`
    SELECT
      verification_version AS verificationVersion,
      request_code AS requestCode,
      machine_binding_hash AS machineBindingHash,
      signed_activation AS signedActivation,
      signing_key_id AS signingKeyId,
      issued_at AS issuedAt,
      activated_at AS activatedAt
    FROM activation_record
    WHERE singleton_id = 1
  `).get();
  const ownerRow = database.prepare(`
    SELECT
      owner_id AS ownerId,
      display_name AS displayName,
      avatar_path AS avatarPath,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM local_owner
    WHERE singleton_id = 1
  `).get();

  if (!activationRow && !ownerRow) {
    return Object.freeze({ activated: false, activation: null, owner: null });
  }
  if (!activationRow || !ownerRow) {
    throw activationStateError('The local BEX activation and owner records are incomplete.');
  }

  let verified;
  try {
    verified = verifyActivationCode(
      activationRow.signedActivation,
      TRUSTED_ACTIVATION_PUBLIC_KEYS,
    );
  } catch {
    throw activationStateError('The saved BEX activation could not be verified on this computer.');
  }

  const activationMatches =
    Number(activationRow.verificationVersion) === verified.verificationVersion
    && activationRow.requestCode === verified.requestCode
    && activationRow.machineBindingHash === verified.machineBindingHash
    && activationRow.signedActivation === verified.signedActivation
    && activationRow.signingKeyId === verified.signingKeyId
    && activationRow.issuedAt === verified.issuedAt
    && isExactIsoTimestamp(activationRow.activatedAt);
  const ownerIsValid =
    typeof ownerRow.ownerId === 'string'
    && ownerRow.ownerId.length > 0
    && isExactIsoTimestamp(ownerRow.createdAt)
    && isExactIsoTimestamp(ownerRow.updatedAt);

  if (!activationMatches || !ownerIsValid) {
    throw activationStateError('The saved BEX activation or local owner record is invalid.');
  }

  return Object.freeze({
    activated: true,
    activation: Object.freeze({
      verificationVersion: verified.verificationVersion,
      requestCode: verified.requestCode,
      signingKeyId: verified.signingKeyId,
      issuedAt: verified.issuedAt,
      activatedAt: activationRow.activatedAt,
    }),
    owner: Object.freeze({
      ownerId: ownerRow.ownerId,
      displayName: ownerRow.displayName ?? null,
      avatarPath: ownerRow.avatarPath ?? null,
      createdAt: ownerRow.createdAt,
      updatedAt: ownerRow.updatedAt,
    }),
  });
}

function activateDatabase(database, activationCode) {
  const currentState = readActivationState(database);
  if (currentState.activated) return currentState;

  const verified = verifyActivationCode(
    activationCode,
    TRUSTED_ACTIVATION_PUBLIC_KEYS,
  );
  const activatedAt = new Date().toISOString();
  const ownerId = randomUUID();
  let transactionStarted = false;

  try {
    database.exec('BEGIN IMMEDIATE');
    transactionStarted = true;

    const occupied = database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM activation_record) AS activationCount,
        (SELECT COUNT(*) FROM local_owner) AS ownerCount
    `).get();
    if (Number(occupied.activationCount) !== 0 || Number(occupied.ownerCount) !== 0) {
      throw activationStateError('This BEX database already contains activation information.');
    }

    database.prepare(`
      INSERT INTO activation_record (
        singleton_id,
        verification_version,
        request_code,
        machine_binding_hash,
        signed_activation,
        signing_key_id,
        issued_at,
        activated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      verified.verificationVersion,
      verified.requestCode,
      verified.machineBindingHash,
      verified.signedActivation,
      verified.signingKeyId,
      verified.issuedAt,
      activatedAt,
    );

    database.prepare(`
      INSERT INTO local_owner (
        singleton_id, owner_id, display_name, avatar_path, created_at, updated_at
      ) VALUES (1, ?, NULL, NULL, ?, ?)
    `).run(ownerId, activatedAt, activatedAt);

    database.exec('COMMIT');
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) {
      try {
        database.exec('ROLLBACK');
      } catch {
        // Preserve the original failure.
      }
    }
    throw error;
  }

  return readActivationState(database);
}

module.exports = {
  activateDatabase,
  readActivationState,
};
