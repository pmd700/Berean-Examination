import React from 'react';

/**
 * The Knowledge Web's name in the header, renamable in place.
 *
 * Double-click turns the label into a field; Enter or clicking away commits,
 * Escape abandons. A private web's name is encrypted at rest, so committing
 * goes through the caller rather than writing the title directly — and if the
 * web is locked the rename is refused there, which is why `onRename` may throw
 * and the old name has to be put back.
 */
export default function InlineWebTitle({ title, onRename, disabled = false, children }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(title || '');
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef(null);
  // Guards the blur handler: committing from Enter blurs the field, and
  // without this the commit would run a second time on the way out.
  const settledRef = React.useRef(false);

  React.useEffect(() => {
    if (!editing) setDraft(title || '');
  }, [title, editing]);

  const begin = () => {
    if (disabled) return;
    settledRef.current = false;
    setDraft(title || '');
    setEditing(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };

  const cancel = () => {
    settledRef.current = true;
    setDraft(title || '');
    setEditing(false);
  };

  const commit = async () => {
    if (settledRef.current) return;
    settledRef.current = true;

    const clean = draft.trim();
    // An empty name is not a rename, and neither is the name it already had.
    if (!clean || clean === (title || '')) {
      setDraft(title || '');
      setEditing(false);
      return;
    }

    setBusy(true);
    try {
      await onRename(clean);
      setEditing(false);
    } catch {
      // The caller reports the reason; here the old name simply comes back.
      setDraft(title || '');
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        disabled={busy}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); commit(); }
          else if (event.key === 'Escape') { event.preventDefault(); cancel(); }
          // The canvas listens for plenty of bare keys; none of them should
          // fire while a name is being typed.
          event.stopPropagation();
        }}
        className="min-w-0 max-w-[18rem] rounded border border-violet-400/60 bg-black/30 px-1.5 py-0.5 text-sm font-medium text-gray-100 outline-none disabled:opacity-60"
        aria-label="Knowledge Web name"
        data-testid="web-title-input"
      />
    );
  }

  return (
    <span
      className={`truncate text-sm font-medium text-gray-300 ${disabled ? '' : 'cursor-text rounded px-1 -mx-1 hover:bg-white/[0.06]'}`}
      onDoubleClick={begin}
      title={disabled ? undefined : 'Double-click to rename'}
      data-testid="web-title-label"
    >
      {children}
    </span>
  );
}
