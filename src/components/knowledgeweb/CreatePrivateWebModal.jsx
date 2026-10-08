import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Lock, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import {
  generateSaltB64,
  deriveKey,
  encryptString,
  makeVerifier,
} from '@/lib/webCrypto';

// Modal that walks the user through creating a new private (encrypted)
// knowledge web. Asks for a name and a passphrase (with confirmation),
// derives the AES key locally, and saves only ciphertext+salt+verifier.
// The plaintext name and passphrase never enter the database.
export default function CreatePrivateWebModal({ open, onClose, onCreate, busy, initialName = '' }) {
  const [name, setName] = useState('');
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const nameRef = useRef(null);
  const passRef = useRef(null);

  useEffect(() => {
    if (open) {
      // Pre-fill the name if the parent passed one (the user typed it
      // into the sidebar's create form before ticking the Encrypt
      // checkbox). Jump focus straight to the passphrase field so the
      // flow stays one-handed.
      setName(initialName); setPass(''); setConfirm(''); setError(''); setReveal(false); setWorking(false);
      setTimeout(() => {
        if (initialName) passRef.current?.focus();
        else nameRef.current?.focus();
      }, 50);
    }
  }, [open, initialName]);

  if (!open) return null;

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (working || busy) return;
    setError('');
    const trimmedName = name.trim();
    if (!trimmedName) return setError('Please enter a name for this web.');
    if (pass.length < 6) return setError('Passphrase must be at least 6 characters.');
    if (pass !== confirm) return setError('Passphrase and confirmation do not match.');
    setWorking(true);
    try {
      const salt = generateSaltB64();
      const key = await deriveKey(pass, salt);
      const enc_name = await encryptString(key, trimmedName);
      const enc_verifier = await makeVerifier(key);
      await onCreate({
        is_private: true,
        enc_salt: salt,
        enc_verifier,
        enc_name,
        cryptoKey: key,
        plainName: trimmedName,
      });
    } catch (err) {
      setError(err?.message || 'Failed to create private web.');
      setWorking(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
      data-testid="modal-create-private-web"
    >
      <form
        onSubmit={handleSubmit}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-line bg-[#0F1218] shadow-2xl"
      >
        <div className="px-5 py-4 border-b border-white/5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand to-[#3B2D5C] flex items-center justify-center flex-shrink-0">
            <Lock className="w-4.5 h-4.5 text-white" />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-bold text-gray-100" style={{ fontFamily: 'var(--bex-app-font-family, serif)', letterSpacing: '0.05em' }}>
              CREATE PRIVATE WEB
            </h2>
            <p className="text-[11px] text-gray-500">Extra local encryption for sensitive work.</p>
          </div>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">Web name</label>
            <Input
              ref={nameRef}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Personal Reflections"
              className="bg-gray-900 border-gray-700 text-gray-100 h-9 text-sm"
              disabled={working || busy}
              data-testid="input-private-web-name"
            />
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">Passphrase</label>
            <div className="relative">
              <Input
                ref={passRef}
                type={reveal ? 'text' : 'password'}
                value={pass}
                onChange={e => setPass(e.target.value)}
                placeholder="Choose anything memorable"
                className="bg-gray-900 border-gray-700 text-gray-100 h-9 text-sm pr-9"
                disabled={working || busy}
                data-testid="input-private-web-passphrase"
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
            <p className="text-[10px] text-gray-600 mt-1">Use your Berean Key text, your password, or any phrase only you know.</p>
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">Confirm passphrase</label>
            <Input
              type={reveal ? 'text' : 'password'}
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              className="bg-gray-900 border-gray-700 text-gray-100 h-9 text-sm"
              disabled={working || busy}
              data-testid="input-private-web-passphrase-confirm"
            />
          </div>

          <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-200/90 leading-snug">
              If you forget this passphrase the web's contents are <strong>permanently unrecoverable</strong>. There is no reset — that's what makes it private.
            </p>
          </div>

          {error && (
            <div className="text-[12px] text-red-400 px-1" data-testid="text-create-private-error">{error}</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-white/5 flex gap-2 justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={working || busy}
            className="h-8 text-xs text-gray-400"
            data-testid="button-cancel-create-private"
          >Cancel</Button>
          <Button
            type="submit"
            disabled={working || busy}
            className="h-8 text-xs bg-brand hover:bg-[#553a7c] text-white"
            data-testid="button-confirm-create-private"
          >
            {working ? 'Encrypting…' : 'Create private web'}
          </Button>
        </div>
      </form>
    </div>
  );
}
