import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useParams } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspaceTabsProvider, TAB_KINDS, useWorkspaceTabs } from '@/lib/WorkspaceTabs';
import TabWorkspace from '@/components/tabs/TabWorkspace';

const pending = vi.hoisted(() => ({ resolve: null, gate: null }));
vi.mock('@/pages.config', () => ({ pagesConfig: {
  mainPage: 'LibraryHome',
  Pages: {
    LibraryHome: function Library() { const [draft,setDraft] = React.useState('Original'); return <input aria-label="Saved pane state" value={draft} onChange={e => setDraft(e.target.value)} />; },
    KnowledgeWeb: React.lazy(async () => {
      await pending.gate;
      return { default: function Note() { return <p>Opened note {useParams().slugId}</p>; } };
    }),
  },
} }));
function Controls() {
  const { openTab, selectTab } = useWorkspaceTabs();
  return <><button onClick={() => openTab(TAB_KINDS.NOTES,{path:'/notes/research-42',title:'Research note'})}>Open note</button><button onClick={() => selectTab('home')}>Return home</button></>;
}
afterEach(() => localStorage.clear());
it('shows a pane-local loading state, resolves deep-link params, and preserves the previous mounted editor', async () => {
  pending.gate = new Promise(resolve => { pending.resolve = resolve; });
  localStorage.setItem('bex_workspace_tabs_v1',JSON.stringify({tabs:[{id:'home',kind:'study',path:'/LibraryHome',title:'Home'}],activeId:'home'}));
  render(<MemoryRouter initialEntries={['/LibraryHome']}><WorkspaceTabsProvider><Controls /><TabWorkspace /></WorkspaceTabsProvider></MemoryRouter>);
  const original = screen.getByRole('textbox',{name:'Saved pane state'});
  fireEvent.change(original,{target:{value:'Keep this draft'}});
  fireEvent.click(screen.getByRole('button',{name:'Open note'}));
  await screen.findByTestId('workspace-page-loading');
  expect(screen.getByTestId('workspace-page-loading').textContent).toContain('Research note');
  expect(document.querySelectorAll('[data-pane-active="true"]')).toHaveLength(1);
  await act(async () => { pending.resolve(); });
  await screen.findByText('Opened note research-42');
  await waitFor(() => expect(screen.queryByTestId('workspace-page-loading')).toBeNull());
  fireEvent.click(screen.getByRole('button',{name:'Return home'}));
  expect(screen.getByRole('textbox',{name:'Saved pane state'})).toBe(original);
  expect(original.value).toBe('Keep this draft');
});
