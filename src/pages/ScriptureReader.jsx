import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  Clock,
  Heart,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { useTabTitle } from '@/lib/WorkspaceTabs';
import {
  cancelScriptureRequest,
  fetchScriptureBatch,
  getScriptureCatalog,
  getScriptureUsage,
  searchScriptureWords,
} from '@/lib/scriptureClient';
import { parseScriptureQuery, isLikelyReference } from '@/lib/scriptureReferences';
import ScriptureContentRenderer from '@/components/scripture/ScriptureContentRenderer';
import '@/components/scripture/scriptureReader.css';

const DEFAULT_BIBLE_ID = '317e03834065a236-01'; // Berean Standard Bible (BSB)

export default function ScriptureReader() {
  const location = useLocation();
  const navigate = useNavigate();

  // URL search query
  const searchParams = new URLSearchParams(location.search);
  const initialQuery = searchParams.get('q') || '';

  const [inputVal, setInputVal] = React.useState(initialQuery);
  const [activeQuery, setActiveQuery] = React.useState(initialQuery);

  // Bible catalog & selection
  const [catalog, setCatalog] = React.useState([]);
  const [loadingCatalog, setLoadingCatalog] = React.useState(true);
  const [selectedBibleId, setSelectedBibleId] = React.useState(() => {
    return localStorage.getItem('bex_scripture_selected_bible_id') || DEFAULT_BIBLE_ID;
  });
  const [versionFilter, setVersionFilter] = React.useState('');

  // Reader settings
  const [fontSize, setFontSize] = React.useState(() => {
    const saved = localStorage.getItem('bex_scripture_font_size');
    return saved ? parseInt(saved, 10) : 20;
  });
  const [redLetters, setRedLetters] = React.useState(() => {
    const saved = localStorage.getItem('bex_scripture_red_letters');
    return saved !== null ? saved === 'true' : true;
  });

  // Content state
  const [mode, setMode] = React.useState(() => (isLikelyReference(initialQuery) ? 'references' : 'references'));
  const [loadingContent, setLoadingContent] = React.useState(false);
  const [showSkeleton, setShowSkeleton] = React.useState(false);
  const [progress, setProgress] = React.useState({ completed: 0, total: 0 });
  const [resultsByGroup, setResultsByGroup] = React.useState([]);
  const [searchResults, setSearchResults] = React.useState(null);
  const [error, setError] = React.useState('');
  const [usage, setUsage] = React.useState({ totalRequests: 0, requestsToday: 0 });

  // Tab Title
  const activeTitle = resultsByGroup.length > 0
    ? resultsByGroup.map((g) => g.group.label).join('; ')
    : activeQuery || 'Scripture Reader';
  useTabTitle(activeTitle);

  // Load catalog on mount
  React.useEffect(() => {
    let active = true;
    getScriptureCatalog()
      .then((res) => {
        if (!active) return;
        const bibles = res?.data || [];
        setCatalog(bibles);
        // Verify selected Bible is in catalog; if not, select default or first English
        const exists = bibles.some((b) => b.id === selectedBibleId);
        if (!exists && bibles.length > 0) {
          const eng = bibles.find((b) => b.language?.id === 'eng');
          setSelectedBibleId((eng || bibles[0]).id);
        }
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoadingCatalog(false);
      });

    getScriptureUsage().then((u) => setUsage(u));

    return () => {
      active = false;
    };
  }, []);

  // Save selected Bible
  const handleSelectBible = (bId) => {
    setSelectedBibleId(bId);
    localStorage.setItem('bex_scripture_selected_bible_id', bId);
  };

  // Adjust font size
  const handleFontSize = (delta) => {
    setFontSize((prev) => {
      const next = Math.max(16, Math.min(30, prev + delta));
      localStorage.setItem('bex_scripture_font_size', String(next));
      return next;
    });
  };

  // Toggle red letters
  const handleToggleRedLetters = () => {
    setRedLetters((prev) => {
      const next = !prev;
      localStorage.setItem('bex_scripture_red_letters', String(next));
      return next;
    });
  };

  // Fetch Scripture when query or selected Bible changes
  React.useEffect(() => {
    if (!activeQuery.trim() || !selectedBibleId) return;

    let active = true;
    const batchId = `query-${Date.now()}`;
    setError('');
    setLoadingContent(true);
    setProgress({ completed: 0, total: 0 });

    // Show skeleton only after 150ms to prevent flash on fast/cached loads
    const timer = setTimeout(() => {
      if (active) setShowSkeleton(true);
    }, 150);

    const isRef = isLikelyReference(activeQuery);
    if (isRef && mode === 'references') {
      const parsed = parseScriptureQuery(activeQuery);
      if (!parsed.isReference || parsed.requests.length === 0) {
        setResultsByGroup([]);
        setLoadingContent(false);
        setShowSkeleton(false);
        clearTimeout(timer);
        return;
      }

      // Initialize groups
      const initialGroups = parsed.groups.map((g) => ({
        group: g,
        units: g.requests.map((r) => ({ req: r, data: null, loading: true, error: null })),
      }));
      setResultsByGroup(initialGroups);

      fetchScriptureBatch(parsed.requests, {
        bibleId: selectedBibleId,
        batchId,
        onProgress: (prog) => {
          if (!active) return;
          setProgress({ completed: prog.completed, total: prog.total });
          // Update completed unit in groups
          if (prog.latest) {
            setResultsByGroup((prev) =>
              prev.map((grp) => ({
                ...grp,
                units: grp.units.map((u) =>
                  u.req.id === prog.latest.req.id ? { ...u, ...prog.latest, loading: false } : u
                ),
              }))
            );
          }
        },
      })
        .then(() => {
          if (!active) return;
          getScriptureUsage().then((u) => setUsage(u));
        })
        .catch((err) => {
          if (active) setError(err.message);
        })
        .finally(() => {
          if (active) {
            clearTimeout(timer);
            setLoadingContent(false);
            setShowSkeleton(false);
          }
        });
    } else {
      // Words Search mode
      searchScriptureWords({ bibleId: selectedBibleId, query: activeQuery })
        .then((res) => {
          if (!active) return;
          setSearchResults(res?.data);
          getScriptureUsage().then((u) => setUsage(u));
        })
        .catch((err) => {
          if (active) setError(err.message);
        })
        .finally(() => {
          if (active) {
            clearTimeout(timer);
            setLoadingContent(false);
            setShowSkeleton(false);
          }
        });
    }

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [activeQuery, selectedBibleId, mode]);

  const handleSubmitSearch = (e) => {
    e.preventDefault();
    const clean = inputVal.trim();
    if (!clean) return;
    setActiveQuery(clean);
  };

  const selectedBible = catalog.find((b) => b.id === selectedBibleId);

  // Filtered versions for dropdown
  const filteredBibles = catalog.filter((b) => {
    if (!versionFilter.trim()) return true;
    const term = versionFilter.toLowerCase();
    return (
      b.name?.toLowerCase().includes(term) ||
      b.abbreviation?.toLowerCase().includes(term) ||
      b.language?.name?.toLowerCase().includes(term)
    );
  });

  return (
    <div className="scripture-reader" style={{ '--scripture-font-size': `${fontSize}px` }}>
      {/* Top Toolbar */}
      <header className="scripture-reader__toolbar">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="scripture-reader__back-btn"
          title="Back"
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back</span>
        </button>

        {/* Search Input */}
        <form onSubmit={handleSubmitSearch} className="scripture-reader__search-form" role="search">
          <Search className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
          <input
            type="search"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            placeholder="Search reference (e.g. Jn1:1-3, Mark 5:1) or text…"
            className="scripture-reader__search-input"
            aria-label="Scripture query"
          />
          {loadingContent && <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400 shrink-0" />}
        </form>

        {/* Bible Version Popover */}
        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              type="button"
              className="scripture-reader__version-select"
              title="Change translation"
              aria-label="Selected translation"
            >
              <BookOpen className="h-3.5 w-3.5 text-sky-400 shrink-0" />
              <span className="truncate font-medium">
                {selectedBible?.abbreviation || selectedBible?.name || 'Select Bible'}
              </span>
              <ChevronDown className="h-3 w-3 text-slate-400 ml-auto shrink-0" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="z-50 w-72 rounded-lg bg-slate-900 border border-slate-700 shadow-2xl p-2 text-sm text-slate-200"
              sideOffset={5}
              align="start"
            >
              <input
                type="text"
                placeholder="Filter translations…"
                value={versionFilter}
                onChange={(e) => setVersionFilter(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white mb-2 outline-none focus:border-sky-500"
              />
              <div className="max-h-60 overflow-y-auto space-y-1">
                {filteredBibles.map((bible) => (
                  <button
                    key={bible.id}
                    type="button"
                    onClick={() => handleSelectBible(bible.id)}
                    className={`w-full text-left px-2 py-1.5 rounded text-xs flex flex-col transition-colors ${
                      bible.id === selectedBibleId
                        ? 'bg-sky-600/30 text-sky-300 font-semibold'
                        : 'hover:bg-slate-800 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span>{bible.name}</span>
                      <span className="text-[10px] text-slate-400 uppercase">{bible.abbreviation}</span>
                    </div>
                    <span className="text-[10px] text-slate-500">{bible.language?.name}</span>
                  </button>
                ))}
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        {/* Actions / Typography Controls */}
        <div className="scripture-reader__actions">
          {/* Words of Jesus toggle */}
          <button
            type="button"
            onClick={handleToggleRedLetters}
            data-active={redLetters}
            className="scripture-reader__toggle-btn"
            title="Toggle Words of Jesus in red"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Red letters</span>
          </button>

          {/* Text size controls */}
          <div className="flex items-center gap-1 bg-slate-800/80 rounded border border-slate-700/60 p-0.5">
            <button
              type="button"
              onClick={() => handleFontSize(-2)}
              className="scripture-reader__size-btn"
              title="Smaller text"
            >
              <Minus className="h-3 w-3" />
            </button>
            <span className="text-[11px] text-slate-300 px-1 font-mono">{fontSize}px</span>
            <button
              type="button"
              onClick={() => handleFontSize(2)}
              className="scripture-reader__size-btn"
              title="Larger text"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>

          {/* Usage Meter */}
          <div
            className="scripture-reader__usage-badge"
            title={`Requests from this device: ${usage.requestsToday} today (${usage.totalRequests} total)`}
          >
            <Clock className="h-3 w-3" />
            <span>{usage.requestsToday} req</span>
          </div>
        </div>
      </header>

      {/* Main Viewport */}
      <main className="scripture-reader__viewport" tabIndex={0}>
        <div className="scripture-reader__container">
          {error && (
            <div className="mb-6 p-4 rounded-lg bg-red-950/60 border border-red-800 text-red-200 text-sm">
              <p className="font-semibold mb-1">Retrieval Notice</p>
              <p>{error}</p>
            </div>
          )}

          {/* Progress Banner */}
          {loadingContent && progress.total > 0 && (
            <div className="mb-4 text-xs text-sky-400 flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>
                Loading {progress.completed} of {progress.total} units…
              </span>
            </div>
          )}

          {/* Skeleton state */}
          {showSkeleton && (
            <div className="my-6 space-y-3" aria-hidden="true">
              <div className="scripture-reader__skeleton-line w-1/3 h-6 mb-4" />
              <div className="scripture-reader__skeleton-line w-full" />
              <div className="scripture-reader__skeleton-line w-11/12" />
              <div className="scripture-reader__skeleton-line w-4/5" />
            </div>
          )}

          {/* Reading Area */}
          <article className="scripture-reader__text-body" data-red-letters={redLetters}>
            {resultsByGroup.map((grp, gIdx) => (
              <section key={`grp-${gIdx}`} className="mb-8">
                <h2 className="scripture-reader__heading">{grp.group.label}</h2>
                {grp.units.map((unit, uIdx) => (
                  <div key={`unit-${uIdx}`} className="scripture-reader__unit">
                    {unit.loading ? (
                      <div className="py-2 space-y-2 opacity-50" aria-hidden="true">
                        <div className="scripture-reader__skeleton-line w-full" />
                        <div className="scripture-reader__skeleton-line w-5/6" />
                      </div>
                    ) : unit.error ? (
                      <p className="text-red-400 text-xs italic my-2">{unit.error}</p>
                    ) : (
                      <ScriptureContentRenderer
                        content={unit.data?.content}
                        redLetters={redLetters}
                      />
                    )}
                  </div>
                ))}
              </section>
            ))}
          </article>

          {/* Words search results if any */}
          {searchResults?.verses && searchResults.verses.length > 0 && (
            <div className="space-y-4 my-6">
              <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                Search Results ({searchResults.total})
              </h3>
              {searchResults.verses.map((v) => (
                <div
                  key={v.id}
                  onClick={() => {
                    setInputVal(v.reference);
                    setActiveQuery(v.reference);
                    setMode('references');
                  }}
                  className="p-3 rounded bg-slate-900/60 border border-slate-800 hover:border-sky-500/50 cursor-pointer transition-colors"
                >
                  <p className="text-sky-400 font-semibold text-xs mb-1">{v.reference}</p>
                  <p className="text-slate-200 text-sm leading-relaxed">{v.text}</p>
                </div>
              ))}
            </div>
          )}

          {/* Attribution footer */}
          {selectedBible && (
            <footer className="scripture-reader__attribution">
              <p className="font-semibold text-slate-300">{selectedBible.name} ({selectedBible.abbreviation})</p>
              {selectedBible.description && (
                <p className="mt-1 text-slate-400 text-xs leading-normal">{selectedBible.description}</p>
              )}
              {selectedBible.copyright && (
                <p className="mt-1 text-slate-500 text-[11px] leading-normal">{selectedBible.copyright}</p>
              )}
            </footer>
          )}
        </div>
      </main>
    </div>
  );
}
