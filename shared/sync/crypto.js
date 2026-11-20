import { canonicalJson, syncError } from './protocol.js';
const utf8 = new TextEncoder();
export const SYNC_KEY_BYTES = 32;
export function toBase64(bytes) {
  let result = '';
  for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(result);
}
export function fromBase64(value, maximum = 48 * 1024 * 1024) {
  if (typeof value !== 'string' || value.length > 4 * Math.ceil(maximum / 3) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new TypeError('Invalid encrypted encoding.');
  const bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0));
  if (bytes.length > maximum) throw new RangeError('Encrypted payload too large.');
  return bytes;
}
export function randomSecret() { return toBase64(crypto.getRandomValues(new Uint8Array(32))); }
export async function hashBytes(bytes) { return toBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))); }
export async function importSyncKey(encoded) {
  const raw = fromBase64(encoded, 32);
  if (raw.length !== 32) throw new TypeError('A sync key must be 256 bits.');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function sealBytes(key, bytes, purpose) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(purpose), tagLength: 128 }, key, bytes);
  return { format: 1, iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}
export async function openBytes(key, envelope, purpose) {
  if (envelope?.format !== 1 || Object.keys(envelope).sort().join(',') !== 'ciphertext,format,iv') throw syncError('BEX_SYNC_CIPHER_VERSION', 'Unsupported encrypted format.');
  const iv = fromBase64(envelope.iv, 12);
  if (iv.length !== 12) throw new TypeError('Invalid encryption nonce.');
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(purpose), tagLength: 128 }, key, fromBase64(envelope.ciphertext)));
  } catch { throw syncError('BEX_SYNC_AUTH_FAILED', 'The encrypted content could not be authenticated.'); }
}
export async function sealJson(key, value, purpose) { return sealBytes(key, utf8.encode(canonicalJson(value)), purpose); }
export async function openJson(key, envelope, purpose) { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await openBytes(key, envelope, purpose))); }
export function operationPurpose(identity, id) { return `bex:sync:operation:1:${identity.vaultId}:${identity.epoch}:${id}`; }
export async function passphraseKey(passphrase, salt) {
  if (typeof passphrase !== 'string' || passphrase.length < 12 || passphrase.length > 1024) throw new TypeError('Use a passphrase of at least 12 characters.');
  const material = await crypto.subtle.importKey('raw', utf8.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function wrapDeviceSecrets(passphrase, secrets) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await passphraseKey(passphrase, salt);
  return { format: 1, salt: toBase64(salt), envelope: await sealJson(key, secrets, 'bex:sync:device-unlock:1') };
}
export async function unwrapDeviceSecrets(passphrase, wrapped) {
  if (wrapped?.format !== 1) throw new TypeError('Unsupported unlock format.');
  const salt = fromBase64(wrapped.salt, 16);
  if (salt.length !== 16) throw new TypeError('Invalid unlock salt.');
  return openJson(await passphraseKey(passphrase, salt), wrapped.envelope, 'bex:sync:device-unlock:1');
}
