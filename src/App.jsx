import React from 'react'
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router } from 'react-router-dom';
import { WorkspaceTabsProvider, useWorkspaceTabs, TAB_KINDS } from '@/lib/WorkspaceTabs';
import { OPEN_COMMENTARY_TAB_EVENT, parseCommentaryLinkTarget } from '@/lib/commentaryLink';
import TabBar from '@/components/tabs/TabBar';
import TabWorkspace from '@/components/tabs/TabWorkspace';
import CopyConfirmation from '@/components/utils/CopyConfirmation';
import { AuthProvider } from '@/lib/AuthContext';
import { ThemeProvider } from '@/lib/ThemeContext';
import { I18nProvider } from '@/components/utils/I18nContext';
import { PrivateWebProvider } from '@/lib/PrivateWebContext';
import { ConfirmDialogHost } from '@/components/ui/confirm-dialog';
import DesktopActivationGate from '@/components/desktop/ActivationGate';
import DesktopLibraryGate from '@/components/desktop/LibrarySetup';
import DesktopPrivacyGate from '@/components/desktop/PrivacyGate';
import { useTextSizePreference } from '@/components/scripture/TextSizeControl';

const { Layout } = pagesConfig;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName} fullBleed>{children}</Layout>
  : <>{children}</>;

/**
 * The workspace shell: one tab bar, and every open tab mounted beneath it.
 *
 * Layout lives out here rather than inside each tab — it owns the global nav
 * and global search, and one copy of those is enough no matter how many tabs
 * are open. Which page name it gets follows the active tab.
 */
const LocalApp = () => {
  const { activeTab } = useWorkspaceTabs();
  const currentPageName = pageNameForPath(activeTab?.path);
  // Load the same owner preference Chapter Study uses once at the shell. The
  // resulting CSS tokens reach every shared editor, including surfaces without
  // their own visible slider.
  useTextSizePreference();

  // A commentary link opens its passage in a tab of its own.
  const { openTab } = useWorkspaceTabs();
  React.useEffect(() => {
    const open = (event) => {
      const detail = event.detail;
      if (!detail?.path || detail.handled) return;
      detail.handled = true;
      openTab(TAB_KINDS.STUDY, {
        path: detail.path,
        title: parseCommentaryLinkTarget(detail.path)?.query || detail.title || undefined,
      });
    };
    window.addEventListener(OPEN_COMMENTARY_TAB_EVENT, open);
    return () => window.removeEventListener(OPEN_COMMENTARY_TAB_EVENT, open);
  }, [openTab]);

  return (
    <LayoutWrapper currentPageName={currentPageName}>
      {/* The shell owns the viewport and the scrolling. Without overflow-hidden
          a page taller than the screen spills past this box, the document
          itself starts scrolling, and everything below the fold shows bare
          <body> — which turns white the moment a page flips <html> out of dark
          mode. Panes scroll internally instead. */}
      <div className="h-screen overflow-hidden flex flex-col bg-app">
        <TabBar />
        <TabWorkspace />
      </div>
    </LayoutWrapper>
  );
};

/** Layout only needs to know whether the active page owns the full viewport. */
function pageNameForPath(path = '') {
  if (path.startsWith('/spreadsheets/')) return 'Spreadsheets';
  if (path.startsWith('/knowledge-webs/') || path.startsWith('/notes/')) return 'KnowledgeWeb';
  const match = path.replace(/^\//, '').split(/[/?]/)[0];
  return match || 'Study';
}

function App() {
  return (
    <DesktopLibraryGate>
    <DesktopActivationGate>
    <DesktopPrivacyGate>
    <ThemeProvider>
    <AuthProvider>
      <I18nProvider>
        <PrivateWebProvider>
          <QueryClientProvider client={queryClientInstance}>
            <Router>
              <WorkspaceTabsProvider initialPath={`${window.location.pathname}${window.location.search}`}>
                <LocalApp />
              </WorkspaceTabsProvider>
            </Router>
            <Toaster />
            <CopyConfirmation />
            <ConfirmDialogHost />
          </QueryClientProvider>
        </PrivateWebProvider>
      </I18nProvider>
    </AuthProvider>
    </ThemeProvider>
    </DesktopPrivacyGate>
    </DesktopActivationGate>
    </DesktopLibraryGate>
  )
}

export default App
