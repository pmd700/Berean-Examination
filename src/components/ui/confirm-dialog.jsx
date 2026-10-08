import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, Check, X, AlertTriangle } from 'lucide-react';
import HolographicShader from '@/components/shaders/HolographicShader';

// ─────────────────────────────────────────────────────────────────────────
// Promise-based confirmation dialog.
//
// Replaces the native, browser-chrome `window.confirm()` with an on-brand
// "cyber-intelligence metallic" card: live shader glow, glass surface,
// stacked shadows, a subtle 3D cursor-tilt, and satisfying confirm / cancel
// state transitions.
//
// Usage (anywhere — no hook required):
//
//   import { confirmDialog } from '@/components/ui/confirm-dialog';
//   const ok = await confirmDialog({
//     title: 'Delete note',
//     description: 'This also removes its links.',
//     confirmText: 'Delete',
//     tone: 'danger',
//   });
//   if (!ok) return;
//
// A single <ConfirmDialogHost /> must be mounted once near the app root
// (see App.jsx). The module-level `confirmDialog` talks to it through the
// `openFn` bridge below.
// ─────────────────────────────────────────────────────────────────────────

let openFn = null;

/**
 * Open the confirmation dialog. Resolves to `true` when confirmed,
 * `false` when cancelled / dismissed. Falls back to the native confirm if
 * the host somehow isn't mounted yet, so callers can always trust it.
 */
export function confirmDialog(opts = {}) {
  if (typeof openFn !== 'function') {
    // A native confirm cannot enforce a countdown. Fail closed for timed actions.
    if (Number(opts.confirmDelaySeconds) > 0) return Promise.resolve(false);
    const msg = opts.description
      ? `${opts.title ? opts.title + '\n\n' : ''}${opts.description}`
      : opts.title || 'Are you sure?';
    return Promise.resolve(window.confirm(msg));
  }
  return openFn(opts);
}

export function ConfirmDialogHost() {
  // The active request: { opts, resolve } or null when idle.
  const [req, setReq] = useState(null);
  // Drives the enter/exit CSS transition independently of mount/unmount.
  const [shown, setShown] = useState(false);
  // 'idle' | 'confirming' | 'cancelling' — powers the button flourish.
  const [phase, setPhase] = useState('idle');
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  const tiltRef = useRef(null);
  const glowRef = useRef(null);
  const cardRef = useRef(null);
  const timers = useRef([]);
  // The live request lives in a ref too so `close()` can settle the promise
  // without reading it from a state-updater (which can run twice and would
  // double-fire timers / resolve). `closingRef` guards re-entrancy.
  const activeRef = useRef(null);
  const closingRef = useRef(false);
  // The element focused before the dialog opened, so we can restore it on close.
  const lastFocusRef = useRef(null);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  // Register the module bridge so `confirmDialog()` can drive this host.
  useEffect(() => {
    openFn = (opts) =>
      new Promise((resolve) => {
        clearTimers();
        // If a request is still pending (rapid re-open while one is open or
        // mid-exit), settle it as cancelled so its caller never hangs.
        if (activeRef.current) {
          const prev = activeRef.current;
          activeRef.current = null;
          prev.resolve(false);
        }
        closingRef.current = false;
        lastFocusRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const requestedDelay = Number(opts?.confirmDelaySeconds);
        const delayMs = Number.isFinite(requestedDelay) ? Math.max(0, requestedDelay * 1000) : 0;
        activeRef.current = { resolve, readyAt: delayMs ? Infinity : 0 };
        setRemainingSeconds(Math.ceil(delayMs / 1000));
        setReq({ opts: opts || {}, resolve, delayMs });
        setPhase('idle');
        setShown(false);
        // Two rAFs: mount at the "from" state, then flip to "to" so the
        // browser actually animates the entrance instead of snapping.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => setShown(true)),
        );
      });
    return () => {
      openFn = null;
      clearTimers();
      // Host is going away — never leave an awaiting caller hanging.
      if (activeRef.current) {
        const prev = activeRef.current;
        activeRef.current = null;
        prev.resolve(false);
      }
    };
  }, []);

  // Start after the request is rendered. Use an elapsed-time deadline so
  // delayed browser timers cannot shorten the mandatory wait.
  useEffect(() => {
    if (!req?.delayMs) return undefined;
    const active = activeRef.current;
    if (!active || active.resolve !== req.resolve) return undefined;
    const readyAt = performance.now() + req.delayMs;
    active.readyAt = readyAt;
    let timer;
    const tick = () => {
      const remaining = Math.max(0, readyAt - performance.now());
      setRemainingSeconds(Math.ceil(remaining / 1000));
      if (remaining > 0) timer = setTimeout(tick, Math.min(1000, remaining));
    };
    tick();
    return () => clearTimeout(timer);
  }, [req]);

  const close = useCallback((value) => {
    const active = activeRef.current;
    if (!active || closingRef.current) return;
    // Guard the action itself as well as the button, including Enter presses.
    if (value && performance.now() < active.readyAt) return;
    closingRef.current = true;
    const { resolve } = active;
    activeRef.current = null;
    if (value) {
      // Confirm: let the "confirming" flourish play, fire the action
      // mid-exit so it feels instant, then collapse the card.
      setPhase('confirming');
      timers.current.push(
        setTimeout(() => {
          resolve(true);
          setShown(false);
          timers.current.push(
            setTimeout(() => {
              setReq(null);
              setPhase('idle');
            }, 220),
          );
        }, 360),
      );
    } else {
      // Cancel / dismiss: quick acknowledging dip, then out.
      setPhase('cancelling');
      setShown(false);
      resolve(false);
      timers.current.push(
        setTimeout(() => {
          setReq(null);
          setPhase('idle');
        }, 200),
      );
    }
  }, []);

  // Escape closes (cancel), Enter confirms, Tab is trapped within the dialog.
  // Bound only while a request is live.
  useEffect(() => {
    if (!req) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (phase === 'idle') close(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (phase === 'idle') close(true);
      } else if (e.key === 'Tab') {
        // Focus trap: keep Tab / Shift+Tab cycling inside the card so
        // keyboard users can't reach the background while the modal is open.
        const root = cardRef.current;
        if (!root) return;
        const focusables = root.querySelectorAll(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [req, phase, close]);

  // Restore focus to whatever was focused before the dialog opened, once it
  // fully closes (req cleared). Runs after unmount of the card content.
  useEffect(() => {
    if (req) return;
    const prev = lastFocusRef.current;
    lastFocusRef.current = null;
    if (prev && typeof prev.focus === 'function' && document.contains(prev)) {
      prev.focus();
    }
  }, [req]);

  // Cursor-tracking 3D tilt + specular highlight. Direct DOM writes keep
  // this off the React render path (no 60fps re-renders).
  const handleMove = (e) => {
    const el = tiltRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    const rx = (-py * 6).toFixed(2);
    const ry = (px * 6).toFixed(2);
    el.style.setProperty('--rx', `${rx}deg`);
    el.style.setProperty('--ry', `${ry}deg`);
    if (glowRef.current) {
      glowRef.current.style.background = `radial-gradient(440px circle at ${
        (px + 0.5) * 100
      }% ${(py + 0.5) * 100}%, rgb(var(--ink-muted) / 0.12), transparent 55%)`;
    }
  };
  const handleLeave = () => {
    const el = tiltRef.current;
    if (!el) return;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
    if (glowRef.current) glowRef.current.style.background = 'transparent';
  };

  if (!req) return null;

  const {
    title = 'Are you sure?',
    description = '',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    tone = 'danger', // 'danger' | 'default'
  } = req.opts;

  const isDanger = tone === 'danger';
  const busy = phase !== 'idle';
  const waiting = remainingSeconds > 0;

  return createPortal(
    <div
      className="cfm-overlay"
      data-open={shown}
      onMouseDown={(e) => {
        // Backdrop click cancels — but only direct hits on the overlay.
        if (e.target === e.currentTarget && phase === 'idle') close(false);
      }}
      role="presentation"
    >
      <div
        className="cfm-card-wrap"
        data-open={shown}
        data-phase={phase}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      >
        <div ref={tiltRef} className="cfm-card" data-tone={tone} data-testid="dialog-confirm">
          {/* Live shader glow behind the glass. */}
          <div className="cfm-shader" aria-hidden="true">
            <HolographicShader
              intensity={isDanger ? 0.5 : 0.55}
              hueShift={isDanger ? 0.85 : 0.1}
              speed={0.9}
            />
          </div>
          {/* Glass + cursor specular + rim highlight. */}
          <div className="cfm-glass" aria-hidden="true" />
          <div ref={glowRef} className="cfm-specular" aria-hidden="true" />
          <div className="cfm-rim" aria-hidden="true" />

          {/* Content */}
          <div
            ref={cardRef}
            className="relative z-10 p-6"
            role="alertdialog"
            aria-modal="true"
            aria-label={title}
          >
            <div className="flex items-start gap-4">
              <div className="cfm-icon" data-tone={tone} aria-hidden="true">
                {isDanger ? (
                  <AlertTriangle className="w-5 h-5" strokeWidth={2.25} />
                ) : (
                  <Check className="w-5 h-5" strokeWidth={2.25} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h2
                  className="font-signature text-[17px] leading-tight text-slate-100 tracking-wide"
                  data-testid="text-confirm-title"
                >
                  {title}
                </h2>
                {description ? (
                  <p
                    className="mt-1.5 text-[13.5px] leading-relaxed text-slate-400"
                    data-testid="text-confirm-description"
                  >
                    {description}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                className="cfm-btn cfm-btn-cancel"
                onClick={() => phase === 'idle' && close(false)}
                disabled={busy}
                autoFocus={req.delayMs > 0}
                data-testid="button-confirm-cancel"
              >
                <span className="cfm-btn-label">
                  <X className="w-4 h-4" strokeWidth={2.25} />
                  {cancelText}
                </span>
              </button>

              <div className="cfm-confirm-slot">
                {req.delayMs > 0 && (
                  <span className="cfm-countdown" role="status" aria-live="polite"
                    style={{ visibility: waiting ? 'visible' : 'hidden' }}
                    data-testid="confirm-countdown">
                    Please wait {Math.max(1, remainingSeconds)}s
                  </span>
                )}
                <button
                  type="button"
                  className="cfm-btn cfm-btn-confirm"
                  data-waiting={waiting}
                  aria-hidden={waiting || undefined}
                  tabIndex={waiting ? -1 : 0}
                  data-tone={tone}
                  onClick={() => phase === 'idle' && close(true)}
                  disabled={busy || waiting}
                  autoFocus={!req.delayMs}
                  data-testid="button-confirm-accept"
                >
                  <span className="cfm-btn-sweep" aria-hidden="true" />
                  <span className="cfm-btn-label">
                    <span className="cfm-btn-ico">
                      {isDanger ? (
                        <Trash2 className="cfm-ico-default w-4 h-4" strokeWidth={2.25} />
                      ) : (
                        <Check className="cfm-ico-default w-4 h-4" strokeWidth={2.25} />
                      )}
                      <Check className="cfm-ico-done w-4 h-4" strokeWidth={2.75} />
                    </span>
                    {confirmText}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default ConfirmDialogHost;
