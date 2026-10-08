import React from 'react';
import ReactDOM from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Ban } from 'lucide-react';
import { HIGHLIGHT_COLORS } from '@/components/editor/HighlightExtension';

/**
 * The colour picker Cmd+H opens.
 *
 * It sits over the selection it is about to colour, so the choice is made while
 * looking at the text it applies to. The selection has to survive the menu
 * being open — clicking a swatch must not move the caret first — which is why
 * every button cancels its own mousedown.
 */

const MENU_WIDTH = 176;
const ESTIMATED_HEIGHT = 300;

export default function HighlightMenu({ editor, open, onClose }) {
  React.useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!event.target.closest?.('[data-bex-highlight-menu]')) onClose();
    };
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, onClose]);

  const anchor = React.useMemo(() => {
    if (!open || !editor) return null;
    const { from, to } = editor.state.selection;
    try {
      const start = editor.view.coordsAtPos(from);
      const end = editor.view.coordsAtPos(to);
      return { left: Math.min(start.left, end.left), top: Math.max(start.bottom, end.bottom) };
    } catch {
      return null;
    }
  }, [open, editor]);

  if (!open || !editor || !anchor) return null;

  const apply = (color) => {
    editor.chain().focus().setHighlight(color).run();
    onClose();
  };

  const clear = () => {
    editor.chain().focus().unsetHighlight().run();
    onClose();
  };

  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const left = Math.min(Math.max(12, anchor.left), Math.max(12, viewportWidth - MENU_WIDTH - 12));
  const below = anchor.top + 8;
  const top = below + ESTIMATED_HEIGHT <= viewportHeight - 12
    ? below
    : Math.max(12, anchor.top - ESTIMATED_HEIGHT - 24);

  const rowClass = 'flex w-full items-center gap-2.5 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700/60';

  return ReactDOM.createPortal((
    <AnimatePresence>
      <motion.div
        data-bex-highlight-menu
        data-testid="highlight-menu"
        role="menu"
        aria-label="Highlight colour"
        initial={{ opacity: 0, scale: 0.97, y: 4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 2 }}
        transition={{ duration: 0.12 }}
        style={{ position: 'fixed', left, top, width: MENU_WIDTH, zIndex: 100000 }}
        className="overflow-hidden rounded-lg border border-gray-200 bg-white py-1.5 shadow-2xl dark:border-gray-700 dark:bg-gray-800"
      >
        <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
          Highlight
        </div>
        {HIGHLIGHT_COLORS.map((color) => (
          <button
            key={color.id}
            type="button"
            role="menuitem"
            className={rowClass}
            // Without this the press moves the caret and the selection the
            // colour was meant for is gone before the click lands.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => apply(color.value)}
          >
            <span
              className="grid h-4 w-4 shrink-0 place-items-center rounded border border-gray-300 text-[9px] font-semibold dark:border-gray-600"
              style={{ background: color.value }}
            >
              A
            </span>
            {color.label}
          </button>
        ))}
        <div className="my-1 border-t border-gray-100 dark:border-gray-700/60" />
        <button
          type="button"
          role="menuitem"
          className={rowClass}
          onMouseDown={(event) => event.preventDefault()}
          onClick={clear}
        >
          <Ban className="h-3.5 w-3.5 shrink-0" /> None
        </button>
      </motion.div>
    </AnimatePresence>
  ), document.body);
}
