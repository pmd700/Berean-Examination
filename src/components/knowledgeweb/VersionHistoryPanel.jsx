import React, { useEffect, useState } from 'react';
import { History, Trash2, RotateCcw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { desktopClient } from '@/api/desktopClient';

function fmtDate(value) {
  if (!value) return '';
  try {
    const d = new Date(value);
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return '';
  }
}

// Floating panel listing every manual snapshot for the active web. Restores
// reuse the existing replaceWebData diffing flow on the parent so undo/redo
// still work and autosave continues normally afterward.
export default function VersionHistoryPanel({
  webId,
  open,
  onClose,
  onRestoreSnapshot,
  refreshKey,
}) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  useEffect(() => {
    if (!open || !webId) return;
    let cancelled = false;
    setLoading(true);
    desktopClient.entities.WebVersion.filter({ web_id: webId })
      .then((rows) => { if (!cancelled) setVersions(rows || []); })
      .catch(() => { if (!cancelled) setVersions([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, webId, refreshKey]);

  const handleRestore = async (id) => {
    setBusyId(id);
    try {
      // The lightweight list omits the large snapshot. Fetch only the one
      // encrypted local snapshot the owner chose to restore.
      const row = await desktopClient.entities.WebVersion.get(id);
      const snap = typeof row.snapshot === 'string' ? JSON.parse(row.snapshot) : row.snapshot;
      await onRestoreSnapshot(snap);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id) => {
    setBusyId(id);
    try {
      await desktopClient.entities.WebVersion.delete(id);
      setVersions(prev => prev.filter(v => v.id !== id));
      setConfirmDeleteId(null);
    } finally {
      setBusyId(null);
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="absolute right-0 top-full mt-1 z-50 w-80 bg-surface border border-line rounded-lg shadow-xl text-xs"
        data-testid="panel-version-history"
      >
        <div className="px-3 py-2 border-b border-line flex items-center gap-2">
          <History className="w-3.5 h-3.5 text-brand-strong" />
          <span className="font-semibold text-gray-200">Version History</span>
          <span className="ml-auto text-[10px] text-gray-500">{versions.length}</span>
        </div>

        <div className="max-h-80 overflow-y-auto">
          {loading ? (
            <div className="px-3 py-6 text-center text-gray-500 flex items-center justify-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading...
            </div>
          ) : versions.length === 0 ? (
            <div className="px-3 py-6 text-center text-gray-500 leading-relaxed">
              No snapshots yet.<br />
              <span className="text-gray-600 text-[10px]">
                Use this for milestones, not every save — autosave already
                handles your day-to-day work.
              </span>
            </div>
          ) : (
            versions.map(v => (
              <div
                key={v.id}
                className="px-3 py-2 border-b border-[#1F2532] last:border-b-0 group hover:bg-elevated transition-colors"
                data-testid={`row-version-${v.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-gray-200 truncate">
                      {v.label || `Snapshot #${v.id}`}
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5">
                      {fmtDate(v.created_date || v.created_at)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => handleRestore(v.id)}
                      disabled={busyId === v.id}
                      title="Restore this version"
                      className="p-1 rounded text-gray-500 hover:text-brand-strong hover:bg-brand/10 disabled:opacity-40"
                      data-testid={`button-version-restore-${v.id}`}
                    >
                      {busyId === v.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <RotateCcw className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(v.id)}
                      disabled={busyId === v.id}
                      title="Delete this snapshot"
                      className="p-1 rounded text-gray-500 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-40"
                      data-testid={`button-version-delete-${v.id}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {confirmDeleteId === v.id && (
                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleDelete(v.id)}
                      className="h-6 px-2 text-[10px] bg-red-600 hover:bg-red-700 text-white"
                      data-testid={`button-version-delete-confirm-${v.id}`}
                    >
                      Confirm delete
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmDeleteId(null)}
                      className="h-6 px-2 text-[10px] text-gray-400"
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
