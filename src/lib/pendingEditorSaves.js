/** @type {Set<() => Promise<boolean>>} */
const pendingSavers = new Set();

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
