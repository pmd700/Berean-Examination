import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIsActiveTab } from '@/lib/WorkspaceTabs';
import { useAuth } from '@/lib/AuthContext';
import { platformEntities } from '@/lib/platform/entities';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Inbox, ArrowLeft, Plus, FileText, Calendar, Sparkles, AlertTriangle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { LoadingScreen } from '../components/ui/loading-screen';

// Curated source types — kept in sync with the desktop source validator.
const SOURCE_TYPES = [
  { value: 'article', label: 'Article' },
  { value: 'youtube', label: 'YouTube transcript' },
  { value: 'tweet', label: 'Tweet' },
  { value: 'podcast', label: 'Podcast notes' },
  { value: 'book', label: 'Book notes' },
  { value: 'note', label: 'Generic note' },
  { value: 'journal', label: 'Journal' },
  { value: 'crm', label: 'CRM / person notes' },
  { value: 'meeting', label: 'Meeting notes' },
  { value: 'scripture', label: 'Scripture / theology' },
  { value: 'other', label: 'Other' },
];

// Renders metadata_json.ai_processing_v1 — the structured AI analysis the
// server saved on the source. Every section degrades gracefully when the
// model returned an empty list. card/connection drafts are PREVIEWS only:
// per Step 3 scope they are NOT yet writeable to web_cards / web_connections.
function AIProcessingPanel({ source }) {
  const ai = source?.metadata_json?.ai_processing_v1 || null;
  const aiErr = source?.metadata_json?.ai_processing_error || null;

  if (!ai && !aiErr) {
    return (
      <div className="p-4 rounded-md border border-dashed border-[var(--border-subtle)] text-sm text-[var(--text-muted)]" data-testid="text-ai-empty">
        Online Mode is off. The AI Spine is dormant; this source remains fully available for local reading and organization.
      </div>
    );
  }

  if (aiErr && !ai) {
    return (
      <div className="p-4 rounded-md border border-red-900/60 bg-red-950/20 text-sm text-red-200" data-testid="text-ai-prior-error">
        <div className="font-semibold mb-1">Previous AI run failed</div>
        <div className="text-xs opacity-90 break-words">{aiErr.message}</div>
        {aiErr.failed_at && <div className="text-[10px] mt-2 opacity-60">at {new Date(aiErr.failed_at).toLocaleString()}</div>}
      </div>
    );
  }

  const Section = ({ title, items, testid, render }) => {
    if (!items || (Array.isArray(items) && items.length === 0)) return null;
    return (
      <div data-testid={testid}>
        <h4 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">{title}</h4>
        {render ? render(items) : (
          <ul className="list-disc pl-5 space-y-1 text-sm text-[var(--text-secondary)]">
            {items.map((it, i) => (
              <li key={i} className="break-words">{typeof it === 'string' ? it : JSON.stringify(it)}</li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  const renderEntities = (group) => {
    const groups = Object.entries(group).filter(([, v]) => Array.isArray(v) && v.length > 0);
    if (groups.length === 0) return null;
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {groups.map(([key, arr]) => (
          <div key={key} className="p-3 rounded-md bg-[var(--bg-primary)] border border-[var(--border-subtle)]">
            <div className="text-xs uppercase tracking-wider text-[var(--text-muted)] mb-1">{key}</div>
            <ul className="text-sm text-[var(--text-secondary)] space-y-0.5">
              {arr.map((it, i) => (
                <li key={i} className="break-words">{typeof it === 'string' ? it : JSON.stringify(it)}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    );
  };

  const theologyHasContent = ai.theology && Object.values(ai.theology).some(v => Array.isArray(v) && v.length > 0);
  const entitiesHaveContent = ai.entities && Object.values(ai.entities).some(v => Array.isArray(v) && v.length > 0);

  return (
    <div className="space-y-6" data-testid="panel-ai-processing">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[var(--accent-violet-light)]" />
          <h3 className="text-lg font-bold">AI analysis</h3>
          {ai.confidence && (
            <span className="px-2 py-0.5 rounded-full text-xs bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-muted)]" data-testid="text-ai-confidence">
              confidence: {ai.confidence}
            </span>
          )}
        </div>
        {ai._meta && (
          <div className="text-xs text-[var(--text-muted)]" data-testid="text-ai-meta">
            {ai._meta.model}{ai._meta.processed_at ? ` · ${new Date(ai._meta.processed_at).toLocaleString()}` : ''}
          </div>
        )}
      </div>

      {ai.summary && (
        <div data-testid="text-ai-summary">
          <h4 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">Summary</h4>
          <p className="text-sm text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap">{ai.summary}</p>
        </div>
      )}

      <Section title="Key points" items={ai.key_points} testid="section-key-points" />
      <Section title="Source claims (what the source asserts — not necessarily your beliefs)" items={ai.source_claims} testid="section-source-claims" />

      {entitiesHaveContent && (
        <div data-testid="section-entities">
          <h4 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">Entities</h4>
          {renderEntities(ai.entities)}
        </div>
      )}

      {theologyHasContent && (
        <div data-testid="section-theology">
          <h4 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">Scripture / theology</h4>
          {renderEntities(ai.theology)}
        </div>
      )}

      <Section title="Concepts" items={ai.concepts} testid="section-concepts" />
      <Section title="Questions raised" items={ai.questions_raised} testid="section-questions" />

      {Array.isArray(ai.possible_card_drafts) && ai.possible_card_drafts.length > 0 && (
        <div data-testid="section-card-drafts">
          <div className="flex items-baseline gap-2 mb-2">
            <h4 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">Possible card drafts</h4>
            <span className="text-[10px] uppercase tracking-wider text-[var(--accent-violet-light)]">previews only — not yet saved as cards</span>
          </div>
          <div className="space-y-2">
            {ai.possible_card_drafts.map((c, i) => (
              <div key={i} className="p-3 rounded-md bg-[var(--bg-primary)] border border-[var(--border-subtle)]" data-testid={`card-draft-${i}`}>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-semibold text-sm">{c.title || '(untitled)'}</span>
                </div>
                {c.description && <p className="text-sm text-[var(--text-secondary)] mt-1 whitespace-pre-wrap">{c.description}</p>}
                {Array.isArray(c.tags) && c.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {c.tags.map((t, j) => (
                      <span key={j} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-muted)]">{t}</span>
                    ))}
                  </div>
                )}
                {c.reason_this_card_matters && (
                  <p className="text-xs text-[var(--text-muted)] italic mt-2">Why: {c.reason_this_card_matters}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {Array.isArray(ai.possible_connection_drafts) && ai.possible_connection_drafts.length > 0 && (
        <div data-testid="section-connection-drafts">
          <div className="flex items-baseline gap-2 mb-2">
            <h4 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">Possible connection drafts</h4>
            <span className="text-[10px] uppercase tracking-wider text-[var(--accent-violet-light)]">previews only — not yet saved as connections</span>
          </div>
          <div className="space-y-2">
            {ai.possible_connection_drafts.map((c, i) => (
              <div key={i} className="p-3 rounded-md bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-sm" data-testid={`connection-draft-${i}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">{c.from_title || '?'}</span>
                  <span className="text-[var(--text-muted)]">— {c.relationship_type || 'related to'} →</span>
                  <span className="font-semibold">{c.to_title || '?'}</span>
                </div>
                {c.label && <div className="text-xs text-[var(--text-muted)] mt-1">{c.label}</div>}
                {c.reason_this_connection_matters && (
                  <p className="text-xs text-[var(--text-muted)] italic mt-1">Why: {c.reason_this_connection_matters}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <Section title="Warnings" items={ai.warnings} testid="section-warnings" render={(items) => (
        <ul className="space-y-1 text-sm text-amber-300">
          {items.map((it, i) => (
            <li key={i} className="flex gap-2 items-start"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /><span className="break-words">{typeof it === 'string' ? it : JSON.stringify(it)}</span></li>
          ))}
        </ul>
      )} />
    </div>
  );
}

export default function BrainInbox() {
  const navigate = useNavigate();
  // Background tabs stay mounted; only the visible one may redirect.
  const isActiveTab = useIsActiveTab();
  const { isAuthenticated, isLoadingAuth, user: authUser } = useAuth();

  const [loading, setLoading] = useState(true);
  const [sources, setSources] = useState([]);
  const [webs, setWebs] = useState([]);

  // 'list' | 'new' | 'view' | 'edit'
  const [mode, setMode] = useState('list');
  const [selected, setSelected] = useState(null);

  // Form state — used for both 'new' (all fields editable) and 'edit'
  // (raw_text is shown read-only). web_id null encodes "unassigned".
  const [fTitle, setFTitle] = useState('');
  const [fType, setFType] = useState('note');
  const [fUrl, setFUrl] = useState('');
  const [fWebId, setFWebId] = useState('__none__');
  const [fRawText, setFRawText] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated) { if (isActiveTab) navigate('/'); return; }
    bootstrap();
  }, [isLoadingAuth, isAuthenticated]);

  const bootstrap = async () => {
    try {
      const [src, w] = await Promise.all([
        platformEntities.BrainSource.list('-updated_date', 5000),
        platformEntities.KnowledgeWeb.list().catch(() => []),
      ]);
      setSources(Array.isArray(src) ? src : []);
      setWebs(Array.isArray(w) ? w : []);
    } catch (e) {
      console.error('[BrainInbox] load failed', e);
      toast.error('Could not load raw sources');
    }
    setLoading(false);
  };

  const reloadSources = async () => {
    try {
      const src = await platformEntities.BrainSource.list('-updated_date', 5000);
      setSources(Array.isArray(src) ? src : []);
    } catch (e) {
      console.error('[BrainInbox] reload failed', e);
    }
  };

  const resetForm = () => {
    setFTitle('');
    setFType('note');
    setFUrl('');
    setFWebId('__none__');
    setFRawText('');
  };

  const beginNew = () => {
    resetForm();
    setSelected(null);
    setMode('new');
  };

  const beginView = (s) => {
    setSelected(s);
    setConfirmDelete(false);
    setMode('view');
  };

  const beginEdit = (s) => {
    setFTitle(s.title || '');
    setFType(s.source_type || 'note');
    setFUrl(s.source_url || '');
    setFWebId(s.web_id != null ? String(s.web_id) : '__none__');
    setFRawText(s.raw_text || ''); // shown read-only — raw_text is immutable
    setSelected(s);
    setMode('edit');
  };

  const handleCreate = async () => {
    if (!fTitle.trim()) { toast.error('Title is required'); return; }
    if (!fType) { toast.error('Source type is required'); return; }
    if (!fRawText.trim()) { toast.error('Raw text is required'); return; }
    setSaving(true);
    try {
      const body = {
        title: fTitle.trim(),
        source_type: fType,
        source_url: fUrl.trim() || null,
        web_id: fWebId === '__none__' ? null : Number(fWebId),
        raw_text: fRawText,
      };
      await platformEntities.BrainSource.create(body);
      toast.success('Source saved');
      resetForm();
      setMode('list');
      await reloadSources();
    } catch (e) {
      toast.error(`Save failed: ${e.message}`);
    }
    setSaving(false);
  };

  const handleSaveMetadata = async () => {
    if (!selected) return;
    if (!fTitle.trim()) { toast.error('Title is required'); return; }
    setSaving(true);
    try {
      // Only metadata fields are sent; the desktop validator keeps raw text immutable.
      const body = {
        title: fTitle.trim(),
        source_type: fType,
        source_url: fUrl.trim() || null,
        web_id: fWebId === '__none__' ? null : Number(fWebId),
      };
      const updated = await platformEntities.BrainSource.update(selected.id, body);
      toast.success('Metadata updated');
      setSelected(updated);
      setMode('view');
      await reloadSources();
    } catch (e) {
      toast.error(`Update failed: ${e.message}`);
    }
    setSaving(false);
  };

  const handleDeleteSource = async () => {
    if (!selected || deleting) return;

    setDeleting(true);
    try {
      await platformEntities.BrainSource.delete(selected.id);
      setSources((current) => current.filter((source) => source.id !== selected.id));
      setSelected(null);
      setConfirmDelete(false);
      setMode('list');
      toast.success('Source deleted');
    } catch (e) {
      toast.error(`Delete failed: ${e.message}`);
    } finally {
      setDeleting(false);
    }
  };

  const webLabel = (webId) => {
    if (webId == null) return '— unassigned —';
    const w = webs.find(x => Number(x.id) === Number(webId));
    return w?.title || `web #${webId}`;
  };

  if (loading) return <LoadingScreen message="Loading Raw Source Inbox..." />;

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <header className="sticky top-0 z-40 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/90 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate(-1)}
              data-testid="button-back"
              aria-label="Back"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="p-2 rounded-lg bg-[var(--accent-violet)]/20">
              <Inbox className="w-5 h-5 text-[var(--accent-violet-light)]" />
            </div>
            <h1 className="text-lg font-bold tracking-wide font-signature">
              Raw Source Inbox
            </h1>
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            {authUser?.username}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {mode === 'list' && (
          <>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold" data-testid="text-source-count">
                  My Raw Sources ({sources.length})
                </h2>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  Drop raw material here — articles, transcripts, notes, journal entries.
                  Everything is stored locally exactly as entered.
                </p>
              </div>
              <Button
                onClick={beginNew}
                className="bg-[var(--accent-violet)] hover:bg-[var(--accent-violet-hover)]"
                data-testid="button-new-source"
              >
                <Plus className="w-4 h-4 mr-2" />
                New source
              </Button>
            </div>

            {sources.length === 0 ? (
              <Card className="p-12 text-center bg-[var(--bg-surface)] border-[var(--border-subtle)]">
                <FileText className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-4" />
                <p className="text-[var(--text-secondary)]">
                  No sources yet. Click <span className="font-semibold">New source</span> to add one.
                </p>
              </Card>
            ) : (
              <div className="space-y-3">
                {sources.map(s => (
                  <Card
                    key={s.id}
                    className="p-4 bg-[var(--bg-surface)] border-[var(--border-subtle)] hover:border-[var(--accent-violet)]/60 transition-colors cursor-pointer"
                    onClick={() => beginView(s)}
                    data-testid={`card-source-${s.id}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-base font-semibold truncate" data-testid={`text-title-${s.id}`}>
                            {s.title}
                          </h3>
                          <span className="px-2 py-0.5 rounded-full text-xs bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)]">
                            {s.source_type}
                          </span>
                          <span className="px-2 py-0.5 rounded-full text-xs bg-[var(--bg-elevated)] text-[var(--text-muted)] border border-[var(--border-subtle)]">
                            Local
                          </span>
                        </div>
                        <p className="text-xs text-[var(--text-muted)] line-clamp-2">
                          {(s.raw_text || '').slice(0, 240)}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-[var(--text-muted)] mt-2">
                          <span>web: {webLabel(s.web_id)}</span>
                          {(s.created_date || s.created_at) && (
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {new Date(s.created_date || s.created_at).toLocaleString()}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {mode === 'new' && (
          <Card className="p-6 bg-[var(--bg-surface)] border-[var(--border-subtle)]">
            <h2 className="text-2xl font-bold mb-6">New raw source</h2>
            <div className="space-y-5">
              <div>
                <Label className="mb-2 block">Title *</Label>
                <Input
                  value={fTitle}
                  onChange={(e) => setFTitle(e.target.value)}
                  placeholder="Short descriptive title"
                  data-testid="input-title"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="mb-2 block">Source type *</Label>
                  <Select value={fType} onValueChange={setFType}>
                    <SelectTrigger data-testid="select-source-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SOURCE_TYPES.map(t => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-2 block">Knowledge web (optional)</Label>
                  <Select value={fWebId} onValueChange={setFWebId}>
                    <SelectTrigger data-testid="select-web">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— unassigned —</SelectItem>
                      {webs.map(w => (
                        <SelectItem key={w.id} value={String(w.id)}>{w.title || `web #${w.id}`}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label className="mb-2 block">Source URL (optional)</Label>
                <Input
                  value={fUrl}
                  onChange={(e) => setFUrl(e.target.value)}
                  placeholder="https://…"
                  data-testid="input-url"
                />
              </div>

              <div>
                <Label className="mb-2 block">Raw text *</Label>
                <Textarea
                  value={fRawText}
                  onChange={(e) => setFRawText(e.target.value)}
                  placeholder="Paste the article, transcript, tweet, sermon notes…"
                  className="min-h-[320px] font-mono text-sm"
                  data-testid="textarea-raw-text"
                />
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Raw text is immutable once saved.
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={() => { resetForm(); setMode('list'); }}
                  disabled={saving}
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={saving}
                  className="bg-[var(--accent-violet)] hover:bg-[var(--accent-violet-hover)]"
                  data-testid="button-save-source"
                >
                  {saving ? 'Saving…' : 'Save source'}
                </Button>
              </div>
            </div>
          </Card>
        )}

        {mode === 'view' && selected && (
          <Card className="p-6 bg-[var(--bg-surface)] border-[var(--border-subtle)]">
            <div className="flex items-start justify-between mb-6 gap-4">
              <div className="min-w-0">
                <h2 className="text-2xl font-bold break-words" data-testid="text-view-title">{selected.title}</h2>
                <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-[var(--text-muted)]">
                  <span className="px-2 py-0.5 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">{selected.source_type}</span>
                  <span className="px-2 py-0.5 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-subtle)]">Local</span>
                  <span>web: {webLabel(selected.web_id)}</span>
                  {(selected.created_date || selected.created_at) && (
                    <span>added {new Date(selected.created_date || selected.created_at).toLocaleString()}</span>
                  )}
                </div>
                {selected.source_url && (
                  <a
                    href={selected.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-[var(--accent-violet-light)] hover:underline break-all mt-2 inline-block"
                    data-testid="link-source-url"
                  >
                    {selected.source_url}
                  </a>
                )}
              </div>
              <div className="flex gap-2 flex-shrink-0 flex-wrap justify-end">
                <Button variant="outline" onClick={() => setMode('list')} data-testid="button-back-to-list">Back</Button>
                <Button
                  variant="outline"
                  onClick={() => beginEdit(selected)}
                  data-testid="button-edit-metadata"
                >
                  Edit metadata
                </Button>
                <Button
                  variant="outline"
                  disabled
                  className="gap-2"
                  data-testid="button-online-mode-off"
                  title="The AI Spine is dormant until Online Mode is available."
                >
                  <Sparkles className="w-4 h-4" />
                  Online Mode off
                </Button>
                {!confirmDelete ? (
                  <Button
                    variant="ghost"
                    className="gap-2 text-red-300 hover:bg-red-500/10 hover:text-red-200"
                    onClick={() => setConfirmDelete(true)}
                    data-testid="button-delete-source"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete source
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="destructive"
                      onClick={handleDeleteSource}
                      disabled={deleting}
                    >
                      {deleting ? 'Deleting…' : 'Delete source'}
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <div className="mb-6">
              <Label className="mb-2 block">Raw text (immutable)</Label>
              <pre
                className="whitespace-pre-wrap break-words text-sm font-mono p-4 rounded-md bg-[var(--bg-primary)] border border-[var(--border-subtle)] max-h-[40vh] overflow-auto"
                data-testid="text-raw-text"
              >
                {selected.raw_text}
              </pre>
            </div>

            <AIProcessingPanel source={selected} />
          </Card>
        )}

        {mode === 'edit' && selected && (
          <Card className="p-6 bg-[var(--bg-surface)] border-[var(--border-subtle)]">
            <h2 className="text-2xl font-bold mb-6">Edit source metadata</h2>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              Only metadata (title, type, URL, web assignment) can change.
              Raw text is immutable.
            </p>
            <div className="space-y-5">
              <div>
                <Label className="mb-2 block">Title *</Label>
                <Input value={fTitle} onChange={(e) => setFTitle(e.target.value)} data-testid="input-edit-title" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="mb-2 block">Source type *</Label>
                  <Select value={fType} onValueChange={setFType}>
                    <SelectTrigger data-testid="select-edit-source-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SOURCE_TYPES.map(t => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-2 block">Knowledge web (optional)</Label>
                  <Select value={fWebId} onValueChange={setFWebId}>
                    <SelectTrigger data-testid="select-edit-web">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— unassigned —</SelectItem>
                      {webs.map(w => (
                        <SelectItem key={w.id} value={String(w.id)}>{w.title || `web #${w.id}`}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="mb-2 block">Source URL (optional)</Label>
                <Input value={fUrl} onChange={(e) => setFUrl(e.target.value)} data-testid="input-edit-url" />
              </div>
              <div>
                <Label className="mb-2 block">Raw text (read-only)</Label>
                <pre className="whitespace-pre-wrap break-words text-xs font-mono p-3 rounded-md bg-[var(--bg-primary)] border border-[var(--border-subtle)] max-h-[200px] overflow-auto text-[var(--text-muted)]">
                  {fRawText}
                </pre>
              </div>
              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setMode('view')}
                  disabled={saving}
                  data-testid="button-cancel-edit"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSaveMetadata}
                  disabled={saving}
                  className="bg-[var(--accent-violet)] hover:bg-[var(--accent-violet-hover)]"
                  data-testid="button-save-metadata"
                >
                  {saving ? 'Saving…' : 'Save metadata'}
                </Button>
              </div>
            </div>
          </Card>
        )}
      </main>
    </div>
  );
}
