import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { pagesConfig } from '@/pages.config';
import { normalizeWorkspacePath } from '@/lib/workspaceSession';
import PageNotFound from '@/lib/PageNotFound';
import { ActiveTabProvider, useWorkspaceTabs, kindForPath } from '@/lib/WorkspaceTabs';
import ErrorBoundary from '@/components/ErrorBoundary';

const { Pages, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : null;
const KnowledgeWebPage = Pages.KnowledgeWeb;
const TimelinesPage = Pages.Timelines;
const SpreadsheetsPage = Pages.Spreadsheets;

/**
 * The route table, resolved against a tab's own path rather than the browser's.
 *
 * Passing `location` to <Routes> is what lets several tabs render at once and
 * still each see their own `useParams()` — a Knowledge Web tab and a note tab
 * can be mounted together, each matching its own deep link.
 */
function TabRoutes({ path }) {
  return (
    <Routes location={normalizeWorkspacePath(path)}>
      <Route path="/" element={MainPage ? <MainPage /> : null} />
      {Object.entries(Pages).map(([routePath, Page]) => (
        <Route key={routePath} path={`/${routePath}`} element={<Page />} />
      ))}
      {KnowledgeWebPage && (
        <>
          <Route path="/knowledge-webs/:slugId" element={<KnowledgeWebPage />} />
          <Route path="/notes/:slugId" element={<KnowledgeWebPage />} />
        </>
      )}
      {TimelinesPage && (
        <Route path="/timegraphs/:slugId" element={<TimelinesPage />} />
      )}
      {SpreadsheetsPage && <Route path="/spreadsheets/:slugId" element={<SpreadsheetsPage />} />}
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
}

// Remounting on every keystroke would defeat the point of keeping tabs alive,
// so a tab's subtree only re-renders when its own path or active flag changes.
const TabPane = React.memo(function TabPane({ tab, isActive, entering = false, exiting = false, finishOpeningTab }) {
  return (
    <motion.div
      // Each pane is its own scroll container, so a tall page scrolls inside
      // the shell rather than pushing the document past it.
      className={isActive || exiting ? `bex-tab-pane absolute inset-0 min-h-0 min-w-0 flex flex-col overflow-y-auto ${exiting ? 'pointer-events-none' : ''}` : 'hidden'}
      initial={entering ? { x: '100%' } : false}
      animate={{ x: exiting ? '-100%' : '0%' }}
      transition={{ duration: entering || exiting ? 0.48 : 0, ease: [0.22, 0.8, 0.2, 1] }}
      onAnimationComplete={() => { if (entering) finishOpeningTab?.(tab.id); }}
      aria-hidden={isActive ? undefined : 'true'}
      inert={isActive ? undefined : ''}
      data-testid={`workspace-pane-${tab.id}`}
      data-pane-active={isActive ? 'true' : 'false'}
      data-tab-slide={entering ? 'entering' : exiting ? 'exiting' : undefined}
    >
      <ActiveTabProvider isActive={isActive} tabId={tab.id}>
        {/* One boundary per pane. Without it a single throwing component
            unmounts the whole app, losing every other tab's canvas position,
            scroll and unsaved edits along with it. `resetKey` clears a stuck
            pane as soon as it navigates somewhere else. */}
        <ErrorBoundary label={tab.title} resetKey={tab.path}>
          <TabRoutes path={tab.path} />
        </ErrorBoundary>
      </ActiveTabProvider>
    </motion.div>
  );
});

export default function TabWorkspace() {
  const { tabs, activeId, activeTab, updateTab, openingTab, finishOpeningTab } = useWorkspaceTabs();
  const reducedMotion = useReducedMotion();
  React.useEffect(() => {
    if (reducedMotion && openingTab) finishOpeningTab(openingTab.toId);
  }, [reducedMotion, openingTab, finishOpeningTab]);
  const location = useLocation();
  const navigate = useNavigate();
  const browserPath = `${location.pathname}${location.search}`;
  const lastBrowserPath = React.useRef(browserPath);
  const lastActive = React.useRef({ id: activeTab?.id, path: activeTab?.path });

  // The URL and the active tab are two views of the same thing, so the sync has
  // to know which of them actually moved. Comparing them to each other is not
  // enough: opening a new tab leaves a stale URL that looks exactly like a
  // navigation, and the tab would be dragged back to the old page.
  React.useEffect(() => {
    if (!activeTab) return;

    const browserMoved = browserPath !== lastBrowserPath.current;
    const tabMoved = activeTab.id !== lastActive.current.id
      || activeTab.path !== lastActive.current.path;

    if (browserMoved && !tabMoved) {
      // "/" is the app root, not a workspace. A stray redirect landing there
      // must not be written into the tab — that would erase what the tab is,
      // and the erased path would then be persisted for next launch.
      if (browserPath === '/') {
        lastBrowserPath.current = browserPath;
        return;
      }
      // A page navigated itself — a sidebar click, or a deep link opened from
      // outside. The active tab follows it; no new tab appears.
      lastBrowserPath.current = browserPath;
      lastActive.current = { id: activeTab.id, path: browserPath };
      if (browserPath !== activeTab.path) {
        const isDeepLink = browserPath.startsWith('/knowledge-webs/')
          || browserPath.startsWith('/notes/')
          || browserPath.startsWith('/timegraphs/')
          || browserPath.startsWith('/spreadsheets/')
          || browserPath.startsWith('/Study');
        updateTab(activeTab.id, {
          path: browserPath,
          // Only a deep link tells us what the tab now really holds; landing on
          // the plain workspace shouldn't relabel a Notes tab.
          ...(isDeepLink ? { kind: kindForPath(browserPath) } : {}),
        });
      }
      return;
    }

    // Otherwise the tab set moved (switched, opened, closed, reordered) and the
    // URL follows it.
    lastBrowserPath.current = activeTab.path;
    lastActive.current = { id: activeTab.id, path: activeTab.path };
    if (browserPath !== activeTab.path) navigate(activeTab.path, { replace: true });
  }, [browserPath, activeTab, updateTab, navigate]);

  return (
    <div className="relative flex-1 min-h-0 min-w-0 overflow-hidden" data-testid="workspace-stage">
      {tabs.map((tab) => (
        <TabPane key={tab.id} tab={tab} isActive={tab.id === activeId}
          entering={!reducedMotion && openingTab?.toId === tab.id && tab.id === activeId}
          exiting={!reducedMotion && openingTab?.fromId === tab.id && openingTab?.toId === activeId}
          finishOpeningTab={finishOpeningTab} />
      ))}
    </div>
  );
}
