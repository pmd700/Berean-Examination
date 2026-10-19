import { waitForLocalEntityWritesToSettle } from '@/lib/localEntities';
import { flushPendingEditorSaves } from '@/lib/pendingEditorSaves';

/** Reload the interface after mounted editors have persisted their edits. */
export async function refreshBex({ reload = () => window.location.reload(), timeoutMs = 20000 } = {}) {
  let timeout;
  let stopped = false;
  try {
    // Study editors can use longer timers than notes. Flush those first, then
    // wait for ordinary note/web/timeline debounces and protected file imports.
    const prepare = async () => {
      await flushPendingEditorSaves();
      if (stopped) return;
      do {
        await waitForLocalEntityWritesToSettle({ quietMs: 1000, operationName: 'Refresh' });
        if (stopped) return;
        // An edit made during the wait must save too, followed by another quiet
        // window for any note debounce scheduled while that save was running.
      } while (await flushPendingEditorSaves());
    };
    await Promise.race([
      prepare(),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Saving timed out.')), timeoutMs); }),
    ]);
  } catch {
    throw new Error('BEX is still saving, or a recent save failed. Wait for saving to finish or resolve the save error, then refresh again. Your workspace has been kept open.');
  } finally {
    stopped = true;
    clearTimeout(timeout);
  }
  reload();
}
