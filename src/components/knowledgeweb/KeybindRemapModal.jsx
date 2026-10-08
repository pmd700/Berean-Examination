import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, RotateCcw, Keyboard } from 'lucide-react';

const prettyKey = (k) => {
  if (!k) return '—';
  if (k === ' ' || k === 'space') return 'Space';
  if (k === '`') return '`';
  return k.length === 1 ? k.toUpperCase() : k;
};

// Reusable "customize shortcuts" dialog. Caller supplies the tool list
// (`{ id, label }`), the current `binds` map, and `onSetBind(id, key)` /
// `onReset` handlers (wired to useKeybinds). While a row is "listening", the
// next non-modifier keypress is captured as that tool's new key.
export default function KeybindRemapModal({
  open,
  onClose,
  title = 'Keyboard shortcuts',
  tools = [],
  binds = {},
  onSetBind,
  onReset,
}) {
  const [listeningId, setListeningId] = useState(null);

  // Capture the next keypress for the row being rebound.
  useEffect(() => {
    if (!open || !listeningId) return;
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const k = e.key;
      if (k === 'Escape') { setListeningId(null); return; }
      // Ignore lone modifier presses; wait for a real key.
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(k)) return;
      const key = k === ' ' ? 'space' : k;
      onSetBind && onSetBind(listeningId, key);
      setListeningId(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, listeningId, onSetBind]);

  const handleClose = useCallback(() => {
    setListeningId(null);
    onClose && onClose();
  }, [onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={handleClose}
      data-testid="modal-keybind-remap"
    >
      <div
        className="card-metal rounded-xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-brand-strong" />
            <h3 className="font-signature text-base text-gold">{title}</h3>
          </div>
          <button
            onClick={handleClose}
            className="text-ink-muted/60 hover:text-ink-muted"
            data-testid="button-close-remap"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-3 space-y-1.5">
          {tools.map((t) => {
            const listening = listeningId === t.id;
            return (
              <div
                key={t.id}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg hover:bg-white/5"
              >
                <span className="text-sm text-ink">{t.label}</span>
                <button
                  onClick={() => setListeningId(listening ? null : t.id)}
                  data-testid={`button-rebind-${t.id}`}
                  className={`min-w-[68px] text-xs font-semibold px-3 py-1.5 rounded border transition-colors ${
                    listening
                      ? 'border-gold text-gold animate-pulse'
                      : 'border-white/15 text-ink-muted hover:border-brand-strong hover:text-white'
                  }`}
                >
                  {listening ? 'Press a key…' : prettyKey(binds[t.id])}
                </button>
              </div>
            );
          })}
        </div>

        <div className="px-4 py-3 border-t border-white/10 flex items-center justify-between">
          <button
            onClick={() => { setListeningId(null); onReset && onReset(); }}
            className="flex items-center gap-1.5 text-xs text-ink-muted/80 hover:text-ink-muted"
            data-testid="button-reset-keybinds"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset to defaults
          </button>
          <span className="text-[10px] text-ink-muted/40">Click a key, then press the new shortcut</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
