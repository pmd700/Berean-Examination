import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { WorkspaceTabsProvider, useWorkspaceTabs } from '@/lib/WorkspaceTabs';
import TabWorkspace from '@/components/tabs/TabWorkspace';
import TabBar from '@/components/tabs/TabBar';
import { noteDeepLink, webDeepLink } from '@/utils';

const data = vi.hoisted(() => ({
  notes: [
    { id: 1, title: 'Blasphemy of the Holy Spirit' },
    { id: 2, title: 'Babies, Original Sin, and Jesus' },
    { id: 3, title: 'Should Christians still follow the law?' },
  ],
  webs: [],
  loadNotes: vi.fn(),
  loadWebs: vi.fn(),
  cards: vi.fn(),
}));

vi.mock('@/pages.config', async () => ({
  pagesConfig: {
    mainPage: 'KnowledgeWeb',
    Pages: { KnowledgeWeb: (await import('@/pages/KnowledgeWeb')).default },
  },
}));
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true, isLoadingAuth: false, user: { id: 1 } }),
}));
vi.mock('@/lib/PrivateWebContext', () => ({
  usePrivateWeb: () => ({ isUnlocked: () => false, getKey: () => null }),
}));
vi.mock('@/components/utils/activityTracker', () => ({ trackActivity: vi.fn() }));
vi.mock('@/api/desktopClient', () => ({
  desktopClient: { entities: {
    Keyword: { list: async () => [] },
    MindNote: { list: data.loadNotes },
    KnowledgeWeb: { list: data.loadWebs },
    WebFolder: { list: async () => [] },
    WebCard: { filter: data.cards },
    WebConnection: { filter: async () => [] },
    CanvasObject: { filter: async () => [] },
  } },
}));
// Keep the real page loader, router, tab context and title effects. Only the
// editor body is a stand-in, exposing which note the page actually loaded.
vi.mock('@/components/knowledgeweb/NoteEditorPanel', () => ({
  default: ({ noteId, notes, onNoteSaved }) => <div data-testid="loaded-note">
    {notes.find((note) => note.id === noteId)?.title}
    <button onClick={() => onNoteSaved({ id: noteId, title: 'Renamed note' })}>Rename test note</button>
  </div>,
}));

function SessionControls() {
  const { tabs, activeId, selectTab, updateTab, duplicateTab } = useWorkspaceTabs();
  return <>
    <output data-testid="session">{JSON.stringify({ tabs, activeId })}</output>
    {tabs.map((tab) => <button key={tab.id} onClick={() => selectTab(tab.id)}>Select {tab.id}</button>)}
    <button onClick={() => duplicateTab(activeId)}>Duplicate active tab</button>
    <button onClick={() => updateTab('note-1', { path: noteDeepLink(2, data.notes[1].title) })}>Retarget first tab</button>
  </>;
}

function mount(tabs, activeId) {
  const path = tabs.find((tab) => tab.id === activeId).path;
  window.history.replaceState({}, '', path);
  window.localStorage.setItem('bex_workspace_tabs_v1', JSON.stringify({ tabs, activeId }));
  return render(<BrowserRouter><WorkspaceTabsProvider initialPath={path}>
    <TabBar /><SessionControls /><TabWorkspace />
  </WorkspaceTabsProvider></BrowserRouter>);
}

function noteTabs() {
  return data.notes.map((note) => ({
    id: `note-${note.id}`, kind: 'notes', path: noteDeepLink(note.id, note.title),
    // Reproduce a previously saved session whose labels were already corrupted.
    title: data.notes[2].title,
  }));
}

function session() {
  return JSON.parse(screen.getByTestId('session').textContent);
}

beforeEach(() => {
  window.localStorage.clear();
  data.webs = [];
  data.loadNotes.mockImplementation(async () => data.notes);
  data.loadWebs.mockImplementation(async () => data.webs);
  data.cards.mockImplementation(async () => []);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('each workspace tab owns its document identity', () => {
  it('restores the current card and fullscreen mode after a real workspace remount, and Escape closes it completely', async () => {
    data.webs = [{ id: 1, title: 'Canvas' }];
    data.cards.mockResolvedValue([{ id: 41, web_id: 1, title: 'Remember this card', description: '<p>Card writing.</p>', x: 0, y: 0 }]);
    const tab = { id: 'web', kind: 'knowledge-web', title: 'Canvas', path: webDeepLink(1, 'Canvas'), webCard: { webId: 1, cardId: 41, mode: 'fullscreen' } };
    const first = mount([tab], 'web');
    await waitFor(() => expect(document.querySelector('.bex-card-fullscreen .ProseMirror')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Expanded', exact: true }));
    await waitFor(() => expect(session().tabs[0].webCard.mode).toBe('expanded'));
    fireEvent.click(screen.getByRole('button', { name: 'Full screen', exact: true }));
    await waitFor(() => expect(session().tabs[0].webCard.mode).toBe('fullscreen'));
    const stored = JSON.parse(localStorage.getItem('bex_workspace_tabs_v1'));
    first.unmount();
    const second = mount(stored.tabs, stored.activeId);
    await waitFor(() => expect(document.querySelector('.bex-card-fullscreen .ProseMirror')).toBeTruthy());
    fireEvent.keyDown(document.querySelector('.bex-card-fullscreen .ProseMirror'), { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('.bex-card-fullscreen, .bex-card-inspector')).toBeNull());
    await waitFor(() => expect(session().tabs[0].webCard).toBeNull());
    expect(session().tabs[0].path).toBe(tab.path);
    const closed = JSON.parse(localStorage.getItem('bex_workspace_tabs_v1'));
    second.unmount();
    mount(closed.tabs, closed.activeId);
    await waitFor(() => expect(session().tabs[0].title).toBe('Canvas'));
    expect(document.querySelector('.bex-card-fullscreen, .bex-card-inspector')).toBeNull();
  });

  it('clears a deleted card from the saved session without blocking the web from loading', async () => {
    data.webs = [{ id: 1, title: 'Canvas' }];
    mount([{ id: 'web', kind: 'knowledge-web', title: 'Canvas', path: webDeepLink(1, 'Canvas'), webCard: { webId: 1, cardId: 999, mode: 'fullscreen' } }], 'web');
    await waitFor(() => expect(data.cards).toHaveBeenCalledWith({ web_id: 1 }));
    await waitFor(() => expect(session().tabs[0].webCard).toBeNull());
    expect(document.querySelector('.bex-card-fullscreen, .bex-card-inspector')).toBeNull();
  });
  it('restores three different note titles without first clicking their tabs', async () => {
    const tabs = noteTabs();
    mount(tabs, 'note-3');
    await waitFor(() => expect(screen.getAllByTestId('loaded-note')).toHaveLength(3));

    await waitFor(() => expect(session().tabs.map((tab) => tab.title)).toEqual(data.notes.map((note) => note.title)));
    for (const note of data.notes) {
      expect(within(screen.getByTestId(`workspace-tab-note-${note.id}`)).getByTitle(note.title)).toBeTruthy();
      expect(within(screen.getByTestId(`workspace-pane-note-${note.id}`)).getByTestId('loaded-note').textContent)
        .toContain(note.title);
    }
    expect(session().tabs.map((tab) => tab.path)).toEqual(tabs.map((tab) => tab.path));
  });

  it('keeps known names during loading and resolves each tab correctly after switching mid-load', async () => {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    data.loadNotes.mockReturnValue(pending);
    const tabs = noteTabs().map((tab, index) => ({ ...tab, title: data.notes[index].title }));
    mount(tabs, 'note-3');
    await waitFor(() => expect(data.loadNotes).toHaveBeenCalledTimes(3));
    expect(session().tabs.map((tab) => tab.title)).toEqual(data.notes.map((note) => note.title));

    fireEvent.click(screen.getByRole('button', { name: 'Select note-1', exact: true }));
    await act(async () => { release(data.notes); });
    await waitFor(() => expect(screen.getAllByTestId('loaded-note')).toHaveLength(3));
    expect(session().activeId).toBe('note-1');
    expect(session().tabs.map((tab) => tab.title)).toEqual(data.notes.map((note) => note.title));
    expect(session().tabs.map((tab) => tab.path)).toEqual(tabs.map((tab) => tab.path));
    expect(JSON.parse(window.localStorage.getItem('bex_workspace_tabs_v1')).tabs)
      .toEqual(session().tabs);
  });

  it('uses the latest owning route when a background tab changes during its initial read', async () => {
    let release;
    data.loadNotes.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    mount(noteTabs(), 'note-3');
    await waitFor(() => expect(data.loadNotes).toHaveBeenCalledTimes(3));
    fireEvent.click(screen.getByRole('button', { name: 'Retarget first tab', exact: true }));
    await act(async () => { release(data.notes); });
    await waitFor(() => expect(screen.getAllByTestId('loaded-note')).toHaveLength(3));
    expect(session().tabs.map((tab) => tab.title)).toEqual([
      data.notes[1].title, data.notes[1].title, data.notes[2].title,
    ]);
  });

  it('also restores separate notes from legacy query-string links', async () => {
    mount(noteTabs().map((tab, index) => ({ ...tab, path: `/KnowledgeWeb?note=${index + 1}` })), 'note-3');
    await waitFor(() => expect(screen.getAllByTestId('loaded-note')).toHaveLength(3));
    expect(session().tabs.map((tab) => tab.title)).toEqual(data.notes.map((note) => note.title));
  });

  it('loads background webs from their own paths while a note is active', async () => {
    data.webs = [{ id: 1, title: 'First Debate' }, { id: 2, title: 'Gospel' }];
    mount([
      ...data.webs.map((web) => ({ id: `web-${web.id}`, kind: 'knowledge-web', path: webDeepLink(web.id, web.title), title: 'Stale name' })),
      noteTabs()[2],
    ], 'note-3');
    await waitFor(() => expect(session().tabs.map((tab) => tab.title)).toEqual([
      'First Debate', 'Gospel', data.notes[2].title,
    ]));
    expect(data.cards).toHaveBeenCalledWith({ web_id: 1 });
    expect(data.cards).toHaveBeenCalledWith({ web_id: 2 });
    expect(screen.getAllByTestId('loaded-note')).toHaveLength(1);
  });

  it('updates a renamed note without relabeling other tabs', async () => {
    mount(noteTabs(), 'note-3');
    await waitFor(() => expect(screen.getAllByTestId('loaded-note')).toHaveLength(3));
    fireEvent.click(screen.getByRole('button', { name: 'Select note-1', exact: true }));
    fireEvent.click(within(screen.getByTestId('workspace-pane-note-1')).getByRole('button', { name: 'Rename test note' }));
    await waitFor(() => expect(session().tabs[0].title).toBe('Renamed note'));
    expect(session().tabs.slice(1).map((tab) => tab.title)).toEqual(data.notes.slice(1).map((note) => note.title));
  });

  it('duplicates the intended note without changing the existing tab identities', async () => {
    mount(noteTabs(), 'note-3');
    await waitFor(() => expect(screen.getAllByTestId('loaded-note')).toHaveLength(3));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate active tab', exact: true }));
    await waitFor(() => expect(screen.getAllByTestId('loaded-note')).toHaveLength(4));
    expect(session().tabs.map((tab) => tab.title)).toEqual([...data.notes.map((note) => note.title), data.notes[2].title]);
    expect(session().tabs[3].path).toBe(noteTabs()[2].path);
    expect(session().tabs[3].id).not.toBe('note-3');
  });
});
