import React, { useState } from 'react';
import {
  History, FileText, Loader2, RotateCw, Eye, CheckCircle2,
  AlertTriangle, Clock, ChevronDown, ChevronRight, GitPullRequest,
} from 'lucide-react';

// Source History (Phase 3) — "Chewed Sources" panel inside Brain Chat.
//
// Presentational only (React + lucide-react, no app aliases) so it can be
// render-tested in isolation like ChewProposal. It shows the recent raw
// sources behind the Data Chewer: status, type, created date, whether anything
// was committed, the chew-session changelog summary, and per-row actions
// (reopen the proposal/changelog, retry failed processing, view raw summary).
//
// It never calls the API itself — BrainChat passes onReopen / onRetry and the
// already-fetched source rows (which include metadata_json.chew_session_v1).

function fmtDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

const STATUS_TONE = {
  processed: 'bg-emerald-950/30 border-emerald-800/50 text-emerald-300',
  processing: 'bg-violet-950/30 border-violet-800/50 text-violet-300',
  failed: 'bg-red-950/30 border-red-800/50 text-red-300',
  unprocessed: 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-muted)]',
};

export default function SourceHistory({ sources, onReopen, onRetry, busyId }) {
  const list = Array.isArray(sources) ? sources : [];

  return (
    <div data-testid="source-history">
      <div className="flex items-center gap-2 mb-3">
        <History className="w-4 h-4 text-[var(--accent-violet-light)]" />
        <div className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Chewed sources</div>
      </div>

      {list.length === 0 ? (
        <div className="text-xs text-[var(--text-muted)]" data-testid="source-history-empty">
          Nothing chewed yet. Paste raw material in Data Chewer mode to build your source history.
        </div>
      ) : (
        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1" data-testid="source-history-list">
          {list.map((s) => (
            <SourceRow
              key={s.id}
              source={s}
              busy={busyId === s.id}
              onReopen={onReopen}
              onRetry={onRetry}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SourceRow({ source, busy, onReopen, onRetry }) {
  const [open, setOpen] = useState(false);
  const status = source?.processing_status || 'unprocessed';
  const meta = (source?.metadata_json && typeof source.metadata_json === 'object') ? source.metadata_json : {};
  const session = meta.chew_session_v1 || null;
  const procError = meta.ai_processing_error || null;
  const committed = !!session && (session.committed?.cards > 0 || session.committed?.connections > 0);
  const tone = STATUS_TONE[status] || STATUS_TONE.unprocessed;

  return (
    <div
      className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-2"
      data-testid={`source-history-row-${source.id}`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mt-0.5 flex-shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          data-testid={`source-history-toggle-${source.id}`}
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold break-words leading-snug" data-testid={`source-history-title-${source.id}`}>
            {source.title || '(untitled)'}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${tone}`} data-testid={`source-history-status-${source.id}`}>
              {status}
            </span>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-muted)]">
              <FileText className="w-2.5 h-2.5 inline mr-0.5" />{source.source_type || 'note'}
            </span>
            {committed && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-950/40 border border-emerald-800/50 text-emerald-300 inline-flex items-center gap-0.5" data-testid={`source-history-committed-${source.id}`}>
                <CheckCircle2 className="w-2.5 h-2.5" /> committed
              </span>
            )}
            <span className="text-[9px] text-[var(--text-muted)] inline-flex items-center gap-0.5">
              <Clock className="w-2.5 h-2.5" />{fmtDate(source.created_at)}
            </span>
          </div>

          {/* One-line changelog summary, always visible when present */}
          {session && (
            <div className="text-[10px] text-[var(--text-muted)] mt-1 font-mono" data-testid={`source-history-changelog-${source.id}`}>
              +{session.committed?.cards ?? 0} card(s), +{session.committed?.connections ?? 0} conn(s)
              {session.committed?.skipped > 0 ? `, ~${session.committed.skipped} skipped` : ''}
            </div>
          )}
          {status === 'failed' && procError?.message && (
            <div className="text-[10px] text-red-300/90 mt-1 break-words inline-flex items-start gap-1" data-testid={`source-history-error-${source.id}`}>
              <AlertTriangle className="w-2.5 h-2.5 mt-0.5 flex-shrink-0" />
              <span className="break-words">{procError.message}</span>
            </div>
          )}
        </div>
      </div>

      {open && (
        <div className="mt-2 pl-5 space-y-2" data-testid={`source-history-detail-${source.id}`}>
          {session && (
            <div className="text-[10px] text-[var(--text-secondary)] space-y-1">
              {session.ai_summary && (
                <p className="leading-relaxed whitespace-pre-wrap break-words">{session.ai_summary}</p>
              )}
              <div className="font-mono text-[var(--text-muted)] leading-relaxed">
                <div>proposed: {session.proposed?.cards ?? 0} card(s), {session.proposed?.connections ?? 0} conn(s)</div>
                <div className="text-emerald-300/90">accepted: {(session.accepted?.cards || []).length} card(s), {(session.accepted?.connections || []).length} conn(s)</div>
                {((session.rejected?.cards || []).length > 0 || (session.rejected?.connections || []).length > 0) && (
                  <div className="text-[var(--text-muted)]">rejected: {(session.rejected?.cards || []).length} card(s), {(session.rejected?.connections || []).length} conn(s)</div>
                )}
                {session.duplicate_count > 0 && <div className="text-amber-300/90">{session.duplicate_count} possible duplicate(s)</div>}
                {(session.warnings || []).length > 0 && <div className="text-amber-300/90">{session.warnings.length} warning(s)</div>}
              </div>
            </div>
          )}
          {!session && status === 'processed' && (
            <div className="text-[10px] text-[var(--text-muted)]">Processed but not committed yet — reopen to review the proposal.</div>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            {(status === 'processed' || status === 'failed') && (
              <button
                type="button"
                onClick={() => onReopen && onReopen(source.id)}
                disabled={busy}
                className="text-[10px] px-2 py-0.5 rounded-md border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)] inline-flex items-center gap-1 disabled:opacity-40"
                data-testid={`source-history-reopen-${source.id}`}
              >
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : (session ? <Eye className="w-3 h-3" /> : <GitPullRequest className="w-3 h-3" />)}
                {session ? 'Reopen changelog' : 'Reopen proposal'}
              </button>
            )}
            {status === 'failed' && (
              <button
                type="button"
                onClick={() => onRetry && onRetry(source.id)}
                disabled={busy}
                className="text-[10px] px-2 py-0.5 rounded-md border border-red-900/50 text-red-300 hover:bg-red-950/30 inline-flex items-center gap-1 disabled:opacity-40"
                data-testid={`source-history-retry-${source.id}`}
              >
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCw className="w-3 h-3" />}
                Retry processing
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
