import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { desktopClient } from '@/api/desktopClient';
import { useAuth } from '@/lib/AuthContext';

// ─── Remappable, persisted keybinds (per scope) ─────────────────────────
// A scope is a logical keymap, e.g. 'kw' (Knowledge Web canvas) or 'mindmap'
// (Mind View). Bindings are `{ toolId: keyChar }`. They persist two ways:
//   1. localStorage (instant, survives reloads on this device)
//   2. user metadata via desktopClient.owner.updatePreferences → flattened back on the user
//      object as `keybinds_<scope>` (cross-device; see user-prefs round-trip)
// The given/spec defaults are passed in by the caller and used whenever no
// stored value exists. Keys are normalized to lowercase single characters so
// matching in keydown handlers is case-insensitive.

const lsKey = (scope) => `brn_keybinds_${scope}`;
const prefKey = (scope) => `keybinds_${scope}`;

function normKey(k) {
  if (k == null) return '';
  const s = String(k);
  if (s === ' ') return 'space';
  return s.length === 1 ? s.toLowerCase() : s.toLowerCase();
}

function loadLocal(scope) {
  try {
    const raw = localStorage.getItem(lsKey(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function saveLocal(scope, binds) {
  try { localStorage.setItem(lsKey(scope), JSON.stringify(binds)); } catch {}
}

// Merge stored bindings over defaults so newly-added tools always have a key
// even if the stored blob predates them. Only known tool ids are kept.
function mergeWithDefaults(defaults, stored) {
  const out = { ...defaults };
  if (stored && typeof stored === 'object') {
    for (const id of Object.keys(defaults)) {
      if (typeof stored[id] === 'string' && stored[id]) out[id] = normKey(stored[id]);
    }

    // A newly-added tool must own its advertised default key. Otherwise an
    // older customized map can leave (for example) both the new Timeline and
    // another tool on 6, and the reverse lookup silently makes one unreachable.
    // Move the older owner back to its own default before the new tool claims it.
    for (const id of Object.keys(defaults)) {
      const isNewTool = typeof stored[id] !== 'string' || !stored[id];
      if (!isNewTool) continue;
      const defaultKey = normKey(defaults[id]);
      const previousOwner = Object.keys(out).find(
        (otherId) => otherId !== id && out[otherId] === defaultKey && typeof stored[otherId] === 'string',
      );
      if (previousOwner) out[previousOwner] = normKey(defaults[previousOwner]);
      out[id] = defaultKey;
    }
  }
  return out;
}

export default function useKeybinds(scope, defaults) {
  // Defaults are stable per scope; freeze a normalized copy once.
  const normDefaults = useMemo(() => {
    const o = {};
    for (const k of Object.keys(defaults || {})) o[k] = normKey(defaults[k]);
    return o;
  }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps

  const [binds, setBinds] = useState(() => mergeWithDefaults(normDefaults, loadLocal(scope)));
  const hydratedRef = useRef(false);
  const { user } = useAuth();

  // One-time hydration from server-side user prefs (cross-device). We only
  // lock hydration once we've actually applied a saved keymap — NOT merely
  // because `user` became non-null. Metadata can flatten onto the user object
  // a render or two after auth resolves, so locking on bare `user` would miss
  // late-arriving prefs. Once a real keymap is applied it wins, and later
  // auth refreshes can't clobber the user's in-session edits.
  useEffect(() => {
    if (hydratedRef.current) return;
    const fromUser = user && user[prefKey(scope)];
    if (fromUser && typeof fromUser === 'object') {
      const merged = mergeWithDefaults(normDefaults, fromUser);
      setBinds(merged);
      saveLocal(scope, merged);
      hydratedRef.current = true;
    }
  }, [user, scope, normDefaults]);

  const persist = useCallback((next) => {
    saveLocal(scope, next);
    // Once the user edits locally, that's authoritative for this session — stop
    // any later server-pref hydration from overwriting their fresh choice.
    hydratedRef.current = true;
    // Fire-and-forget server save; keybinds don't gate nav so no refresh needed.
    // updateMe is async: guard both a synchronous throw and a rejected promise
    // so a transient save failure never surfaces as an unhandled rejection.
    try {
      const p = desktopClient.owner.updatePreferences({ [prefKey(scope)]: next });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {}
  }, [scope]);

  // Assign `key` to `toolId`. If another tool already owns that key, swap so
  // every tool keeps exactly one binding (no silent collisions / dead tools).
  const setBind = useCallback((toolId, rawKey) => {
    const key = normKey(rawKey);
    if (!key) return;
    setBinds((prev) => {
      if (!(toolId in prev)) return prev;
      const next = { ...prev };
      const oldKey = next[toolId];
      const owner = Object.keys(next).find((id) => id !== toolId && next[id] === key);
      if (owner) next[owner] = oldKey; // swap
      next[toolId] = key;
      persist(next);
      return next;
    });
  }, [persist]);

  const resetBinds = useCallback(() => {
    const next = { ...normDefaults };
    setBinds(next);
    persist(next);
  }, [normDefaults, persist]);

  // Reverse lookup `{ keyChar: toolId }` for keydown dispatch.
  const keyToTool = useMemo(() => {
    const m = {};
    for (const id of Object.keys(binds)) m[binds[id]] = id;
    return m;
  }, [binds]);

  return { binds, setBind, resetBinds, keyToTool, defaults: normDefaults };
}
