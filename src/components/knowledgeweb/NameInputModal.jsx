import React, { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

// Small in-app naming dialog used in place of the browser's window.prompt
// (which renders an ugly native chrome dialog). Controlled via `open`;
// Enter confirms, Escape / backdrop click cancels.
export default function NameInputModal({
  open,
  title = 'Name',
  label,
  placeholder = '',
  initialValue = '',
  confirmLabel = 'Create',
  icon: Icon = null,
  onCancel,
  onConfirm,
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setValue(initialValue);
    const t = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 20);
    return () => clearTimeout(t);
  }, [open, initialValue]);

  if (!open) return null;

  const submit = () => { onConfirm?.(value); };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      data-testid="modal-name-input"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
      />
      <div
        className="relative card-metal rounded-xl w-full max-w-sm p-5 shadow-2xl"
        style={{ animation: 'mvPreviewIn 140ms ease-out' }}
      >
        <div className="flex items-start justify-between mb-3">
          <h3 className="font-signature text-lg text-gold flex items-center gap-2">
            {Icon && <Icon className="w-4 h-4 text-brand-strong" />}
            {title}
          </h3>
          <button
            onClick={onCancel}
            className="text-ink-muted/60 hover:text-ink-muted"
            data-testid="button-name-cancel-x"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {label && (
          <label className="block text-[11px] uppercase tracking-wider text-ink-muted/60 mb-1.5">
            {label}
          </label>
        )}

        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
            if (e.key === 'Escape') { e.preventDefault(); onCancel?.(); }
          }}
          placeholder={placeholder}
          className="input-metal w-full text-sm px-3 py-2"
          data-testid="input-name"
        />

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            className="btn-metal text-xs px-3 py-2"
            data-testid="button-name-cancel"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            className="btn-metal text-xs px-4 py-2 bg-brand hover:bg-brand-strong text-white"
            data-testid="button-name-confirm"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
