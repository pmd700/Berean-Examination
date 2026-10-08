// Client-side AES-GCM encryption for "private" knowledge webs.
//
// This is an optional second encryption layer for individual private webs.
// The library database is already encrypted; this layer additionally keeps
// one web unreadable without its own passphrase.
//
// Approach (symmetric encryption, per the standard recommendation in the
// Splunk "Data Encryption Methods & Types" article):
//   1. When the user creates a private web, generate a random 16-byte salt
//      and store it with the encrypted local web record (it is not secret).
//   2. Derive a 256-bit AES key from the user's passphrase using
//      PBKDF2-SHA256 with 250 000 iterations and that salt.
//   3. Encrypt each sensitive field's JSON with AES-GCM (a fresh random
//      12-byte IV per ciphertext, ciphertext + 16-byte auth tag returned).
//   4. Store only ciphertext blobs (base64) for sensitive web fields.
//   5. Verify the passphrase on unlock by decrypting a small `enc_verifier`
//      ciphertext with a known plaintext sentinel ("ok"). Wrong passphrase
//      → AES-GCM auth-tag mismatch → decryption throws → wrong-password UI.
//
// The derived AES key stays in the app's renderer session. We cache the raw
// key bytes in sessionStorage so the owner does not have to re-enter the
// passphrase on every navigation within one app session.

const PBKDF2_ITERATIONS = 250_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const VERIFIER_PLAINTEXT = 'berean-private-web-v1';

const enc = new TextEncoder();
const dec = new TextDecoder();

// ── Base64 helpers (browser-safe, no Buffer) ─────────────────────────────
function bytesToB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── Key derivation ───────────────────────────────────────────────────────
export function generateSaltB64() {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  return bytesToB64(salt);
}

export async function deriveKey(passphrase, saltB64) {
  if (!passphrase || !saltB64) throw new Error('passphrase and salt required');
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: b64ToBytes(saltB64),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    true, // extractable so we can cache the raw bytes in sessionStorage
    ['encrypt', 'decrypt'],
  );
}

// ── Encrypt / decrypt JSON values ────────────────────────────────────────
// Output format: base64( iv (12 bytes) || ciphertext+tag ). All in one
// string for cheap storage in a single text column.
export async function encryptString(key, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plaintext),
  );
  const ctBytes = new Uint8Array(ct);
  const out = new Uint8Array(iv.length + ctBytes.length);
  out.set(iv, 0);
  out.set(ctBytes, iv.length);
  return bytesToB64(out);
}

export async function decryptString(key, b64) {
  const all = b64ToBytes(b64);
  const iv = all.slice(0, IV_BYTES);
  const ct = all.slice(IV_BYTES);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return dec.decode(pt);
}

export async function encryptJson(key, obj) {
  return encryptString(key, JSON.stringify(obj));
}

export async function decryptJson(key, b64) {
  const text = await decryptString(key, b64);
  return JSON.parse(text);
}

// ── Verifier (used to check passphrase on unlock) ────────────────────────
export async function makeVerifier(key) {
  return encryptString(key, VERIFIER_PLAINTEXT);
}

export async function checkVerifier(key, verifierB64) {
  try {
    const text = await decryptString(key, verifierB64);
    return text === VERIFIER_PLAINTEXT;
  } catch {
    return false;
  }
}

// ── Session-cached raw key bytes ─────────────────────────────────────────
// CryptoKey objects aren't structured-cloneable into sessionStorage, so we
// stash the raw 32-byte AES key (base64) and re-import it on demand.
const SESSION_KEY_PREFIX = 'brn_web_key_v1_';

export async function exportRawKeyB64(key) {
  const raw = await crypto.subtle.exportKey('raw', key);
  return bytesToB64(new Uint8Array(raw));
}

export async function importRawKeyB64(b64) {
  return crypto.subtle.importKey(
    'raw',
    b64ToBytes(b64),
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

export function storeKeyForWeb(webId, rawB64) {
  try { sessionStorage.setItem(SESSION_KEY_PREFIX + webId, rawB64); } catch {}
}
export function loadKeyForWeb(webId) {
  try { return sessionStorage.getItem(SESSION_KEY_PREFIX + webId); } catch { return null; }
}
export function clearKeyForWeb(webId) {
  try { sessionStorage.removeItem(SESSION_KEY_PREFIX + webId); } catch {}
}
export function clearAllWebKeys() {
  try {
    const toRemove = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(SESSION_KEY_PREFIX)) toRemove.push(k);
    }
    toRemove.forEach(k => sessionStorage.removeItem(k));
  } catch {}
}

// ── Active-encryption context for the entity wrapper ─────────────────────
// The desktopClient entity wrapper checks this single module-level value to
// decide whether to encrypt outgoing card/connection/object payloads and
// decrypt incoming ones. KnowledgeWeb sets it when it activates a private
// web (after a successful unlock) and clears it when navigating away or
// re-locking.
let activeEncryption = null; // { webId: number, key: CryptoKey }

export function setActiveEncryption(ctx) {
  activeEncryption = ctx && ctx.webId && ctx.key ? ctx : null;
}
export function clearActiveEncryption() { activeEncryption = null; }
export function getActiveEncryption() { return activeEncryption; }

// ── Field policy: which fields on each entity contain sensitive content ──
// Geometry / topology / IDs stay in the clear. Everything that could leak
// the user's notes, names, scripture references, sketches, link targets,
// or chosen colors goes into enc_payload.
export const PRIVATE_FIELDS = {
  WebCard: ['title', 'description', 'tags', 'scripture_refs', 'image_url', 'color', 'link_url'],
  WebConnection: ['label', 'color', 'style'],
  CanvasObject: ['content', 'title', 'color', 'image_url', 'strokes_data'],
};

// Visible placeholder we write to plaintext columns for sensitive string
// fields so the compatibility layer never carries the user's real content.
export const LOCK_PLACEHOLDER = '🔒';

// Recursively scrub the LOCK_PLACEHOLDER glyph out of a value before it
// gets baked into ciphertext. The glyph is a reserved "this row is
// encrypted" sentinel — it must never appear as real content, otherwise
// a future decrypt will surface it back into the UI as a stuck 🔒 the
// user can't edit away. The most common way this happens: a user views
// a locked private web, the card title renders the literal '🔒'
// placeholder, the user (or any save path that round-trips the visible
// title) writes '🔒' back, and now '🔒' lives inside enc_payload as
// the encrypted "real" value forever.
function stripLockGlyph(value) {
  if (value === LOCK_PLACEHOLDER) return '';
  if (Array.isArray(value)) return value.map(stripLockGlyph);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = stripLockGlyph(value[k]);
    return out;
  }
  if (typeof value === 'string' && value.includes(LOCK_PLACEHOLDER)) {
    // Substrings get stripped too — a description like
    // "🔒 my notes" should become "my notes" rather than smuggling the
    // sentinel back into ciphertext.
    return value.split(LOCK_PLACEHOLDER).join('');
  }
  return value;
}

// Encrypt the sensitive subset of a payload before local persistence.
// Returns a new object with the plaintext columns blanked out and the
// real content stored in an `enc_payload` blob. We intentionally write
// '' / null to plaintext columns instead of any visible "🔒" sentinel
// — that sentinel had a tendency to get round-tripped back through
// saves and corrupt the encrypted content. Blank columns make it
// impossible for the placeholder to ever surface in the UI again.
export async function encryptOutgoing(entityName, data) {
  const ctx = getActiveEncryption();
  if (!ctx?.key) return data;
  const fields = PRIVATE_FIELDS[entityName];
  if (!fields) return data;
  const sensitive = {};
  const out = { ...data };
  let touched = false;
  for (const f of fields) {
    if (f in data) {
      // Defensive scrub of any stale lock-glyph the caller might be
      // carrying in optimistic state from before this fix landed.
      const cleaned = stripLockGlyph(data[f]);
      sensitive[f] = cleaned;
      if (cleaned === null || cleaned === undefined) {
        // Preserve explicit nulls for the storage default.
      } else if (typeof cleaned === 'string') {
        out[f] = '';
      } else if (Array.isArray(cleaned)) {
        out[f] = [];
      } else {
        out[f] = null;
      }
      touched = true;
    }
  }
  if (!touched) return data;
  out.enc_payload = await encryptJson(ctx.key, sensitive);
  return out;
}

// Decrypt an entity row coming back from local storage. Mutates a shallow
// copy by overlaying the decrypted sensitive fields on top of the row's
// placeholder columns. If decryption fails (corrupted blob, key mismatch,
// or the row simply isn't encrypted), the row is returned unchanged so
// the UI keeps rendering rather than crashing.
export async function decryptIncoming(entityName, row) {
  const ctx = getActiveEncryption();
  return decryptIncomingWithKey(entityName, row, ctx?.key);
}

// Same as decryptIncoming but uses an EXPLICIT key instead of the module-
// global active-encryption context. This lets callers (e.g. the full Second
// Brain backup) decrypt rows from many private webs in a row WITHOUT mutating
// the shared global context — which would otherwise race with concurrent
// writes (an autosave firing mid-backup would encrypt the active web's data
// with the wrong web's key). Read-only: always returns a fresh copy, never
// writes.
export async function decryptIncomingWithKey(entityName, row, key) {
  if (!key || !row || !row.enc_payload) return row;
  const fields = PRIVATE_FIELDS[entityName];
  if (!fields) return row;
  let sensitive;
  try {
    sensitive = await decryptJson(key, row.enc_payload);
    // Strip the lock-glyph sentinel out of any decrypted value. If a
    // previous broken save round-tripped the visible '🔒' placeholder
    // back into ciphertext, we treat that value as garbage rather than
    // surfacing the stuck glyph in the UI.
    sensitive = stripLockGlyph(sensitive);
  } catch (e) {
    console.warn(`[webCrypto] failed to decrypt ${entityName} #${row.id}:`, e?.message || e);
    return row;
  }
  // Build the merged row but ALWAYS overwrite a 🔒 plaintext column
  // with the decrypted value (even if that value is empty). The
  // plaintext column only ever holds the sentinel as a "this is
  // encrypted" hint to humans inspecting the database — it must never
  // bleed into the UI once the web is unlocked. For sensitive fields
  // missing from the decrypted blob we substitute a typed neutral
  // default so the UI shows nothing rather than a stray glyph.
  const merged = { ...row };
  for (const f of fields) {
    if (f in sensitive) {
      merged[f] = sensitive[f];
      continue;
    }
    if (row[f] !== LOCK_PLACEHOLDER) continue; // genuine non-placeholder, keep it
    const before = row[f];
    if (Array.isArray(before)) merged[f] = [];
    else if (typeof before === 'string') merged[f] = '';
    else merged[f] = null;
  }
  return merged;
}
