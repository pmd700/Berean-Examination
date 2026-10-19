import React from 'react';
import {
  BookOpen,
  Clock3,
  FileText,
  Key,
  MessageSquare,
  Network,
  Search,
} from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { platformEntities } from '@/lib/platform/entities';
import { searchLocalLibrary } from '@/lib/localGlobalSearch';
import { buildSpotlightPath, sameSpotlightWorkspace } from '@/lib/spotlightNavigation';
import { requestLocalFindShortcut, requestPageFindShortcut } from '@/lib/localFindShortcut';
import {
  TAB_KINDS,
  kindForPath,
  useIsActiveTab,
  useWorkspaceTabs,
} from '@/lib/WorkspaceTabs';
import { AnimatePresence, motion } from 'framer-motion';

const FOCUS_LIBRARY_SEARCH_EVENT = 'bex:focus-library-search';

function ResultIcon({ type }) {
  const className = 'h-4 w-4';
  if (type === 'Note') return <FileText className={className} />;
  if (type === 'Timeline' || type === 'Timeline Event') return <Clock3 className={className} />;
  if (type === 'Knowledge Web' || type === 'Web Card') return <Network className={className} />;
  if (type === 'Chapter') return <BookOpen className={className} />;
  if (type === 'Annotation') return <MessageSquare className={className} />;
  if (type === 'Keyword') return <Key className={className} />;
  return <Search className={className} />;
}

function HighlightedText({ text, query }) {
  const value = String(text || '');
  const phrase = String(query || '').trim();
  const terms = phrase.split(/\s+/).filter(Boolean);
  const lower = value.toLocaleLowerCase();
  const exact = lower.indexOf(phrase.toLocaleLowerCase());
  const fallback = terms.reduce((found, term) => (
    found.index >= 0 ? found : { index: lower.indexOf(term.toLocaleLowerCase()), text: term }
  ), { index: -1, text: '' });
  const index = exact >= 0 ? exact : fallback.index;
  const length = exact >= 0 ? phrase.length : fallback.text.length;
  if (index < 0 || !length) return value;
  return (
    <>
      {value.slice(0, index)}
      <mark className="rounded-sm bg-brand/35 px-0.5 text-inherit">{value.slice(index, index + length)}</mark>
      {value.slice(index + length)}
    </>
  );
}

function useSpotlightEngine(enabled) {
  const { tabs, activeTab, openTab, selectTab, updateTab } = useWorkspaceTabs();
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState([]);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [records, setRecords] = React.useState(null);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    setRecords(null);
    setLoading(true);
    setError('');
    Promise.all([
      platformEntities.StudyChapter.list('-updated_date'),
      platformEntities.Annotation.list('-updated_date'),
      platformEntities.Keyword.list('-updated_date'),
      platformEntities.WebCard.list('-updated_date'),
      platformEntities.KnowledgeWeb.list('-updated_date'),
      platformEntities.MindNote.list('-updated_date'),
      platformEntities.Timegraph.list('-updated_date'),
    ])
      .then(([chapters, annotations, keywords, cards, webs, notes, timegraphs]) => {
        if (!cancelled) setRecords({ chapters, annotations, keywords, cards, webs, notes, timegraphs });
      })
      .catch((loadError) => {
        console.error('[GlobalSearch] Local library search failed:', loadError);
        if (!cancelled) setError('BEX could not read your local library.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [enabled]);

  React.useEffect(() => {
    if (!query.trim() || !records) {
      setResults([]);
      setSelectedIndex(0);
      return undefined;
    }
    const debounce = window.setTimeout(() => {
      setResults(searchLocalLibrary(records, query, 60));
      setSelectedIndex(0);
    }, 70);
    return () => window.clearTimeout(debounce);
  }, [query, records]);

  const openResult = React.useCallback((result) => {
    if (!result) return;
    const path = buildSpotlightPath(result, query, Date.now());
    const kind = kindForPath(path);
    const existing = tabs.find((tab) => sameSpotlightWorkspace(tab.path, path));
    const patch = {
      kind,
      path,
      title: result.workspaceTitle || result.title,
    };

    if (existing) {
      updateTab(existing.id, patch);
      selectTab(existing.id);
    } else if (activeTab?.kind === TAB_KINDS.HOME) {
      updateTab(activeTab.id, patch);
    } else {
      openTab(kind, patch);
    }
  }, [activeTab, openTab, query, selectTab, tabs, updateTab]);

  return {
    error,
    loading,
    openResult,
    query,
    results,
    selectedIndex,
    setQuery,
    setSelectedIndex,
  };
}

function SearchResultList({ engine, inline = false, onSelect }) {
  const {
    error,
    loading,
    query,
    results,
    selectedIndex,
    setSelectedIndex,
  } = engine;

  return (
    <div
      className={`${inline ? 'max-h-[min(58vh,34rem)]' : 'max-h-[58vh]'} overflow-y-auto p-2`}
      role="listbox"
      aria-label="Search results"
      data-testid={inline ? 'library-spotlight-results' : 'global-spotlight-results'}
    >
      <AnimatePresence mode="popLayout">
        {results.length > 0 ? results.map((result, index) => (
          <motion.button
            type="button"
            layout
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.13, delay: Math.min(index, 8) * 0.012 }}
            key={`${result.type}:${result.id}`}
            role="option"
            aria-selected={index === selectedIndex}
            onMouseEnter={() => setSelectedIndex(index)}
            onClick={() => onSelect(result)}
            className={`flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors ${
              index === selectedIndex ? 'bg-brand/18' : 'hover:bg-elevated/70'
            }`}
            data-testid={`${inline ? 'library' : 'global'}-spotlight-result-${index}`}
          >
            <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
              index === selectedIndex ? 'bg-brand/25 text-brand' : 'bg-elevated text-ink-faint'
            }`}>
              <ResultIcon type={result.type} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">
                <HighlightedText text={result.title} query={query} />
              </span>
              {result.description && (
                <span className="mt-1 block truncate text-xs text-ink-soft">
                  <HighlightedText text={result.description} query={query} />
                </span>
              )}
            </span>
            <span className="mt-1 shrink-0 text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
              {result.type}
            </span>
          </motion.button>
        )) : error ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-10 text-center text-sm text-red-400">
            {error}
          </motion.div>
        ) : query.trim() && !loading ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-10 text-center text-sm text-ink-faint">
            No match in your local library.
          </motion.div>
        ) : loading && query.trim() ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-10 text-center text-sm text-ink-faint">
            Searching this computer…
          </motion.div>
        ) : !inline ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-12 text-center">
            <p className="text-sm text-ink-soft">Type any phrase you remember.</p>
            <p className="mt-1 text-xs text-ink-faint">Everything is searched on this computer.</p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function useSearchKeyboard(engine, onSelect, onDismiss) {
  return React.useCallback((event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      engine.setSelectedIndex((current) => Math.min(current + 1, Math.max(0, engine.results.length - 1)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      engine.setSelectedIndex((current) => Math.max(0, current - 1));
    } else if (event.key === 'Enter' && engine.results[engine.selectedIndex]) {
      event.preventDefault();
      onSelect(engine.results[engine.selectedIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onDismiss();
    }
  }, [engine, onDismiss, onSelect]);
}

/** Browser-style search field embedded in the active New Tab page. */
export function LibrarySpotlightSearch({ className = '' }) {
  const isActiveTab = useIsActiveTab();
  const [expanded, setExpanded] = React.useState(false);
  const rootRef = React.useRef(null);
  const inputRef = React.useRef(null);
  const engine = useSpotlightEngine(expanded && isActiveTab);

  const dismiss = React.useCallback(() => {
    setExpanded(false);
    inputRef.current?.blur();
  }, []);

  const selectResult = React.useCallback((result) => {
    engine.openResult(result);
    engine.setQuery('');
    setExpanded(false);
  }, [engine]);

  const handleKeyDown = useSearchKeyboard(engine, selectResult, dismiss);

  React.useEffect(() => {
    const focusSearch = () => {
      if (!isActiveTab) return;
      setExpanded(true);
      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    };
    window.addEventListener(FOCUS_LIBRARY_SEARCH_EVENT, focusSearch);
    return () => window.removeEventListener(FOCUS_LIBRARY_SEARCH_EVENT, focusSearch);
  }, [isActiveTab]);

  React.useEffect(() => {
    if (!expanded) return undefined;
    const closeOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setExpanded(false);
    };
    document.addEventListener('pointerdown', closeOutside, true);
    return () => document.removeEventListener('pointerdown', closeOutside, true);
  }, [expanded]);

  const showSuggestions = expanded && Boolean(engine.query.trim());

  return (
    <div ref={rootRef} className={`relative w-full max-w-3xl ${className}`} data-testid="library-spotlight">
      <div className={`flex h-9 items-center gap-2 rounded-xl border px-3 transition-all ${
        expanded
          ? 'border-brand/55 bg-[#111722] shadow-[0_0_0_3px_rgba(139,92,246,0.09)]'
          : 'border-white/[0.075] bg-white/[0.025] hover:border-white/[0.13]'
      }`}>
        <Search className="h-4 w-4 shrink-0 text-slate-500" />
        <input
          ref={inputRef}
          value={engine.query}
          onChange={(event) => {
            engine.setQuery(event.target.value);
            setExpanded(true);
          }}
          onFocus={() => setExpanded(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search every note, card, and timeline…"
          aria-label="Search your BEX library"
          aria-expanded={showSuggestions}
          className="min-w-0 flex-1 border-0 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600"
          data-testid="library-spotlight-input"
        />
        {engine.loading ? (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-700 border-t-brand" />
        ) : (
          <kbd className="rounded-md border border-white/[0.075] bg-white/[0.025] px-1.5 py-0.5 text-[9px] text-slate-600">⌘F</kbd>
        )}
      </div>

      <AnimatePresence>
        {showSuggestions && (
          <motion.div
            initial={{ opacity: 0, y: -5, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.99 }}
            transition={{ duration: 0.14 }}
            className="absolute left-0 right-0 top-[calc(100%+8px)] z-[90] overflow-hidden rounded-2xl border border-white/[0.09] bg-[#10151f]/[0.985] shadow-[0_24px_70px_rgba(0,0,0,0.58),0_0_0_1px_rgba(139,92,246,0.08)] backdrop-blur-xl"
          >
            <SearchResultList engine={engine} inline onSelect={selectResult} />
            <div className="flex items-center gap-4 border-t border-white/[0.06] px-4 py-2 text-[9px] text-slate-600">
              <span><kbd>↑</kbd><kbd>↓</kbd> choose</span>
              <span><kbd>↵</kbd> open</span>
              <span className="ml-auto">Esc closes</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Global shortcut and fallback overlay when the active tab is not New Tab. */
export default function GlobalSearch() {
  const { activeTab } = useWorkspaceTabs();
  const [open, setOpen] = React.useState(false);
  const engine = useSpotlightEngine(open);

  const dismiss = React.useCallback(() => setOpen(false), []);
  const selectResult = React.useCallback((result) => {
    engine.openResult(result);
    engine.setQuery('');
    setOpen(false);
  }, [engine]);
  const handleInputKeyDown = useSearchKeyboard(engine, selectResult, dismiss);

  React.useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.repeat) return;
      const isFind = event.key.toLocaleLowerCase() === 'f';
      if (
        !(event.metaKey || event.ctrlKey)
        || !isFind
        || event.altKey
      ) return;
      // Shift+Cmd/Ctrl+F belongs to footnotes while typing. Let the editor's
      // existing keymap receive it rather than stealing it in window capture.
      if (event.shiftKey && event.target.closest?.('input, textarea, [contenteditable="true"], [role="textbox"]')) return;
      if (!event.shiftKey && requestPageFindShortcut()) {
        setOpen(false);
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (event.shiftKey) requestPageFindShortcut({ close: true });
      // Ask the active long-form editor to claim Cmd/Ctrl+F before opening the
      // app-wide search. This explicit handoff is reliable even in portals and
      // full-screen editors where event.target may temporarily be the body.
      if (!event.shiftKey && requestLocalFindShortcut()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (activeTab?.kind === TAB_KINDS.HOME) {
        setOpen(false);
        window.dispatchEvent(new Event(FOCUS_LIBRARY_SEARCH_EVENT));
      } else {
        setOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [activeTab?.kind]);

  React.useEffect(() => {
    if (!open) return;
    engine.setQuery('');
    engine.setSelectedIndex(0);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="!top-[18%] w-[min(46rem,calc(100vw-2rem))] max-w-none !translate-y-0 gap-0 overflow-hidden rounded-2xl border-line bg-[#10141d]/98 p-0 shadow-[0_28px_90px_rgba(0,0,0,0.6),0_0_0_1px_rgba(139,92,246,0.12)] backdrop-blur-xl"
        data-testid="global-spotlight"
      >
        <div className="flex h-16 items-center gap-3 border-b border-line px-5">
          <Search className="h-5 w-5 shrink-0 text-ink-faint" />
          <input
            value={engine.query}
            onChange={(event) => engine.setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Search every note, card, and timeline…"
            aria-label="Search your BEX library"
            className="h-full min-w-0 flex-1 border-0 bg-transparent text-lg text-ink outline-none placeholder:text-ink-faint"
            autoFocus
            data-testid="global-spotlight-input"
          />
          {engine.loading ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-brand" />
          ) : (
            <kbd className="rounded-md border border-line bg-elevated/70 px-2 py-1 text-[10px] text-ink-faint">⇧⌘F</kbd>
          )}
        </div>

        <SearchResultList engine={engine} onSelect={selectResult} />

        <div className="flex items-center gap-4 border-t border-line px-5 py-2 text-[10px] text-ink-faint">
          <span><kbd>↑</kbd><kbd>↓</kbd> choose</span>
          <span><kbd>↵</kbd> open</span>
          <span className="ml-auto">Esc closes</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
