import BackToMenu from '@/components/navigation/BackToMenu';
import React from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Loader2 } from 'lucide-react';
import TimegraphEditor from '@/components/timegraph/TimegraphEditor';
import {
  listTimegraphs,
  renameTimegraph,
} from '@/lib/timegraph/timegraphStore';
import {
  NEW_TAB_PATH,
  TAB_KINDS,
  useCurrentWorkspaceTab,
  useTabTitle,
  useWorkspaceTabs,
} from '@/lib/WorkspaceTabs';
import { parseIdFromParam, timegraphDeepLink } from '@/utils';
import { toast } from 'sonner';

function formatCreatedOn(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function SpotlightTitle({ title, query }) {
  const value = String(title || 'Unnamed timeline');
  const phrase = String(query || '').trim();
  const index = value.toLocaleLowerCase().indexOf(phrase.toLocaleLowerCase());
  if (!phrase || index < 0) return value;
  return (
    <>
      {value.slice(0, index)}
      <mark className="rounded-sm bg-brand/45 px-0.5 text-inherit">{value.slice(index, index + phrase.length)}</mark>
      {value.slice(index + phrase.length)}
    </>
  );
}

/**
 * The full editor for one Timeline. Timeline discovery, creation and management
 * now live on the New tab library, so this page deliberately has no second list.
 * The open graph is carried in the URL (`/timegraphs/<slug>-<id>`) rather than in
 * component state, which is what lets a tab reopen on the same timeline after a
 * restart and what makes a link to a timeline shareable.
 */
export default function Timelines() {
  const { slugId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const spotlightTarget = React.useMemo(() => {
    const params = new URLSearchParams(location.search);
    return {
      query: params.get('spotlight') || '',
      field: params.get('spotlightField') || '',
      token: params.get('spotlightJump') || '',
      eventId: params.get('event'),
    };
  }, [location.search]);
  const currentTab = useCurrentWorkspaceTab();
  const { tabs, selectTab, openTab, updateTab } = useWorkspaceTabs();
  const openId = parseIdFromParam(slugId);
  const knowledgeWebOrigin = currentTab?.returnTo?.kind === TAB_KINDS.KNOWLEDGE_WEB
    ? currentTab.returnTo
    : null;

  const goBack = React.useCallback(() => {
    if (!knowledgeWebOrigin) {
      if (currentTab) {
        updateTab(currentTab.id, {
          kind: TAB_KINDS.HOME,
          path: NEW_TAB_PATH,
          title: 'New tab',
          returnTo: undefined,
        });
      } else {
        navigate(NEW_TAB_PATH);
      }
      return;
    }
    if (tabs.some((tab) => tab.id === knowledgeWebOrigin.tabId)) {
      selectTab(knowledgeWebOrigin.tabId);
      return;
    }
    openTab(TAB_KINDS.KNOWLEDGE_WEB, {
      path: knowledgeWebOrigin.path,
      title: knowledgeWebOrigin.title || 'Knowledge Web',
    });
  }, [currentTab, knowledgeWebOrigin, navigate, openTab, selectTab, tabs, updateTab]);

  const [graphs, setGraphs] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [editingTitle, setEditingTitle] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState('');
  const titleInputRef = React.useRef(null);

  const load = React.useCallback(async () => {
    try {
      setGraphs(await listTimegraphs());
      setError(null);
    } catch (loadError) {
      setError(loadError?.message || 'BEX could not read your timelines.');
      setGraphs([]);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const openGraph = graphs?.find((graph) => String(graph.id) === String(openId)) || null;

  React.useEffect(() => {
    setEditingTitle(false);
    setTitleDraft(openGraph?.title || '');
  }, [openId, openGraph?.title]);

  React.useLayoutEffect(() => {
    if (editingTitle === false) return;
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [editingTitle]);

  // Name the tab after the open timeline, so several are told apart.
  useTabTitle(openId ? (openGraph?.title || 'Unnamed timeline') : 'New tab');

  React.useEffect(() => {
    if (openId != null || !currentTab) return;
    updateTab(currentTab.id, {
      kind: TAB_KINDS.HOME,
      path: NEW_TAB_PATH,
      title: 'New tab',
      returnTo: undefined,
    });
  }, [currentTab, openId, updateTab]);

  const saveTitle = async () => {
    if (!openGraph) return;
    const previousTitle = openGraph.title || '';
    const nextTitle = titleDraft.trim();
    setEditingTitle(false);
    setTitleDraft(nextTitle);
    if (nextTitle === previousTitle) return;

    setGraphs((current) => current?.map((graph) => (
      String(graph.id) === String(openGraph.id) ? { ...graph, title: nextTitle } : graph
    )));

    try {
      const saved = await renameTimegraph(openGraph.id, nextTitle);
      setGraphs((current) => current?.map((graph) => (
        String(graph.id) === String(openGraph.id) ? { ...graph, ...saved } : graph
      )));
      navigate(timegraphDeepLink(openGraph.id, nextTitle), { replace: true });
    } catch (renameError) {
      setTitleDraft(previousTitle);
      setGraphs((current) => current?.map((graph) => (
        String(graph.id) === String(openGraph.id) ? { ...graph, title: previousTitle } : graph
      )));
      toast.error(renameError?.message || 'BEX could not rename that timeline.');
    }
  };

  // A deep link can outlive the record it names — a graph deleted from another
  // tab, or a stale saved session. Say so instead of showing an empty editor.
  const missing = openId != null && graphs != null && !openGraph;

  if (openId != null && graphs === null) {
    return (
      <div className="grid h-full place-items-center" data-testid="timelines-loading">
        <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'rgb(var(--brand-strong))' }} />
      </div>
    );
  }

  if (openId != null && !missing) {
    return (
      <div className="flex flex-col h-full min-h-0" data-testid="timelines-editor">
        <div
          className="flex items-center gap-2 px-3 py-2 shrink-0"
          style={{ borderBottom: '1px solid rgb(var(--line))', background: 'rgb(var(--surface))' }}
        >
          <BackToMenu />
          <button
            type="button"
            className="bex-tg-button"
            onClick={goBack}
            data-testid="timelines-back"
          >
            <ChevronLeft className="w-3 h-3" />
            {knowledgeWebOrigin ? 'Go back to knowledge web' : 'Back to library'}
          </button>
          {openGraph?.created_date && (
            <span
              className="shrink-0 text-[10px]"
              style={{ color: 'rgb(var(--ink-faint))' }}
              data-testid="timeline-created-on"
            >
              Created on {formatCreatedOn(openGraph.created_date)}
            </span>
          )}
          {editingTitle ? (
            <input
              ref={titleInputRef}
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={saveTitle}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') {
                  setTitleDraft(openGraph?.title || '');
                  setEditingTitle(false);
                }
              }}
              placeholder="Unnamed timeline"
              aria-label="Timeline name"
              className="h-7 min-w-0 max-w-sm flex-1 rounded-md border px-2 text-sm font-semibold outline-none"
              style={{
                color: 'rgb(var(--ink))',
                background: 'rgb(var(--elevated) / 0.65)',
                borderColor: 'rgb(var(--brand-strong))',
              }}
              data-testid="timeline-title-input"
            />
          ) : (
            <button
              type="button"
              onDoubleClick={() => setEditingTitle(true)}
              className="min-w-0 truncate text-left text-sm font-semibold cursor-text"
              style={{ color: openGraph?.title ? 'rgb(var(--ink))' : 'rgb(var(--ink-faint))' }}
              aria-label="Double-click to rename timeline"
              data-testid="timeline-title-display"
            >
              <SpotlightTitle
                title={openGraph?.title || 'Unnamed timeline'}
                query={spotlightTarget.field === 'title' && !spotlightTarget.eventId ? spotlightTarget.query : ''}
              />
            </button>
          )}
        </div>
        <div className="flex-1 min-h-0">
          <TimegraphEditor
            timegraphId={openId}
            className="h-full"
            spotlightEventId={spotlightTarget.eventId}
            spotlightQuery={spotlightTarget.query}
            spotlightField={spotlightTarget.field}
            spotlightToken={spotlightTarget.token}
          />
        </div>
      </div>
    );
  }

  if (missing || error) {
    return (
      <div className="grid h-full place-items-center p-6" data-testid="timelines-missing">
        <div className="text-center">
          <p className="text-sm text-slate-400">{error || 'That timeline no longer exists.'}</p>
          <button type="button" className="bex-tg-button mt-3" onClick={goBack}>
            <ChevronLeft className="h-3 w-3" /> Back to library
          </button>
        </div>
      </div>
    );
  }

  // `/Timelines` is kept only as a compatibility route for old saved tabs and
  // bookmarks. The effect above changes that tab into the New tab library.
  return null;
}
