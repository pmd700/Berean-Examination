import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import LibraryHome from '@/pages/LibraryHome';
import TabBar from '@/components/tabs/TabBar';
import { WorkspaceTabsProvider, ActiveTabProvider } from '@/lib/WorkspaceTabs';
import { PrivateWebProvider } from '@/lib/PrivateWebContext';
import { localEntities } from '@/lib/localEntities';

// Native restart proof: emulate the real note editor's 600 ms debounce.
window.queueRestartProofEdit = () => window.setTimeout(() => {
  void localEntities.MindNote.update('restart-proof-note', { content: 'latest debounced edit' });
}, 600);

window.localStorage.setItem('bex_workspace_tabs_v1', JSON.stringify({ tabs: [
  { id: 'home', kind: 'home', path: '/LibraryHome', title: 'New tab' },
], activeId: 'home' }));
createRoot(document.getElementById('root')).render(
  <MemoryRouter><PrivateWebProvider><WorkspaceTabsProvider initialPath="/LibraryHome">
    <TabBar /><ActiveTabProvider isActive tabId="home"><LibraryHome /></ActiveTabProvider>
  </WorkspaceTabsProvider></PrivateWebProvider></MemoryRouter>,
);
