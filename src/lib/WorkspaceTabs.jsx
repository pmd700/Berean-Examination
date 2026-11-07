import React from 'react';
import { createPageUrl } from '@/utils';
import { TAB_TITLE_MAX, formatTabTitle } from '@/lib/tabTitle';
import { normalizeSession, normalizeWorkspacePath } from '@/lib/workspaceSession';

export { TAB_TITLE_MAX, formatTabTitle, normalizeSession };

/**
 * Workspace tabs.
 *
 * A tab is a workspace that stays mounted for as long as it is open — switching
 * tabs hides one and shows another rather than tearing anything down, so canvas
 * position, scroll, undo history and in-flight edits all survive. The trade is
 * that background tabs are live React trees, which is why anything that
 * registers a window/document listener has to check `useIsActiveTab()` before
 * acting; see TabWorkspace.
 *
 * The browser URL mirrors the active tab, so existing deep links, bookmarks and
 * shared web/note links keep working: opening one loads it into the active tab,
 * and switching tabs rewrites the URL.
 */

const STORAGE_KEY = 'bex_workspace_tabs_v1';

export const TAB_KINDS = Object.freeze({
  HOME: 'home',
  STUDY: 'study',
  KNOWLEDGE_WEB: 'knowledge-web',
  NOTES: 'notes',
  KEYWORDS: 'keywords',
  TIMELINE: 'timeline',
  SPREADSHEET: 'spreadsheet',
  COURSES: 'courses',
  STATS: 'stats',
  AI_SECOND_BRAIN: 'ai-second-brain',
  SCRIPTURE: 'scripture',
});

export const NEW_TAB_PATH = createPageUrl('LibraryHome');

/** What the "+" menu offers, in order. */
export const NEW_TAB_OPTIONS = [
  {
    kind: TAB_KINDS.KNOWLEDGE_WEB,
    label: 'Knowledge Web',
    hint: 'Cards and connections on a canvas',
    path: createPageUrl('KnowledgeWeb'),
  },
  {
    kind: TAB_KINDS.NOTES,
    label: 'Notes',
    hint: 'Write a standalone note',
    path: createPageUrl('KnowledgeWeb'),
  },
  {
    kind: TAB_KINDS.KEYWORDS,
    label: 'Keywords Library',
    hint: 'Terms and definitions',
    path: createPageUrl('Keywords'),
  },
  {
    kind: TAB_KINDS.TIMELINE,
    label: 'Timeline',
    hint: 'Create or choose one from New tab',
    path: NEW_TAB_PATH,
  },
  { kind: TAB_KINDS.SPREADSHEET, label: 'Spreadsheet', hint: 'Analyze data in a workbook', path: NEW_TAB_PATH },
  {
    kind: TAB_KINDS.COURSES,
    label: 'Courses',
    hint: 'Watch installed course material',
    path: createPageUrl('Courses'),
  },
  {
    kind: TAB_KINDS.STATS,
    label: 'Stats',
    hint: 'See Bible Study activity',
    path: createPageUrl('Stats'),
  },
  {
    kind: TAB_KINDS.AI_SECOND_BRAIN,
    label: 'AI Second Brain',
    hint: 'Search and ask your library',
    path: createPageUrl('BrainChat'),
  },
];

const DEFAULT_TITLES = {
  [TAB_KINDS.HOME]: 'New tab',
  [TAB_KINDS.STUDY]: 'Bible Study',
  [TAB_KINDS.KNOWLEDGE_WEB]: 'Knowledge Web',
  [TAB_KINDS.NOTES]: 'Notes',
  [TAB_KINDS.KEYWORDS]: 'Keywords',
  [TAB_KINDS.TIMELINE]: 'Timeline',
  [TAB_KINDS.SPREADSHEET]: 'Spreadsheet',
  [TAB_KINDS.COURSES]: 'Courses',
  [TAB_KINDS.STATS]: 'Stats',
  [TAB_KINDS.AI_SECOND_BRAIN]: 'AI Second Brain',
  [TAB_KINDS.SCRIPTURE]: 'Scripture Reader',
};

let tabSequence = 0;
function nextTabId() {
  tabSequence += 1;
  return `tab-${Date.now().toString(36)}-${tabSequence}`;
}

export function makeTab(kind, overrides = {}) {
  const option = kind === TAB_KINDS.HOME
    ? { kind: TAB_KINDS.HOME, path: NEW_TAB_PATH, label: 'New tab' }
    : kind === TAB_KINDS.STUDY
      ? { kind, path: createPageUrl('Study'), label: 'Bible Study' }
      : NEW_TAB_OPTIONS.find((entry) => entry.kind === kind) || NEW_TAB_OPTIONS[0];
  return {
    id: nextTabId(),
    kind: option.kind,
    path: option.path,
    title: DEFAULT_TITLES[option.kind] || option.label,
    ...overrides,
  };
}

/** Which kind of workspace a URL belongs to, for tabs opened from a deep link. */
export function kindForPath(path) {
  path = normalizeWorkspacePath(path);
  if (path.startsWith(NEW_TAB_PATH)) return TAB_KINDS.HOME;
  if (path.startsWith('/spreadsheets/') || path.startsWith('/Spreadsheets')) return TAB_KINDS.SPREADSHEET;
  if (path.startsWith('/timegraphs/')) return TAB_KINDS.TIMELINE;
  if (path.startsWith('/notes/')) return TAB_KINDS.NOTES;
  if (path.startsWith('/knowledge-webs/')) return TAB_KINDS.KNOWLEDGE_WEB;
  if (path.startsWith(createPageUrl('Keywords'))) return TAB_KINDS.KEYWORDS;
  // `/Timelines` is an old bookmark/session target. It now opens the one
  // management surface—the New tab library—instead of a duplicate list.
  if (path.startsWith(createPageUrl('Timelines'))) return TAB_KINDS.HOME;
  if (path.startsWith(createPageUrl('Courses'))) return TAB_KINDS.COURSES;
  if (path.startsWith(createPageUrl('Stats'))) return TAB_KINDS.STATS;
  if (
    path.startsWith(createPageUrl('BrainChat'))
    || path.startsWith(createPageUrl('BrainSearch'))
    || path.startsWith(createPageUrl('BrainInbox'))
  ) return TAB_KINDS.AI_SECOND_BRAIN;
  if (path.startsWith(createPageUrl('KnowledgeWeb'))) return TAB_KINDS.KNOWLEDGE_WEB;
  if (path.startsWith('/ScriptureReader')) return TAB_KINDS.STUDY;
  return TAB_KINDS.STUDY;
}

function isDesktopRuntime() {
  return typeof window !== 'undefined' && Boolean(window.bexDesktop?.isDesktop);
}

function readStoredSession() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeSession(JSON.parse(raw));
  } catch {
    return null;   // corrupt or unavailable storage is not worth failing over
  }
}

function initialSession(initialPath) {
  const restored = readStoredSession();
  if (restored) return restored;
  // First run, or a deep link opened before any session existed.
  const kind = initialPath && initialPath !== '/' ? kindForPath(initialPath) : TAB_KINDS.HOME;
  const tab = makeTab(
    kind,
    initialPath && initialPath !== '/'
      ? { path: normalizeWorkspacePath(initialPath) }
      : { path: NEW_TAB_PATH, title: DEFAULT_TITLES[TAB_KINDS.HOME] },
  );
  return { tabs: [tab], activeId: tab.id };
}

const WorkspaceTabsContext = React.createContext(null);
const ActiveTabContext = React.createContext(true);
const TabIdContext = React.createContext(null);

/**
 * True when the surrounding workspace is the one on screen. Background tabs stay
 * mounted, so global keyboard/pointer handlers must not act unless this is true.
 */
export function useIsActiveTab() {
  return React.useContext(ActiveTabContext);
}

export function ActiveTabProvider({ isActive, tabId = null, children }) {
  return (
    <ActiveTabContext.Provider value={isActive}>
      <TabIdContext.Provider value={tabId}>{children}</TabIdContext.Provider>
    </ActiveTabContext.Provider>
  );
}

/**
 * Lets a page name its own tab after whatever it currently holds — the chapter
 * being read, the web or note being edited — so several open workspaces are
 * told apart by content rather than all reading "Bible Study".
 *
 * Pass a blank value and the tab falls back to its kind's generic label.
 * Disable while loading to retain the known title until its record is ready.
 */
export function useTabTitle(title, { enabled = true } = {}) {
  const tabId = React.useContext(TabIdContext);
  const { tabs, updateTab } = useWorkspaceTabs();
  // Only the kind is read, not the tab object: depending on the object would
  // re-run this on every unrelated session change.
  const kind = tabs.find((tab) => tab.id === tabId)?.kind;

  React.useEffect(() => {
    if (!tabId || !enabled) return;
    const clean = typeof title === 'string' ? title.replace(/\s+/g, ' ').trim() : '';
    updateTab(tabId, { title: clean || DEFAULT_TITLES[kind] || 'Workspace' });
  }, [tabId, kind, title, updateTab, enabled]);
}

/**
 * Let a note editor tell its owning workspace tab what document shape it has.
 *
 * This is derived state, not a user setting: a note with one page is a note and
 * a note with two or more pages is a book. Keeping the result on the tab makes
 * the correct icon survive session restore, while every editor mount rechecks
 * the real content and corrects any stale saved value.
 *
 * The context is intentionally optional so the editor remains usable in small
 * standalone test/preview mounts that do not render the full workspace shell.
 */
export function useTabBookStatus(isBook, { enabled = true } = {}) {
  const tabId = React.useContext(TabIdContext);
  const workspace = React.useContext(WorkspaceTabsContext);
  const kind = workspace?.tabs.find((tab) => tab.id === tabId)?.kind;
  const updateTab = workspace?.updateTab;

  React.useEffect(() => {
    if (!tabId || !enabled || kind !== TAB_KINDS.NOTES || !updateTab) return;
    updateTab(tabId, { isBook: Boolean(isBook) });
  }, [enabled, isBook, kind, tabId, updateTab]);
}

export function useWorkspaceTabs() {
  const value = React.useContext(WorkspaceTabsContext);
  if (!value) throw new Error('useWorkspaceTabs must be used inside WorkspaceTabsProvider');
  return value;
}

export function useOptionalWorkspaceTabs() {
  return React.useContext(WorkspaceTabsContext);
}

/** Optional owning-tab metadata for editors also rendered in isolated previews. */
export function useOptionalCurrentWorkspaceTab() {
  const tabId = React.useContext(TabIdContext);
  const workspace = React.useContext(WorkspaceTabsContext);
  return workspace?.tabs.find(tab => tab.id === tabId) || null;
}


/** The tab that owns the calling page, even while another tab is active. */
export function useCurrentWorkspaceTab() {
  const tabId = React.useContext(TabIdContext);
  const { tabs } = useWorkspaceTabs();
  return tabs.find((tab) => tab.id === tabId) || null;
}

export function WorkspaceTabsProvider({ initialPath, children }) {
  const [session, setSession] = React.useState(() => initialSession(initialPath));
  const sessionRef = React.useRef(session);
  sessionRef.current = session;
  // Transient presentation state is never written into the restored session.
  const [openingTab, setOpeningTab] = React.useState(null);

  // Did this launch restore a real session of its own? Read during the first
  // render, because the persist effect below writes localStorage immediately and
  // would erase the distinction before the library read could use it.
  const hadLocalSession = React.useRef(undefined);
  if (hadLocalSession.current === undefined) {
    hadLocalSession.current = Boolean(readStoredSession());
  }

  // Set once the user has actually moved tabs around, so a slow library read
  // can't overwrite work already in progress.
  const touched = React.useRef(false);
  const firstPersist = React.useRef(true);

  // Persist the whole set, so a restart reopens the workspace as it was.
  //
  // localStorage alone is not enough in the packaged app: the built files are
  // served from an ephemeral port, so the origin — and the whole localStorage
  // bucket — is different on every launch, and the tab set was being lost every
  // time. It stays as the synchronous cache, because the first render needs a
  // session before any async read could return, and the library record is the
  // copy that actually survives. Same arrangement as usePersistentPreference.
  React.useEffect(() => {
    if (firstPersist.current) firstPersist.current = false;
    else touched.current = true;

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch { /* storage full or blocked — tabs still work for this session */ }

    if (!isDesktopRuntime()) return;
    (async () => {
      try {
        const { desktopClient } = await import('@/api/desktopClient');
        await desktopClient.owner.updatePreferences({ [STORAGE_KEY]: session });
      } catch { /* cached locally; the next change retries */ }
    })();
  }, [session]);

  // Adopt the library's copy on launch, but only when this launch had nothing of
  // its own — which is exactly the ephemeral-origin case.
  React.useEffect(() => {
    if (!isDesktopRuntime() || hadLocalSession.current) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const { readLocalOwner } = await import('@/lib/localOwner');
        const owner = await readLocalOwner();
        const stored = normalizeSession(owner?.[STORAGE_KEY]);
        // A session the user has already started working in always wins.
        if (cancelled || !stored || touched.current) return;
        setSession(stored);
      } catch { /* not signed in yet — the fresh session stands */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const activeTab = session.tabs.find((tab) => tab.id === session.activeId) || session.tabs[0];

  const openTab = React.useCallback((kind, overrides) => {
    const tab = makeTab(kind, overrides);
    setOpeningTab({ fromId: sessionRef.current.activeId, toId: tab.id });
    setSession((current) => ({
      tabs: [...current.tabs, tab],
      activeId: tab.id,
    }));
    return tab;
  }, []);

  // A duplicate tab is a second live view of the SAME workspace record. It
  // deliberately keeps the source path/title/metadata but receives a fresh
  // tab identity, then sits directly beside the original.
  const duplicateTab = React.useCallback((id) => {
    const source = sessionRef.current.tabs.find(tab => tab.id === id);
    if (!source) return;
    const { id: sourceId, ...sourceWithoutId } = source;
    void sourceId;
    const duplicate = makeTab(source.kind, sourceWithoutId);
    setOpeningTab({ fromId: sessionRef.current.activeId, toId: duplicate.id });
    setSession((current) => {
      const index = current.tabs.findIndex((tab) => tab.id === id);
      if (index === -1) return current;
      const tabs = [...current.tabs];
      tabs.splice(index + 1, 0, duplicate);
      return { tabs, activeId: duplicate.id };
    });
  }, []);

  const closeTab = React.useCallback((id) => {
    setOpeningTab(null);
    setSession((current) => {
      // There is always at least one workspace open.
      if (current.tabs.length <= 1) return current;
      const index = current.tabs.findIndex((tab) => tab.id === id);
      if (index === -1) return current;
      const tabs = current.tabs.filter((tab) => tab.id !== id);
      const activeId = current.activeId === id
        ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? tabs[0].id)
        : current.activeId;
      return { tabs, activeId };
    });
  }, []);

  const selectTab = React.useCallback((id) => {
    setOpeningTab(null);
    setSession((current) => (current.activeId === id ? current : { ...current, activeId: id }));
  }, []);

  const finishOpeningTab = React.useCallback(id => {
    setOpeningTab(current => current?.toId === id ? null : current);
  }, []);

  const reorderTabs = React.useCallback((orderedIds) => {
    setSession((current) => {
      const byId = new Map(current.tabs.map((tab) => [tab.id, tab]));
      const tabs = orderedIds.map((id) => byId.get(id)).filter(Boolean);
      return tabs.length === current.tabs.length ? { ...current, tabs } : current;
    });
  }, []);

  /** Point a tab at a different place — this is what a sidebar click does. */
  const updateTab = React.useCallback((id, patch) => {
    setSession((current) => {
      // A patch that changes nothing has to return the identical session, not a
      // fresh object: useTabTitle re-asserts the same title on every render, and
      // spreading unconditionally would mean a new session (and a localStorage
      // write) each time.
      let mutated = false;
      const tabs = current.tabs.map((tab) => {
        if (tab.id !== id) return tab;
        if (Object.keys(patch).every((key) => tab[key] === patch[key])) return tab;
        mutated = true;
        return { ...tab, ...patch };
      });
      return mutated ? { ...current, tabs } : current;
    });
  }, []);

  const value = React.useMemo(() => ({
    tabs: session.tabs,
    activeId: session.activeId,
    activeTab,
    openTab,
    duplicateTab,
    closeTab,
    selectTab,
    reorderTabs,
    updateTab,
    openingTab,
    finishOpeningTab,
  }), [session, activeTab, openTab, duplicateTab, closeTab, selectTab, reorderTabs, updateTab, openingTab, finishOpeningTab]);

  return <WorkspaceTabsContext.Provider value={value}>{children}</WorkspaceTabsContext.Provider>;
}
