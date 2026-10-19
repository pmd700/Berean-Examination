import React from 'react';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { refreshBex } from '@/lib/refreshBex';

export default function RefreshBexButton({ onRefresh = refreshBex } = {}) {
  const [refreshing, setRefreshing] = React.useState(false);
  const pending = React.useRef(false);

  const refresh = async () => {
    if (pending.current) return;
    pending.current = true;
    setRefreshing(true);
    try { await onRefresh(); }
    catch (error) { toast.error(error?.message || 'BEX could not refresh. Please try again.'); }
    finally { pending.current = false; setRefreshing(false); }
  };

  return <>
    <button
      type="button"
      onClick={refresh}
      disabled={refreshing}
      aria-label="Refresh BEX"
      aria-busy={refreshing}
      title="Refresh BEX: finish autosaves and reload the interface. Open tabs are restored."
      className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-ink-soft transition-colors hover:bg-elevated hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400 disabled:cursor-wait disabled:opacity-60"
      data-testid="workspace-refresh"
    >
      <RefreshCw aria-hidden="true" className={`h-3.5 w-3.5 ${refreshing ? 'motion-safe:animate-spin' : ''}`} />
    </button>
    {refreshing && <span role="status" className="sr-only">Saving edits and refreshing BEX…</span>}
  </>;
}
