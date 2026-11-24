//! 100% Binary-Compatible Cryptography for BEX Vault (`privacy-vault.cjs` parity).
//!
//! Wire formats matched byte-for-byte:
//! - Record / Media blob: `[1u8] || nonce(12B) || auth_tag(16B) || ciphertext` (AES-256-GCM + AAD)
//! - PIN / Recovery KDF: `scrypt(N=32768, r=8, p=1, dkLen=32)`
//! - macOS Automatic Key Envelope: Electron/Chromium OSCrypt `v10` (`"v10"` + AES-128-CBC with
//!   IV = 16 ASCII spaces, key = PBKDF2-HMAC-SHA1(keychain_secret, "saltysalt", 1003, 16B))

use aes::Aes128;
use aes_gcm::{
    aead::{AeadInPlace, KeyInit},
    Aes256Gcm, Nonce, Tag,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use cbc::cipher::{block_padding::Pkcs7, BlockDecryptMut, BlockEncryptMut, KeyIvInit};
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use scrypt::{scrypt, Params as ScryptParams};
use sha1::Sha1;

pub const DATA_KEY_BYTES: usize = 32;
pub const SALT_BYTES: usize = 16;
pub const NONCE_BYTES: usize = 12;
pub const AUTH_TAG_BYTES: usize = 16;
pub const ENCRYPTED_FORMAT_VERSION: u8 = 1;
pub const ENCRYPTION_OVERHEAD: usize = 1 + NONCE_BYTES + AUTH_TAG_BYTES;
pub const PIN_KEY_PURPOSE: &str = "bex:library-key:pin:v1";
pub const RECOVERY_KEY_PURPOSE: &str = "bex:library-key:recovery:v1";
pub const RECOVERY_PREFIX: &str = "BEX-RCV1";

#[derive(Debug, Clone)]
pub struct CryptoError {
    pub code: &'static str,
    pub message: String,
}

impl CryptoError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl std::fmt::Display for CryptoError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for CryptoError {}

pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut buf = [0u8; N];
    rand::thread_rng().fill_bytes(&mut buf);
    buf
}

pub fn encrypt_bytes(
    key: &[u8; DATA_KEY_BYTES],
    plaintext: &[u8],
    purpose: &str,
) -> Result<Vec<u8>, CryptoError> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|_| CryptoError::new("BEX_PRIVACY_KEY_INVALID", "Invalid encryption key."))?;
    let nonce_bytes = random_bytes::<NONCE_BYTES>();
    let nonce = Nonce::from_slice(&nonce_bytes);
    let mut buffer = plaintext.to_vec();
    let tag = cipher
        .encrypt_in_place_detached(nonce, purpose.as_bytes(), &mut buffer)
        .map_err(|_| CryptoError::new("BEX_PRIVACY_DATA_INVALID", "Encryption failed."))?;

    let mut out = Vec::with_capacity(ENCRYPTION_OVERHEAD + buffer.len());
    out.push(ENCRYPTED_FORMAT_VERSION);
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(tag.as_slice());
    out.extend_from_slice(&buffer);
    Ok(out)
}

pub fn decrypt_bytes(
    key: &[u8; DATA_KEY_BYTES],
    encrypted: &[u8],
    purpose: &str,
) -> Result<Vec<u8>, CryptoError> {
    if encrypted.len() < ENCRYPTION_OVERHEAD || encrypted[0] != ENCRYPTED_FORMAT_VERSION {
        return Err(CryptoError::new(
            "BEX_PRIVACY_DATA_INVALID",
            "The encrypted library data is invalid.",
        ));
    }
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|_| CryptoError::new("BEX_PRIVACY_KEY_INVALID", "Invalid decryption key."))?;
    let nonce = Nonce::from_slice(&encrypted[1..1 + NONCE_BYTES]);
    let tag = Tag::from_slice(&encrypted[1 + NONCE_BYTES..ENCRYPTION_OVERHEAD]);
    let mut buffer = encrypted[ENCRYPTION_OVERHEAD..].to_vec();
    cipher
        .decrypt_in_place_detached(nonce, purpose.as_bytes(), &mut buffer, tag)
        .map_err(|_| {
            CryptoError::new(
                "BEX_PRIVACY_DATA_INVALID",
                "The encrypted library data could not be authenticated.",
            )
        })?;
    Ok(buffer)
}

pub fn derive_wrapping_key(secret: &str, salt: &[u8]) -> Result<[u8; DATA_KEY_BYTES], CryptoError> {
    // N = 32768 = 2^15, r = 8, p = 1 (matches privacy-vault.cjs SCRYPT_OPTIONS)
    let params = ScryptParams::new(15, 8, 1, DATA_KEY_BYTES)
        .map_err(|_| CryptoError::new("BEX_PRIVACY_KEY_INVALID", "Invalid scrypt parameters."))?;
    let mut out = [0u8; DATA_KEY_BYTES];
    scrypt(secret.as_bytes(), salt, &params, &mut out)
        .map_err(|_| CryptoError::new("BEX_PRIVACY_KEY_INVALID", "Key derivation failed."))?;
    Ok(out)
}

pub fn wrap_data_key(
    data_key: &[u8; DATA_KEY_BYTES],
    secret: &str,
    salt: &[u8],
    purpose: &str,
) -> Result<Vec<u8>, CryptoError> {
    let wrapping = derive_wrapping_key(secret, salt)?;
    encrypt_bytes(&wrapping, data_key, purpose)
}

pub fn unwrap_data_key(
    envelope: &[u8],
    secret: &str,
    salt: &[u8],
    purpose: &str,
) -> Result<[u8; DATA_KEY_BYTES], CryptoError> {
    let wrapping = derive_wrapping_key(secret, salt)?;
    let plain = decrypt_bytes(&wrapping, envelope, purpose)?;
    if plain.len() != DATA_KEY_BYTES {
        return Err(CryptoError::new(
            "BEX_PRIVACY_KEY_INVALID",
            "Unwrapped data key length is invalid.",
        ));
    }
    let mut out = [0u8; DATA_KEY_BYTES];
    out.copy_from_slice(&plain);
    Ok(out)
}

pub fn generate_recovery_code() -> String {
    const ALPHABET: &[u8] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    let bytes = random_bytes::<20>();
    let mut bits: u32 = 0;
    let mut value: u32 = 0;
    let mut encoded = String::new();
    for b in bytes {
        value = (value << 8) | (b as u32);
        bits += 8;
        while bits >= 5 {
            encoded.push(ALPHABET[((value >> (bits - 5)) & 31) as usize] as char);
            bits -= 5;
        }
    }
    if bits > 0 {
        encoded.push(ALPHABET[((value << (5 - bits)) & 31) as usize] as char);
    }
    let groups: Vec<&str> = encoded
        .as_bytes()
        .chunks(4)
        .map(|c| std::str::from_utf8(c).unwrap_or(""))
        .collect();
    format!("{RECOVERY_PREFIX}-{}", groups.join("-"))
}

pub fn normalize_recovery_code(raw: &str) -> Result<String, CryptoError> {
    if raw.len() < 4 || raw.len() > 256 {
        return Err(CryptoError::new(
            "BEX_RECOVERY_CODE_INVALID",
            "The recovery code format is invalid.",
        ));
    }
    let norm: String = raw
        .to_uppercase()
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .collect();
    let expected_prefix = RECOVERY_PREFIX.replace('-', "");
    if !norm.starts_with(&expected_prefix) {
        return Err(CryptoError::new(
            "BEX_RECOVERY_CODE_INVALID",
            "The recovery code format is invalid.",
        ));
    }
    Ok(norm)
}

// ── macOS Electron `safeStorage` OSCrypt v10 Compatibility ──────────────────

type Aes128CbcDec = cbc::Decryptor<Aes128>;
type Aes128CbcEnc = cbc::Encryptor<Aes128>;

fn derive_oscrypt_v10_key(password: &[u8]) -> [u8; 16] {
    let mut key = [0u8; 16];
    pbkdf2_hmac::<Sha1>(password, b"saltysalt", 1003, &mut key);
    key
}

fn decrypt_oscrypt_v10(password: &[u8], envelope: &[u8]) -> Result<[u8; DATA_KEY_BYTES], CryptoError> {
    if envelope.len() < 19 || &envelope[..3] != b"v10" {
        return Err(CryptoError::new(
            "BEX_AUTOMATIC_KEY_MISMATCH",
            "Unsupported automatic key envelope format.",
        ));
    }
    let key = derive_oscrypt_v10_key(password);
    let iv = [b' '; 16];
    let mut buf = envelope[3..].to_vec();
    let plain = Aes128CbcDec::new(&key.into(), &iv.into())
        .decrypt_padded_mut::<Pkcs7>(&mut buf)
        .map_err(|_| {
            CryptoError::new(
                "BEX_AUTOMATIC_KEY_MISMATCH",
                "Could not decrypt automatic macOS Keychain key.",
            )
        })?;
    let b64_str = std::str::from_utf8(plain).map_err(|_| {
        CryptoError::new(
            "BEX_AUTOMATIC_KEY_MISMATCH",
            "Decoded automatic key is not valid UTF-8.",
        )
    })?;
    let decoded = B64.decode(b64_str.trim()).map_err(|_| {
        CryptoError::new(
            "BEX_AUTOMATIC_KEY_MISMATCH",
            "Decoded automatic key is not valid base64.",
        )
    })?;
    if decoded.len() != DATA_KEY_BYTES {
        return Err(CryptoError::new(
            "BEX_AUTOMATIC_KEY_MISMATCH",
            "Decoded automatic key has invalid length.",
        ));
    }
    let mut out = [0u8; DATA_KEY_BYTES];
    out.copy_from_slice(&decoded);
    Ok(out)
}

fn encrypt_oscrypt_v10(password: &[u8], data_key: &[u8; DATA_KEY_BYTES]) -> Result<Vec<u8>, CryptoError> {
    let key = derive_oscrypt_v10_key(password);
    let iv = [b' '; 16];
    let b64_str = B64.encode(data_key);
    let msg = b64_str.as_bytes();
    let mut buf = vec![0u8; msg.len() + 16];
    buf[..msg.len()].copy_from_slice(msg);
    let ct = Aes128CbcEnc::new(&key.into(), &iv.into())
        .encrypt_padded_mut::<Pkcs7>(&mut buf, msg.len())
        .map_err(|_| CryptoError::new("BEX_PROTECTED_STORAGE_UNAVAILABLE", "OSCrypt encrypt failed."))?;
    let mut out = Vec::with_capacity(3 + ct.len());
    out.extend_from_slice(b"v10");
    out.extend_from_slice(ct);
    Ok(out)
}

#[cfg(target_os = "macos")]
const KEYCHAIN_SERVICES: &[&str] = &[
    "BEX Launcher Official Safe Storage",
    "Electron Safe Storage",
    "bex-launcher-official Safe Storage",
    "BEX Safe Storage",
];

#[cfg(target_os = "macos")]
fn find_keychain_password_by_service(service: &str) -> Result<Vec<u8>, i32> {
    use security_framework::item::{ItemClass, ItemSearchOptions, SearchResult};

    let res = ItemSearchOptions::new()
        .class(ItemClass::generic_password())
        .service(service)
        .load_data(true)
        .search();

    match res {
        Ok(results) => {
            for item in results {
                if let SearchResult::Data(bytes) = item {
                    if !bytes.is_empty() {
                        return Ok(bytes);
                    }
                }
            }
            Err(-25300) // errSecItemNotFound
        }
        Err(err) => Err(err.code()),
    }
}

#[cfg(target_os = "macos")]
fn read_or_create_keychain_secret(create_if_missing: bool) -> Result<Vec<u8>, CryptoError> {
    use security_framework::passwords::set_generic_password;

    for &service in KEYCHAIN_SERVICES {
        if let Ok(pw) = find_keychain_password_by_service(service) {
            return Ok(pw);
        }
    }
    if create_if_missing {
        let new_secret = B64.encode(random_bytes::<16>()).into_bytes();
        set_generic_password("BEX Safe Storage", "BEX", &new_secret).map_err(|_| {
            CryptoError::new(
                "BEX_PROTECTED_STORAGE_UNAVAILABLE",
                "This Mac could not store a key in the macOS Keychain.",
            )
        })?;
        return Ok(new_secret);
    }
    Err(CryptoError::new(
        "BEX_PROTECTED_STORAGE_UNAVAILABLE",
        "Grant macOS Keychain access ('Always Allow') for BEX to unlock your Vault automatically.",
    ))
}

#[cfg(not(target_os = "macos"))]
fn read_or_create_keychain_secret(_create_if_missing: bool) -> Result<Vec<u8>, CryptoError> {
    Err(CryptoError::new(
        "BEX_PROTECTED_STORAGE_UNAVAILABLE",
        "Automatic macOS Keychain storage is only available on macOS.",
    ))
}

/// Unwraps Electron's `automatic_key_envelope` via macOS Login Keychain + OSCrypt v10.
pub fn unprotect_automatic_key(envelope: &[u8]) -> Result<[u8; DATA_KEY_BYTES], CryptoError> {
    #[cfg(target_os = "macos")]
    {
        let mut codes = Vec::new();
        for &service in KEYCHAIN_SERVICES {
            match find_keychain_password_by_service(service) {
                Ok(pw) => {
                    if let Ok(key) = decrypt_oscrypt_v10(&pw, envelope) {
                        return Ok(key);
                    }
                    codes.push(format!("{service}:mismatch"));
                }
                Err(code) => {
                    codes.push(format!("{service}:{code}"));
                }
            }
        }
        Err(CryptoError::new(
            "BEX_PROTECTED_STORAGE_UNAVAILABLE",
            format!(
                "Could not read Vault key from macOS Keychain ({}). Click 'Always Allow' on the macOS prompt and click Try again.",
                codes.join(", ")
            ),
        ))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = envelope;
        Err(CryptoError::new(
            "BEX_PROTECTED_STORAGE_UNAVAILABLE",
            "Protected system storage is unavailable on this OS.",
        ))
    }
}

pub fn protect_automatic_key(data_key: &[u8; DATA_KEY_BYTES]) -> Result<Vec<u8>, CryptoError> {
    let secret = read_or_create_keychain_secret(true)?;
    encrypt_oscrypt_v10(&secret, data_key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aes_gcm_wire_format_roundtrip() {
        let key = random_bytes::<32>();
        let ct = encrypt_bytes(&key, b"{\"title\":\"Romans 8\"}", "bex:local-entity:v1:MindNote:42").unwrap();
        assert_eq!(ct[0], 1);
        let pt = decrypt_bytes(&key, &ct, "bex:local-entity:v1:MindNote:42").unwrap();
        assert_eq!(pt, b"{\"title\":\"Romans 8\"}");
        // Wrong AAD must fail authentication
        assert!(decrypt_bytes(&key, &ct, "bex:local-entity:v1:MindNote:99").is_err());
    }

    #[test]
    fn oscrypt_v10_roundtrip() {
        let key = random_bytes::<32>();
        let env = encrypt_oscrypt_v10(b"test-keychain-secret", &key).unwrap();
        assert_eq!(&env[..3], b"v10");
        let recovered = decrypt_oscrypt_v10(b"test-keychain-secret", &env).unwrap();
        assert_eq!(recovered, key);
    }
}
