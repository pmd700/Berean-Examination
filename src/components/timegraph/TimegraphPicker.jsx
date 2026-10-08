import React from 'react';
import { Loader2, Plus, Trash2, X } from 'lucide-react';
import TimelineGlyph from './TimelineGlyph';
import { createTimegraph, deleteTimegraph, listTimegraphs } from '@/lib/timegraph/timegraphStore';
import { formatDateRange } from '@/lib/timegraph/timegraphDate';
import { eventsBounds } from '@/lib/timegraph/timegraphLayout';
import { fromYearValue } from '@/lib/timegraph/timegraphDate';
import { toast } from 'sonner';

/**
 * Create a new Timeline, or insert one that already exists.
 *
 * Inserting an existing graph is the whole point of the object being reusable:
 * the note stores a reference, so the same chronology can appear in a study note
 * and a Knowledge Web card and stay in step. Deleting from here deletes the
 * object itself and is called out as such, because removing an *embed* elsewhere
 * deliberately does not.
 */
export default function TimegraphPicker({ onPick, onClose }) {
  const [graphs, setGraphs] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [confirmDelete, setConfirmDelete] = React.useState(null);

  const load = React.useCallback(async () => {
    try {
      setGraphs(await listTimegraphs());
      setError(null);
    } catch (loadError) {
      setError(loadError?.message || 'BEX could not list your timelines.');
      setGraphs([]);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      const record = await createTimegraph({ title: title.trim() });
      onPick?.(record);
    } catch (createError) {
      toast.error(createError?.message || 'BEX could not create a timeline.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center p-4"
      style={{ background: 'rgb(0 0 0 / 0.6)', backdropFilter: 'blur(3px)' }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose?.(); }}
      data-testid="timegraph-picker"
    >
      <div
        className="w-full max-w-lg rounded-xl p-4 space-y-3"
        style={{ background: 'rgb(var(--surface))', border: '1px solid rgb(var(--line))' }}
        role="dialog"
        aria-modal="true"
        aria-label="Insert timeline"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold" style={{ color: 'rgb(var(--ink))' }}>
            Insert a timeline
          </h3>
          <button type="button" className="bex-tg-button" onClick={onClose} aria-label="Close">
            <X className="w-3 h-3" />
          </button>
        </div>

        <div>
          <label className="bex-tg-label" htmlFor="tg-new-title">New timeline</label>
          <div className="flex gap-1.5">
            <input
              id="tg-new-title"
              className="bex-tg-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); create(); } }}
              placeholder="e.g. Reformation chronology"
              data-testid="timegraph-new-title"
            />
            <button
              type="button"
              className="bex-tg-button is-primary"
              onClick={create}
              disabled={busy}
              data-testid="timegraph-create"
            >
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              Create
            </button>
          </div>
        </div>

        <div>
          <span className="bex-tg-label">Or insert an existing one</span>
          {graphs === null && (
            <p className="text-xs flex items-center gap-1.5" style={{ color: 'rgb(var(--ink-faint))' }}>
              <Loader2 className="w-3 h-3 animate-spin" /> Loading…
            </p>
          )}
          {error && <p className="text-xs" style={{ color: '#f87171' }}>{error}</p>}
          {graphs?.length === 0 && !error && (
            <p className="text-xs" style={{ color: 'rgb(var(--ink-faint))' }}>
              You have no timelines yet — create one above.
            </p>
          )}
          {graphs?.length > 0 && (
            <ul className="space-y-1 max-h-64 overflow-y-auto" data-testid="timegraph-existing-list">
              {graphs.map((graph) => {
                const bounds = eventsBounds(graph.events);
                const span = bounds
                  ? formatDateRange(fromYearValue(bounds.from), fromYearValue(bounds.to))
                  : 'No events yet';
                return (
                  <li key={graph.id}>
                    {confirmDelete === graph.id ? (
                      <div
                        className="flex items-center gap-1.5 p-2 rounded-md"
                        style={{ background: 'rgb(127 29 29 / 0.25)' }}
                      >
                        <span className="flex-1 text-[11px]" style={{ color: 'rgb(var(--ink-muted))' }}>
                          Delete “{graph.title || 'Unnamed timeline'}” everywhere? Embeds of it will show as missing.
                        </span>
                        <button
                          type="button"
                          className="bex-tg-button"
                          style={{ color: '#fca5a5' }}
                          onClick={async () => {
                            try {
                              await deleteTimegraph(graph.id);
                              setConfirmDelete(null);
                              load();
                              toast.success('Timeline deleted.');
                            } catch (deleteError) {
                              toast.error(deleteError?.message || 'BEX could not delete that timeline.');
                            }
                          }}
                          data-testid={`timegraph-confirm-delete-${graph.id}`}
                        >
                          Delete
                        </button>
                        <button type="button" className="bex-tg-button" onClick={() => setConfirmDelete(null)}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          className="flex-1 flex items-center gap-2 p-2 rounded-md text-left transition-colors"
                          style={{ background: 'rgb(var(--elevated) / 0.5)' }}
                          onClick={() => onPick?.(graph)}
                          data-testid={`timegraph-pick-${graph.id}`}
                        >
                          <TimelineGlyph className="w-3.5 h-3.5 shrink-0" style={{ color: 'rgb(var(--brand-strong))' }} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-semibold truncate" style={{ color: 'rgb(var(--ink))' }}>
                              {graph.title || 'Unnamed timeline'}
                            </span>
                            <span className="block text-[10.5px]" style={{ color: 'rgb(var(--ink-faint))' }}>
                              {graph.events.length} event{graph.events.length === 1 ? '' : 's'} · {span}
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          className="bex-tg-button"
                          aria-label={`Delete ${graph.title || 'Unnamed timeline'}`}
                          onClick={() => setConfirmDelete(graph.id)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
