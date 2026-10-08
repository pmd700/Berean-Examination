import { waitForLocalEntityWritesToSettle } from '@/lib/localEntities';

export async function restartBex() {
  const api = typeof window === 'undefined' ? null : window.bexDesktop;
  if (!api?.isDesktop || typeof api.restartApp !== 'function') {
    throw new Error('This older desktop process needs to be closed and reopened once to install automatic restart.');
  }
  try {
    // All workspace editors remain mounted behind the modal. Wait beyond
    // their debounce windows and refuse to restart after an unresolved save.
    await waitForLocalEntityWritesToSettle({ quietMs: 1000 });
  } catch {
    throw new Error('BEX is still saving or could not save recent edits. Resolve the save error and try restarting again.');
  }
  let result;
  try { result = await api.restartApp(); }
  catch { throw new Error('BEX could not start the restart. Please try again.'); }
  if (!result?.ok) throw new Error(result?.error || 'BEX could not restart. Please try again.');
}
