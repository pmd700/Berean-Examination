import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  Database,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import {
  readPrivacyStatus,
  subscribeToPrivacyStatus,
  unlockPrivacyAutomatically,
  unlockPrivacyWithPin,
  unlockPrivacyWithRecoveryCode,
} from '@/lib/privacy';
import './PrivacyGate.css';

// Only shown after the user unlocks by hand — they acted, so they get the
// confirmation. An automatic unlock goes straight through with no screen.
const SUCCESS_HOLD_MS = 720;

function readableError(error) {
  return error instanceof Error ? error.message : String(error);
}

export default function DesktopPrivacyGate({ children }) {
  const desktopApi = typeof window !== 'undefined' ? window.bexDesktop : null;
  const successTimer = useRef(null);
  const [phase, setPhase] = useState(desktopApi ? 'checking' : 'ready');
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [unlockMethod, setUnlockMethod] = useState('pin');
  const [unlockValue, setUnlockValue] = useState('');
  const [unlocking, setUnlocking] = useState(false);

  const checkVault = useCallback(async () => {
    if (!desktopApi) return;
    setPhase('checking');
    setError('');

    try {
      let nextStatus = await readPrivacyStatus();
      if (nextStatus.locked && nextStatus.mode === 'automatic') {
        nextStatus = await unlockPrivacyAutomatically();
      }

      if (nextStatus.locked) {
        setStatus(nextStatus);
        setPhase(nextStatus.pinEnabled ? 'pin-required' : 'error');
        if (!nextStatus.pinEnabled) setError('This Mac could not open the local privacy vault.');
        return;
      }

      // The vault opened on its own, which is the normal case. Nothing here
      // needs the user, so go straight into the app rather than holding a
      // "Local vault ready" screen in front of them on every launch. The
      // vault's status is available on demand in Privacy settings instead.
      setStatus(nextStatus);
      setPhase('ready');
    } catch (vaultError) {
      setError(readableError(vaultError));
      setPhase('error');
    }
  }, [desktopApi]);

  useEffect(() => {
    if (!desktopApi) return undefined;
    let active = true;
    checkVault();

    const unsubscribe = subscribeToPrivacyStatus((nextStatus) => {
      if (!active || !nextStatus) return;
      setStatus(nextStatus);
      if (!nextStatus.locked) {
        setPhase('ready');
      } else if (nextStatus.pinEnabled) {
        setPhase('pin-required');
      } else {
        setError('This Mac could not reopen the local privacy vault after wake.');
        setPhase('error');
      }
    });

    return () => {
      active = false;
      unsubscribe?.();
      if (successTimer.current) clearTimeout(successTimer.current);
    };
  }, [checkVault, desktopApi]);

  const finishUnlock = (nextStatus) => {
    setStatus(nextStatus);
    setError('');
    setUnlockValue('');
    setPhase('success');
    successTimer.current = setTimeout(() => setPhase('ready'), SUCCESS_HOLD_MS);
  };

  const submitUnlock = async (event) => {
    event.preventDefault();
    if (!unlockValue.trim()) return;
    setUnlocking(true);
    setError('');
    try {
      const nextStatus = unlockMethod === 'pin'
        ? await unlockPrivacyWithPin(unlockValue)
        : await unlockPrivacyWithRecoveryCode(unlockValue);
      finishUnlock(nextStatus);
    } catch (unlockError) {
      const delay = unlockError?.delayMs || unlockError?.retryAfterMs || 0;
      const delayMessage = delay ? ` Try again in ${formatDelay(delay)}.` : '';
      setError(`${readableError(unlockError)}${delayMessage}`);
    } finally {
      setUnlocking(false);
    }
  };

  if (!desktopApi || phase === 'ready') return children;

  const isChecking = phase === 'checking';
  const isSuccess = phase === 'success';
  const needsPin = phase === 'pin-required';

  return (
    <main className="bex-privacy-gate" aria-busy={isChecking}>
      <div className="bex-privacy-aurora" aria-hidden="true" />
      <div className="bex-privacy-grid" aria-hidden="true" />

      <header className="bex-privacy-brand">
        <div className="bex-privacy-brand-mark">
          <img src="/logo.png" alt="" />
        </div>
        <div>
          <p>BEX Launcher Official</p>
          <span>Berean Examination</span>
        </div>
      </header>

      <section className="bex-privacy-card" data-phase={phase}>
        <div className="bex-privacy-edge" aria-hidden="true" />

        {isChecking && (
          <div className="bex-privacy-state">
            <div className="bex-vault-orbit" aria-hidden="true">
              <div className="bex-vault-orbit-line" />
              <div className="bex-vault-icon">
                <LockKeyhole />
              </div>
            </div>
            <p className="bex-privacy-eyebrow">Local privacy</p>
            <h1>Opening your vault</h1>
            <p className="bex-privacy-copy">Confirming this Mac can protect your local library.</p>
            <div className="bex-privacy-progress" aria-hidden="true"><span /></div>
          </div>
        )}

        {isSuccess && (
          <div className="bex-privacy-state bex-privacy-success">
            <div className="bex-vault-check" aria-hidden="true">
              <span className="bex-check-halo" />
              <Check />
            </div>
            <p className="bex-privacy-eyebrow">Protected on this Mac</p>
            <h1>Local vault ready</h1>
            <p className="bex-privacy-copy">Private records can now be stored encrypted.</p>
          </div>
        )}

        {!isChecking && !isSuccess && (
          <div className="bex-privacy-state bex-privacy-blocked">
            <div className="bex-vault-warning" aria-hidden="true">
              {needsPin ? <KeyRound /> : <LockKeyhole />}
            </div>
            <p className="bex-privacy-eyebrow">Library stayed locked</p>
            <h1>{needsPin ? 'Privacy PIN required' : 'Vault unavailable'}</h1>
            <p className="bex-privacy-copy">
              {needsPin
                ? unlockMethod === 'pin'
                  ? 'Enter your PIN to open the encrypted library.'
                  : 'Enter the recovery code you saved when the PIN was created.'
                : error || 'BEX did not open private storage, so it stopped here instead of continuing unprotected.'}
            </p>
            {needsPin && (
              <form className="bex-privacy-unlock" onSubmit={submitUnlock}>
                <input
                  type={unlockMethod === 'pin' ? 'password' : 'text'}
                  inputMode={unlockMethod === 'pin' ? 'numeric' : 'text'}
                  autoComplete="off"
                  autoFocus
                  value={unlockValue}
                  onChange={(event) => setUnlockValue(
                    unlockMethod === 'pin'
                      ? event.target.value.replace(/\D/g, '').slice(0, 12)
                      : event.target.value,
                  )}
                  placeholder={unlockMethod === 'pin' ? 'PIN' : 'BEX-RCV1-…'}
                  aria-label={unlockMethod === 'pin' ? 'Privacy PIN' : 'Recovery code'}
                />
                {error && <p className="bex-privacy-error" role="alert">{error}</p>}
                <button type="submit" className="bex-privacy-retry" disabled={unlocking || !unlockValue.trim()}>
                  <KeyRound /> {unlocking ? 'Opening…' : 'Unlock'}
                </button>
                <button
                  type="button"
                  className="bex-privacy-method"
                  onClick={() => {
                    setUnlockMethod(unlockMethod === 'pin' ? 'recovery' : 'pin');
                    setUnlockValue('');
                    setError('');
                  }}
                >
                  {unlockMethod === 'pin' ? 'Use recovery code' : 'Use PIN'}
                </button>
              </form>
            )}
            {!needsPin && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', justifyContent: 'center' }}>
                <button type="button" className="bex-privacy-retry" onClick={checkVault}>
                  <RefreshCw />
                  Try again
                </button>
                {desktopApi?.chooseLibrary && (
                  <button
                    type="button"
                    className="bex-privacy-method"
                    onClick={async () => {
                      const result = await desktopApi.chooseLibrary();
                      if (result?.ok && !result.canceled) checkVault();
                    }}
                  >
                    Choose another library
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <footer className="bex-privacy-facts" aria-label="Local privacy details">
          <span><ShieldCheck /> AES-256</span>
          <span><KeyRound /> {status?.protectedBy || 'macOS Keychain'}</span>
          <span><Database /> Local only</span>
        </footer>
      </section>
    </main>
  );
}

function formatDelay(milliseconds) {
  const minutes = Math.ceil(milliseconds / 60000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}
