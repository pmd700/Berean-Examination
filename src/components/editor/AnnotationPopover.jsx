import React from 'react';
import ReactDOM from 'react-dom';
import { motion } from 'framer-motion';
import { positionLinkPanel } from './linkPanelModel';

/**
 * The floating card behind tooltips and footnotes.
 *
 * Both features need the same things: a panel pinned to a span of text, kept on
 * screen, portaled so a scrolling page or a fullscreen editor cannot clip it,
 * and dismissed by Escape or a press outside. Only the contents differ, so the
 * shell lives here and each feature supplies its own body.
 *
 * Placement reuses positionLinkPanel — the same prefer-below, flip-above,
 * clamp-to-viewport rule the link editor already follows, so the app's floating
 * panels all behave the same way.
 */

/**
 * The screen rectangle covering a span of the document.
 *
 * Falls back to the editor's own box when the span cannot be measured — a
 * position can briefly outrun the view mid-transaction. A panel placed a little
 * loosely is a far better outcome than a panel that never appears: the writer
 * pressed a shortcut and is waiting to type into something.
 */
export function rectForRange(editor, from, to) {
  if (!editor?.view) return null;
  try {
    const start = editor.view.coordsAtPos(Math.max(0, from));
    const end = editor.view.coordsAtPos(Math.max(0, to ?? from));
    return {
      left: Math.min(start.left, end.left),
      right: Math.max(start.right, end.right),
      top: Math.min(start.top, end.top),
      bottom: Math.max(start.bottom, end.bottom),
    };
  } catch {
    const box = editor.view.dom?.getBoundingClientRect?.();
    if (!box) return { left: 0, right: 0, top: 0, bottom: 0 };
    return { left: box.left, right: box.right, top: box.top, bottom: box.top };
  }
}

export default function AnnotationPopover({
  editor,
  from,
  to,
  width = 300,
  height = 180,
  onDismiss,
  children,
  testId,
  variant = 'view',
  fitContent = false,
}) {
  const cardRef = React.useRef(null);
  const [anchorRect, setAnchorRect] = React.useState(() => rectForRange(editor, from, to));

  /**
   * Dismiss exactly once.
   *
   * The panel is kept mounted through its exit animation, and its listeners go
   * with it — so a panel that has already been saved and closed would keep
   * answering the next Escape or press anywhere on the page. For the composer
   * that meant discarding the footnote the user had just written.
   */
  const dismissedRef = React.useRef(false);
  const dismissOnce = React.useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    onDismiss?.();
  }, [onDismiss]);

  // Follow the text. Scrolling the page, resizing the window or editing above
  // the anchor all move it, and a panel left behind points at the wrong words.
  React.useEffect(() => {
    if (!editor) return undefined;
    let frame = null;
    const reposition = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        setAnchorRect(rectForRange(editor, from, to));
      });
    };
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    editor.on('transaction', reposition);
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      editor.off('transaction', reposition);
    };
  }, [editor, from, to]);

  React.useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      dismissOnce();
    };
    const onPointerDown = (event) => {
      if (cardRef.current?.contains(event.target)) return;
      dismissOnce();
    };
    // Capture: a press inside the editor is handled by ProseMirror first, and
    // by then the popover would already have swallowed its own dismissal.
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [dismissOnce]);

  if (typeof document === 'undefined' || !anchorRect) return null;

  const { left, top } = positionLinkPanel(
    anchorRect,
    { width: window.innerWidth, height: window.innerHeight },
    { width, height },
    { gap: 10, margin: 12 },
  );

  // Opening above the text should grow upward, not drop down onto it.
  const opensAbove = top < anchorRect.top;

  return ReactDOM.createPortal((
    <motion.div
      ref={cardRef}
      data-testid={testId}
      data-bex-annotation-popover={variant}
      initial={{ opacity: 0, scale: 0.94, y: opensAbove ? 8 : -8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: opensAbove ? 6 : -6 }}
      transition={{ type: 'spring', stiffness: 520, damping: 34, mass: 0.7 }}
      style={{
        position: 'fixed',
        left,
        top,
        // A panel that is read rather than written in shrinks to what it holds:
        // a four-word aside in a fixed 300px card is mostly empty space. `width`
        // becomes the ceiling, and still the figure placement is measured
        // against, so a narrower card can only ever sit further inside the
        // viewport than the clamp allowed for.
        ...(fitContent ? { width: 'max-content', maxWidth: width } : { width }),
        transformOrigin: opensAbove ? 'bottom left' : 'top left',
        zIndex: 400,
      }}
      className="rounded-lg border border-line bg-[#0A0D14] shadow-[0_18px_48px_rgba(0,0,0,0.6)]"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </motion.div>
  ), document.body);
}
