/** @type {Set<() => Promise<boolean>>} */
const pendingSavers = new Set();
const activeExports = new Set();

// An incoming sync refresh must not destroy the renderer while a native save
// dialog or PDF job is still waiting for its result.
export function registerActiveExport() {
  let finish;
  const completed = new Promise(resolve => { finish = resolve; });
  activeExports.add(completed);
  return () => { activeExports.delete(completed); finish(); };
}

async function finishActiveExports() {
  while (activeExports.size) await Promise.all(Array.from(activeExports));
}

/**
 * Register a mounted editor whose autosave timer can be flushed explicitly.
 * @param {() => Promise<boolean>} save Resolves true if any edit was persisted.
 */
export function registerPendingEditorSave(save) {
  pendingSavers.add(save);
  return () => { pendingSavers.delete(save); };
}

export async function flushPendingEditorSaves() {
  const results = await Promise.allSettled(Array.from(pendingSavers, save => Promise.resolve().then(save)));
  const failure = results.find(result => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
  return results.some(result => result.status === 'fulfilled' && result.value === true);
}

// The trusted desktop main process asks this page to finish editor debounces
// before its normal-close backup and database shutdown begin.
if (typeof window !== 'undefined') {
  Object.defineProperty(window, '__bexFlushPendingEditorSaves', { configurable: true, value: flushPendingEditorSaves });
}

// Freeze input only across the short native apply transaction. Every mounted
// editor has saved before incoming versions are installed and views reopen.
if (typeof window !== 'undefined') {
  let cover;
  Object.defineProperty(window, '__bexBeginRemoteApply', { configurable: true, value: async (label = 'Receiving your synchronized changes…') => {
    await finishActiveExports();
    if (!cover) {
      cover = document.createElement('div');
      cover.setAttribute('role', 'status'); cover.setAttribute('aria-live', 'polite');
      cover.textContent = label;
      Object.assign(cover.style, { position: 'fixed', inset: '0', zIndex: '2147483647', display: 'grid', placeItems: 'center', background: '#101622e8', color: '#f1f5f9' });
      document.body.append(cover); if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    }
    await flushPendingEditorSaves();
  } });
  Object.defineProperty(window, '__bexEndRemoteApply', { configurable: true, value: changed => {
    if (changed) window.location.reload();
    else { cover?.remove(); cover = null; }
  } });
}
