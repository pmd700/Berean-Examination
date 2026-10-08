import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { COPY_FEEDBACK_EVENT } from '@/lib/copyFeedback';

/** Long enough to catch out of the corner of an eye, short enough to ignore. */
const VISIBLE_MS = 1900;

/**
 * A quiet line in the corner saying whether the last copy landed.
 *
 * Two things feed it. Any ordinary copy — a caret selection, anywhere in the
 * app — is caught from the document's own `copy` and `cut` events, so no surface
 * has to be wired up individually. The copies the browser does not perform
 * itself, such as a whole-block selection written through the Clipboard API,
 * announce themselves through `announceCopy`.
 *
 * It reports failure too. A copy that silently does nothing is the whole reason
 * this exists; a green flash that only appears when everything already worked
 * would confirm nothing on the one occasion it mattered.
 */
export default function CopyConfirmation() {
  const [note, setNote] = React.useState(null);
  const timer = React.useRef(null);

  const show = React.useCallback((detail) => {
    setNote(detail);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNote(null), VISIBLE_MS);
  }, []);

  React.useEffect(() => {
    const onAnnounced = (event) => {
      const detail = event.detail || {};
      show({ ok: detail.ok !== false, message: detail.message || (detail.ok === false ? 'Copy failed' : 'Copied') });
    };

    // The browser's own copy. An empty selection still fires the event — the
    // user pressed the keys and nothing was there to take — so it is only
    // reported when something was genuinely on the clipboard.
    const onNativeCopy = (event) => {
      const selected = window.getSelection?.()?.toString?.() || '';
      if (!selected.trim()) return;
      show({ ok: true, message: event.type === 'cut' ? 'Cut' : 'Copied' });
    };

    window.addEventListener(COPY_FEEDBACK_EVENT, onAnnounced);
    document.addEventListener('copy', onNativeCopy, true);
    document.addEventListener('cut', onNativeCopy, true);
    return () => {
      window.removeEventListener(COPY_FEEDBACK_EVENT, onAnnounced);
      document.removeEventListener('copy', onNativeCopy, true);
      document.removeEventListener('cut', onNativeCopy, true);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [show]);

  return (
    <AnimatePresence>
      {note && (
        <motion.div
          // Deliberately unkeyed. Keying this on each message made a second copy
          // mount a new line while the first was still animating out, and for
          // that moment the two sat on top of each other. One line stays put and
          // its words are replaced instead.
          //
          // Place plain-text feedback just below the top toolbar Copy button.
          // It never intercepts clicks on the document underneath.
          className="pointer-events-none fixed left-4 z-[500] max-w-[calc(100vw-2rem)] select-none text-[10px] font-medium tracking-wide"
          style={{ top: 'calc(var(--bex-tabbar-height, 2.25rem) + 52px)' }}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          role="status"
          aria-live="polite"
          data-testid="copy-confirmation"
          data-copy-ok={note.ok ? 'true' : 'false'}
        >
          <span className={note.ok ? 'text-emerald-400' : 'text-amber-400'}>
            {note.message}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
