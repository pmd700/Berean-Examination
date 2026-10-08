/**
 * One live copy of each Timegraph, shared by every place it appears.
 *
 * A Timegraph is a reusable object: the same graph can be embedded in a note, a
 * Knowledge Web card and a keyword at once, and all of those can be mounted
 * simultaneously (tabs keep workspaces alive). If each embed held its own React
 * state they would drift apart and the last one to autosave would silently win.
 *
 * So the record lives here, keyed by id, with a subscriber set per id. An edit
 * from any surface updates the single entry and notifies every mounted embed on
 * the same frame, and the debounced write to the encrypted store happens once.
 */

import React from 'react';
import { platformEntities } from '@/lib/platform/entities';
import { normalizeTimegraph } from './timegraphModel.js';

const AUTOSAVE_DELAY_MS = 700;

/**
 * id -> {
 *   record, status: 'loading'|'ready'|'error', error,
 *   listeners: Set<fn>, timer, inFlight, dirty, saveState
 * }
 */
const entries = new Map();

function getEntry(id) {
  const key = String(id);
  if (!entries.has(key)) {
    entries.set(key, {
      record: null,
      status: 'idle',
      error: null,
      listeners: new Set(),
      timer: null,
      inFlight: false,
      dirty: false,
      saveState: 'idle',
    });
  }
  return entries.get(key);
}

function notify(entry) {
  // A copy, because a listener may unsubscribe while being called.
  for (const listener of [...entry.listeners]) listener();
}

function patchEntry(id, patch) {
  const entry = getEntry(id);
  Object.assign(entry, patch);
  notify(entry);
  return entry;
}

/** Reads a Timegraph, reusing the shared copy when one is already loaded. */
export async function loadTimegraph(id, { force = false } = {}) {
  const entry = getEntry(id);
  if (!force && entry.record) return entry.record;
  if (entry.status === 'loading' && entry.loadPromise) return entry.loadPromise;

  const promise = (async () => {
    try {
      const raw = await platformEntities.Timegraph.get(id);
      const record = normalizeTimegraph({ ...raw, id });
      patchEntry(id, { record, status: 'ready', error: null, loadPromise: null });
      return record;
    } catch (error) {
      patchEntry(id, { status: 'error', error, loadPromise: null });
      throw error;
    }
  })();

  patchEntry(id, { status: 'loading', loadPromise: promise });
  return promise;
}

export async function listTimegraphs() {
  const records = await platformEntities.Timegraph.list('-updated_date', 500);
  return records.map((record) => normalizeTimegraph(record));
}

export async function createTimegraph(patch = {}) {
  const draft = normalizeTimegraph({ title: '', events: [], ...patch });
  const created = await platformEntities.Timegraph.create(toStoredShape(draft));
  const record = normalizeTimegraph({ ...created });
  patchEntry(record.id, { record, status: 'ready', error: null });
  return record;
}

/** Renames the shared record and writes it immediately before the URL changes. */
export async function renameTimegraph(id, title) {
  await loadTimegraph(id);
  const record = updateTimegraph(id, (current) => ({ ...current, title: String(title ?? '').trim() }));
  if (!record) throw new Error('BEX could not open that timeline.');
  await flushTimegraph(id);
  return getTimegraphSnapshot(id);
}

/**
 * Files a timeline under a library folder, or returns it to the main library
 * with a null folder.
 *
 * This goes through the shared record rather than writing `folder_id` straight
 * to the database: a timeline that is open somewhere holds a cached copy, and
 * its next autosave writes every field it knows — including a `folder_id` that
 * would still be the old one, quietly undoing the move.
 */
export async function moveTimegraphToFolder(id, folderId) {
  await loadTimegraph(id);
  const record = updateTimegraph(id, (current) => ({ ...current, folder_id: folderId ?? null }));
  if (!record) throw new Error('BEX could not open that timeline.');
  await flushTimegraph(id);
  return getTimegraphSnapshot(id);
}

/**
 * Deletes the underlying Timegraph. Note that removing an *embed* never calls
 * this — an embed is only a reference, so deleting the object is a separate,
 * deliberate act performed from the picker.
 */
export async function deleteTimegraph(id) {
  await platformEntities.Timegraph.delete(id);
  const entry = entries.get(String(id));
  if (entry) {
    clearTimeout(entry.timer);
    patchEntry(id, { record: null, status: 'deleted', timer: null });
    entries.delete(String(id));
  }
}

/** Only the fields the store owns; ids and timestamps belong to the database. */
function toStoredShape(record) {
  return {
    title: record.title,
    description: record.description,
    events: record.events,
    view: record.view,
    folder_id: record.folder_id ?? null,
    ...(Number.isSafeInteger(record.sort_order) ? { sort_order: record.sort_order } : {}),
  };
}

/**
 * Applies an edit to the shared copy and schedules one autosave.
 *
 * `updater` is a value or a function of the current record. Returns the new
 * record so a caller can push it onto its own undo history.
 */
export function updateTimegraph(id, updater) {
  const entry = getEntry(id);
  if (!entry.record) return null;
  const next = typeof updater === 'function' ? updater(entry.record) : updater;
  if (!next || next === entry.record) return entry.record;

  const record = normalizeTimegraph({ ...next, id: entry.record.id });
  patchEntry(id, { record, dirty: true, saveState: 'pending' });
  scheduleSave(id);
  return record;
}

function scheduleSave(id) {
  const entry = getEntry(id);
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => { flushTimegraph(id); }, AUTOSAVE_DELAY_MS);
}

/**
 * Writes now rather than on the debounce. Used by the Save button and before a
 * surface unmounts, so a fast edit-then-close can't lose the last keystroke.
 */
export async function flushTimegraph(id) {
  const entry = getEntry(id);
  clearTimeout(entry.timer);
  entry.timer = null;
  if (!entry.record || !entry.dirty) return entry.record;

  // A save already in flight: mark dirty and let it re-run when it lands, so two
  // rapid edits can't interleave into a lost update.
  if (entry.inFlight) {
    entry.pendingAgain = true;
    return entry.record;
  }

  entry.inFlight = true;
  entry.dirty = false;
  patchEntry(id, { saveState: 'saving' });
  try {
    const saved = await platformEntities.Timegraph.update(id, toStoredShape(entry.record));
    entry.inFlight = false;
    // Keep whatever the user typed while the write was in flight; only take the
    // database's timestamps back.
    patchEntry(id, {
      saveState: 'saved',
      record: { ...entry.record, updated_date: saved?.updated_date ?? entry.record.updated_date },
    });
    if (entry.pendingAgain) {
      entry.pendingAgain = false;
      entry.dirty = true;
      scheduleSave(id);
    }
    return entry.record;
  } catch (error) {
    entry.inFlight = false;
    // Keep it dirty so the next edit — or an explicit Save — retries.
    entry.dirty = true;
    patchEntry(id, { saveState: 'error', error });
    throw error;
  }
}

export function getTimegraphSnapshot(id) {
  return getEntry(id).record;
}

function subscribe(id, listener) {
  const entry = getEntry(id);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
    // Nothing is watching: drop the debounce but write out anything pending
    // first, otherwise closing the last embed would discard the final edit.
    if (!entry.listeners.size && entry.dirty) flushTimegraph(id).catch(() => {});
  };
}

/**
 * Subscribes a component to one Timegraph.
 *
 * Returns `{ timegraph, status, error, saveState, update, flush, reload }`.
 * Every mounted embed of the same id gets the same object and re-renders
 * together.
 */
export function useTimegraph(id) {
  const [, forceRender] = React.useReducer((count) => count + 1, 0);

  React.useEffect(() => {
    if (!id) return undefined;
    const unsubscribe = subscribe(id, forceRender);
    if (!getEntry(id).record && getEntry(id).status !== 'loading') {
      loadTimegraph(id).catch(() => { /* status carries the error */ });
    }
    return unsubscribe;
  }, [id]);

  const entry = id ? getEntry(id) : null;

  const update = React.useCallback(
    (updater) => (id ? updateTimegraph(id, updater) : null),
    [id],
  );
  const flush = React.useCallback(() => (id ? flushTimegraph(id) : Promise.resolve(null)), [id]);
  const reload = React.useCallback(
    () => (id ? loadTimegraph(id, { force: true }) : Promise.resolve(null)),
    [id],
  );

  return {
    timegraph: entry?.record ?? null,
    status: entry?.status ?? 'idle',
    error: entry?.error ?? null,
    saveState: entry?.saveState ?? 'idle',
    update,
    flush,
    reload,
  };
}

/** Test seam: drops all cached state. */
export function resetTimegraphStore() {
  for (const entry of entries.values()) clearTimeout(entry.timer);
  entries.clear();
}

/**
 * Test seam: places a record in the shared cache without touching the database,
 * so the editor can be exercised outside the desktop app.
 */
export function seedTimegraph(record) {
  const normalized = normalizeTimegraph(record);
  patchEntry(normalized.id, { record: normalized, status: 'ready', error: null });
  return normalized;
}
