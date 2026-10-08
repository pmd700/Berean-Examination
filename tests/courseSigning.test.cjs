'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { TRUSTED_COURSE_PUBLIC_KEYS } = require('../desktop/course-public-key.cjs');
const { verifyCourseManifestSignature } = require('../desktop/course-signing.cjs');

test('BEX Course public key is Ed25519 and contains no private material', () => {
  const pem = TRUSTED_COURSE_PUBLIC_KEYS['david-course-ed25519-v1'];
  const key = crypto.createPublicKey(pem);
  assert.equal(key.asymmetricKeyType, 'ed25519');
  assert.doesNotMatch(pem, /PRIVATE KEY/);
});

test('Course verification accepts the exact signed manifest and rejects alterations', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const canonicalJson = '{"courseId":"course-proof","format":"bex-course"}';
  const signature = {
    algorithm: 'ed25519',
    keyId: 'proof-key',
    value: crypto.sign(null, Buffer.from(canonicalJson), privateKey).toString('base64url'),
  };
  const keys = { 'proof-key': publicKey.export({ format: 'pem', type: 'spki' }).toString() };
  assert.equal(verifyCourseManifestSignature({ canonicalJson, signature }, keys), true);
  assert.equal(verifyCourseManifestSignature({ canonicalJson: canonicalJson + ' ', signature }, keys), false);
  assert.equal(verifyCourseManifestSignature({ canonicalJson, signature: { ...signature, keyId: 'unknown-key' } }, keys), false);
  const altered = signature.value.slice(0, -1) + (signature.value.endsWith('A') ? 'B' : 'A');
  assert.equal(verifyCourseManifestSignature({ canonicalJson, signature: { ...signature, value: altered } }, keys), false);
});
