import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Minus, Maximize2, Trash2, Save, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SaveStatusIndicator from '@/components/editor/SaveStatusIndicator';

const DEFAULT_SIZE = { width: 960, height: 680 };
const ANNOTATION_SIZE = { width: 560, height: 360 };
const EXPANDED_SIZE = { width: 820, height: 560 };
const MIN_SIZE = { width: 360, height: 280 };
const EDGE_PADDING = 16;

/**
 * macOS-style draggable, resizable annotation window with traffic-light
 * controls (close, minimize, maximize). Minimizing folds the window
 * down into a small pill that the user can click to expand again.
 */
// Compute initial centered geometry synchronously (avoids an open-frame
// flash where the window briefly renders at 0,0 before the centering
// effect runs).
function computeInitialGeometry(defaultSize = DEFAULT_SIZE) {
  if (typeof window === 'undefined') {
    return { position: { x: 0, y: 0 }, size: defaultSize };
  }
  const w = Math.min(defaultSize.width, window.innerWidth - EDGE_PADDING * 2);
  const h = Math.min(defaultSize.height, window.innerHeight - EDGE_PADDING * 2);
  return {
    position: {
      x: Math.max(EDGE_PADDING, (window.innerWidth - w) / 2),
      y: Math.max(EDGE_PADDING, (window.innerHeight - h) / 2),
    },
    size: { width: w, height: h },
  };
}

export default function AnnotationWindow({
  isOpen,
  onClose,
  title,
  saveStatus = null,
  onSave,
  onDelete = null,
  saving = false,
  children,
  autoExpandContent = null,
  bodyClassName = 'p-5',
}) {
  // 'normal' | 'minimized' | 'maximized'
  const [mode, setMode] = useState('normal');
  // Initialize geometry lazily so the first paint is already centered.
  const defaultSize = autoExpandContent === null ? DEFAULT_SIZE : ANNOTATION_SIZE;
  const initial = useRef(computeInitialGeometry(defaultSize));
  const [position, setPosition] = useState(initial.current.position);
  const [size, setSize] = useState(initial.current.size);
  const windowRef = useRef(null);
  const interactionRef = useRef(null);
  const autoExpandedRef = useRef(false);
  const [autoExpanding, setAutoExpanding] = useState(false);
  const characterCount = useMemo(() => {
    if (autoExpandContent === null) return 0;
    const doc = new DOMParser().parseFromString(autoExpandContent, 'text/html');
    return Array.from(doc.body.textContent || '').length;
  }, [autoExpandContent]);
  const previouslyFocusedRef = useRef(null);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const compact = viewport.width < 1024;

  useEffect(() => {
    if (!isOpen) return undefined;
    const resize = () => {
      setAutoExpanding(false);
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [isOpen]);

  // Re-center the window each time it opens, and remember which element
  // had focus so we can restore it on close.
  useEffect(() => {
    if (!isOpen) return;
    setMode('normal');
    autoExpandedRef.current = false;
    setAutoExpanding(false);
    const geo = computeInitialGeometry(defaultSize);
    setPosition(geo.position);
    setSize(geo.size);
    if (typeof document !== 'undefined') {
      previouslyFocusedRef.current = document.activeElement;
    }
    return () => {
      const el = previouslyFocusedRef.current;
      if (el && typeof el.focus === 'function') {
        try { el.focus(); } catch {/* ignore */}
      }
      previouslyFocusedRef.current = null;
    };
  }, [isOpen]);

  // Escape closes the window unless the user is mid-text-edit in a
  // contentEditable surface or the editor's own popovers want it.
  useEffect(() => {
    if (!isOpen || mode === 'minimized') return;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      const tag = (e.target?.tagName || '').toLowerCase();
      // Inputs/textarea Escape is handled by the field; for the
      // ProseMirror editor we still let Escape close the window since
      // it doesn't bind Escape itself.
      if (tag === 'input' || tag === 'textarea') return;
      onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, mode, onClose]);

  // Keep only one set of coordinates. During a gesture, write geometry
  // directly so pointer movement never waits on an editor render or spring.
  const startInteraction = (e, kind) => {
    if (mode !== 'normal' || e.button !== 0) return;
    if (kind === 'drag' && e.target.closest('[data-no-drag]')) return;
    e.preventDefault();
    e.stopPropagation();
    interactionRef.current?.();
    const el = windowRef.current;
    const rect = el.getBoundingClientRect();
    const start = rect.width ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      : Object.fromEntries(['left', 'top', 'width', 'height'].map(key => [key, parseFloat(el.style[key])]));
    let current = start;
    const startX = e.clientX;
    const startY = e.clientY;
    el.style.transition = 'none';
    for (const key of ['left', 'top', 'width', 'height']) el.style[key] = `${start[key]}px`;
    setAutoExpanding(false);
    const onMove = (ev) => {
      const minTop = window.innerWidth < 1024 ? 52 : EDGE_PADDING;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (kind === 'drag') {
        current = { ...start,
          left: Math.max(EDGE_PADDING, Math.min(start.left + dx, window.innerWidth - start.width - EDGE_PADDING)),
          top: Math.max(minTop, Math.min(start.top + dy, window.innerHeight - start.height - EDGE_PADDING)),
        };
      } else {
        current = { ...start,
          width: Math.min(window.innerWidth - start.left - EDGE_PADDING, Math.max(MIN_SIZE.width, start.width + dx)),
          height: Math.min(window.innerHeight - start.top - EDGE_PADDING, Math.max(MIN_SIZE.height, start.height + dy)),
        };
      }
      for (const key of ['left', 'top', 'width', 'height']) el.style[key] = `${current[key]}px`;
    };
    const cleanup = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onUp);
      interactionRef.current = null;
    };
    const onUp = () => {
      cleanup();
      setPosition({ x: current.left, y: current.top });
      setSize({ width: current.width, height: current.height });
    };
    interactionRef.current = cleanup;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onUp);
  };

  useEffect(() => () => interactionRef.current?.(), [isOpen, mode]);

  // Grow once per opening, counting text rather than rich-text HTML tags.
  // Deleting text does not undo the user's chosen size or scroll position.
  useEffect(() => {
    if (!isOpen || characterCount <= 465 || autoExpandedRef.current || interactionRef.current) return;
    autoExpandedRef.current = true;
    setAutoExpanding(true);
    setSize(prev => ({ width: Math.max(prev.width, EXPANDED_SIZE.width), height: Math.max(prev.height, EXPANDED_SIZE.height) }));
  }, [isOpen, characterCount, position]);

  if (!isOpen) return null;

  // Geometry for the current mode.
  const isMax = mode === 'maximized';
  // Fit without overwriting the saved desktop geometry or remounting the
  // editor. Leaving Split View returns to the user's original window size.
  const minTop = compact ? 52 : EDGE_PADDING;
  const width = Math.min(size.width, viewport.width - EDGE_PADDING * 2);
  const height = Math.min(size.height, viewport.height - minTop - EDGE_PADDING);
  const winStyle = {
    left: isMax ? EDGE_PADDING : Math.max(EDGE_PADDING, Math.min(position.x, viewport.width - width - EDGE_PADDING)),
    top: isMax ? minTop : Math.max(minTop, Math.min(position.y, viewport.height - height - EDGE_PADDING)),
    width: isMax ? viewport.width - EDGE_PADDING * 2 : width,
    height: isMax ? viewport.height - minTop - EDGE_PADDING : height,
  };

  const content = (
    <>
      <AnimatePresence>
        {mode !== 'minimized' ? (
          <motion.div
            key="window"
            ref={windowRef}
            data-testid="window-annotation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.18, ease: 'easeOut' } }}
            transition={{ opacity: { duration: 0.18, ease: 'easeOut' } }}
            style={{ position: 'fixed', zIndex: 100, ...winStyle,
              transition: autoExpanding ? 'width 240ms ease-out, height 240ms ease-out, left 240ms ease-out, top 240ms ease-out' : 'none',
            }}
            onTransitionEnd={e => { if (e.target === e.currentTarget) setAutoExpanding(false); }}
            className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface/95 text-ink shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] backdrop-blur-xl"
          >
            {/* macOS title bar with traffic-light controls */}
            <div
              onMouseDown={e => startInteraction(e, 'drag')}
              data-testid="handle-window-drag"
              onDoubleClick={() => setMode(isMax ? 'normal' : 'maximized')}
              className={`relative flex items-center gap-3 border-b border-line bg-gradient-to-b from-elevated to-[#13161D] px-4 py-2.5 select-none ${isMax ? '' : 'cursor-grab active:cursor-grabbing'}`}
            >
              <div className="flex items-center gap-2" data-no-drag>
                <button
                  type="button"
                  onClick={onClose}
                  data-testid="button-window-close"
                  title="Close"
                  aria-label="Close"
                  className="group flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#FF5F57] ring-1 ring-black/20 transition-transform hover:brightness-110 active:scale-95"
                >
                  <X className="h-2.5 w-2.5 text-[#7B0E08] opacity-0 group-hover:opacity-100" strokeWidth={3} />
                </button>
                <button
                  type="button"
                  onClick={() => setMode('minimized')}
                  data-testid="button-window-minimize"
                  title="Minimize"
                  aria-label="Minimize"
                  className="group flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#FEBC2E] ring-1 ring-black/20 transition-transform hover:brightness-110 active:scale-95"
                >
                  <Minus className="h-2.5 w-2.5 text-[#9A5F0F] opacity-0 group-hover:opacity-100" strokeWidth={3} />
                </button>
                <button
                  type="button"
                  onClick={() => setMode(isMax ? 'normal' : 'maximized')}
                  data-testid="button-window-maximize"
                  title={isMax ? 'Restore' : 'Maximize'}
                  aria-label={isMax ? 'Restore' : 'Maximize'}
                  className="group flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#28C840] ring-1 ring-black/20 transition-transform hover:brightness-110 active:scale-95"
                >
                  <Maximize2 className="h-2 w-2 text-[#0B6620] opacity-0 group-hover:opacity-100" strokeWidth={3} />
                </button>
              </div>
              <div className="pointer-events-none absolute inset-x-0 text-center text-sm font-medium text-ink-muted">
                {title}
              </div>
              <div className="ml-auto" data-no-drag>
                <SaveStatusIndicator status={saveStatus} />
              </div>
            </div>

            {/* Body — children stretch to fill the available space */}
            <div className={`flex min-h-0 flex-1 flex-col [&>*]:flex-1 [&>*]:min-h-0 ${bodyClassName}`}>
              {children}
            </div>

            {/* Footer actions */}
            <div className="flex items-center justify-between gap-3 border-t border-line bg-[#0F1218]/80 px-4 py-3">
              {onDelete ? (
                <Button
                  variant="outline"
                  onClick={onDelete}
                  data-testid="button-window-delete"
                  className="border-red-800/60 text-red-400 hover:bg-red-900/20 hover:text-red-300"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </Button>
              ) : <div />}
              <Button
                onClick={onSave}
                disabled={saving}
                data-testid="button-window-save"
                className="bg-brand text-white hover:bg-brand-strong"
              >
                <Save className="mr-2 h-4 w-4" />
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>

            {/* Resize grip — only available in normal mode */}
            {!isMax && (
              <div
                onMouseDown={e => startInteraction(e, 'resize')}
                data-testid="handle-window-resize"
                className="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize"
                style={{
                  background:
                    'linear-gradient(135deg, transparent 55%, rgba(124,92,183,0.55) 55%, rgba(124,92,183,0.55) 65%, transparent 65%, transparent 75%, rgba(124,92,183,0.55) 75%, rgba(124,92,183,0.55) 85%, transparent 85%)',
                }}
                title="Drag to resize"
              />
            )}
          </motion.div>
        ) : (
          <motion.button
            type="button"
            key="minimized"
            onClick={() => setMode('normal')}
            data-testid="button-window-restore"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.15, ease: 'easeOut' } }}
            transition={{
              opacity: { duration: 0.18, ease: 'easeOut' },
            }}
            style={{ position: 'fixed', bottom: 24, left: 24, zIndex: 100 }}
            className="flex items-center gap-2 rounded-full border border-line bg-surface/95 px-4 py-2.5 text-sm text-ink shadow-[0_20px_50px_-12px_rgba(0,0,0,0.7)] backdrop-blur-xl transition-colors hover:border-brand"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand/20 text-brand-strong">
              <FileText className="h-3.5 w-3.5" />
            </span>
            <span className="max-w-[200px] truncate font-medium">{title}</span>
            <span className="ml-1 text-xs text-ink-faint">Click to restore</span>
          </motion.button>
        )}
      </AnimatePresence>
    </>
  );

  return createPortal(content, document.body);
}
