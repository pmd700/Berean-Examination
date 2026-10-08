import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { platformEntities } from '@/lib/platform/entities';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Brain, ArrowLeft, Send, Loader2, FileText, Layers, GitBranch,
  Search as SearchIcon, Sparkles, Eraser, Utensils,
} from 'lucide-react';
import { toast } from 'sonner';
import { LoadingScreen } from '../components/ui/loading-screen';
import ChewProposal from '../components/brain/ChewProposal.jsx';
import SourceHistory from '../components/brain/SourceHistory.jsx';
import MarkdownRenderer from '@/components/editor/MarkdownRenderer';

// Step 5 Brain Chat Workspace.
//
// Intentionally NOT a bottom-right bubble — this is a full-page workspace
// with three regions:
//   • LEFT rail   : context controls (web filter, scope, neighbors toggle,
//                   clear-thread, jump to BrainSearch)
//   • CENTER pane : conversation thread + composer
//   • RIGHT panel : "context used for last answer" — sources/cards/conns
//
// Conversation is FRONTEND STATE ONLY. We never persist to the database
// in this step (spec: "do not add permanent chat memory yet").

async function brainFetch(url, options = {}) {
  const { encodeWriteBody } = await import('@/lib/encodeBody');
  const isWrite = ['POST', 'PUT', 'PATCH'].includes(String(options.method || 'GET').toUpperCase());
  const headers = {};

  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined
      ? JSON.stringify(isWrite ? encodeWriteBody(options.body) : options.body)
      : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

const SCOPE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'sources', label: 'Sources only' },
  { value: 'cards', label: 'Cards only' },
  { value: 'connections', label: 'Connections only' },
];

const CITE_ICON = { source: FileText, card: Layers, connection: GitBranch };

export default function BrainChat() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoadingAuth, user: authUser } = useAuth();

  const [bootLoading, setBootLoading] = useState(true);
  const [webs, setWebs] = useState([]);

  // Source History (Phase 3) — recent chewed sources, replayable.
  const [sources, setSources] = useState([]);
  const [historyBusyId, setHistoryBusyId] = useState(null);

  const [scope, setScope] = useState('all');
  const [webId, setWebId] = useState('__any__');
  const [includeNeighbors, setIncludeNeighbors] = useState(true);

  // Conversation: [{ role: 'user'|'assistant', content, citations?, contextUsed? }]
  // Data Chewer proposals reuse the same thread, rendered as a special
  // assistant turn: { role: 'assistant', kind: 'chew', proposal, sourceMeta }.
  const [messages, setMessages] = useState([]);
  const [pending, setPending] = useState('');
  const [sending, setSending] = useState(false);
  const threadRef = useRef(null);

  // ── Data Chewer (Phase 1) ────────────────────────────────────────
  // A smart mode on the SAME composer — not a separate layout.
  // 'ask'  = normal read-only chat (unchanged behaviour)
  // 'chew' = the Ask box becomes able to chew raw material → reuse
  //          brain_sources + AI processing, show read-only "Proposed
  //          changes". The AI infers the source type; no fields to fill in.
  const [mode, setMode] = useState('ask');

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated) { navigate('/'); return; }
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadingAuth, isAuthenticated]);

  useEffect(() => {
    // Auto-scroll to the latest message whenever the thread grows.
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, sending]);

  const bootstrap = async () => {
    try {
      const w = await platformEntities.KnowledgeWeb.list().catch(() => []);
      setWebs(Array.isArray(w) ? w : []);
    } catch (e) {
      console.error('[BrainChat] bootstrap failed', e);
    }
    refreshSources();
    setBootLoading(false);
  };

  // Pull the recent raw sources behind the Data Chewer for Source History.
  // Rows already include metadata_json (chew_session_v1 / ai_processing_v1 /
  // ai_processing_error), so the panel needs no extra round-trips to render.
  const refreshSources = useCallback(async () => {
    try {
      const rows = await brainFetch('/api/brain/sources');
      setSources(Array.isArray(rows) ? rows.slice(0, 25) : []);
    } catch (e) {
      console.error('[BrainChat] refreshSources failed', e);
    }
  }, []);

  // Replay a past source as a chew message in the thread. A committed source
  // shows its stored changelog (read-only); a processed-but-uncommitted one
  // reopens the reviewable proposal; a failed one shows the failure card.
  const reopenSource = useCallback(async (sourceId) => {
    setHistoryBusyId(sourceId);
    try {
      const src = await brainFetch(`/api/brain/sources/${sourceId}`);
      const meta = (src?.metadata_json && typeof src.metadata_json === 'object') ? src.metadata_json : {};
      const proposal = meta.ai_processing_v1 || null;
      const session = meta.chew_session_v1 || null;
      const procError = meta.ai_processing_error || null;
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          kind: 'chew',
          reopened: true,
          proposal,
          procError,
          committedInfo: session ? session.committed : null,
          sourceMeta: {
            id: src.id,
            title: src.title,
            source_type: src.source_type,
            web_id: src.web_id ?? (session?.web_id ?? null),
            raw_text_chars: typeof src.raw_text === 'string' ? src.raw_text.length : (session?.raw_text_chars ?? 0),
          },
        },
      ]);
    } catch (e) {
      toast.error(`Couldn't reopen source: ${e.message}`);
    }
    setHistoryBusyId(null);
  }, []);

  // Retry a failed source: re-run the existing AI processing, then reopen the
  // fresh proposal. Does not touch raw_text; the source row is preserved.
  const retrySource = useCallback(async (sourceId) => {
    setHistoryBusyId(sourceId);
    try {
      await brainFetch(`/api/brain/sources/${sourceId}/process`, { method: 'POST', body: {} });
      toast.success('Re-processed. Opening the new proposal…');
      await refreshSources();
      await reopenSource(sourceId);
    } catch (e) {
      toast.error(`Retry failed: ${e.message}`);
      refreshSources();
    }
    setHistoryBusyId(null);
  }, [refreshSources, reopenSource]);

  const lastContextUsed = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && messages[i].contextUsed) return messages[i].contextUsed;
    }
    return null;
  })();

  const send = useCallback(async () => {
    const text = pending.trim();
    if (!text) return;
    if (sending) return;
    setPending('');
    const newMessages = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    setSending(true);
    try {
      // Send the last 10 turns as history so the AI keeps the thread.
      const history = newMessages.slice(0, -1).slice(-10).map(m => ({
        role: m.role,
        content: m.content,
      }));
      const body = {
        message: text,
        scope,
        include_neighbors: includeNeighbors,
        conversation_history: history,
      };
      if (webId !== '__any__') body.web_id = Number(webId);

      const data = await brainFetch('/api/brain/chat', { method: 'POST', body });
      setMessages([
        ...newMessages,
        {
          role: 'assistant',
          content: data?.answer || '(no answer)',
          citations: Array.isArray(data?.citations) ? data.citations : [],
          contextUsed: data?.context_pack || null,
        },
      ]);
    } catch (e) {
      toast.error(`Chat failed: ${e.message}`);
      setMessages([
        ...newMessages,
        { role: 'assistant', content: `⚠️ ${e.message}`, citations: [], contextUsed: null, isError: true },
      ]);
    }
    setSending(false);
  }, [pending, sending, messages, scope, includeNeighbors, webId]);

  // Data Chewer: reuse the EXISTING source pipeline. We create an immutable
  // brain_source, then run the existing AI processing on it. The returned
  // ai_processing_v1 (drafts/summary/warnings) is shown read-only as
  // "Proposed changes". No card/connection is written — that is a later phase.
  const chew = useCallback(async () => {
    const text = pending.trim();
    if (!text) return;
    if (sending) return;

    // No fields to fill in: derive a title from the first line and let the
    // AI infer everything else. 'note' is just a neutral default label for the
    // immutable source row — the AI analysis is what actually classifies it.
    const title = (text.split('\n')[0].slice(0, 80).trim() || 'Raw material');
    const userTurn = {
      role: 'user',
      kind: 'chew-input',
      content: text,
      sourceTitle: title,
    };
    const newMessages = [...messages, userTurn];
    setMessages(newMessages);
    setPending('');
    setSending(true);
    try {
      const createBody = { title, source_type: 'note', raw_text: text };
      if (webId !== '__any__') createBody.web_id = Number(webId);
      const source = await brainFetch('/api/brain/sources', { method: 'POST', body: createBody });
      const processed = await brainFetch(`/api/brain/sources/${source.id}/process`, { method: 'POST', body: {} });
      const proposal = processed?.metadata_json?.ai_processing_v1 || null;
      const procError = processed?.metadata_json?.ai_processing_error || null;
      setMessages([
        ...newMessages,
        {
          role: 'assistant',
          kind: 'chew',
          proposal,
          procError,
          sourceMeta: {
            id: processed?.id ?? source.id,
            title: processed?.title ?? title,
            source_type: processed?.source_type ?? 'note',
            web_id: processed?.web_id ?? (webId !== '__any__' ? Number(webId) : null),
            raw_text_chars: text.length,
          },
        },
      ]);
    } catch (e) {
      toast.error(`Data Chewer failed: ${e.message}`);
      setMessages([
        ...newMessages,
        { role: 'assistant', kind: 'chew', proposal: null, procError: { message: e.message }, isError: true },
      ]);
    }
    refreshSources();
    setSending(false);
  }, [pending, sending, messages, webId, refreshSources]);

  // Commit reviewed Data Chewer proposals into the graph. Resolves the target
  // web from the source's own web_id, falling back to the left-rail selection.
  // Only the accepted items (decided in ChewProposal) reach the server; nothing
  // is written unless this runs.
  const commitChew = useCallback(async (sourceMeta, payload) => {
    const targetWebId = sourceMeta?.web_id ?? (webId !== '__any__' ? Number(webId) : null);
    if (!targetWebId) {
      const msg = 'Select a Knowledge Web in the left panel before committing.';
      toast.error(msg);
      throw new Error(msg);
    }
    const body = {
      web_id: targetWebId,
      accepted_cards: payload.accepted_cards,
      accepted_connections: payload.accepted_connections,
    };
    const out = await brainFetch(`/api/brain/sources/${sourceMeta.id}/commit`, { method: 'POST', body });
    const nCards = out?.committed_cards?.length ?? 0;
    const nConns = out?.committed_connections?.length ?? 0;
    const nSkip = out?.skipped_connections?.length ?? 0;
    toast.success(
      `Committed ${nCards} card${nCards === 1 ? '' : 's'} and ${nConns} connection${nConns === 1 ? '' : 's'}` +
      (nSkip ? ` (${nSkip} connection${nSkip === 1 ? '' : 's'} skipped)` : ''),
    );
    refreshSources();
    return out;
  }, [webId, refreshSources]);

  const onComposerKey = (e) => {
    // Same composer in both modes: Enter submits, Shift+Enter inserts a
    // newline. In chew mode Enter chews; otherwise it sends.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (mode === 'chew') chew(); else send();
    }
  };

  const clearThread = () => {
    setMessages([]);
    toast.success('Thread cleared (this chat is not saved)');
  };

  if (bootLoading) return <LoadingScreen message="Loading Brain Chat..." />;

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] flex flex-col">
      <header className="sticky top-0 z-40 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/90 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)} data-testid="button-back" aria-label="Back">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="p-2 rounded-lg bg-[var(--accent-violet)]/20">
              <Brain className="w-5 h-5 text-[var(--accent-violet-light)]" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-wide font-signature">Brain Chat</h1>
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                {mode === 'chew' ? 'Data Chewer · review before commit' : 'Read-only · not saved'}
              </div>
            </div>
          </div>
          <div className="text-xs text-[var(--text-muted)]">{authUser?.username}</div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6 grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)_320px] gap-4">
        {/* ── LEFT: context controls ───────────────────────────────── */}
        <aside className="space-y-3" data-testid="panel-controls">
          <Card className="p-4 bg-[var(--bg-surface)] border-[var(--border-subtle)]">
            <div className="text-xs uppercase tracking-wider text-[var(--text-muted)] mb-3">Context controls</div>
            <div className="space-y-3">
              <div>
                <Label className="mb-1 block text-xs">Scope</Label>
                <Select value={scope} onValueChange={setScope}>
                  <SelectTrigger data-testid="select-scope"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SCOPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1 block text-xs">Knowledge web</Label>
                <Select value={webId} onValueChange={setWebId}>
                  <SelectTrigger data-testid="select-web"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__any__">— any —</SelectItem>
                    {webs.map(w => (
                      <SelectItem key={w.id} value={String(w.id)}>{w.title || `web #${w.id}`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeNeighbors}
                  onChange={(e) => setIncludeNeighbors(e.target.checked)}
                  data-testid="checkbox-neighbors"
                />
                Include neighbor cards
              </label>
            </div>
          </Card>

          <Card className="p-3 bg-[var(--bg-surface)] border-[var(--border-subtle)] space-y-1.5">
            <Button
              variant="ghost"
              className="w-full justify-start text-xs"
              onClick={clearThread}
              disabled={messages.length === 0}
              data-testid="button-clear"
            >
              <Eraser className="w-3.5 h-3.5 mr-2" /> Clear thread
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start text-xs"
              onClick={() => navigate('/BrainSearch')}
              data-testid="button-open-search"
            >
              <SearchIcon className="w-3.5 h-3.5 mr-2" /> Open Brain Search
            </Button>
            <Button
              variant="ghost"
              className="w-full justify-start text-xs"
              onClick={() => navigate('/BrainInbox')}
              data-testid="button-open-inbox"
            >
              <FileText className="w-3.5 h-3.5 mr-2" /> Open Inbox (legacy)
            </Button>
          </Card>

          <Card className="p-3 bg-[var(--bg-surface)] border-[var(--border-subtle)] text-[11px] text-[var(--text-muted)] leading-relaxed">
            {mode === 'chew'
              ? 'Data Chewer mode. Paste raw material to get proposed cards & connections you can review, accept/reject, and commit into the selected Knowledge Web.'
              : 'Read-only assistant. It can read your saved sources, cards, and connections — but cannot create, edit, or delete anything in this mode.'}
          </Card>
        </aside>

        {/* ── CENTER: conversation + composer ──────────────────────── */}
        <section className="flex flex-col min-h-[60vh]" data-testid="panel-thread">
          <Card className="flex-1 flex flex-col bg-[var(--bg-surface)] border-[var(--border-subtle)] overflow-hidden">
            <div ref={threadRef} className="flex-1 overflow-y-auto p-5 space-y-4" data-testid="list-messages">
              {messages.length === 0 && (
                <EmptyState />
              )}
              {messages.map((m, i) => {
                if (m.kind !== 'chew') return <MessageBubble key={i} m={m} idx={i} />;
                const tgtWebId = m.sourceMeta?.web_id ?? (webId !== '__any__' ? Number(webId) : null);
                const tgtWeb = tgtWebId ? webs.find(w => Number(w.id) === Number(tgtWebId)) : null;
                return (
                  <ChewProposal
                    key={i}
                    m={m}
                    idx={i}
                    targetWebId={tgtWebId}
                    targetWebName={tgtWeb?.title || (tgtWebId ? `web #${tgtWebId}` : null)}
                    onCommit={(payload) => commitChew(m.sourceMeta, payload)}
                  />
                );
              })}
              {sending && (
                <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]" data-testid="indicator-thinking">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {mode === 'chew' ? 'Chewing your raw material…' : 'Searching your second brain…'}
                </div>
              )}
            </div>
            <div className="border-t border-[var(--border-subtle)] p-3 bg-[var(--bg-surface)] space-y-2">
              {/* Smart-mode toggle — a single lightweight button that turns the
                  same Ask box into "chew this raw info" mode. The help lives on
                  the button itself (tooltip) so it only appears when relevant. */}
              <div className="flex items-center gap-2">
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="sm"
                        variant={mode === 'chew' ? 'default' : 'ghost'}
                        onClick={() => setMode(mode === 'chew' ? 'ask' : 'chew')}
                        aria-pressed={mode === 'chew'}
                        className={`h-7 px-2.5 text-xs gap-1.5 ${
                          mode === 'chew'
                            ? 'bg-[var(--accent-violet)] hover:bg-[var(--accent-violet-hover)] text-white'
                            : 'text-[var(--text-muted)]'
                        }`}
                        data-testid="toggle-mode-chew"
                      >
                        <Utensils className="w-3.5 h-3.5" /> Data Chewer
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" align="start" className="max-w-xs text-xs leading-relaxed" data-testid="tooltip-chew-help">
                      Turn this chat box into chew mode. Paste any messy raw material —
                      notes, journal entries, transcripts, articles — and your Second Brain
                      figures out what it is and proposes cards, connections, and tags.
                      It'll ask a follow-up if it needs more context. The raw text is kept
                      as a source, but nothing is added to your Knowledge Web until you
                      approve it.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                {mode === 'chew' && (
                  <span className="text-[10px] uppercase tracking-wider text-[var(--accent-violet-light)]" data-testid="text-chew-on">
                    chew mode on
                  </span>
                )}
              </div>

              <div className="flex gap-2 items-end">
                <Textarea
                  value={pending}
                  onChange={(e) => setPending(e.target.value)}
                  onKeyDown={onComposerKey}
                  placeholder={mode === 'chew'
                    ? 'Paste or type raw material to chew… (Enter to chew, Shift+Enter for newline)'
                    : 'Ask your second brain… (Enter to send, Shift+Enter for newline)'}
                  rows={2}
                  className="resize-none flex-1"
                  disabled={sending}
                  data-testid="input-message"
                />
                <Button
                  onClick={mode === 'chew' ? chew : send}
                  disabled={sending || !pending.trim()}
                  className="bg-[var(--accent-violet)] hover:bg-[var(--accent-violet-hover)] h-auto py-3"
                  data-testid="button-send"
                >
                  {sending
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : (mode === 'chew' ? <Utensils className="w-4 h-4" /> : <Send className="w-4 h-4" />)}
                </Button>
              </div>
            </div>
          </Card>
        </section>

        {/* ── RIGHT: context used for last answer ──────────────────── */}
        <aside className="space-y-3" data-testid="panel-context-used">
          <Card className="p-4 bg-[var(--bg-surface)] border-[var(--border-subtle)]">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-[var(--accent-violet-light)]" />
              <div className="text-xs uppercase tracking-wider text-[var(--text-muted)]">Context used (last answer)</div>
            </div>
            {!lastContextUsed && (
              <div className="text-xs text-[var(--text-muted)]" data-testid="text-no-context">
                Ask a question to see which sources, cards, and connections the AI looked at.
              </div>
            )}
            {lastContextUsed && (
              <ContextUsed pack={lastContextUsed} />
            )}
          </Card>

          <Card className="p-4 bg-[var(--bg-surface)] border-[var(--border-subtle)]">
            <SourceHistory
              sources={sources}
              busyId={historyBusyId}
              onReopen={reopenSource}
              onRetry={retrySource}
            />
          </Card>
        </aside>
      </main>
    </div>
  );
}

function EmptyState() {
  const suggestions = [
    'What sources do I have on Romans 5?',
    'Summarize what my brain knows about justification.',
    'Which of my cards mention Augustine?',
  ];
  return (
    <div className="text-center py-12" data-testid="state-empty">
      <Brain className="w-10 h-10 mx-auto text-[var(--accent-violet-light)] opacity-60" />
      <h2 className="mt-4 text-lg font-semibold font-signature">Ask your second brain</h2>
      <div className="mt-6 flex flex-col items-center gap-2">
        {suggestions.map(s => (
          <div key={s} className="text-xs text-[var(--text-muted)] italic">"{s}"</div>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ m, idx }) {
  const isUser = m.role === 'user';
  const isChewInput = m.kind === 'chew-input';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`} data-testid={`message-${m.role}-${idx}`}>
      <div className={`max-w-[85%] rounded-lg px-4 py-3 ${
        isUser
          ? 'bg-[var(--accent-violet)]/15 border border-[var(--accent-violet)]/30'
          : 'bg-[var(--bg-primary)] border border-[var(--border-subtle)]'
      }`}>
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1 flex items-center gap-1.5">
          {isChewInput
            ? <><Utensils className="w-3 h-3" /> Raw material</>
            : (isUser ? 'You' : 'Brain')}
        </div>
        {isUser || m.isError ? (
          <div className="text-sm whitespace-pre-wrap break-words leading-relaxed">{m.content}</div>
        ) : (
          <div className="text-sm break-words leading-relaxed">
            <MarkdownRenderer content={m.content} forceMarkdown />
          </div>
        )}
        {!isUser && Array.isArray(m.citations) && m.citations.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5" data-testid={`citations-${idx}`}>
            {m.citations.map((c, i) => {
              const Icon = CITE_ICON[c.type] || FileText;
              return (
                <span
                  key={`${c.type}-${c.id}-${i}`}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-[var(--bg-elevated)] border border-[var(--border-subtle)]"
                  title={`${c.type} #${c.id}: ${c.title}`}
                >
                  <Icon className="w-3 h-3" />
                  {c.type} #{c.id} · {c.title || '(no title)'}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ContextUsed({ pack }) {
  const Section = ({ title, items, icon: Icon, testid }) => {
    if (!items || items.length === 0) return null;
    return (
      <div className="mb-3" data-testid={testid}>
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1.5 flex items-center gap-1">
          <Icon className="w-3 h-3" /> {title} ({items.length})
        </div>
        <div className="space-y-1">
          {items.map(it => (
            <div key={`${title}-${it.id}`} className="text-xs px-2 py-1.5 rounded-md bg-[var(--bg-primary)] border border-[var(--border-subtle)]">
              <div className="font-medium truncate">{it.title || '(untitled)'}</div>
              <div className="text-[10px] text-[var(--text-muted)]">#{it.id}{it.source_type ? ` · ${it.source_type}` : ''}{it.relationship_type ? ` · ${it.relationship_type}` : ''}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };
  const empty = (!pack.sources_used?.length && !pack.cards_used?.length && !pack.connections_used?.length);
  if (empty) {
    return <div className="text-xs text-[var(--text-muted)]" data-testid="text-context-empty">No matching second-brain context was found for that question.</div>;
  }
  return (
    <div>
      <Section title="Sources" items={pack.sources_used} icon={FileText} testid="section-sources-used" />
      <Section title="Cards" items={pack.cards_used} icon={Layers} testid="section-cards-used" />
      <Section title="Connections" items={pack.connections_used} icon={GitBranch} testid="section-connections-used" />
    </div>
  );
}
