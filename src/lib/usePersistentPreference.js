import React from 'react';

/**
 * A user preference that actually survives a restart.
 *
 * `localStorage` alone is not enough in the packaged desktop app: the built
 * files are served from `http://127.0.0.1:<port>` on an ephemeral port, so the
 * origin — and with it the whole localStorage bucket — is different on every
 * launch. Anything stored only there is gone by the next start.
 *
 * So the real home for a preference is the local owner record (SQLite, keyed by
 * the library, not by an origin). localStorage is kept as a synchronous cache
 * so the first render already has the right value instead of flashing the
 * default while the database is read.
 */

const CHANGE_EVENT = 'bex:preference-change';

function readCached(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeCached(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage blocked — the owner record is still authoritative */ }
}

function isDesktop() {
  return typeof window !== 'undefined' && window.bexDesktop?.isDesktop;
}

/**
 * @param {string} key        storage key, also the owner-preference field name
 * @param {*}      fallback   value when nothing has been stored yet
 */
export function usePersistentPreference(key, fallback) {
  const [value, setValue] = React.useState(() => readCached(key, fallback));
  const [ready, setReady] = React.useState(() => !isDesktop());
  // A choice made in this session must not be overwritten by a slower read of
  // the stored value that was already in flight.
  const touched = React.useRef(false);
  // Mirrors `value` so `update(fn)` can resolve a functional update *outside*
  // the state updater. React may call an updater speculatively (and does, twice,
  // under StrictMode) — writing to storage and dispatching an event from in
  // there would run those effects more than once per change, and the dispatch
  // would call setState on sibling hooks mid-render.
  const latest = React.useRef(value);
  React.useEffect(() => { latest.current = value; }, [value]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isDesktop()) return;
      try {
        const { readLocalOwner } = await import('@/lib/localOwner');
        const owner = await readLocalOwner();
        const stored = owner?.[key];
        if (cancelled || touched.current || stored === undefined || stored === null) return;
        setValue(stored);
        writeCached(key, stored);
      } catch { /* not signed in yet — the cached value stands */ }
      finally { if (!cancelled) setReady(true); }
    })();
    return () => { cancelled = true; };
  }, [key]);

  // Several workspaces can be mounted at once (tabs keep them alive), so a
  // change in one has to reach the others rather than leaving them disagreeing.
  React.useEffect(() => {
    const onChange = (event) => {
      if (event.detail?.key !== key) return;
      touched.current = true;
      latest.current = event.detail.value;
      setValue(event.detail.value);
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, [key]);

  const update = React.useCallback((next) => {
    touched.current = true;
    const resolved = typeof next === 'function' ? next(latest.current) : next;
    // Set eagerly so two updates in the same tick compose off each other rather
    // than both reading the pre-render value.
    latest.current = resolved;
    setValue(resolved);
    writeCached(key, resolved);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { key, value: resolved } }));
    (async () => {
      if (!isDesktop()) return;
      try {
        const { desktopClient } = await import('@/api/desktopClient');
        await desktopClient.owner.updatePreferences({ [key]: resolved });
      } catch { /* cached locally; will be retried on the next change */ }
    })();
  }, [key]);

  return /** @type {[any, (next: any) => void, boolean]} */ ([value, update, ready]);
}

export default usePersistentPreference;
