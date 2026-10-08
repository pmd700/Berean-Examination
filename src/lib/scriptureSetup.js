const CHANGED_EVENT = 'bex:scripture-setup-changed';
export const SCRIPTURE_SETUP_CHANGED_EVENT = CHANGED_EVENT;
const RESTART_MESSAGE = 'Restart BEX once to finish installing scripture setup, then paste your API key again.';
function restartRequired() {
  return Object.assign(new Error(RESTART_MESSAGE), { code: 'BEX_RESTART_REQUIRED' });
}

async function invoke(method, ...args) {
  const api = typeof window === 'undefined' ? null : window.bexDesktop;
  if (!api?.isDesktop || typeof api[method] !== 'function') {
    throw restartRequired();
  }
  let result;
  try {
    result = await api[method](...args);
  } catch (failure) {
    // During development the renderer can update before the already-running
    // main process. Keep Electron's internal IPC errors out of the UI.
    const missingHandler = /No handler registered/i.test(failure?.message || '');
    if (missingHandler) throw restartRequired();
    throw new Error('Scripture setup is temporarily unavailable. Please try again.');
  }
  if (!result?.ok) throw new Error(result?.error || 'BEX could not update scripture setup.');
  return { configured: result.status?.configured === true };
}

export const getScriptureSetup = () => invoke('getScriptureStatus');
export async function saveScriptureKey(key) {
  const status = await invoke('saveScriptureKey', key);
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: status }));
  return status;
}
export async function clearScriptureKey() {
  const status = await invoke('clearScriptureKey');
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: status }));
  return status;
}
