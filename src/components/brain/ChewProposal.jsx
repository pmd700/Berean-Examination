import React, { useMemo, useState } from 'react';
import {
  AlertTriangle, Plus, GitBranch, Tag, CheckCircle2, FileText,
  Check, X, Copy, GitPullRequest, Loader2, Ban,
} from 'lucide-react';

// Data Chewer "review & commit" panel (Step 6).
//
// Pulled into its own presentational component (like ExportMenu.jsx) so it can
// be render-tested in isolation — see tests/dataChewer.test.js. It imports only
// React + lucide-react, NO app aliases, so the lightweight node:test +
// react-dom/server runner can mount it without Vite.
//
// Renders the AI drafts (cards/connections/tags) from the EXISTING source
// pipeline (metadata_json.ai_processing_v1) as a GitHub-style pull-request
// review: every draft can be accepted or rejected individually, and a single
// "Commit accepted changes" button writes ONLY the accepted items into the
// selected Knowledge Web.
//
// This component never writes to the API itself — it calls the `onCommit`
// callback (provided by BrainChat) with the accepted payload and reflects the
// returned result. Without `onCommit` (e.g. in the isolated render test) the
// commit controls render but stay inert.

const ACCEPTED = 'accepted';
const REJECTED = 'rejected';

export default function ChewProposal({ m, idx, onCommit, targetWebId, targetWebName }) {
  const { proposal, procError, sourceMeta } = m;

  const cards = useMemo(
    () => (Array.isArray(proposal?.possible_card_drafts) ? proposal.possible_card_drafts : []),
    [proposal],
  );
  const conns = useMemo(
    () => (Array.isArray(proposal?.possible_connection_drafts) ? proposal.possible_connection_drafts : []),
    [proposal],
  );
  const warnings = Array.isArray(proposal?.warnings) ? proposal.warnings : [];
  const allTags = Array.from(new Set(cards.flatMap((c) => (Array.isArray(c.tags) ? c.tags : []))));

  // Per-item review state. GitHub-PR convention: everything is proposed for
  // inclusion by default; the reviewer rejects what they don't want. Nothing
  // is written until the explicit Commit click.
  const [cardState, setCardState] = useState(() => cards.map(() => ACCEPTED));
  const [connState, setConnState] = useState(() => conns.map(() => ACCEPTED));
  const [committing, setCommitting] = useState(false);
  // When this proposal is reopened from Source History for a source that was
  // already committed, BrainChat passes m.committedInfo so the panel renders
  // straight into its read-only committed/changelog state.
  const [committed, setCommitted] = useState(() => {
    const ci = m?.committedInfo;
    if (!ci) return null;
    return {
      cards: ci.cards ?? 0,
      connections: ci.connections ?? 0,
      skipped: ci.skipped ?? 0,
    };
  });
  const [commitError, setCommitError] = useState(null);

  // Intra-batch duplicate detection (real, not mocked): two proposed cards
  // with the same normalized title are flagged so the reviewer can reject one.
  const duplicateGroups = useMemo(() => {
    const byTitle = new Map();
    cards.forEach((c, i) => {
      const key = String(c?.title ?? '').trim().toLowerCase();
      if (!key) return;
      if (!byTitle.has(key)) byTitle.set(key, []);
      byTitle.get(key).push(i);
    });
    return Array.from(byTitle.entries())
      .filter(([, ids]) => ids.length > 1)
      .map(([title, ids]) => ({ title, ids }));
  }, [cards]);
  const duplicateIdx = useMemo(() => {
    const s = new Set();
    duplicateGroups.forEach((g) => g.ids.forEach((i) => s.add(i)));
    return s;
  }, [duplicateGroups]);

  const norm = (s) => String(s ?? '').trim().toLowerCase();
  const acceptedTitleSet = useMemo(() => {
    const s = new Set();
    cards.forEach((c, i) => { if (cardState[i] === ACCEPTED) s.add(norm(c?.title)); });
    return s;
  }, [cards, cardState]);

  // A connection is committable only if BOTH endpoint cards are accepted in
  // this same batch (the server resolves endpoints by title against committed
  // cards). Otherwise it's auto-blocked regardless of its own accept toggle.
  const connBlocked = (cn) => !(acceptedTitleSet.has(norm(cn?.from_title)) && acceptedTitleSet.has(norm(cn?.to_title)));

  const acceptedCardCount = cardState.filter((s) => s === ACCEPTED).length;
  const committableConns = conns.filter((cn, i) => connState[i] === ACCEPTED && !connBlocked(cn));
  const acceptedConnCount = committableConns.length;
  const nothingAccepted = acceptedCardCount === 0 && acceptedConnCount === 0;

  const toggleCard = (i) => setCardState((p) => p.map((s, j) => (j === i ? (s === ACCEPTED ? REJECTED : ACCEPTED) : s)));
  const toggleConn = (i) => setConnState((p) => p.map((s, j) => (j === i ? (s === ACCEPTED ? REJECTED : ACCEPTED) : s)));
  const acceptAll = () => { setCardState(cards.map(() => ACCEPTED)); setConnState(conns.map(() => ACCEPTED)); };
  const rejectAll = () => { setCardState(cards.map(() => REJECTED)); setConnState(conns.map(() => REJECTED)); };

  const handleCommit = async () => {
    if (!onCommit || committing || committed || nothingAccepted) return;
    const accepted_cards = cards.filter((_, i) => cardState[i] === ACCEPTED);
    const accepted_connections = conns.filter((cn, i) => connState[i] === ACCEPTED && !connBlocked(cn));
    setCommitting(true);
    setCommitError(null);
    try {
      const out = await onCommit({ accepted_cards, accepted_connections });
      setCommitted({
        cards: out?.committed_cards?.length ?? accepted_cards.length,
        connections: out?.committed_connections?.length ?? accepted_connections.length,
        skipped: out?.skipped_connections?.length ?? 0,
      });
    } catch (e) {
      setCommitError(e?.message || 'Commit failed');
    }
    setCommitting(false);
  };

  // ── Analysis failure: nothing to review ───────────────────────────────────
  if (!proposal) {
    return (
      <div className="rounded-lg border border-red-900/60 bg-red-950/20 p-4" data-testid={`chew-proposal-${idx}`}>
        <div className="flex items-center gap-2 text-sm font-semibold text-red-200">
          <AlertTriangle className="w-4 h-4" /> Data Chewer couldn't analyze this material
        </div>
        {procError?.message && (
          <div className="text-xs text-red-200/90 mt-1 break-words">{procError.message}</div>
        )}
        <div className="text-[11px] text-[var(--text-muted)] mt-2">
          The raw material was still saved as a source — you can retry processing later. Nothing was added to your graph.
        </div>
      </div>
    );
  }

  const webLabel = targetWebName
    ? targetWebName
    : (targetWebId ? `web #${targetWebId}` : (sourceMeta?.web_id ? `web #${sourceMeta.web_id}` : null));

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] overflow-hidden" data-testid={`chew-proposal-${idx}`}>
      {/* Header: PR-style summary line */}
      <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <GitPullRequest className="w-4 h-4 text-[var(--accent-violet-light)]" />
          <span className="text-sm font-semibold">Proposed changes</span>
          {proposal.confidence && (
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-muted)]">
              confidence: {proposal.confidence}
            </span>
          )}
          {committed && (
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-900/40 border border-emerald-700/50 text-emerald-200 inline-flex items-center gap-1" data-testid={`chew-status-committed-${idx}`}>
              <CheckCircle2 className="w-3 h-3" /> committed
            </span>
          )}
          {m?.reopened && (
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-muted)]" data-testid={`chew-status-reopened-${idx}`}>
              reopened from history
            </span>
          )}
        </div>
        {!committed && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={acceptAll}
              className="text-[10px] px-2 py-0.5 rounded-md border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              data-testid={`chew-accept-all-${idx}`}
            >
              Accept all
            </button>
            <button
              type="button"
              onClick={rejectAll}
              className="text-[10px] px-2 py-0.5 rounded-md border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              data-testid={`chew-reject-all-${idx}`}
            >
              Reject all
            </button>
          </div>
        )}
      </div>

      {/* Source provenance line — proves raw source is preserved on commit */}
      {sourceMeta && (
        <div className="px-4 py-2 border-b border-[var(--border-subtle)] text-[11px] text-[var(--text-muted)] flex flex-wrap gap-x-3 gap-y-1" data-testid={`chew-source-${idx}`}>
          <span><FileText className="w-3 h-3 inline mr-1" />Source #{sourceMeta.id} · {sourceMeta.source_type}</span>
          <span className="truncate max-w-[18rem]">"{sourceMeta.title}"</span>
          <span>{Number(sourceMeta.raw_text_chars || 0).toLocaleString()} chars</span>
          <span>{webLabel ? `→ ${webLabel}` : '→ no web selected'}</span>
        </div>
      )}

      {/* Diff stat line */}
      <div className="px-4 py-2 border-b border-[var(--border-subtle)] flex flex-wrap gap-2 text-[11px]">
        <span className="inline-flex items-center gap-1 text-emerald-300"><Plus className="w-3 h-3" />{cards.length} card{cards.length === 1 ? '' : 's'}</span>
        <span className="inline-flex items-center gap-1 text-emerald-300"><GitBranch className="w-3 h-3" />{conns.length} connection{conns.length === 1 ? '' : 's'}</span>
        <span className="inline-flex items-center gap-1 text-[var(--text-muted)]"><Tag className="w-3 h-3" />{allTags.length} tag{allTags.length === 1 ? '' : 's'}</span>
        {warnings.length > 0 && (
          <span className="inline-flex items-center gap-1 text-amber-300"><AlertTriangle className="w-3 h-3" />{warnings.length} warning{warnings.length === 1 ? '' : 's'}</span>
        )}
        {duplicateGroups.length > 0 && (
          <span className="inline-flex items-center gap-1 text-amber-300"><Copy className="w-3 h-3" />{duplicateGroups.length} possible duplicate{duplicateGroups.length === 1 ? '' : 's'}</span>
        )}
      </div>

      <div className="p-4 space-y-4">
        {proposal.summary && (
          <div data-testid={`chew-summary-${idx}`}>
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Summary</div>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{proposal.summary}</p>
          </div>
        )}

        {/* ── New Cards ─────────────────────────────────────────────────── */}
        {cards.length > 0 && (
          <div data-testid={`chew-cards-${idx}`}>
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">New cards ({acceptedCardCount}/{cards.length})</div>
            <div className="space-y-2">
              {cards.map((c, i) => {
                const accepted = cardState[i] === ACCEPTED;
                return (
                  <ReviewRow
                    key={i}
                    accepted={accepted}
                    committed={!!committed}
                    onToggle={() => toggleCard(i)}
                    testid={`chew-card-${idx}-${i}`}
                    acceptTestid={`chew-card-accept-${idx}-${i}`}
                    rejectTestid={`chew-card-reject-${idx}-${i}`}
                  >
                    <div className="text-sm font-semibold break-words flex items-center gap-2">
                      {c.title || '(untitled)'}
                      {duplicateIdx.has(i) && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-950/40 border border-amber-800/50 text-amber-300 inline-flex items-center gap-1">
                          <Copy className="w-2.5 h-2.5" /> possible duplicate
                        </span>
                      )}
                    </div>
                    {c.description && <p className="text-xs text-[var(--text-secondary)] mt-1 whitespace-pre-wrap break-words">{c.description}</p>}
                    {Array.isArray(c.tags) && c.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {c.tags.map((t, j) => (
                          <span key={j} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-muted)]">{t}</span>
                        ))}
                      </div>
                    )}
                    {c.reason_this_card_matters && (
                      <p className="text-[11px] text-[var(--text-muted)] italic mt-1.5">Why: {c.reason_this_card_matters}</p>
                    )}
                  </ReviewRow>
                );
              })}
            </div>
          </div>
        )}

        {/* ── New Connections ───────────────────────────────────────────── */}
        {conns.length > 0 && (
          <div data-testid={`chew-connections-${idx}`}>
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">New connections ({acceptedConnCount}/{conns.length})</div>
            <div className="space-y-2">
              {conns.map((c, i) => {
                const blocked = connBlocked(c);
                const accepted = connState[i] === ACCEPTED && !blocked;
                return (
                  <ReviewRow
                    key={i}
                    accepted={accepted}
                    blocked={blocked}
                    committed={!!committed}
                    onToggle={() => toggleConn(i)}
                    testid={`chew-connection-${idx}-${i}`}
                    acceptTestid={`chew-connection-accept-${idx}-${i}`}
                    rejectTestid={`chew-connection-reject-${idx}-${i}`}
                  >
                    <div className="flex items-center gap-2 flex-wrap text-sm">
                      <span className="font-semibold break-words">{c.from_title || '?'}</span>
                      <span className="text-[var(--text-muted)]">— {c.relationship_type || 'related to'} →</span>
                      <span className="font-semibold break-words">{c.to_title || '?'}</span>
                    </div>
                    {c.label && <div className="text-xs text-[var(--text-muted)] mt-1">{c.label}</div>}
                    {c.reason_this_connection_matters && (
                      <p className="text-[11px] text-[var(--text-muted)] italic mt-1">Why: {c.reason_this_connection_matters}</p>
                    )}
                    {blocked && (
                      <p className="text-[11px] text-amber-300/90 mt-1 inline-flex items-center gap-1" data-testid={`chew-connection-blocked-${idx}-${i}`}>
                        <Ban className="w-3 h-3" /> Both endpoint cards must be accepted to commit this link.
                      </p>
                    )}
                  </ReviewRow>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Warnings ──────────────────────────────────────────────────── */}
        {warnings.length > 0 && (
          <div data-testid={`chew-warnings-${idx}`}>
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Warnings</div>
            <ul className="space-y-1 text-xs text-amber-300">
              {warnings.map((w, i) => (
                <li key={i} className="flex gap-2 items-start">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <span className="break-words">{typeof w === 'string' ? w : JSON.stringify(w)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Possible Duplicates ───────────────────────────────────────── */}
        {duplicateGroups.length > 0 && (
          <div data-testid={`chew-duplicates-${idx}`}>
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Possible duplicates</div>
            <ul className="space-y-1 text-xs text-amber-300">
              {duplicateGroups.map((g, i) => (
                <li key={i} className="flex gap-2 items-start">
                  <Copy className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <span className="break-words">
                    {g.ids.length} proposed cards share the title “{cards[g.ids[0]]?.title || g.title}”. Reject the extras to avoid duplicate cards.
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {cards.length === 0 && conns.length === 0 && (
          <div className="text-xs text-[var(--text-muted)]" data-testid={`chew-no-drafts-${idx}`}>
            The analysis didn't surface any card or connection drafts for this material.
          </div>
        )}

        {/* ── Changelog Preview ─────────────────────────────────────────── */}
        {(cards.length > 0 || conns.length > 0) && (
          <div data-testid={`chew-changelog-${idx}`}>
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Changelog preview</div>
            <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-[11px] leading-relaxed">
              {committed ? (
                <>
                  <div className="text-emerald-300">+ {committed.cards} card(s) committed</div>
                  <div className="text-emerald-300">+ {committed.connections} connection(s) committed</div>
                  {committed.skipped > 0 && (
                    <div className="text-amber-300">~ {committed.skipped} connection(s) skipped (endpoint not committed)</div>
                  )}
                  <div className="text-[var(--text-muted)] mt-1">{webLabel ? `into ${webLabel}` : ''}</div>
                </>
              ) : (
                <>
                  <div className="text-emerald-300">+ {acceptedCardCount} card(s) to add</div>
                  <div className="text-emerald-300">+ {acceptedConnCount} connection(s) to add</div>
                  {(cards.length - acceptedCardCount > 0 || conns.length - acceptedConnCount > 0) && (
                    <div className="text-[var(--text-muted)]">
                      − {cards.length - acceptedCardCount} card(s), {conns.length - acceptedConnCount} connection(s) excluded
                    </div>
                  )}
                  <div className="text-[var(--text-muted)] mt-1">{webLabel ? `target: ${webLabel}` : 'no web selected — pick one to commit'}</div>
                </>
              )}
            </div>
          </div>
        )}

        {commitError && (
          <div className="text-xs text-red-300 break-words" data-testid={`chew-commit-error-${idx}`}>
            <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />{commitError}
          </div>
        )}
      </div>

      {/* Footer: commit control + guardrail */}
      <div className="px-4 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center justify-between gap-3 flex-wrap" data-testid={`chew-footer-${idx}`}>
        {committed ? (
          <div className="text-[11px] text-emerald-200 inline-flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
            Committed to your Knowledge Web. The raw source is preserved on every card.
          </div>
        ) : (
          <div className="text-[11px] text-[var(--text-muted)] inline-flex items-center gap-2 min-w-0">
            <CheckCircle2 className="w-3.5 h-3.5 text-[var(--accent-violet-light)] flex-shrink-0" />
            Review each item. Nothing is added to your Knowledge Web until you commit.
          </div>
        )}
        {!committed && (cards.length > 0 || conns.length > 0) && (
          <button
            type="button"
            onClick={handleCommit}
            disabled={committing || nothingAccepted || !webLabel || !onCommit}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid={`chew-commit-${idx}`}
            title={!webLabel ? 'Select a Knowledge Web first' : (nothingAccepted ? 'Accept at least one item' : 'Commit accepted changes')}
          >
            {committing
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Committing…</>
              : <><Check className="w-3.5 h-3.5" /> Commit accepted changes</>}
          </button>
        )}
      </div>
    </div>
  );
}

// A single reviewable diff row with Accept / Reject controls. Accepted rows
// read as green "added" diffs; rejected rows dim and strike through.
function ReviewRow({ accepted, blocked, committed, onToggle, children, testid, acceptTestid, rejectTestid }) {
  const tone = blocked
    ? 'border-amber-900/40 bg-amber-950/5'
    : accepted
      ? 'border-emerald-900/50 bg-emerald-950/10'
      : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] opacity-60';
  return (
    <div className={`rounded-md border px-3 py-2 ${tone}`} data-testid={testid}>
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex-shrink-0">
          {accepted
            ? <Plus className="w-3.5 h-3.5 text-emerald-400" />
            : <X className="w-3.5 h-3.5 text-[var(--text-muted)]" />}
        </div>
        <div className={`min-w-0 flex-1 ${!accepted && !blocked ? 'line-through decoration-[var(--text-muted)]/40' : ''}`}>
          {children}
        </div>
        {!committed && (
          <div className="flex-shrink-0 flex items-center gap-1">
            {accepted ? (
              <button
                type="button"
                onClick={onToggle}
                className="text-[10px] px-1.5 py-0.5 rounded-md border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-red-300 hover:border-red-900/60 inline-flex items-center gap-1"
                data-testid={rejectTestid}
                title="Reject"
              >
                <X className="w-3 h-3" /> Reject
              </button>
            ) : (
              <button
                type="button"
                onClick={onToggle}
                disabled={blocked}
                className="text-[10px] px-1.5 py-0.5 rounded-md border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-emerald-300 hover:border-emerald-900/60 inline-flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                data-testid={acceptTestid}
                title={blocked ? 'Accept both endpoint cards first' : 'Accept'}
              >
                {blocked ? <Ban className="w-3 h-3" /> : <Check className="w-3 h-3" />} Accept
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
