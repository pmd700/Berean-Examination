import React from 'react';
import ReactDOM from 'react-dom';
import { motion } from 'framer-motion';
import {
  getSlashState,
  filterSlashCommands,
  dismissSlashMenu,
  setSlashMenuIndex,
  runSlashCommand,
} from './slashCommands';

const MENU_WIDTH = 288;

/**
 * The "/" command menu. Arrow keys, Enter and Escape are handled inside the
 * editor (see slashCommands.js) so the caret never loses focus while you type
 * the query — this component only draws what that state describes.
 */
export default function SlashCommandMenu({ editor }) {
  const [menu, setMenu] = React.useState(null);
  const [coords, setCoords] = React.useState(null);

  React.useEffect(() => {
    if (!editor) return undefined;
    const sync = () => setMenu(getSlashState(editor.state).menu);
    sync();
    editor.on('transaction', sync);
    return () => { editor.off('transaction', sync); };
  }, [editor]);

  // Anchor to the "/" itself, and flip above the line when the menu would run
  // off the bottom of the window.
  React.useLayoutEffect(() => {
    if (!editor || !menu) { setCoords(null); return undefined; }
    const place = () => {
      let caret;
      try {
        caret = editor.view.coordsAtPos(menu.from);
      } catch {
        return;
      }
      const height = 88 + Math.max(1, filterSlashCommands(menu.query).length) * 48;
      const below = caret.bottom + 8;
      const fitsBelow = below + height < window.innerHeight - 8;
      setCoords({
        top: fitsBelow ? below : Math.max(8, caret.top - height - 8),
        left: Math.min(Math.max(caret.left, 8), Math.max(8, window.innerWidth - MENU_WIDTH - 8)),
      });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [editor, menu]);

  if (!menu || !coords) return null;

  const items = filterSlashCommands(menu.query);
  const activeIndex = Math.min(menu.index, Math.max(0, items.length - 1));

  return ReactDOM.createPortal((
    <motion.div
      initial={{ opacity: 0, y: -6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 560, damping: 34, mass: 0.6 }}
      className="fixed z-[100000] rounded-xl border border-line bg-surface/97 backdrop-blur-xl shadow-[0_20px_56px_-14px_rgba(0,0,0,0.8)] overflow-hidden"
      style={{ top: coords.top, left: coords.left, width: MENU_WIDTH }}
      data-testid="menu-slash-commands"
    >
      <div className="px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-ink-faint">
        {items.length ? 'Filtered results' : 'No matching command'}
      </div>

      <div className="px-1.5 pb-1.5">
        {items.map((command, i) => (
          <button
            key={command.id}
            type="button"
            // mousedown would blur the editor and collapse the trigger range
            // before the command could read it.
            onMouseDown={(e) => { e.preventDefault(); runSlashCommand(editor, command); }}
            onMouseEnter={() => setSlashMenuIndex(editor, i)}
            className={`w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors ${
              i === activeIndex ? 'bg-white/[0.07] text-white' : 'text-[#C7CDD9] hover:bg-white/[0.04]'
            }`}
            data-testid={`button-slash-${command.id}`}
          >
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ring-1 ring-inset transition-colors ${
              i === activeIndex
                ? 'bg-violet-500/20 text-violet-200 ring-violet-400/30'
                : 'bg-white/[0.04] text-ink-soft ring-white/5'
            }`}>
              <command.Icon className="w-4 h-4" />
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block text-[13px] font-medium">{command.label}</span>
              <span className="block text-[10.5px] text-ink-faint truncate">{command.hint}</span>
            </span>
          </button>
        ))}

        {items.length === 0 && (
          <div className="px-2 py-2 text-[12px] text-ink-faint">
            Nothing matches “{menu.query}”.
          </div>
        )}

        <div className="mt-1 pt-1 border-t border-white/5">
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); dismissSlashMenu(editor); }}
            className="w-full flex items-center justify-between rounded-lg px-2 py-1.5 text-[12px] text-ink-soft hover:bg-white/[0.04] hover:text-white transition-colors"
            data-testid="button-slash-close"
          >
            <span>Close menu</span>
            <kbd className="text-[10px] px-1.5 py-0.5 rounded border border-line bg-app text-ink-faint">esc</kbd>
          </button>
        </div>
      </div>
    </motion.div>
  ), document.body);
}
