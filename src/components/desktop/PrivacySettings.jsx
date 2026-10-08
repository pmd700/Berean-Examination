import { useEffect, useState } from 'react';
import { Check, ChevronLeft, Copy, DatabaseBackup, KeyRound, LockKeyhole, RotateCcw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  changePrivacyPin,
  disablePrivacyPin,
  enablePrivacyPin,
  readPrivacyStatus,
  replacePrivacyRecoveryCode,
} from '@/lib/privacy';
import { chooseAndRestoreLibraryBackup, createLibraryBackup } from '@/lib/localBackup';

const PIN_PATTERN = /^\d{4,12}$/;

function messageFrom(error) {
  return error instanceof Error ? error.message : String(error);
}

export default function DesktopPrivacySettings() {
  const isDesktop = typeof window !== 'undefined' && window.bexDesktop?.isDesktop;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('home');
  const [status, setStatus] = useState(null);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [savedRecovery, setSavedRecovery] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!open || !isDesktop) return;
    readPrivacyStatus().then(setStatus).catch((nextError) => setError(messageFrom(nextError)));
  }, [isDesktop, open]);

  // `locked` is only meaningful once status has loaded; treat "not locked" as
  // the healthy state so the row doesn't flash a warning while it reads.
  const vaultOk = !status?.locked;

  if (!isDesktop) return null;

  const clearForm = (nextView) => {
    setView(nextView);
    setPin('');
    setConfirmPin('');
    setError('');
    setNotice('');
  };

  const handleBackupNow = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const backup = await createLibraryBackup();
      setNotice(`Backup saved: ${backup.fileName}`);
    } catch (nextError) {
      setError(messageFrom(nextError));
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await chooseAndRestoreLibraryBackup();
      if (result.canceled) return;
      setNotice('Restore verified. Reopening the library…');
      window.setTimeout(() => window.location.reload(), 650);
    } catch (nextError) {
      setError(messageFrom(nextError));
      if (nextError?.rolledBack) window.setTimeout(() => window.location.reload(), 900);
    } finally {
      setBusy(false);
    }
  };

  const handleOpenChange = (nextOpen) => {
    if (!nextOpen && view === 'recovery' && !savedRecovery) return;
    if (!nextOpen && view === 'recovery') setRecoveryCode('');
    setOpen(nextOpen);
    if (nextOpen) clearForm('home');
  };

  const validatePins = () => {
    if (!PIN_PATTERN.test(pin)) return 'Use 4 to 12 digits.';
    if (pin !== confirmPin) return 'The PINs do not match.';
    return '';
  };

  const handlePinSave = async (event) => {
    event.preventDefault();
    const validationError = validatePins();
    if (validationError) {
      setError(validationError);
      return;
    }

    setBusy(true);
    setError('');
    try {
      if (view === 'enable') {
        const result = await enablePrivacyPin(pin);
        setStatus(result.status);
        setRecoveryCode(result.recoveryCode);
        setSavedRecovery(false);
        setCopied(false);
        setView('recovery');
      } else {
        const nextStatus = await changePrivacyPin(pin);
        setStatus(nextStatus);
        clearForm('home');
      }
    } catch (nextError) {
      setError(messageFrom(nextError));
    } finally {
      setBusy(false);
    }
  };

  const handleReplaceRecovery = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await replacePrivacyRecoveryCode();
      setStatus(result.status);
      setRecoveryCode(result.recoveryCode);
      setSavedRecovery(false);
      setCopied(false);
      setView('recovery');
    } catch (nextError) {
      setError(messageFrom(nextError));
    } finally {
      setBusy(false);
    }
  };

  const handleDisablePin = async () => {
    setBusy(true);
    setError('');
    try {
      const nextStatus = await disablePrivacyPin();
      setStatus(nextStatus);
      clearForm('home');
    } catch (nextError) {
      setError(messageFrom(nextError));
    } finally {
      setBusy(false);
    }
  };

  const copyRecoveryCode = async () => {
    try {
      await navigator.clipboard.writeText(recoveryCode);
      setCopied(true);
    } catch {
      setError('Copy failed. Select the code and copy it manually.');
    }
  };

  const finishRecovery = () => {
    if (!savedRecovery) return;
    setRecoveryCode('');
    setOpen(false);
    clearForm('home');
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        className="text-ink-faint hover:text-ink"
        title="Privacy"
        aria-label="Privacy settings"
      >
        <ShieldCheck className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="max-w-md gap-5 border-line bg-[#10131A] text-ink shadow-2xl"
          onEscapeKeyDown={(event) => view === 'recovery' && !savedRecovery && event.preventDefault()}
          onPointerDownOutside={(event) => view === 'recovery' && !savedRecovery && event.preventDefault()}
        >
          <DialogHeader>
            <div className="flex items-center gap-3">
              {view !== 'home' && view !== 'recovery' && (
                <button
                  type="button"
                  onClick={() => clearForm('home')}
                  className="rounded-md p-1 text-[#7D879A] hover:bg-[#1A1F2A] hover:text-white"
                  aria-label="Back"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              )}
              <DialogTitle className="flex items-center gap-2 text-xl">
                <ShieldCheck className="h-5 w-5 text-[#A78BFA]" />
                {view === 'recovery' ? 'Save recovery code' : 'Privacy PIN'}
              </DialogTitle>
            </div>
          </DialogHeader>

          {view === 'home' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-line bg-app p-4">
                <p className="text-sm font-semibold text-white">
                  {status?.pinEnabled ? 'PIN protection is on' : 'Automatic unlock is on'}
                </p>
                <p className="mt-1 text-sm leading-6 text-[#8C96A8]">
                  {status?.pinEnabled
                    ? 'BEX asks for your PIN when it starts or wakes.'
                    : 'This Mac unlocks the encrypted library automatically.'}
                </p>
              </div>

              {error && <p className="text-sm text-[#FCA5A5]">{error}</p>}

              {status?.pinEnabled ? (
                <div className="grid gap-2">
                  <Button onClick={() => clearForm('change')} className="justify-start bg-[#6D4BC3] hover:bg-[#7C5AD2]">
                    <KeyRound /> Change PIN
                  </Button>
                  <Button variant="outline" onClick={handleReplaceRecovery} disabled={busy} className="justify-start border-[#303747] bg-transparent hover:bg-[#1A1F2A] hover:text-white">
                    Replace recovery code
                  </Button>
                  <Button variant="ghost" onClick={() => clearForm('remove')} className="justify-start text-[#9AA3B3] hover:bg-[#1A1F2A] hover:text-white">
                    Remove PIN
                  </Button>
                </div>
              ) : (
                <Button onClick={() => clearForm('enable')} className="w-full bg-[#6D4BC3] hover:bg-[#7C5AD2]">
                  <KeyRound /> Add optional PIN
                </Button>
              )}

              <div className="border-t border-[#252B38] pt-4">
                <p className="text-sm font-semibold text-white">Library recovery</p>
                <p className="mt-1 text-sm text-[#8C96A8]">BEX also backs up automatically when it closes.</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={handleBackupNow} disabled={busy} className="border-[#303747] bg-transparent hover:bg-[#1A1F2A] hover:text-white">
                    <DatabaseBackup /> Back up now
                  </Button>
                  <Button variant="outline" onClick={handleRestore} disabled={busy} className="border-[#303747] bg-transparent hover:bg-[#1A1F2A] hover:text-white">
                    <RotateCcw /> Restore
                  </Button>
                </div>
                {notice && <p className="mt-3 break-words text-sm text-[#A7F3D0]">{notice}</p>}
              </div>

              {/* Vault status, on demand. This used to be a full screen shown
                  at every launch; it says the same thing, quietly, to whoever
                  actually wants to check. */}
              <div className="border-t border-[#252B38] pt-4">
                <div className="flex items-start gap-2.5">
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                    vaultOk ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'
                  }`}>
                    {vaultOk ? <Check className="h-3 w-3" /> : <LockKeyhole className="h-3 w-3" />}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">
                      {vaultOk ? 'Local vault is working' : 'Local vault is locked'}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-[#8C96A8]">
                      {vaultOk
                        ? 'Private records are stored encrypted on this Mac. Nothing to do.'
                        : 'Unlock it to read or write private records.'}
                    </p>
                    <p className="mt-1.5 text-[11px] uppercase tracking-wider text-ink-faint">
                      AES-256 · {status?.protectedBy || 'macOS Keychain'} · Local only
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {(view === 'enable' || view === 'change') && (
            <form onSubmit={handlePinSave} className="space-y-4">
              <p className="text-sm text-[#8C96A8]">Use 4 to 12 digits.</p>
              <Input
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 12))}
                placeholder="New PIN"
                autoFocus
                className="h-11 border-[#303747] bg-app text-white"
              />
              <Input
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                value={confirmPin}
                onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, '').slice(0, 12))}
                placeholder="Confirm PIN"
                className="h-11 border-[#303747] bg-app text-white"
              />
              {error && <p className="text-sm text-[#FCA5A5]">{error}</p>}
              <Button type="submit" disabled={busy} className="w-full bg-[#6D4BC3] hover:bg-[#7C5AD2]">
                {busy ? 'Saving…' : view === 'enable' ? 'Turn on PIN' : 'Save new PIN'}
              </Button>
            </form>
          )}

          {view === 'remove' && (
            <div className="space-y-4">
              <p className="text-sm leading-6 text-[#AAB2C0]">
                BEX will return to automatic unlock on this Mac. Your private data stays encrypted.
              </p>
              {error && <p className="text-sm text-[#FCA5A5]">{error}</p>}
              <Button onClick={handleDisablePin} disabled={busy} className="w-full bg-[#6D4BC3] hover:bg-[#7C5AD2]">
                {busy ? 'Removing…' : 'Remove PIN'}
              </Button>
            </div>
          )}

          {view === 'recovery' && (
            <div className="space-y-4">
              <p className="text-sm leading-6 text-[#AAB2C0]">
                Save this outside the Berean Library. It is the only way to unlock the library if the PIN is lost.
              </p>
              <div className="rounded-xl border border-[#50436D] bg-app p-4">
                <code className="block select-all break-all text-sm leading-6 text-[#DDD6FE]">{recoveryCode}</code>
                <Button type="button" variant="ghost" size="sm" onClick={copyRecoveryCode} className="mt-3 text-[#B8A7E8] hover:bg-[#1A1F2A] hover:text-white">
                  {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <label className="flex cursor-pointer items-start gap-3 text-sm text-[#C8CFDA]">
                <input
                  type="checkbox"
                  checked={savedRecovery}
                  onChange={(event) => setSavedRecovery(event.target.checked)}
                  className="mt-1 accent-[#8B5CF6]"
                />
                I saved it outside the Berean Library.
              </label>
              {error && <p className="text-sm text-[#FCA5A5]">{error}</p>}
              <Button onClick={finishRecovery} disabled={!savedRecovery} className="w-full bg-[#6D4BC3] hover:bg-[#7C5AD2]">
                Done
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
