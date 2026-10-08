import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { X, Minus, Maximize2, Trash2, Save, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SaveStatusIndicator from '@/components/editor/SaveStatusIndicator';

// Default size for the floating window. Larger than the previous Dialog
// so the rich-text editor has plenty of breathing room.
const DEFAULT_SIZE = { width: 960, height: 680 };
const MIN_SIZE = { width: 520, height: 380 };
const EDGE_PADDING = 16;

/**
 * macOS-style draggable, resizable annotation window with traffic-light
 * controls (close, minimize, maximize). Minimizing folds the window
 * down into a small pill that the user can click to expand again.
 */
// Compute initial centered geometry synchronously (avoids an open-frame
// flash where the window briefly renders at 0,0 before the centering
// effect runs).
function computeInitialGeometry() {
  if (typeof window === 'undefined') {
    return { position: { x: 0, y: 0 }, size: DEFAULT_SIZE };
  }
  const w = Math.min(DEFAULT_SIZE.width, window.innerWidth - EDGE_PADDING * 2);
  const h = Math.min(DEFAULT_SIZE.height, window.innerHeight - EDGE_PADDING * 2);
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
  saveStatus,
  onSave,
  onDelete,
  saving,
  children,
}) {
  // 'normal' | 'minimized' | 'maximized'
  const [mode, setMode] = useState('normal');
  // Initialize geometry lazily so the first paint is already centered.
  const initial = useRef(computeInitialGeometry());
  const [position, setPosition] = useState(initial.current.position);
  const [size, setSize] = useState(initial.current.size);
  const dragControls = useDragControls();
  const constraintsRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  // Re-center the window each time it opens, and remember which element
  // had focus so we can restore it on close.
  useEffect(() => {
    if (!isOpen) return;
    setMode('normal');
    const geo = computeInitialGeometry();
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

  // Manual resize from the bottom-right corner. Listens at window level
  // so the drag stays smooth even if the cursor leaves the handle.
  const startResize = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = size.width;
    const startH = size.height;
    const onMove = (ev) => {
      const newW = Math.max(MIN_SIZE.width, Math.min(window.innerWidth - EDGE_PADDING * 2, startW + (ev.clientX - startX)));
      const newH = Math.max(MIN_SIZE.height, Math.min(window.innerHeight - EDGE_PADDING * 2, startH + (ev.clientY - startY)));
      setSize({ width: newW, height: newH });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [size.width, size.height]);

  // Start dragging only when the user grabs the title bar (not the
  // traffic lights or save indicator).
  const onTitleBarPointerDown = (e) => {
    if (mode !== 'normal') return;
    if (e.target.closest('[data-no-drag]')) return;
    dragControls.start(e);
  };

  if (!isOpen) return null;

  // Geometry for the current mode.
  const isMax = mode === 'maximized';
  const winStyle = isMax
    ? {
        left: EDGE_PADDING,
        top: EDGE_PADDING,
        width: window.innerWidth - EDGE_PADDING * 2,
        height: window.innerHeight - EDGE_PADDING * 2,
      }
    : {
        left: position?.x ?? 0,
        top: position?.y ?? 0,
        width: size.width,
        height: size.height,
      };

  const content = (
    <>
      {/* Invisible drag-constraint area covering the whole viewport so
          framer-motion knows where the window is allowed to live. */}
      <div ref={constraintsRef} className="pointer-events-none fixed inset-0 z-[90]" />

      <AnimatePresence>
        {mode !== 'minimized' ? (
          <motion.div
            key="window"
            layoutId="annotation-window"
            data-testid="window-annotation"
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.18, ease: 'easeOut' } }}
            transition={{
              layout: { type: 'spring', damping: 32, stiffness: 340, mass: 0.9 },
              default: { type: 'spring', damping: 28, stiffness: 320 },
            }}
            drag={!isMax}
            dragControls={dragControls}
            dragListener={false}
            dragMomentum={false}
            dragConstraints={constraintsRef}
            dragElastic={0}
            onDragEnd={(_, info) => {
              if (isMax) return;
              setPosition((prev) => ({
                x: Math.max(EDGE_PADDING, (prev?.x ?? 0) + info.offset.x),
                y: Math.max(EDGE_PADDING, (prev?.y ?? 0) + info.offset.y),
              }));
            }}
            style={{ position: 'fixed', zIndex: 100, ...winStyle }}
            className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface/95 text-ink shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] backdrop-blur-xl"
          >
            {/* macOS title bar with traffic-light controls */}
            <div
              onPointerDown={onTitleBarPointerDown}
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
            <div className="flex min-h-0 flex-1 flex-col p-5 [&>*]:flex-1 [&>*]:min-h-0">
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
                onMouseDown={startResize}
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
            layoutId="annotation-window"
            onClick={() => setMode('normal')}
            data-testid="button-window-restore"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.15, ease: 'easeOut' } }}
            transition={{
              layout: { type: 'spring', damping: 32, stiffness: 340, mass: 0.9 },
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
