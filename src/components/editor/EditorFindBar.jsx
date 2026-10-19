import React from 'react';
import ReactDOM from 'react-dom';
import { motion } from 'framer-motion';
import { Search, ChevronUp, ChevronDown, EllipsisVertical, X } from 'lucide-react';
import { getFindState, DEFAULT_FIND_OPTIONS, FIND_HIT_ACTIVE_CLASS } from './findInEditor';

const BAR_WIDTH = 296;
/** Room for the replace row's two buttons and the option checkboxes. */
const PANEL_WIDTH = 380;

const OPTIONS = Object.freeze([
  { key: 'matchCase', label: 'Match case' },
  // Deliberately not Docs' "\\n for newline" example: matching runs inside one
  // block at a time here, so a pattern can never cross a paragraph and there is
  // no newline in the text to find.
  { key: 'regex', label: 'Use regular expressions', hint: '(e.g. \\d for a digit, \\w+ for a word)' },
  { key: 'ignoreDiacritics', label: 'Ignore diacritics', hint: '(e.g. ä = a, א = אַ)' },
]);

/**
 * Minimal Google-Docs-style find bar for a TEXT_EDITOR_MACHINERY.
 *
 * Floats at the top-right of the editor it searches (portalled to <body> and
 * fixed to the viewport, so it stays put while the document scrolls). Typing
 * highlights every match, the counter shows "3/17", and ↑/↓ — or Enter /
 * Shift+Enter — cycle through them, scrolling each one into view.
 *
 * @param {object} editor        tiptap editor instance to search
 * @param {object} anchorRef     ref to the editor's container element
 * @param {number} focusNonce    bump to re-focus + select the input (⌘F again)
 * @param {Function} onClose     called when the bar should disappear
 */
export default function EditorFindBar({ editor, anchorRef, focusNonce, onClose }) {
  const inputRef = React.useRef(null);
  const replaceRef = React.useRef(null);
  const [term, setTerm] = React.useState('');
  const [replacement, setReplacement] = React.useState('');
  const [expanded, setExpanded] = React.useState(false);
  const [options, setOptions] = React.useState(DEFAULT_FIND_OPTIONS);
  const [stats, setStats] = React.useState({ count: 0, index: 0 });
  const [pos, setPos] = React.useState(() => ({ top: 84, left: window.innerWidth - BAR_WIDTH - 24 }));

  const width = expanded ? PANEL_WIDTH : BAR_WIDTH;

  // Keep the bar pinned to the top-right of the editor it belongs to, clamped
  // into the viewport. Recomputed on scroll/resize so it tracks panels that
  // move (the note sidebar, a resized card editor, …).
  React.useLayoutEffect(() => {
    const place = () => {
      const el = anchorRef?.current;
      const rect = el?.getBoundingClientRect();
      const maxLeft = window.innerWidth - width - 12;
      if (!rect || (!rect.width && !rect.height)) {
        setPos({ top: 84, left: Math.max(12, maxLeft) });
        return;
      }
      // Sit just above the editor when there's room, so the bar never covers
      // the text you're searching; otherwise float over its top-right corner.
      const above = rect.top - 44;
      const overlapping = Math.min(Math.max(rect.top + 12, 12), Math.max(12, window.innerHeight - 60));
      setPos({
        top: above >= 12 ? above : overlapping,
        left: Math.min(Math.max(rect.right - width - 12, 12), Math.max(12, maxLeft)),
      });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [anchorRef, width]);

  // Mirror the plugin's match count / active index into React.
  React.useEffect(() => {
    if (!editor) return undefined;
    const sync = () => {
      const state = getFindState(editor.state);
      setStats({ count: state.matches.length, index: state.activeIndex, navigationId: state.navigationId });
    };
    sync();
    editor.on('transaction', sync);
    return () => { editor.off('transaction', sync); };
  }, [editor]);

  // Seed with the current selection (like Google Docs), then focus.
  React.useEffect(() => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const selected = from !== to ? editor.state.doc.textBetween(from, to, ' ').trim() : '';
    const seed = selected && selected.length <= 80 ? selected : '';
    if (seed) {
      setTerm(seed);
      editor.commands.setFindTerm(seed);
    }
  }, []);

  // ⌘F while the bar is already open re-focuses and selects what's in it.
  React.useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [focusNonce]);

  // Drop the highlights when the bar goes away.
  React.useEffect(() => () => { editor?.commands.clearFind(); }, [editor]);

  // Only explicit search navigation scrolls; editing never moves the viewport.
  React.useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const state = editor.state;
    if (!getFindState(state).matches.length) return;
    const frame = requestAnimationFrame(() => {
      if (editor.isDestroyed || editor.state.doc !== state.doc) return;
      const hit = editor.view.dom.querySelector(`.${FIND_HIT_ACTIVE_CLASS}`);
      hit?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [editor, stats.navigationId]);

  // Drop the highlights immediately rather than when the exit animation ends,
  // then hand focus back to the document.
  const closeBar = React.useCallback(() => {
    editor?.commands.clearFind();
    onClose();
    editor?.commands.focus();
  }, [editor, onClose]);

  const step = React.useCallback((delta) => {
    if (!editor) return;
    const state = getFindState(editor.state);
    if (!state.matches.length) return;
    editor.commands.setFindActiveIndex(state.activeIndex + delta);
  }, [editor]);

  const handleChange = (event) => {
    const value = event.target.value;
    setTerm(value);
    editor?.commands.setFindTerm(value);
  };

  const toggleOption = React.useCallback((key) => {
    setOptions((current) => {
      const next = { ...current, [key]: !current[key] };
      editor?.commands.setFindOptions(next);
      return next;
    });
  }, [editor]);

  const replaceOne = React.useCallback(() => {
    if (!editor) return;
    editor.commands.replaceFindMatch(replacement);
  }, [editor, replacement]);

  const replaceAll = React.useCallback(() => {
    if (!editor) return;
    editor.commands.replaceAllFindMatches(replacement);
  }, [editor, replacement]);

  const openReplace = React.useCallback(() => {
    setExpanded((current) => {
      const next = !current;
      // Opening it should land you where the new field is, not leave you typing
      // into the one you were already in.
      if (next) window.requestAnimationFrame(() => replaceRef.current?.focus());
      return next;
    });
  }, []);

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeBar();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      step(event.shiftKey ? -1 : 1);
      return;
    }
    // Don't let ⌘F / typing leak out to page-level shortcut handlers.
    event.stopPropagation();
  };

  const handleReplaceKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeBar();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (event.metaKey || event.ctrlKey) replaceAll();
      else replaceOne();
      return;
    }
    event.stopPropagation();
  };

  const noHits = term.length > 0 && stats.count === 0;
  const canReplace = stats.count > 0;

  const panel = expanded ? (
    /* Find and replace, laid out as a dialog rather than a strip of controls:
       a title, labelled fields, the options stacked where they can be read, and
       the actions gathered along the bottom with Next as the one that carries
       the weight. */
    <div className="p-4" data-testid="panel-editor-replace">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[15px] font-semibold leading-tight text-ink">Find and replace</h2>
        <button
          type="button"
          onClick={closeBar}
          title="Close (Esc)"
          aria-label="Close"
          className="-mr-1 -mt-0.5 shrink-0 h-7 w-7 grid place-items-center rounded-md text-ink-soft transition-all hover:bg-white/[0.07] hover:text-white active:scale-90"
          data-testid="button-editor-find-close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* The find field carries its own label and its own count, the way the
          outlined fields in Docs do. */}
      <label
        className={`relative mt-4 flex h-11 items-center rounded-md border px-3 transition-colors ${
          noHits ? 'border-red-400/70' : 'border-line-strong focus-within:border-violet-400'
        }`}
      >
        <span
          className={`pointer-events-none absolute -top-2 left-2.5 bg-surface px-1 text-[11px] transition-colors ${
            noHits ? 'text-red-400/90' : 'text-ink-soft'
          }`}
        >
          Find
        </span>
        <input
          ref={inputRef}
          value={term}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none"
          data-testid="input-editor-find"
        />
        <motion.span
          key={`${stats.index}-${stats.count}`}
          initial={{ opacity: 0.35, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          className={`ml-2 shrink-0 select-none text-[12px] tabular-nums ${noHits ? 'text-red-400/90' : 'text-ink-soft'}`}
          data-testid="text-editor-find-count"
        >
          {term.length === 0 ? '' : `${stats.count ? stats.index + 1 : 0} of ${stats.count}`}
        </motion.span>
      </label>

      <label className="mt-3 flex h-11 items-center rounded-md border border-line-strong px-3 transition-colors focus-within:border-violet-400">
        <input
          ref={replaceRef}
          value={replacement}
          onChange={(event) => setReplacement(event.target.value)}
          onKeyDown={handleReplaceKeyDown}
          placeholder="Replace with"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-[14px] text-ink placeholder:text-ink-faint outline-none"
          data-testid="input-editor-replace"
        />
      </label>

      <div className="mt-4 space-y-2.5">
        {OPTIONS.map(({ key, label, hint }) => (
          <label key={key} className="flex cursor-pointer select-none items-start gap-2.5 text-[13px] leading-snug text-ink">
            <input
              type="checkbox"
              checked={options[key]}
              onChange={() => toggleOption(key)}
              className="mt-0.5 h-[15px] w-[15px] shrink-0 cursor-pointer accent-violet-500"
              data-testid={`checkbox-find-${key}`}
            />
            <span>
              {label}
              {hint && <span className="text-ink-soft"> {hint}</span>}
            </span>
          </label>
        ))}
      </div>

      <div className="mt-5 flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={replaceOne}
          disabled={!canReplace}
          title="Replace this one (⏎)"
          className="h-8 rounded-md px-2.5 text-[13px] font-medium text-violet-300 transition-all hover:bg-violet-400/10 hover:text-violet-200 active:scale-95 disabled:opacity-30 disabled:pointer-events-none"
          data-testid="button-editor-replace-one"
        >
          Replace
        </button>
        <button
          type="button"
          onClick={replaceAll}
          disabled={!canReplace}
          title="Replace every match (⌘⏎)"
          className="h-8 rounded-md px-2.5 text-[13px] font-medium text-violet-300 transition-all hover:bg-violet-400/10 hover:text-violet-200 active:scale-95 disabled:opacity-30 disabled:pointer-events-none"
          data-testid="button-editor-replace-all"
        >
          Replace all
        </button>
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={!stats.count}
          title="Previous (⇧⏎)"
          className="h-8 rounded-md px-2.5 text-[13px] font-medium text-violet-300 transition-all hover:bg-violet-400/10 hover:text-violet-200 active:scale-95 disabled:opacity-30 disabled:pointer-events-none"
          data-testid="button-editor-find-prev"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={!stats.count}
          title="Next (⏎)"
          className="ml-1 h-8 rounded-full bg-violet-500/90 px-5 text-[13px] font-semibold text-white transition-all hover:bg-violet-500 active:scale-95 disabled:opacity-30 disabled:pointer-events-none"
          data-testid="button-editor-find-next"
        >
          Next
        </button>
      </div>

      {/* Back to the one-line finder. */}
      <button
        type="button"
        onClick={openReplace}
        aria-expanded
        className="mt-3 text-[11px] text-ink-faint transition-colors hover:text-ink-soft"
        data-testid="button-editor-find-toggle-replace"
      >
        Hide replace
      </button>
    </div>
  ) : (
    <div className="flex h-9 items-center gap-1.5 pl-2.5 pr-1.5">
      {/* The disclosure that turns a find bar into find and replace. Three
          dots rather than an arrow: this opens the rest of the options, it does
          not step through anything — and the bar already has two chevrons on it
          that do. */}
      <button
        type="button"
        onClick={openReplace}
        aria-expanded={false}
        aria-label="More find options"
        title="Replace…"
        className="shrink-0 h-6 w-6 grid place-items-center rounded-md text-ink-faint transition-all hover:bg-white/[0.07] hover:text-white active:scale-90"
        data-testid="button-editor-find-toggle-replace"
      >
        <EllipsisVertical className="w-4 h-4" />
      </button>

      <Search className={`w-3.5 h-3.5 shrink-0 transition-colors ${noHits ? 'text-red-400/80' : 'text-ink-faint'}`} />

      <input
        ref={inputRef}
        value={term}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Find in document"
        spellCheck={false}
        className="flex-1 min-w-0 bg-transparent text-[13px] text-ink placeholder:text-ink-faint outline-none"
        data-testid="input-editor-find"
      />

      {/* Counter — the number pops each time you land on a new match. */}
      <motion.span
        key={`${stats.index}-${stats.count}`}
        initial={{ opacity: 0.35, scale: 0.88 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
        className={`shrink-0 text-[11px] tabular-nums select-none ${noHits ? 'text-red-400/90' : 'text-ink-soft'}`}
        data-testid="text-editor-find-count"
      >
        {term.length === 0 ? '' : `${stats.count ? stats.index + 1 : 0}/${stats.count}`}
      </motion.span>

      <div className="shrink-0 w-px h-4 bg-line mx-0.5" />

      <button
        type="button"
        onClick={() => step(-1)}
        disabled={!stats.count}
        title="Previous (⇧⏎)"
        className="shrink-0 h-6 w-6 grid place-items-center rounded-md text-ink-soft transition-all hover:bg-white/[0.07] hover:text-white active:scale-90 disabled:opacity-30 disabled:pointer-events-none"
        data-testid="button-editor-find-prev"
      >
        <ChevronUp className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => step(1)}
        disabled={!stats.count}
        title="Next (⏎)"
        className="shrink-0 h-6 w-6 grid place-items-center rounded-md text-ink-soft transition-all hover:bg-white/[0.07] hover:text-white active:scale-90 disabled:opacity-30 disabled:pointer-events-none"
        data-testid="button-editor-find-next"
      >
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={closeBar}
        title="Close (Esc)"
        className="shrink-0 h-6 w-6 grid place-items-center rounded-md text-ink-faint transition-all hover:bg-white/[0.07] hover:text-white active:scale-90"
        data-testid="button-editor-find-close"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );

  return ReactDOM.createPortal((
    <motion.div
      initial={{ opacity: 0, y: -14, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.97, transition: { duration: 0.11, ease: 'easeIn' } }}
      transition={{ type: 'spring', stiffness: 560, damping: 34, mass: 0.65 }}
      className="fixed z-[100001] rounded-xl border border-line bg-surface/95 backdrop-blur-xl shadow-[0_18px_50px_-12px_rgba(0,0,0,0.75)]"
      style={{ top: pos.top, left: pos.left, width }}
      role={expanded ? 'dialog' : undefined}
      aria-label={expanded ? 'Find and replace' : undefined}
      data-testid="bar-editor-find"
      data-expanded={expanded ? 'true' : 'false'}
    >
      {panel}
    </motion.div>
  ), document.body);
}
