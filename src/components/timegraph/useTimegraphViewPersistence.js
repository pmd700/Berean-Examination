import React from 'react';
import { registerPendingEditorSave } from '@/lib/pendingEditorSaves';
import { normalizeSavedView } from '@/lib/timegraph/timegraphModel';

const emptyFilters = () => ({ query: '', tags: [], hiddenTags: [], hideUntagged: false, colors: [] });

/** Keep navigation out of undo history, but in the timeline's encrypted record. */
export default function useTimegraphViewPersistence({ id, timegraph, viewport, filters, setFilters, hostRef, canvasHeight, paneHeight, active, update, flush }) {
  const hydration = React.useRef(null), latest = React.useRef(null);
  const [hydratingId, setHydratingId] = React.useState(null), [readyId, setReadyId] = React.useState(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  latest.current = { id, viewport, filters, scrollTop, active, ready: readyId === id, update, flush };

  React.useEffect(() => {
    if (!timegraph || hydration.current?.id === id) return;
    hydration.current = { id, scrollTop: timegraph.view?.scrollTop ?? null, done: false };
    setReadyId(null); setHydratingId(id);
    setFilters(timegraph.view?.filters || emptyFilters());
  }, [id, timegraph, setFilters]);

  // Record loading, lane measurement, and the host's actual size arrive in
  // separate renders. Apply the saved scroll after those layouts, not against
  // the initial 420px placeholder (where the browser would clamp it to zero).
  React.useLayoutEffect(() => {
    const saved = hydration.current, host = hostRef.current;
    if (!host || !active || hydratingId !== id || saved?.id !== id || saved.done) return;
    const apply = () => { host.scrollTop = saved.scrollTop ?? Math.max(0, (canvasHeight - host.clientHeight) / 2); };
    apply();
    let second;
    const first = requestAnimationFrame(() => {
      apply();
      second = requestAnimationFrame(() => {
        apply(); saved.done = true;
        setScrollTop(host.scrollTop); setReadyId(id);
      });
    });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [id, hydratingId, hostRef, canvasHeight, paneHeight, active]);

  const persist = React.useCallback(() => {
    const state = latest.current;
    if (!state.ready || !state.active || hydration.current?.id !== state.id) return;
    const view = normalizeSavedView({
      centerYear: state.viewport.centerYear,
      yearsPerPixel: state.viewport.yearsPerPixel,
      scrollTop: hostRef.current?.scrollTop ?? state.scrollTop,
      filters: state.filters,
    });
    state.update(current => JSON.stringify(current.view) === JSON.stringify(view) ? current : { ...current, view });
  }, [hostRef]);

  React.useEffect(() => { persist(); }, [persist, id, readyId, active, viewport.centerYear, viewport.yearsPerPixel, filters, scrollTop]);
  React.useEffect(() => {
    const finish = async () => { persist(); await latest.current.flush(); return false; };
    const unregister = registerPendingEditorSave(finish);
    const leaving = () => { finish().catch(() => { /* The store retains dirty data and exposes its save error. */ }); };
    window.addEventListener('pagehide', leaving);
    window.addEventListener('blur', leaving);
    return () => {
      unregister(); window.removeEventListener('pagehide', leaving); window.removeEventListener('blur', leaving);
      leaving();
    };
  }, [persist, id]);

  const onScroll = React.useCallback(event => {
    if (hydration.current?.done && latest.current.ready && latest.current.active) setScrollTop(event.currentTarget.scrollTop);
  }, []);
  return { onScroll, persist, ready: readyId === id };
}
