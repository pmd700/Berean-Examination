'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, safeStorage } = require('electron');
const {
  createSafeStorageProtector,
  PrivacyVault,
} = require('./privacy-vault.cjs');
const {
  CURRENT_SCHEMA_VERSION,
  closeDatabase,
  initializeDatabase,
  lockPrivacyVault,
  readPrivateRecord,
  savePrivateRecord,
  unlockPrivacyAutomatically: unlockIntegratedPrivacy,
} = require('./database.cjs');

const APP_NAME = 'BEX Launcher Official';
const RECORD_ID = 'harmless-privacy-proof';
const RECORD_TYPE = 'test-only';
const RECORD_MARKER = 'HARMLESS-BEX-PRIVATE-RECORD-PLAINTEXT';
const TEST_PIN = '482915';
const NEW_TEST_PIN = '731604';
const WRONG_PIN = '000000';
const EXPECTED_WRONG_PIN_DELAYS = [
  0,
  0,
  0,
  0,
  60 * 1000,
  10 * 60 * 1000,
  0,
  60 * 60 * 1000,
  24 * 60 * 60 * 1000,
  12 * 60 * 60 * 1000,
];
const TEST_RECORD = Object.freeze({
  message: RECORD_MARKER,
  purpose: 'Disposable encryption proof; not real study data.',
  sequence: 1,
});
const LIBRARY_FOLDERS = ['Database', 'Courses', 'Media', 'Imports', 'Exports', 'Backups'];

function assertThrowsCode(action, code) {
  let caught;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `Expected ${code} to be thrown.`);
  assert.equal(caught.code, code);
  return caught;
}

function assertPlaintextAbsent(filePath, secrets = []) {
  const fileBytes = fs.readFileSync(filePath);
  for (const secret of [RECORD_MARKER, TEST_PIN, NEW_TEST_PIN, ...secrets]) {
    assert.equal(
      fileBytes.includes(Buffer.from(secret, 'utf8')),
      false,
      `The SQLite file exposed a plaintext test secret: ${secret.slice(0, 12)}...`,
    );
  }
}

function runCreatePhase(databasePath, protector) {
  const { vault, created } = PrivacyVault.open({ databasePath, protector });
  assert.equal(created, true);
  assert.equal(vault.getProtectionMode(), 'automatic');
  assert.equal(vault.isLocked(), false);

  vault.saveRecord(RECORD_ID, RECORD_TYPE, TEST_RECORD);
  assert.deepEqual(vault.readRecord(RECORD_ID), TEST_RECORD);
  assert.equal(vault.countRecords(), 1);

  vault.lock();
  assert.equal(vault.isLocked(), true);
  assertThrowsCode(() => vault.readRecord(RECORD_ID), 'BEX_PRIVACY_LOCKED');
  vault.unlockAutomatically();
  assert.deepEqual(vault.readRecord(RECORD_ID), TEST_RECORD);
  vault.close();

  assertPlaintextAbsent(databasePath);
  return [
    'encrypted save and read',
    'memory lock blocks private reads',
    'macOS protected storage automatically unlocks without a PIN',
    'SQLite file contains no plaintext test record or PIN',
  ];
}

async function runVerifyPhase(databasePath, backupPath, protector) {
  let fakeNow = Date.UTC(2026, 6, 23, 12, 0, 0);
  const now = () => fakeNow;
  const { vault, created } = PrivacyVault.open({ databasePath, protector, now });
  assert.equal(created, false);
  assert.equal(vault.isLocked(), true);
  vault.unlockAutomatically();
  assert.deepEqual(vault.readRecord(RECORD_ID), TEST_RECORD);

  const originalFingerprint = vault.getRecordCiphertextFingerprint(RECORD_ID);
  const oldRecoveryCode = vault.enablePin(TEST_PIN);
  assert.equal(vault.getProtectionMode(), 'pin');
  assert.equal(vault.getRecordCiphertextFingerprint(RECORD_ID), originalFingerprint);
  vault.lock();
  assertThrowsCode(() => vault.readRecord(RECORD_ID), 'BEX_PRIVACY_LOCKED');
  assertThrowsCode(() => vault.unlockAutomatically(), 'BEX_PIN_REQUIRED');

  for (let index = 0; index < EXPECTED_WRONG_PIN_DELAYS.length; index += 1) {
    if (index > 0) fakeNow += EXPECTED_WRONG_PIN_DELAYS[index - 1];
    const error = assertThrowsCode(() => vault.unlockWithPin(WRONG_PIN), 'BEX_WRONG_PIN');
    assert.equal(error.attempts, index + 1);
    assert.equal(error.delayMs, EXPECTED_WRONG_PIN_DELAYS[index]);
    assert.equal(vault.countRecords(), 1);
  }

  assertThrowsCode(() => vault.unlockWithPin(TEST_PIN), 'BEX_PIN_DELAY');
  fakeNow += EXPECTED_WRONG_PIN_DELAYS[9];
  const resetAttempt = assertThrowsCode(() => vault.unlockWithPin(WRONG_PIN), 'BEX_WRONG_PIN');
  assert.equal(resetAttempt.attempts, 1);
  assert.equal(resetAttempt.delayMs, 0);

  vault.unlockWithPin(TEST_PIN);
  assert.deepEqual(vault.readRecord(RECORD_ID), TEST_RECORD);
  assert.deepEqual(vault.getPinAttemptState(), { attempts: 0, retryAfterMs: 0 });

  const replacementRecoveryCode = vault.replaceRecoveryCode();
  assert.notEqual(replacementRecoveryCode, oldRecoveryCode);
  vault.lock();
  assertThrowsCode(
    () => vault.unlockWithRecoveryCode(oldRecoveryCode),
    'BEX_WRONG_RECOVERY_CODE',
  );
  vault.unlockWithRecoveryCode(replacementRecoveryCode);
  assert.deepEqual(vault.readRecord(RECORD_ID), TEST_RECORD);

  vault.changePin(NEW_TEST_PIN);
  assert.equal(vault.getRecordCiphertextFingerprint(RECORD_ID), originalFingerprint);
  vault.lock();
  assertThrowsCode(() => vault.unlockWithPin(TEST_PIN), 'BEX_WRONG_PIN');
  vault.unlockWithPin(NEW_TEST_PIN);
  assert.deepEqual(vault.readRecord(RECORD_ID), TEST_RECORD);

  await vault.createEncryptedBackup(backupPath);
  assertPlaintextAbsent(backupPath, [oldRecoveryCode, replacementRecoveryCode]);
  const backupOpen = PrivacyVault.open({ databasePath: backupPath, protector, now });
  assert.equal(backupOpen.created, false);
  assert.equal(backupOpen.vault.isLocked(), true);
  assertThrowsCode(() => backupOpen.vault.unlockAutomatically(), 'BEX_PIN_REQUIRED');
  backupOpen.vault.unlockWithPin(NEW_TEST_PIN);
  assert.deepEqual(backupOpen.vault.readRecord(RECORD_ID), TEST_RECORD);
  backupOpen.vault.close();

  vault.disablePin();
  assert.equal(vault.getProtectionMode(), 'automatic');
  assert.equal(vault.getRecordCiphertextFingerprint(RECORD_ID), originalFingerprint);
  vault.lock();
  vault.unlockAutomatically();
  assert.deepEqual(vault.readRecord(RECORD_ID), TEST_RECORD);
  vault.close();

  assertPlaintextAbsent(databasePath, [oldRecoveryCode, replacementRecoveryCode]);
  return [
    'new Electron process reopens and unlocks the same encrypted record',
    'enabling a PIN re-protects the same library key',
    'approved wrong-PIN delays and tenth-attempt reset',
    'wrong attempts never remove the encrypted record',
    'replacement recovery code invalidates the previous code',
    'replacement recovery code unlocks the library',
    'changing the PIN leaves record ciphertext unchanged',
    'backup contains no plaintext and requires the PIN',
    'removing the PIN restores protected automatic unlock without re-encrypting data',
  ];
}

function runIntegratedPhase(databasePath, protector) {
  const libraryPath = path.join(path.dirname(databasePath), 'Integrated Berean Library');
  for (const folderName of LIBRARY_FOLDERS) {
    fs.mkdirSync(path.join(libraryPath, folderName), { recursive: true });
  }

  try {
    const firstOpen = initializeDatabase(libraryPath, { privacyProtector: protector });
    assert.equal(firstOpen.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.equal(firstOpen.privacy.created, true);
    assert.equal(firstOpen.privacy.mode, 'automatic');
    assert.equal(firstOpen.privacy.locked, false);

    savePrivateRecord(RECORD_ID, RECORD_TYPE, TEST_RECORD);
    assert.deepEqual(readPrivateRecord(RECORD_ID), TEST_RECORD);
    lockPrivacyVault();
    assertThrowsCode(() => readPrivateRecord(RECORD_ID), 'BEX_PRIVACY_LOCKED');
    unlockIntegratedPrivacy();
    assert.deepEqual(readPrivateRecord(RECORD_ID), TEST_RECORD);
    closeDatabase();

    const realDatabasePath = path.join(libraryPath, 'Database', 'berean.db');
    assertPlaintextAbsent(realDatabasePath);

    const restartOpen = initializeDatabase(libraryPath, { privacyProtector: protector });
    assert.equal(restartOpen.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.equal(restartOpen.privacy.created, false);
    assert.equal(restartOpen.privacy.locked, false);
    assert.deepEqual(readPrivateRecord(RECORD_ID), TEST_RECORD);
    closeDatabase();
  } finally {
    closeDatabase();
  }

  return [
    `real Berean database reaches schema version ${CURRENT_SCHEMA_VERSION}`,
    'production vault saves only encrypted private-record bytes',
    'production lock blocks reads and automatic unlock restores them',
    'production database restart reopens the same protected library key',
  ];
}

async function main() {
  const phase = process.argv[2];
  const databasePath = path.resolve(process.argv[3] || '');
  const backupPath = process.argv[4] ? path.resolve(process.argv[4]) : null;
  assert.ok(
    phase === 'create' || phase === 'verify' || phase === 'integrated',
    'Unknown privacy proof phase.',
  );
  assert.ok(databasePath, 'The privacy proof database path is required.');
  if (phase === 'verify') assert.ok(backupPath, 'The privacy proof backup path is required.');
  assert.equal(safeStorage.isEncryptionAvailable(), true, 'macOS protected storage is unavailable.');
  const protector = createSafeStorageProtector(safeStorage);
  const checks = phase === 'create'
    ? runCreatePhase(databasePath, protector)
    : phase === 'verify'
      ? await runVerifyPhase(databasePath, backupPath, protector)
      : runIntegratedPhase(databasePath, protector);
  process.stdout.write(`BEX_PRIVACY_PROOF ${JSON.stringify({ phase, checks })}\n`);
}

app.setName(APP_NAME);
if (process.platform === 'darwin' && app.dock) app.dock.hide();
app.whenReady().then(async () => {
  try {
    await main();
    app.exit(0);
  } catch (error) {
    process.stderr.write(`${error?.stack || error}\n`);
    app.exit(1);
  }
});
