import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import {
  deriveKey,
  checkVerifier,
  exportRawKeyB64,
  importRawKeyB64,
  storeKeyForWeb,
  loadKeyForWeb,
  clearKeyForWeb,
  setActiveEncryption,
  clearActiveEncryption,
} from './webCrypto';

// Tracks which private knowledge webs are unlocked in the current app
// session and exposes helpers to unlock/lock them. Caches the derived AES
// key in sessionStorage so the user does not have to retype the passphrase
// on every page navigation within a single session — but never persists
// the key to localStorage or to disk.

const PrivateWebContext = createContext(null);

export function PrivateWebProvider({ children }) {
  // Map of webId → CryptoKey for currently-unlocked private webs.
  const [unlocked, setUnlocked] = useState({});

  // On mount, hydrate from sessionStorage so a hard refresh keeps the
  // user's existing unlocked webs (until the tab closes).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const restored = {};
      try {
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          if (k && k.startsWith('brn_web_key_v1_')) {
            const webId = Number(k.slice('brn_web_key_v1_'.length));
            const rawB64 = sessionStorage.getItem(k);
            if (Number.isFinite(webId) && rawB64) {
              try {
                restored[webId] = await importRawKeyB64(rawB64);
              } catch {}
            }
          }
        }
      } catch {}
      if (!cancelled && Object.keys(restored).length > 0) setUnlocked(restored);
    })();
    return () => { cancelled = true; };
  }, []);

  const isUnlocked = useCallback((webId) => !!unlocked[webId], [unlocked]);

  const getKey = useCallback((webId) => unlocked[webId] || null, [unlocked]);

  // Activate decryption for a given private web. Subsequent entity reads/
  // writes will transparently encrypt/decrypt against this web's key. Pass
  // `null` to deactivate (e.g., when the user navigates to a public web).
  const activate = useCallback((webId) => {
    if (!webId) { clearActiveEncryption(); return; }
    const key = unlocked[webId];
    if (key) setActiveEncryption({ webId, key });
    else clearActiveEncryption();
  }, [unlocked]);

  // Try to unlock a private web with the user's passphrase. Returns the
  // CryptoKey on success, or throws Error('wrong-passphrase') / other.
  const unlock = useCallback(async (web, passphrase) => {
    if (!web?.is_private) throw new Error('not-a-private-web');
    if (!web.enc_salt || !web.enc_verifier) {
      throw new Error('private-web-missing-salt-or-verifier');
    }
    const key = await deriveKey(passphrase, web.enc_salt);
    const ok = await checkVerifier(key, web.enc_verifier);
    if (!ok) throw new Error('wrong-passphrase');
    // Cache for this session and this tab.
    const rawB64 = await exportRawKeyB64(key);
    storeKeyForWeb(web.id, rawB64);
    setUnlocked(prev => ({ ...prev, [web.id]: key }));
    return key;
  }, []);

  // Re-lock a single web: forget its key in this session.
  const lock = useCallback((webId) => {
    clearKeyForWeb(webId);
    setUnlocked(prev => {
      if (!(webId in prev)) return prev;
      const next = { ...prev };
      delete next[webId];
      return next;
    });
    clearActiveEncryption();
  }, []);

  // After a successful create-private-web flow, the page already has the
  // derived CryptoKey — let it register that key without re-deriving.
  const registerNewWeb = useCallback(async (webId, key) => {
    const rawB64 = await exportRawKeyB64(key);
    storeKeyForWeb(webId, rawB64);
    setUnlocked(prev => ({ ...prev, [webId]: key }));
  }, []);

  const value = {
    isUnlocked,
    getKey,
    activate,
    unlock,
    lock,
    registerNewWeb,
  };

  return (
    <PrivateWebContext.Provider value={value}>
      {children}
    </PrivateWebContext.Provider>
  );
}

export function usePrivateWeb() {
  const ctx = useContext(PrivateWebContext);
  if (!ctx) throw new Error('usePrivateWeb must be used within a PrivateWebProvider');
  return ctx;
}
