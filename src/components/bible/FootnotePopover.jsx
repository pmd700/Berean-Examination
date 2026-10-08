import React, { useEffect, useId, useRef, useState } from 'react';

/**
 * A single clickable footnote marker (superscript letter) with a custom,
 * keyboard-accessible popover. The marker is a real <button> so it is reachable
 * by Tab and toggled by Enter/Space. Escape closes and returns focus. The
 * marker is `user-select: none` so it never pollutes verse text selection or
 * shifts the per-token highlight indices.
 */
export default function FootnotePopover({ segment, book, chapter, verse, debug = false }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const popId = useId();

  const label = segment.text || '*';
  const ariaLabel = `Footnote ${label} for ${book} ${chapter}:${verse}`;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    const onPointer = (e) => {
      if (popRef.current?.contains(e.target)) return;
      if (btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
    };
  }, [open]);

  const renderBody = () => {
    if (Array.isArray(segment.noteSegments) && segment.noteSegments.length > 0) {
      return segment.noteSegments.map((s, i) =>
        s.type === 'italic'
          ? <em key={i}>{s.text}</em>
          : <React.Fragment key={i}>{s.text}</React.Fragment>
      );
    }
    return segment.noteBody || '';
  };

  return (
    <span className="bible-footnote-wrap">
      <button
        ref={btnRef}
        type="button"
        className="bible-footnote-marker"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? popId : undefined}
        data-testid={`footnote-marker-${chapter}-${verse}-${label}`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((o) => !o);
        }}
      >
        {label}
      </button>
      {open && (
        <span
          ref={popRef}
          id={popId}
          role="dialog"
          aria-label={ariaLabel}
          className="bible-footnote-popover card-metal"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <span className="bible-footnote-popover-head">
            {book} {chapter}:{verse}
            {segment.noteType ? <span className="bible-footnote-type"> · {segment.noteType}</span> : null}
          </span>
          <span className="bible-footnote-popover-body">{renderBody()}</span>
          {debug && (
            <span className="bible-footnote-debug">
              {segment.markerId || '—'} → {segment.noteTargetId || '—'}
              {segment.href ? ` (${segment.href})` : ''}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
