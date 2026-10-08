'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { TRUSTED_COURSE_PUBLIC_KEYS } = require('./course-public-key.cjs');

const SIGNER_PATH = path.resolve(__dirname, '../tools/bex-course-signer/BEXCourseSigner');

function decodeSignature(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64url');
  return bytes.length === 64 && bytes.toString('base64url') === value ? bytes : null;
}

function verifyCourseManifestSignature({ canonicalJson, signature }, trustedKeys = TRUSTED_COURSE_PUBLIC_KEYS) {
  if (
    typeof canonicalJson !== 'string'
    || !signature
    || signature.algorithm !== 'ed25519'
    || typeof signature.keyId !== 'string'
    || !Object.prototype.hasOwnProperty.call(trustedKeys, signature.keyId)
  ) return false;
  const signatureBytes = decodeSignature(signature.value);
  if (!signatureBytes) return false;
  try {
    const publicKey = crypto.createPublicKey(trustedKeys[signature.keyId]);
    return publicKey.asymmetricKeyType === 'ed25519'
      && crypto.verify(null, Buffer.from(canonicalJson, 'utf8'), publicKey, signatureBytes);
  } catch {
    return false;
  }
}

function signCourseDocumentWithKeychain(canonicalJson, command, signerPath = SIGNER_PATH) {
  if (typeof canonicalJson !== 'string' || !canonicalJson.length) {
    throw new TypeError('Course Studio needs one canonical manifest to sign.');
  }
  const result = spawnSync(signerPath, [command], {
    encoding: 'utf8',
    input: canonicalJson,
    maxBuffer: 1024 * 1024,
    timeout: 30000,
  });
  if (result.status !== 0) {
    const error = new Error((result.stderr || 'The Course publishing key could not sign this package.').trim());
    error.code = 'BEX_STUDIO_SIGNING_FAILED';
    throw error;
  }
  const lines = result.stdout.trim().split(/\r?\n/);
  const keyId = lines.find((line) => line.startsWith('KEY_ID='))?.slice(7);
  const value = lines.find((line) => line.startsWith('SIGNATURE='))?.slice(10);
  const signature = { algorithm: 'ed25519', keyId, value };
  if (!verifyCourseManifestSignature({ canonicalJson, signature })) {
    const error = new Error('Course Studio produced a signature BEX could not verify. Nothing was exported.');
    error.code = 'BEX_STUDIO_SIGNING_FAILED';
    throw error;
  }
  return signature;
}

function signCourseManifestWithKeychain(canonicalJson, signerPath = SIGNER_PATH) {
  return signCourseDocumentWithKeychain(canonicalJson, 'sign', signerPath);
}

function signCourseCatalogWithKeychain(canonicalJson, signerPath = SIGNER_PATH) {
  return signCourseDocumentWithKeychain(canonicalJson, 'sign-catalog', signerPath);
}

module.exports = { signCourseCatalogWithKeychain, signCourseManifestWithKeychain, verifyCourseManifestSignature };
