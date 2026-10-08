import React from 'react';
import ReactDOM from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  Copy,
  Paintbrush,
  Trash2,
  XCircle,
} from 'lucide-react';
import { CELL_COLORS } from '@/components/editor/TableCellBackground';
import { GRIP_AXIS } from '@/components/editor/tableGripModel';
import {
  clearBandContents,
  duplicateBand,
  selectBandCommand,
  setBandBackground,
} from '@/components/editor/tableBandCommands';

/**
 * The menu a column or row grip opens.
 *
 * Every action runs against the band the grip belongs to, not against wherever
 * the caret happens to be — the band is selected first, so the editor's own
 * insert and delete commands act on the right column even if the user last
 * typed somewhere else in the table.
 */

const MENU_WIDTH = 220;
const ESTIMATED_HEIGHT = 260;

function useDismiss(open, onClose) {
  React.useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!event.target.closest?.('[data-bex-table-grip-menu]')) onClose();
    };
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, onClose]);
}

export default function TableGripMenu({ editor, request, onClose }) {
  const [colorOpen, setColorOpen] = React.useState(false);
  useDismiss(Boolean(request), onClose);

  React.useEffect(() => { setColorOpen(false); }, [request]);

  if (!request || !editor) return null;

  const { axis, index, tablePos, gripRect } = request;
  const isColumn = axis === GRIP_AXIS.COLUMN;

  // Runs a plain ProseMirror command against the band, then closes.
  const run = (command) => {
    command(editor.state, editor.view.dispatch);
    editor.view.focus();
    onClose();
  };

  // Runs one of the editor's own chained commands, after making sure the band
  // is what is selected.
  const runChain = (apply) => {
    selectBandCommand(tablePos, axis, index)(editor.state, editor.view.dispatch);
    apply(editor.chain().focus());
    onClose();
  };

  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const left = Math.min(Math.max(12, gripRect.left), Math.max(12, viewportWidth - MENU_WIDTH - 12));
  const below = gripRect.top + gripRect.height + 6;
  const top = below + ESTIMATED_HEIGHT <= viewportHeight - 12
    ? below
    : Math.max(12, gripRect.top - ESTIMATED_HEIGHT - 6);

  const rowClass = 'flex w-full items-center gap-2.5 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700/60';
  const dangerClass = 'flex w-full items-center gap-2.5 px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-500/10';

  return ReactDOM.createPortal((
    <AnimatePresence>
      <motion.div
        key={`${axis}-${index}`}
        data-bex-table-grip-menu
        data-testid="table-grip-menu"
        role="menu"
        aria-label={isColumn ? 'Column actions' : 'Row actions'}
        initial={{ opacity: 0, scale: 0.97, y: 4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 2 }}
        transition={{ duration: 0.12 }}
        style={{ position: 'fixed', left, top, width: MENU_WIDTH, zIndex: 100000 }}
        className="overflow-visible rounded-lg border border-gray-200 bg-white py-1.5 shadow-2xl dark:border-gray-700 dark:bg-gray-800"
      >
        <button type="button" role="menuitem" className={rowClass}
          onClick={() => run(clearBandContents(tablePos, axis, index))}>
          <XCircle className="h-3.5 w-3.5 shrink-0" /> Clear contents
        </button>

        <button type="button" role="menuitem" className={rowClass}
          onClick={() => runChain((chain) => (isColumn ? chain.addColumnBefore() : chain.addRowBefore()).run())}>
          {isColumn ? <ArrowLeft className="h-3.5 w-3.5 shrink-0" /> : <ArrowUp className="h-3.5 w-3.5 shrink-0" />}
          {isColumn ? 'Insert left' : 'Insert above'}
        </button>

        <button type="button" role="menuitem" className={rowClass}
          onClick={() => runChain((chain) => (isColumn ? chain.addColumnAfter() : chain.addRowAfter()).run())}>
          {isColumn ? <ArrowRight className="h-3.5 w-3.5 shrink-0" /> : <ArrowDown className="h-3.5 w-3.5 shrink-0" />}
          {isColumn ? 'Insert right' : 'Insert below'}
        </button>

        <button type="button" role="menuitem" className={rowClass}
          onClick={() => run(duplicateBand(tablePos, axis, index))}>
          <Copy className="h-3.5 w-3.5 shrink-0" /> Duplicate
        </button>

        <div
          className="relative"
          onMouseEnter={() => setColorOpen(true)}
          onMouseLeave={() => setColorOpen(false)}
        >
          <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={colorOpen}
            className={rowClass} onClick={() => setColorOpen((open) => !open)}>
            <Paintbrush className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1 text-left">Color</span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" />
          </button>
          {colorOpen && (
            <div
              role="menu"
              aria-label="Cell color"
              data-testid="table-grip-color-menu"
              className="absolute left-full top-0 ml-1 max-h-64 w-40 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1.5 shadow-2xl dark:border-gray-700 dark:bg-gray-800"
            >
              {CELL_COLORS.map((color) => (
                <button key={color.id} type="button" role="menuitem" className={rowClass}
                  onClick={() => run(setBandBackground(tablePos, axis, index, color.value))}>
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded border border-gray-300 dark:border-gray-600"
                    style={color.value ? { background: color.value } : undefined}
                  />
                  {color.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="my-1 border-t border-gray-100 dark:border-gray-700/60" />

        <button type="button" role="menuitem" className={dangerClass}
          onClick={() => runChain((chain) => (isColumn ? chain.deleteColumn() : chain.deleteRow()).run())}>
          <Trash2 className="h-3.5 w-3.5 shrink-0" /> Delete
        </button>
      </motion.div>
    </AnimatePresence>
  ), document.body);
}
