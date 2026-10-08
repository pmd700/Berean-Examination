import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIsActiveTab } from '@/lib/WorkspaceTabs';
import { useAuth } from '@/lib/AuthContext';
import { platformEntities } from '@/lib/platform/entities';
import {
  searchLocalBrainRecords, toPlainSearchText,
} from '@/lib/localBrainSearch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Search, ArrowLeft, FileText, Layers, GitBranch, Loader2, Brain, StickyNote } from 'lucide-react';
import { toast } from 'sonner';
import { LoadingScreen } from '../components/ui/loading-screen';

// Read-only local search. It never creates AI requests or changes saved records.
// The index exists in memory only while this unlocked screen is open.
const SCOPE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'sources', label: 'Sources' },
  { value: 'cards', label: 'Cards' },
  { value: 'connections', label: 'Connections' },
  { value: 'notes', label: 'Notes' },
];

const RESULT_ICON = {
  source: FileText,
  card: Layers,
  connection: GitBranch,
  note: StickyNote,
};

const RESULT_LABEL = {
  source: 'Source',
  card: 'Card',
  connection: 'Connection',
  note: 'Note',
};

function sameRecordId(left, right) {
  return left !== null && left !== undefined
    && right !== null && right !== undefined
    && String(left) === String(right);
}

export default function BrainSearch() {
  const navigate = useNavigate();
  // Background tabs stay mounted; only the visible one may redirect.
  const isActiveTab = useIsActiveTab();
  const { isAuthenticated, isLoadingAuth, user: authUser } = useAuth();

  const [bootLoading, setBootLoading] = useState(true);
  const [webs, setWebs] = useState([]);
  const [searchIndex, setSearchIndex] = useState({
    cards: [],
    connections: [],
    links: [],
    notes: [],
    sources: [],
  });

  const [q, setQ] = useState('');
  const [scope, setScope] = useState('all');
  const [webId, setWebId] = useState('__any__');

  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [hasSearched, setHasSearched] = useState(false);

  const [openContext, setOpenContext] = useState(null);
  const [contextLoading, setContextLoading] = useState(false);

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated) { if (isActiveTab) navigate('/'); return; }
    bootstrap();
  }, [isLoadingAuth, isAuthenticated]);

  const bootstrap = async () => {
    try {
      const [nextWebs, sources, cards, connections, notes, links] = await Promise.all([
        platformEntities.KnowledgeWeb.list('-updated_date', 5000),
        platformEntities.BrainSource.list('-updated_date', 5000),
        platformEntities.WebCard.list('-updated_date', 5000),
        platformEntities.WebConnection.list('-updated_date', 5000),
        platformEntities.MindNote.list('-updated_date', 5000),
        platformEntities.MindLink.list('-updated_date', 5000),
      ]);
      setWebs(Array.isArray(nextWebs) ? nextWebs : []);
      setSearchIndex({
        cards: Array.isArray(cards) ? cards : [],
        connections: Array.isArray(connections) ? connections : [],
        links: Array.isArray(links) ? links : [],
        notes: Array.isArray(notes) ? notes : [],
        sources: Array.isArray(sources) ? sources : [],
      });
    } catch (e) {
      console.error('[BrainSearch] local index failed', e);
      toast.error('BEX could not prepare private search');
    } finally {
      setBootLoading(false);
    }
  };

  const runSearch = useCallback(() => {
    const query = q.trim();
    if (!query) { toast.error('Enter a search query'); return; }
    setSearching(true);
    setHasSearched(true);
    try {
      setResults(searchLocalBrainRecords(searchIndex, {
        query,
        scope,
        webId,
      }));
    } catch (e) {
      toast.error(`Search failed: ${e.message}`);
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [q, scope, searchIndex, webId]);

  const openResult = async (result) => {
    if (result.result_type === 'connection') {
      const targetId = result.metadata?.from_card_id;
      if (targetId) await openCardContext(targetId, { focusConnectionId: result.id });
      else await openConnectionContext(result.id);
      return;
    }
    if (result.result_type === 'card') await openCardContext(result.id);
    if (result.result_type === 'source') await openSourceContext(result.id);
    if (result.result_type === 'note') await openNoteContext(result.id);
  };

  const openCardContext = async (cardId, extras = {}) => {
    setContextLoading(true);
    setOpenContext({ type: 'card', id: cardId, data: null, ...extras });
    await Promise.resolve();
    const card = searchIndex.cards.find((item) => sameRecordId(item.id, cardId));
    if (!card) {
      toast.error('That card is no longer available');
      setOpenContext(null);
      setContextLoading(false);
      return;
    }
    const connections = searchIndex.connections.filter((connection) => (
      sameRecordId(connection.from_card_id, cardId)
      || sameRecordId(connection.to_card_id, cardId)
    ));
    const neighborIds = new Set();
    for (const connection of connections) {
      if (!sameRecordId(connection.from_card_id, cardId)) neighborIds.add(String(connection.from_card_id));
      if (!sameRecordId(connection.to_card_id, cardId)) neighborIds.add(String(connection.to_card_id));
    }
    const neighbors = searchIndex.cards.filter((item) => neighborIds.has(String(item.id)));
    const sourceIds = new Set((card.source_ids || []).map(String));
    const linkedSources = searchIndex.sources.filter((source) => sourceIds.has(String(source.id)));
    setOpenContext({
      type: 'card',
      id: cardId,
      data: { card, connections, linked_sources: linkedSources, neighbors },
      ...extras,
    });
    setContextLoading(false);
  };

  const openSourceContext = async (sourceId) => {
    setContextLoading(true);
    setOpenContext({ type: 'source', id: sourceId, data: null });
    await Promise.resolve();
    const source = searchIndex.sources.find((item) => sameRecordId(item.id, sourceId));
    if (!source) {
      toast.error('That source is no longer available');
      setOpenContext(null);
      setContextLoading(false);
      return;
    }
    const { raw_text: rawText, ...safeSource } = source;
    const linkedCards = searchIndex.cards.filter((card) => (
      Array.isArray(card.source_ids) && card.source_ids.some((id) => sameRecordId(id, sourceId))
    ));
    setOpenContext({
      type: 'source',
      id: sourceId,
      data: {
        ai_processing: source.metadata_json?.ai_processing_v1 || null,
        linked_cards: linkedCards,
        source: { ...safeSource, raw_text_chars: rawText?.length || 0 },
      },
    });
    setContextLoading(false);
  };

  const openNoteContext = async (noteId) => {
    setContextLoading(true);
    setOpenContext({ type: 'note', id: noteId, data: null });
    await Promise.resolve();
    const note = searchIndex.notes.find((item) => sameRecordId(item.id, noteId));
    if (!note) {
      toast.error('That note is no longer available');
      setOpenContext(null);
      setContextLoading(false);
      return;
    }
    const linkedWebIds = new Set();
    for (const link of searchIndex.links) {
      if (link.from_type === 'note' && sameRecordId(link.from_id, noteId) && link.to_type === 'web') {
        linkedWebIds.add(String(link.to_id));
      }
      if (link.to_type === 'note' && sameRecordId(link.to_id, noteId) && link.from_type === 'web') {
        linkedWebIds.add(String(link.from_id));
      }
    }
    setOpenContext({
      type: 'note',
      id: noteId,
      data: {
        linked_webs: webs.filter((web) => linkedWebIds.has(String(web.id))),
        note,
      },
    });
    setContextLoading(false);
  };

  const openConnectionContext = async (connectionId) => {
    const connection = searchIndex.connections.find((item) => sameRecordId(item.id, connectionId));
    if (!connection) {
      toast.error('That connection is no longer available');
      return;
    }
    setOpenContext({ type: 'connection', id: connectionId, data: { connection } });
  };

  if (bootLoading) return <LoadingScreen message="Preparing private search..." />;

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <header className="sticky top-0 z-40 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/90 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)} data-testid="button-back" aria-label="Back">
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="p-2 rounded-lg bg-[var(--accent-violet)]/20">
              <Search className="w-5 h-5 text-[var(--accent-violet-light)]" />
            </div>
            <h1 className="text-lg font-bold tracking-wide font-signature">Brain Search</h1>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled
              className="text-xs"
              data-testid="button-online-mode-off"
              title="Brain Chat will be available only through the future optional Online Mode."
            >
              <Brain className="w-3.5 h-3.5 mr-1.5" />
              Online Mode off
            </Button>
            <div className="text-xs text-[var(--text-muted)]">{authUser?.username}</div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <Card className="p-5 bg-[var(--bg-surface)] border-[var(--border-subtle)]" data-testid="card-search-form">
          <div className="space-y-4">
            <div>
              <Label className="mb-2 block">Query *</Label>
              <div className="flex gap-2">
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
                  placeholder="Search sources, cards, connections, and notes…"
                  data-testid="input-query"
                />
                <Button
                  onClick={runSearch}
                  disabled={searching}
                  className="bg-[var(--accent-violet)] hover:bg-[var(--accent-violet-hover)]"
                  data-testid="button-search"
                >
                  {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  <span className="ml-2">Search</span>
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="mb-2 block">Scope</Label>
                <Select value={scope} onValueChange={setScope}>
                  <SelectTrigger data-testid="select-scope"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SCOPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-2 block">Knowledge web (optional)</Label>
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
            </div>
          </div>
        </Card>

        <div className="mt-6">
          {!hasSearched && (
            <p className="text-sm text-[var(--text-muted)]" data-testid="text-prompt">
              Search stays on this Mac. Results show only short previews from your unlocked library.
            </p>
          )}

          {hasSearched && !searching && results.length === 0 && (
            <p className="text-sm text-[var(--text-muted)]" data-testid="text-no-results">No results.</p>
          )}

          {results.length > 0 && (
            <div className="space-y-2" data-testid="list-results">
              <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-2">
                {results.length} result{results.length === 1 ? '' : 's'}
              </div>
              {results.map((r, i) => {
                const Icon = RESULT_ICON[r.result_type] || FileText;
                return (
                  <Card
                    key={`${r.result_type}-${r.id}-${i}`}
                    className="p-4 bg-[var(--bg-surface)] border-[var(--border-subtle)] hover:border-[var(--accent-violet)]/60 transition-colors cursor-pointer"
                    onClick={() => openResult(r)}
                    data-testid={`result-${r.result_type}-${r.id}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-md bg-[var(--bg-elevated)] border border-[var(--border-subtle)] flex-shrink-0">
                        <Icon className="w-4 h-4 text-[var(--accent-violet-light)]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs uppercase tracking-wider text-[var(--text-muted)]">{RESULT_LABEL[r.result_type] || 'Result'}</span>
                          <h3 className="text-base font-semibold truncate">{r.title || '(untitled)'}</h3>
                          {r.metadata?.status && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">
                              {r.metadata.status}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-[var(--text-secondary)] mt-1 line-clamp-3 break-words">{r.snippet || '(no preview)'}</p>
                        <div className="text-xs text-[var(--text-muted)] mt-2">{r.match_reason}</div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {openContext && (
          <ContextPanel
            ctx={openContext}
            loading={contextLoading}
            onClose={() => setOpenContext(null)}
            onOpenCard={openCardContext}
            onOpenSource={openSourceContext}
          />
        )}
      </main>
    </div>
  );
}

// Read-only local details. Search never edits the records it opens.
// Linked cards and sources remain navigable without a server request.
function ContextPanel({ ctx, loading, onClose, onOpenCard, onOpenSource }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60" onClick={onClose} data-testid="overlay-context">
      <div
        className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-t-xl md:rounded-xl max-w-3xl w-full max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] px-5 py-3 flex items-center justify-between">
          <div className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            {RESULT_LABEL[ctx.type] || 'Result'} details
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="button-close-context">Close</Button>
        </div>
        <div className="p-5">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
          )}
          {!loading && ctx.type === 'source' && ctx.data && <SourceContext data={ctx.data} onOpenCard={onOpenCard} />}
          {!loading && ctx.type === 'card' && ctx.data && <CardContext data={ctx.data} onOpenCard={onOpenCard} onOpenSource={onOpenSource} />}
          {!loading && ctx.type === 'note' && ctx.data && <NoteContext data={ctx.data} />}
          {!loading && ctx.type === 'connection' && ctx.data && <ConnectionContext data={ctx.data} />}
        </div>
      </div>
    </div>
  );
}

function SourceContext({ data, onOpenCard }) {
  const s = data?.source || {};
  const ai = data?.ai_processing || null;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold break-words" data-testid="text-context-source-title">{s.title}</h2>
        <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-[var(--text-muted)]">
          <span className="px-2 py-0.5 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">{s.source_type}</span>
          <span className="px-2 py-0.5 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">Local</span>
          {typeof s.raw_text_chars === 'number' && <span>{s.raw_text_chars.toLocaleString()} characters · full text stays in the Inbox</span>}
        </div>
        {s.source_url && <a href={s.source_url} target="_blank" rel="noreferrer" className="text-xs text-[var(--accent-violet-light)] hover:underline break-all mt-2 inline-block">{s.source_url}</a>}
      </div>

      {ai && (
        <div className="space-y-3" data-testid="section-context-ai">
          {ai.summary && (
            <div>
              <div className="text-xs uppercase tracking-wider text-[var(--text-muted)] mb-1">Saved analysis</div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{ai.summary}</p>
            </div>
          )}
          {Array.isArray(ai.key_points) && ai.key_points.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wider text-[var(--text-muted)] mb-1">Key points</div>
              <ul className="list-disc pl-5 text-sm space-y-0.5">
                {ai.key_points.map((p, i) => <li key={i} className="break-words">{typeof p === 'string' ? p : JSON.stringify(p)}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {Array.isArray(data.linked_cards) && data.linked_cards.length > 0 && (
        <div data-testid="section-linked-cards">
          <div className="text-xs uppercase tracking-wider text-[var(--text-muted)] mb-2">Cards that cite this source</div>
          <div className="space-y-1">
            {data.linked_cards.map(c => (
              <button
                key={c.id}
                className="block w-full text-left p-2 rounded-md bg-[var(--bg-primary)] border border-[var(--border-subtle)] hover:border-[var(--accent-violet)]/60"
                onClick={() => onOpenCard(c.id)}
                data-testid={`button-linked-card-${c.id}`}
              >
                <div className="text-sm font-semibold">{c.title}</div>
                <div className="text-xs text-[var(--text-muted)]">{c.status}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CardContext({ data, onOpenCard, onOpenSource }) {
  const c = data?.card || {};
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold break-words" data-testid="text-context-card-title">{c.title}</h2>
        <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-[var(--text-muted)]">
          {c.status && <span className="px-2 py-0.5 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">{c.status}</span>}
          {c.created_by && <span>by {c.created_by}</span>}
        </div>
        {c.description && <p className="text-sm leading-relaxed whitespace-pre-wrap mt-3">{c.description}</p>}
        {c.tags && <div className="text-xs text-[var(--text-muted)] mt-2">tags: {c.tags}</div>}
      </div>

      {Array.isArray(data.connections) && data.connections.length > 0 && (
        <div data-testid="section-connections">
          <div className="text-xs uppercase tracking-wider text-[var(--text-muted)] mb-2">
            Connections ({data.connections.length})
          </div>
          <div className="space-y-1">
            {data.connections.map(conn => (
              <div key={conn.id} className="p-2 rounded-md bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[var(--text-muted)]">#{conn.from_card_id}</span>
                  <span className="text-[var(--text-muted)]">— {conn.relationship_type || 'related_to'} →</span>
                  <span className="text-[var(--text-muted)]">#{conn.to_card_id}</span>
                </div>
                {conn.label && <div className="text-xs mt-1">{conn.label}</div>}
                {conn.evidence && <div className="text-xs italic text-[var(--text-muted)] mt-1">{conn.evidence}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {Array.isArray(data.neighbors) && data.neighbors.length > 0 && (
        <div data-testid="section-neighbors">
          <div className="text-xs uppercase tracking-wider text-[var(--text-muted)] mb-2">Neighbor cards</div>
          <div className="space-y-1">
            {data.neighbors.map(n => (
              <button
                key={n.id}
                className="block w-full text-left p-2 rounded-md bg-[var(--bg-primary)] border border-[var(--border-subtle)] hover:border-[var(--accent-violet)]/60"
                onClick={() => onOpenCard(n.id)}
                data-testid={`button-neighbor-${n.id}`}
              >
                <div className="text-sm font-semibold">{n.title}</div>
                <div className="text-xs text-[var(--text-muted)]">{n.status}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {Array.isArray(data.linked_sources) && data.linked_sources.length > 0 && (
        <div data-testid="section-linked-sources">
          <div className="text-xs uppercase tracking-wider text-[var(--text-muted)] mb-2">Linked sources</div>
          <div className="space-y-1">
            {data.linked_sources.map(s => (
              <button
                key={s.id}
                className="block w-full text-left p-2 rounded-md bg-[var(--bg-primary)] border border-[var(--border-subtle)] hover:border-[var(--accent-violet)]/60"
                onClick={() => onOpenSource(s.id)}
                data-testid={`button-linked-source-${s.id}`}
              >
                <div className="text-sm font-semibold">{s.title}</div>
                <div className="text-xs text-[var(--text-muted)]">{s.source_type} · Local</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NoteContext({ data }) {
  const note = data?.note || {};
  const content = toPlainSearchText(note.content);
  const tags = Array.isArray(note.tags) ? note.tags.join(', ') : toPlainSearchText(note.tags);
  return (
    <div className="space-y-4" data-testid="panel-note-details">
      <div>
        <h2 className="text-xl font-bold break-words">{note.title || 'Untitled note'}</h2>
        {tags && <div className="text-xs text-[var(--text-muted)] mt-1">{tags}</div>}
      </div>
      {content && (
        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{content}</p>
      )}
      {Array.isArray(data.linked_webs) && data.linked_webs.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wider text-[var(--text-muted)] mb-2">Linked Knowledge Webs</div>
          <div className="flex flex-wrap gap-2">
            {data.linked_webs.map((web) => (
              <span key={web.id} className="px-2 py-1 rounded-md bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-sm">
                {web.title || `Web #${web.id}`}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ConnectionContext({ data }) {
  const connection = data?.connection || {};
  return (
    <div className="space-y-3" data-testid="panel-connection-details">
      <h2 className="text-xl font-bold break-words">
        {connection.label || connection.relationship_type || 'Connection'}
      </h2>
      <div className="text-sm text-[var(--text-secondary)]">
        Card {connection.from_card_id} → Card {connection.to_card_id}
      </div>
      {connection.evidence && (
        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{connection.evidence}</p>
      )}
    </div>
  );
}
