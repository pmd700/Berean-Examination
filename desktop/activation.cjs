'use strict';

const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const REQUEST_CODE_VERSION = 1;
const REQUEST_CODE_PREFIX = `BEX-REQ-${REQUEST_CODE_VERSION}`;
const REQUEST_CODE_DOMAIN = 'com.bereanexamination.desktop.activation';
const ACTIVATION_CODE_VERSION = 1;
const ACTIVATION_CODE_PREFIX = `BEX-ACT-${ACTIVATION_CODE_VERSION}`;
const ACTIVATION_PRODUCT = 'bex-launcher-official';
const MAX_ACTIVATION_CODE_LENGTH = 4096;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const SIGNING_KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const REQUEST_CODE_PATTERN = /^BEX-REQ-1\.[A-Za-z0-9_-]{43}$/;
const ACTIVATION_PAYLOAD_FIELDS = Object.freeze(['issuedAt', 'keyId', 'product', 'requestCode', 'version']);
const MAC_MACHINE_ID_COMMAND = '/usr/sbin/ioreg';
const MAC_MACHINE_ID_PATTERN = /"IOPlatformUUID"\s*=\s*"([^"]+)"/;
const MAC_UUID_PATTERN = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;
const EMPTY_MAC_UUID = '00000000-0000-0000-0000-000000000000';

function normalizeMachineIdentifier(identifier) {
  if (typeof identifier !== 'string') {
    throw new Error('BEX could not read a valid machine identifier.');
  }

  const normalized = identifier.trim().toUpperCase();
  if (!MAC_UUID_PATTERN.test(normalized) || normalized === EMPTY_MAC_UUID) {
    throw new Error('BEX could not read a valid machine identifier.');
  }
  return normalized;
}

function readMacMachineIdentifier() {
  if (process.platform !== 'darwin') {
    throw new Error('Machine request codes are currently available only on macOS.');
  }

  let output;
  try {
    output = execFileSync(
      MAC_MACHINE_ID_COMMAND,
      ['-rd1', '-c', 'IOPlatformExpertDevice'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      },
    );
  } catch {
    throw new Error('BEX could not read this Mac\'s machine identifier.');
  }

  const match = MAC_MACHINE_ID_PATTERN.exec(output);
  return normalizeMachineIdentifier(match?.[1]);
}

function createMachineRequest() {
  const machineIdentifier = readMacMachineIdentifier();
  const machineBinding = crypto
    .createHash('sha256')
    .update(REQUEST_CODE_DOMAIN, 'utf8')
    .update('\0', 'utf8')
    .update(String(REQUEST_CODE_VERSION), 'utf8')
    .update('\0', 'utf8')
    .update(machineIdentifier, 'utf8')
    .digest();

  return Object.freeze({
    verificationVersion: REQUEST_CODE_VERSION,
    requestCode: `${REQUEST_CODE_PREFIX}.${machineBinding.toString('base64url')}`,
    machineBindingHash: machineBinding.toString('hex'),
  });
}

function activationError(message = 'Activation code is invalid.') {
  const error = new Error(message);
  error.code = 'BEX_ACTIVATION_INVALID';
  return error;
}

function decodeBase64Url(value) {
  if (typeof value !== 'string' || !BASE64URL_PATTERN.test(value)) {
    throw activationError();
  }

  const decoded = Buffer.from(value, 'base64url');
  if (!decoded.length || decoded.toString('base64url') !== value) {
    throw activationError();
  }
  return decoded;
}

function parseActivationCode(activationCode) {
  if (typeof activationCode !== 'string') throw activationError();
  const normalizedCode = activationCode.trim();
  if (!normalizedCode || normalizedCode.length > MAX_ACTIVATION_CODE_LENGTH) {
    throw activationError();
  }

  const parts = normalizedCode.split('.');
  if (parts.length !== 3 || parts[0] !== ACTIVATION_CODE_PREFIX) {
    throw activationError();
  }

  const payloadBytes = decodeBase64Url(parts[1]);
  const signature = decodeBase64Url(parts[2]);
  if (payloadBytes.length > 2048 || signature.length !== 64) {
    throw activationError();
  }

  let payload;
  try {
    payload = JSON.parse(payloadBytes.toString('utf8'));
  } catch {
    throw activationError();
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw activationError();
  }
  const fields = Object.keys(payload).sort();
  if (JSON.stringify(fields) !== JSON.stringify(ACTIVATION_PAYLOAD_FIELDS)) {
    throw activationError();
  }
  if (
    payload.version !== ACTIVATION_CODE_VERSION
    || payload.product !== ACTIVATION_PRODUCT
    || typeof payload.keyId !== 'string'
    || !SIGNING_KEY_ID_PATTERN.test(payload.keyId)
    || typeof payload.requestCode !== 'string'
    || !REQUEST_CODE_PATTERN.test(payload.requestCode)
    || typeof payload.issuedAt !== 'string'
    || payload.issuedAt.length > 64
  ) {
    throw activationError();
  }

  const issuedAt = new Date(payload.issuedAt);
  if (Number.isNaN(issuedAt.getTime()) || issuedAt.toISOString() !== payload.issuedAt) {
    throw activationError();
  }

  return { normalizedCode, payload, payloadBytes, signature };
}

function getTrustedPublicKey(keyId, trustedPublicKeys) {
  const hasKey = trustedPublicKeys
    && typeof trustedPublicKeys === 'object'
    && !Array.isArray(trustedPublicKeys)
    && Object.prototype.hasOwnProperty.call(trustedPublicKeys, keyId);
  if (!hasKey) {
    throw activationError('This activation code uses an unknown BEX verification key.');
  }

  const publicKeyPem = trustedPublicKeys[keyId];
  if (
    typeof publicKeyPem !== 'string'
    || !publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----')
    || !publicKeyPem.trimEnd().endsWith('-----END PUBLIC KEY-----')
  ) {
    throw new Error('BEX activation verification is not configured correctly.');
  }

  let publicKey;
  try {
    publicKey = crypto.createPublicKey(publicKeyPem);
  } catch {
    throw new Error('BEX activation verification is not configured correctly.');
  }
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('BEX activation verification is not configured correctly.');
  }
  return publicKey;
}

function verifyActivationCode(activationCode, trustedPublicKeys) {
  const parsed = parseActivationCode(activationCode);
  const publicKey = getTrustedPublicKey(parsed.payload.keyId, trustedPublicKeys);
  const signatureIsValid = crypto.verify(
    null,
    parsed.payloadBytes,
    publicKey,
    parsed.signature,
  );
  if (!signatureIsValid) throw activationError();

  const machineRequest = createMachineRequest();
  if (parsed.payload.requestCode !== machineRequest.requestCode) {
    const error = new Error('This activation code was created for a different computer.');
    error.code = 'BEX_ACTIVATION_WRONG_MACHINE';
    throw error;
  }

  return Object.freeze({
    verificationVersion: parsed.payload.version,
    requestCode: machineRequest.requestCode,
    machineBindingHash: machineRequest.machineBindingHash,
    signedActivation: parsed.normalizedCode,
    signingKeyId: parsed.payload.keyId,
    issuedAt: parsed.payload.issuedAt,
  });
}

module.exports = {
  createMachineRequest,
  verifyActivationCode,
};
