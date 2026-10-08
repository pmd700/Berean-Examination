import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Lock, Eye, EyeOff } from 'lucide-react';

// Modal that asks the user for the passphrase of a locked private web.
// Calls the parent's local verifier. Incorrect attempts never write to or
// delete library data.
export default function UnlockWebModal({ open, web, onClose, onUnlock }) {
  const [pass, setPass] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setPass(''); setError(''); setReveal(false); setWorking(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, web?.id]);

  if (!open || !web) return null;

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (working) return;
    setError('');
    if (!pass) return setError('Enter your passphrase.');
    setWorking(true);
    try {
      await onUnlock(pass);
    } catch (err) {
      const msg = err?.message === 'wrong-passphrase'
        ? 'Wrong passphrase. Nothing was changed.'
        : (err?.message || 'Failed to unlock.');
      setError(msg);
      setWorking(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
      data-testid="modal-unlock-private-web"
    >
      <form
        onSubmit={handleSubmit}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl border border-line bg-[#0F1218] shadow-2xl"
      >
        <div className="px-5 py-4 border-b border-white/5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand to-[#3B2D5C] flex items-center justify-center flex-shrink-0">
            <Lock className="w-4.5 h-4.5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-gray-100" style={{ fontFamily: 'var(--bex-app-font-family, serif)', letterSpacing: '0.05em' }}>
              UNLOCK PRIVATE WEB
            </h2>
            <p className="text-[11px] text-gray-500">Enter the passphrase you set when creating this web.</p>
          </div>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">Passphrase</label>
            <div className="relative">
              <Input
                ref={inputRef}
                type={reveal ? 'text' : 'password'}
                value={pass}
                onChange={e => setPass(e.target.value)}
                className="bg-gray-900 border-gray-700 text-gray-100 h-9 text-sm pr-9"
                disabled={working}
                data-testid="input-unlock-passphrase"
              />
              <button
                type="button"
                onClick={() => setReveal(r => !r)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                tabIndex={-1}
              >
                {reveal ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="text-[12px] text-red-400 px-1" data-testid="text-unlock-error">{error}</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/5 flex gap-2 justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            // Always allow the owner to close the dialog.
            className="h-8 text-xs text-gray-400"
            data-testid="button-cancel-unlock"
          >Cancel</Button>
          <Button
            type="submit"
            disabled={working}
            className="h-8 text-xs bg-brand hover:bg-[#553a7c] text-white disabled:opacity-50"
            data-testid="button-confirm-unlock"
          >
            {working ? 'Verifying…' : 'Unlock'}
          </Button>
        </div>
      </form>
    </div>
  );
}
