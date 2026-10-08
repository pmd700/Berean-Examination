import React from 'react';
import {
  CalendarClock, Check, Filter, Loader2, Maximize2, Minus, Plus,
  Redo2, Save, Share2, Undo2, Upload,
} from 'lucide-react';
import TimegraphCanvas from './TimegraphCanvas';
import TimegraphEventPanel from './TimegraphEventPanel';
import TimegraphExportDialog from './TimegraphExportDialog';
import {
  clampViewport,
  createViewport,
  viewportForRange,
  zoomAt,
} from '@/lib/timegraph/timegraphScale';
import { eventsBounds, requiredHeight } from '@/lib/timegraph/timegraphLayout';
import {
  collectTags,
  tagKey,
  createEvent,
  createHistory,
  duplicateEvent,
  filterEvents,
  moveEventToYear,
  pushHistory,
  redoHistory,
  removeEvent,
  undoHistory,
  upsertEvent,
} from '@/lib/timegraph/timegraphModel';
import { fromJson } from '@/lib/timegraph/timegraphExport';
import { todayPoint, toYearValue } from '@/lib/timegraph/timegraphDate';
import { useTimegraph } from '@/lib/timegraph/timegraphStore';
import { useIsActiveTab } from '@/lib/WorkspaceTabs';
import { toast } from 'sonner';
import TextSizeControl, { useTextSizePreference } from '@/components/scripture/TextSizeControl';
import { startFieldSpotlight } from '@/lib/spotlightMotion';

/**
 * The full Timegraph editor: toolbar, canvas, event panel.
 *
 * The document itself lives in `timegraphStore`, shared with every embed of the
 * same graph, so edits made here are visible everywhere immediately and are
 * autosaved once. Undo history is local to this editor session — it is a record
 * of what *you* did in this sitting, not a shared log.
 */
export default function TimegraphEditor({
  timegraphId,
  linkTargets = [],
  onClose = null,
  className = '',
  minHeight = 420,
  spotlightEventId = null,
  spotlightQuery = '',
  spotlightField = '',
  spotlightToken = '',
}) {
  const { timegraph, status, error, saveState, update, flush } = useTimegraph(timegraphId);
  const [textSize, setTextSize] = useTextSizePreference();
  const isActiveTab = useIsActiveTab();
  const hasTimegraph = Boolean(timegraph);
  const editorRef = React.useRef(null);
  const hostRef = React.useRef(null);
  const fileInputRef = React.useRef(null);
  const historyRef = React.useRef(null);
  const historyGraphIdRef = React.useRef(null);
  const spotlightHandledRef = React.useRef('');

  const [width, setWidth] = React.useState(1000);
  const [viewport, setViewport] = React.useState(() => createViewport({
    centerYear: new Date().getFullYear(), yearsPerPixel: 0.5, width: 1000, height: minHeight,
  }));
  const [selectedIds, setSelectedIds] = React.useState([]);
  const [history, setHistory] = React.useState(null);
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [filters, setFilters] = React.useState({
    query: '', tags: [], hiddenTags: [], hideUntagged: false, colors: [],
  });
  const [exportOpen, setExportOpen] = React.useState(false);

  // Track the host's width so the axis spans the real surface rather than a
  // guess; height follows the deepest stack so no lane is ever clipped.
  React.useLayoutEffect(() => {
    if (hasTimegraph === false) return undefined;
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return undefined;

    const measure = () => {
      const nextWidth = Math.max(320, Math.round(host.clientWidth));
      setWidth((current) => (current === nextWidth ? current : nextWidth));
      const nextHeight = Math.max(minHeight, Math.round(host.clientHeight));
      setPaneHeight((current) => (current === nextHeight ? current : nextHeight));
    };

    // The host does not exist while the record is loading. Measure immediately
    // when it appears, then once more after the surrounding tab has completed
    // its first layout. This prevents the stale half-height canvas seen at
    // startup and keeps cursor coordinates aligned with the visible surface.
    measure();
    const frame = window.requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    window.addEventListener('focus', measure);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('focus', measure);
    };
  }, [hasTimegraph, minHeight]);

  const visibleEvents = React.useMemo(
    () => filterEvents(timegraph?.events || [], filters),
    [timegraph, filters],
  );

  const canvasViewport = React.useMemo(
    () => clampViewport({ ...viewport, width }),
    [viewport, width],
  );

  // Grow the canvas to fit the stacks currently on screen.
  const [measuredHeight, setMeasuredHeight] = React.useState(minHeight);
  const [paneHeight, setPaneHeight] = React.useState(minHeight);
  const canvasHeight = Math.max(minHeight, paneHeight, measuredHeight);
  const laneAwareViewport = React.useMemo(
    () => ({ ...canvasViewport, height: canvasHeight }),
    [canvasViewport, canvasHeight],
  );

  // When the stacks make the canvas taller than the pane, the axis would sit
  // below the fold. Scroll so it lands in the middle of what is visible, leaving
  // the outer lanes reachable by scrolling rather than clipped away.
  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const overflow = canvasHeight - host.clientHeight;
    if (overflow <= 0) return;
    host.scrollTop = overflow / 2;
  }, [canvasHeight]);

  // A mounted editor can be pointed at another timeline without remounting.
  // Never let the previous timeline's undo chain leak into the next one.
  React.useEffect(() => {
    historyRef.current = null;
    historyGraphIdRef.current = null;
    setHistory(null);
    setSelectedIds([]);
  }, [timegraphId]);

  // Restore the saved view once for each timeline, when its record arrives.
  React.useEffect(() => {
    if (!timegraph || historyGraphIdRef.current === timegraphId) return;
    historyGraphIdRef.current = timegraphId;
    const initialHistory = createHistory(timegraph);
    historyRef.current = initialHistory;
    setHistory(initialHistory);
    if (timegraph.view) {
      setViewport((current) => clampViewport({ ...current, ...timegraph.view, width }));
      return;
    }
    const bounds = eventsBounds(timegraph.events);
    if (bounds) setViewport(viewportForRange(bounds.from, bounds.to, { width, height: minHeight }));
  }, [timegraphId, timegraph, width, minHeight]);

  // Spotlight can address one event inside a large chronology. Reveal it even
  // if a toolbar filter hid it, center its year, open the real event editor and
  // select the exact matching words in purple.
  React.useEffect(() => {
    const query = String(spotlightQuery || '').trim();
    const jumpKey = `${timegraphId}:${spotlightToken}`;
    if (!timegraph || spotlightEventId == null || !query || !spotlightToken) return undefined;
    if (spotlightHandledRef.current === jumpKey) return undefined;

    const event = (timegraph.events || []).find((candidate) => (
      String(candidate.id) === String(spotlightEventId)
    ));
    spotlightHandledRef.current = jumpKey;
    if (!event) return undefined;

    setFilters({ query: '', tags: [], hiddenTags: [], hideUntagged: false, colors: [] });
    setSelectedIds([event.id]);
    const eventYear = toYearValue(event.start);
    if (Number.isFinite(eventYear)) {
      setViewport((current) => clampViewport({ ...current, centerYear: eventYear }));
    }

    const selector = spotlightField === 'body'
      ? '#tg-description'
      : spotlightField === 'tags'
        ? '#tg-tags'
        : '#tg-title';
    let secondFrame = null;
    let trip;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const field = editorRef.current?.querySelector(selector);
        if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
        trip = startFieldSpotlight(field, query);
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) window.cancelAnimationFrame(secondFrame);
      trip?.cancel();
    };
  }, [spotlightEventId, spotlightField, spotlightQuery, spotlightToken, timegraph, timegraphId]);

  /** Every mutation goes through here so undo history and autosave stay in step. */
  const commit = React.useCallback((mutate) => {
    let before = null;
    const next = update((current) => {
      before = current;
      return mutate(current);
    });
    if (next) {
      const base = historyGraphIdRef.current === timegraphId && historyRef.current
        ? historyRef.current
        : createHistory(before || next);
      const nextHistory = pushHistory(base, next);
      historyGraphIdRef.current = timegraphId;
      historyRef.current = nextHistory;
      setHistory(nextHistory);
    }
    return next;
  }, [timegraphId, update]);

  const selectedEvent = React.useMemo(
    () => (timegraph?.events || []).find((event) => event.id === selectedIds[0]) || null,
    [timegraph, selectedIds],
  );

  const handleSelect = React.useCallback((id, { additive = false } = {}) => {
    if (id == null) { setSelectedIds([]); return; }
    setSelectedIds((current) => {
      if (!additive) return [id];
      return current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id];
    });
  }, []);

  const handleNewEvent = React.useCallback(() => {
    // createEvent reads the device's local calendar date on every invocation,
    // including after midnight or a time-zone change while this editor is open.
    const event = createEvent();
    if (!commit((current) => upsertEvent(current, event))) return;
    setSelectedIds([event.id]);
    setViewport((current) => clampViewport({ ...current, centerYear: toYearValue(event.start) }));
    // A newly created event should be visible even when a filter excludes it.
    setFilters((current) => filterEvents([event], current).length ? current : {
      query: '', tags: [], hiddenTags: [], hideUntagged: false, colors: [],
    });
  }, [commit]);

  const handleMoveEvent = React.useCallback((id, yearValue, { committed }) => {
    const current = timegraph?.events.find((event) => event.id === id);
    if (!current) return;
    const moved = moveEventToYear(current, yearValue);
    if (committed) {
      commit((graph) => upsertEvent(graph, moved));
    } else {
      // Live drag: update the shared record but don't push an undo step per frame.
      update((graph) => upsertEvent(graph, moved));
    }
  }, [timegraph, commit, update]);

  const applyHistory = React.useCallback((step) => {
    if (historyGraphIdRef.current !== timegraphId || !historyRef.current) return;
    const current = historyRef.current;
    const next = step(current);
    if (next === current) return;
    // Update the ref first. A fast second press must see this undo immediately,
    // even before React has painted the first one.
    historyRef.current = next;
    setHistory(next);
    update(next.present);
  }, [timegraphId, update]);

  const handleFitAll = React.useCallback(() => {
    const bounds = eventsBounds(visibleEvents.length ? visibleEvents : timegraph?.events);
    if (!bounds) { toast.info('No events to fit yet.'); return; }
    setViewport(viewportForRange(bounds.from, bounds.to, { width, height: laneAwareViewport.height }));
  }, [visibleEvents, timegraph, width, laneAwareViewport.height]);

  const handleJumpToday = React.useCallback(() => {
    const year = toYearValue(todayPoint());
    setViewport((current) => clampViewport({ ...current, centerYear: year, width }));
  }, [width]);

  const handleSave = React.useCallback(async () => {
    try {
      // Remember where the user was looking, so reopening is continuous.
      update((current) => ({
        ...current,
        view: { centerYear: laneAwareViewport.centerYear, yearsPerPixel: laneAwareViewport.yearsPerPixel },
      }));
      await flush();
      toast.success('Timegraph saved.');
    } catch (saveError) {
      toast.error(saveError?.message || 'BEX could not save the timegraph.');
    }
  }, [update, flush, laneAwareViewport]);

  const handleImportFile = React.useCallback(async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const { timegraph: imported, dropped } = fromJson(text);
      commit((current) => ({
        ...current,
        // Imported events are added alongside what is already here rather than
        // replacing it, so an import can never silently destroy existing work.
        events: [...current.events, ...imported.events.map((event) => ({
          ...event,
          id: `${event.id}-imported-${Math.random().toString(36).slice(2, 7)}`,
        }))],
      }));
      toast.success(
        dropped
          ? `Imported ${imported.events.length} events; skipped ${dropped} without a readable date.`
          : `Imported ${imported.events.length} events.`,
      );
    } catch (importError) {
      toast.error(importError?.message || 'BEX could not read that timegraph file.');
    }
  }, [commit]);

  // Keyboard: listen across the active Timeline workspace. Keeping this only on
  // the editor element made undo fail after Delete removed the focused button,
  // because focus fell back to the page body and the keystroke never arrived.
  const handleKeyDown = React.useCallback((event) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || '')
      || event.target?.isContentEditable;
    const typingInsideEditor = typing && editorRef.current?.contains(event.target);
    const modifier = event.metaKey || event.ctrlKey;

    // A timeline name (or another field outside this editor) owns its native
    // text undo. Event fields inside this editor belong to Timeline history.
    if (typing && !typingInsideEditor) return;

    // The shared rich editor owns text undo/redo, including block selections.
    if (modifier && event.key.toLowerCase() === 'z'
      && event.target?.closest?.('[data-testid="timegraph-description-editor"]')) return;

    if (modifier && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      applyHistory(event.shiftKey ? redoHistory : undoHistory);
      return;
    }
    if (modifier && event.key.toLowerCase() === 's') {
      event.preventDefault();
      handleSave();
      return;
    }
    if (typing) return;

    if ((event.key === 'e' || event.key === 'E' || event.key === 'n' || event.key === 'N') && !event.repeat) {
      event.preventDefault();
      handleNewEvent();
      return;
    }
    if (event.key === 'f' || event.key === 'F') { event.preventDefault(); handleFitAll(); return; }
    if (event.key === 't' || event.key === 'T') { event.preventDefault(); handleJumpToday(); return; }
    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedIds.length) {
      event.preventDefault();
      commit((current) => selectedIds.reduce((graph, id) => removeEvent(graph, id), current));
      setSelectedIds([]);
      return;
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      setViewport((current) => zoomAt({ ...current, width }, width / 2, 0.7));
      return;
    }
    if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      setViewport((current) => zoomAt({ ...current, width }, width / 2, 1.4));
    }
  }, [
    applyHistory,
    commit,
    handleFitAll,
    handleJumpToday,
    handleNewEvent,
    handleSave,
    selectedIds,
    width,
  ]);

  React.useEffect(() => {
    if (!isActiveTab) return undefined;
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [handleKeyDown, isActiveTab]);

  if (status === 'error') {
    return (
      <div className="bex-timegraph-embed__missing" data-testid="timegraph-error">
        {error?.message || 'BEX could not open that timegraph.'}
      </div>
    );
  }

  if (!timegraph) {
    return (
      <div
        className="flex items-center justify-center gap-2 p-8 text-xs"
        style={{ color: 'rgb(var(--ink-faint))' }}
        data-testid="timegraph-loading"
      >
        <Loader2 className="w-4 h-4 animate-spin" /> Loading timegraph…
      </div>
    );
  }

  const tags = collectTags(timegraph.events);
  const untaggedCount = timegraph.events.filter((event) => event.tags.length === 0).length;
  const filtering = Boolean(
    filters.query || filters.tags.length || filters.hiddenTags.length
      || filters.hideUntagged || filters.colors.length,
  );

  return (
    <div
      ref={editorRef}
      className={`bex-timegraph-editor ${className}`}
      data-testid="timegraph-editor"
    >
      <div className="bex-timegraph-toolbar">
        <button type="button" className="bex-tg-button is-primary" onClick={handleNewEvent} title="New event (E)" data-testid="timegraph-new-event">
          <Plus className="w-3 h-3" /> New event
        </button>

        <span className="w-px h-5 mx-0.5" style={{ background: 'rgb(var(--line))' }} />

        <button
          type="button" className="bex-tg-button" title="Undo (⌘Z)" aria-label="Undo"
          onClick={() => applyHistory(undoHistory)}
          disabled={!history?.past.length}
          data-testid="timegraph-undo"
        >
          <Undo2 className="w-3 h-3" />
        </button>
        <button
          type="button" className="bex-tg-button" title="Redo (⇧⌘Z)" aria-label="Redo"
          onClick={() => applyHistory(redoHistory)}
          disabled={!history?.future.length}
          data-testid="timegraph-redo"
        >
          <Redo2 className="w-3 h-3" />
        </button>

        <span className="w-px h-5 mx-0.5" style={{ background: 'rgb(var(--line))' }} />

        <button type="button" className="bex-tg-button" onClick={handleFitAll} title="Fit all events (F)" data-testid="timegraph-fit">
          <Maximize2 className="w-3 h-3" /> Fit all
        </button>
        <button type="button" className="bex-tg-button" onClick={handleJumpToday} title="Jump to today (T)" data-testid="timegraph-today">
          <CalendarClock className="w-3 h-3" /> Today
        </button>
        <button
          type="button" className="bex-tg-button" aria-label="Zoom out"
          onClick={() => setViewport((current) => zoomAt({ ...current, width }, width / 2, 1.4))}
          data-testid="timegraph-zoom-out"
        >
          <Minus className="w-3 h-3" />
        </button>
        <button
          type="button" className="bex-tg-button" aria-label="Zoom in"
          onClick={() => setViewport((current) => zoomAt({ ...current, width }, width / 2, 0.7))}
          data-testid="timegraph-zoom-in"
        >
          <Plus className="w-3 h-3" />
        </button>

        <span className="w-px h-5 mx-0.5" style={{ background: 'rgb(var(--line))' }} />

        <button
          type="button"
          className={`bex-tg-button ${filtering ? 'is-active' : ''}`}
          onClick={() => setFilterOpen((open) => !open)}
          aria-expanded={filterOpen}
          data-testid="timegraph-filter-toggle"
        >
          <Filter className="w-3 h-3" /> Filter
          {filtering && <span>· {visibleEvents.length}/{timegraph.events.length}</span>}
        </button>

        <TagVisibilityRow
          tags={tags}
          untaggedCount={untaggedCount}
          filters={filters}
          onChange={setFilters}
        />

        <div className="ml-auto flex items-center gap-1.5">
          <div className="rounded-md border px-2 py-1" style={{ borderColor: 'rgb(var(--line))' }}>
            <TextSizeControl
              value={textSize}
              onChange={setTextSize}
              ariaLabel="Timeline text size"
              testId="timeline-text-size"
            />
          </div>
          <span className="text-[10.5px]" style={{ color: 'rgb(var(--ink-faint))' }} data-testid="timegraph-save-state">
            {saveState === 'saving' ? 'Saving…'
              : saveState === 'pending' ? 'Unsaved changes'
                : saveState === 'error' ? 'Save failed'
                  : saveState === 'saved' ? 'Saved' : ''}
          </span>
          <button type="button" className="bex-tg-button" onClick={() => fileInputRef.current?.click()} data-testid="timegraph-import">
            <Upload className="w-3 h-3" /> Import
          </button>
          <button type="button" className="bex-tg-button" onClick={() => setExportOpen(true)} data-testid="timegraph-export-open">
            <Share2 className="w-3 h-3" /> Export
          </button>
          <button type="button" className="bex-tg-button" onClick={handleSave} data-testid="timegraph-save">
            {saveState === 'saving' ? <Loader2 className="w-3 h-3 animate-spin" />
              : saveState === 'saved' ? <Check className="w-3 h-3" /> : <Save className="w-3 h-3" />}
            Save
          </button>
          {onClose && (
            <button type="button" className="bex-tg-button" onClick={onClose} data-testid="timegraph-close">
              Close
            </button>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            handleImportFile(event.target.files?.[0]);
            event.target.value = '';
          }}
          data-testid="timegraph-import-input"
        />
      </div>

      {filterOpen && (
        <FilterBar
          filters={filters}
          onChange={setFilters}
          tags={tags}
          matched={visibleEvents.length}
          total={timegraph.events.length}
        />
      )}

      <div className="flex min-h-0 flex-1">
        {/* Scrolls vertically, never horizontally: horizontal movement is the
            timeline's own panning, but a very dense graph genuinely needs more
            vertical room than the pane has, and clipping the outermost lane would
            hide events entirely. Zooming in reduces the stacking. */}
        <div ref={hostRef} className="flex-1 min-w-0 overflow-x-hidden overflow-y-auto">
          <TimegraphCanvas
            timegraph={{ ...timegraph, events: visibleEvents }}
            viewport={laneAwareViewport}
            onViewportChange={(next) => setViewport(next)}
            selectedIds={selectedIds}
            onSelect={handleSelect}
            onMoveEvent={handleMoveEvent}
            onOpenEvent={(id) => setSelectedIds([id])}
            onHeightNeeded={setMeasuredHeight}
          />
        </div>

        {selectedEvent && (
          <TimegraphEventPanel
            availableTags={tags.map(({ tag }) => tag)}
            event={selectedEvent}
            linkTargets={linkTargets}
            onChange={(next) => commit((current) => upsertEvent(current, next))}
            onDuplicate={(id) => {
              let created = null;
              commit((current) => {
                const result = duplicateEvent(current, id);
                created = result.event;
                return result.timegraph;
              });
              if (created) setSelectedIds([created.id]);
            }}
            onDelete={(id) => {
              commit((current) => removeEvent(current, id));
              setSelectedIds([]);
            }}
            onClose={() => setSelectedIds([])}
          />
        )}
      </div>

      {exportOpen && (
        <TimegraphExportDialog
          timegraph={timegraph}
          viewport={laneAwareViewport}
          selectedIds={selectedIds}
          onClose={() => setExportOpen(false)}
        />
      )}
    </div>
  );
}

function FilterBar({ filters, onChange, tags, matched, total }) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 px-3 py-2"
      style={{ borderBottom: '1px solid rgb(var(--line))', background: 'rgb(var(--elevated) / 0.4)' }}
      data-testid="timegraph-filter-bar"
    >
      <input
        className="bex-tg-input"
        style={{ maxWidth: '15rem' }}
        value={filters.query}
        onChange={(event) => onChange({ ...filters, query: event.target.value })}
        placeholder="Search titles, notes, tags, dates…"
        aria-label="Filter events"
        data-testid="timegraph-filter-query"
      />
      {tags.map(({ tag, count }) => {
        const key = tagKey(tag);
        const active = filters.tags.some(entry => tagKey(entry) === key);
        return (
          <button
            key={key}
            type="button"
            className={`bex-tg-button ${active ? 'is-active' : ''}`}
            aria-pressed={active}
            onClick={() => onChange({
              ...filters,
              tags: active ? filters.tags.filter((entry) => tagKey(entry) !== key) : [...filters.tags, tag],
            })}
          >
            {tag} · {count}
          </button>
        );
      })}
      {(filters.query || filters.tags.length || filters.hiddenTags.length
        || filters.hideUntagged || filters.colors.length) && (
        <button
          type="button"
          className="bex-tg-button"
          onClick={() => onChange({
            query: '', tags: [], hiddenTags: [], hideUntagged: false, colors: [],
          })}
        >
          Clear
        </button>
      )}
      <span className="text-[10.5px] ml-auto" style={{ color: 'rgb(var(--ink-faint))' }}>
        {matched} of {total} shown
      </span>
    </div>
  );
}

function TagVisibilityRow({ tags, untaggedCount, filters, onChange }) {
  if (!tags.length && !untaggedCount) return null;

  return (
    <div className="bex-timegraph-tag-strip" aria-label="Event tag visibility">
      {untaggedCount > 0 && (
        <label
          className={`bex-timegraph-tag-toggle ${filters.hideUntagged ? 'is-hidden' : ''}`}
          title={`${filters.hideUntagged ? 'Show' : 'Hide'} ${untaggedCount} untagged event${untaggedCount === 1 ? '' : 's'}`}
        >
          <input
            type="checkbox"
            checked={!filters.hideUntagged}
            onChange={() => onChange((current) => ({
              ...current,
              hideUntagged: !current.hideUntagged,
            }))}
            aria-label={`${filters.hideUntagged ? 'Show' : 'Hide'} untagged events`}
          />
          <span>Untagged</span>
        </label>
      )}
      {tags.map(({ tag, count }) => {
        const key = tagKey(tag);
        const hidden = filters.hiddenTags.some((entry) => tagKey(entry) === key);
        return (
          <label
            key={key}
            className={`bex-timegraph-tag-toggle ${hidden ? 'is-hidden' : ''}`}
            title={`${hidden ? 'Show' : 'Hide'} ${count} event${count === 1 ? '' : 's'} tagged ${tag}`}
          >
            <input
              type="checkbox"
              checked={!hidden}
              onChange={() => onChange((current) => ({
                ...current,
                hiddenTags: hidden
                  ? current.hiddenTags.filter((entry) => tagKey(entry) !== key)
                  : [...current.hiddenTags, tag],
              }))}
              aria-label={`${hidden ? 'Show' : 'Hide'} events tagged ${tag}`}
            />
            <span>{tag}</span>
          </label>
        );
      })}
    </div>
  );
}

export { requiredHeight };
