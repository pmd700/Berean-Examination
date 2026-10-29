import React from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { WorkspaceTabsProvider, useWorkspaceTabs } from '@/lib/WorkspaceTabs';
import TabWorkspace from '@/components/tabs/TabWorkspace';

// Exercise the real Study footer, support pages, router and restored workspace.
// Only data access is stubbed; no live Vault or email app is touched.
vi.mock('@/lib/localOwner', () => ({
  readLocalOwner: vi.fn(async () => ({ id: 'owner-1', is_local_owner: true })),
}));
vi.mock('@/lib/scriptureClient', async importOriginal => ({
  ...await importOriginal(),
  fetchScriptureBatch: vi.fn(async () => [{ data: { content: [{
    type: 'tag', name: 'para', attrs: { style: 'p' }, items: [
      { type: 'tag', name: 'verse', attrs: { number: '1' } },
      { type: 'text', text: 'The study passage.' },
    ],
  }] } }]),
}));
vi.mock('@/api/desktopClient', () => ({
  desktopClient: {
    entities: {
      Keyword: { list: vi.fn(async () => []) },
      AppMetadata: { list: vi.fn(async () => []) },
    },
    localOwner: {
      get: vi.fn(async () => ({ id: 'owner-1', is_local_owner: true })),
    },
  },
}));

vi.mock('@/lib/platform/entities', () => ({
  platformEntities: {
    ChapterArtCatalog: { list: vi.fn(async () => []) },
    Keyword: { list: vi.fn(async () => []) },
    StudyChapter: {
      filter: vi.fn(async () => []),
      list: vi.fn(async () => []),
      create: vi.fn(async data => ({ id: 42, ...data })),
      update: vi.fn(async (id, data) => ({ id, ...data })),
    },
    Annotation: { filter: vi.fn(async () => []), list: vi.fn(async () => []) },
    Drawing: { filter: vi.fn(async () => []) },
    TextHighlight: { filter: vi.fn(async () => []) },
  },
}));


vi.mock('@/pages.config', async () => ({
  pagesConfig: {
    mainPage: 'Study',
    Pages: {
      Study: (await import('@/pages/Study')).default,
      ContactFeedback: (await import('@/pages/ContactFeedback')).default,
      SourcesLicenses: (await import('@/pages/SourcesLicenses')).default,
    },
  },
}));

const studyPath = '/Study?q=John%208';
function SessionStatus() {
  const { tabs, activeId } = useWorkspaceTabs();
  const location = useLocation();
  return <output data-testid="session-status">{JSON.stringify({ tabs, activeId, path: location.pathname + location.search })}</output>;
}
function status() { return JSON.parse(screen.getByTestId('session-status').textContent); }
function mount() {
  localStorage.setItem('bex_workspace_tabs_v1', JSON.stringify({
    tabs: [
      { id: 'study', kind: 'study', title: 'John 8', path: studyPath },
      { id: 'other', kind: 'study', title: 'Other study', path: '/Study' },
    ], activeId: 'study',
  }));
  return render(<MemoryRouter initialEntries={[studyPath]}><WorkspaceTabsProvider initialPath={studyPath}>
    <SessionStatus /><TabWorkspace />
  </WorkspaceTabsProvider></MemoryRouter>);
}
function activePane() { return document.querySelector('[data-pane-active="true"]'); }
function footerLink(name) { return Array.from(activePane().querySelectorAll('.bex-study-footer a')).find(link => link.textContent === name); }

beforeEach(() => {
  localStorage.clear();
  window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
});
afterEach(() => { localStorage.clear(); delete window.IntersectionObserver; });

describe('Study support footer navigation with a restored workspace', () => {
  it.each([
    ['Feedback & Contact', '/ContactFeedback', 'Email David'],
    ['Sources & Licenses', '/SourcesLicenses', 'Sources & Licenses'],
  ])('opens %s without reloading and Back returns to the same study route', async (label, destination, heading) => {
    mount();
    await waitFor(() => expect(footerLink(label)).toBeTruthy());
    // A router Link cancels native document navigation; an ordinary anchor
    // regresses this even if its href is correct.
    expect(fireEvent.click(footerLink(label))).toBe(false);
    await screen.findByRole('heading', { name: heading, exact: true });
    expect(status().path).toBe(destination);
    expect(status().tabs.find(tab => tab.id === 'study').path).toBe(destination);
    expect(status().tabs.find(tab => tab.id === 'other').path).toBe('/Study');
    fireEvent.click(screen.getByRole('button', { name: 'Back', exact: true }));
    await waitFor(() => expect(footerLink(label)).toBeTruthy());
    expect(status().path).toBe(studyPath);
    expect(status().tabs).toHaveLength(2);
  });

  it('returns from Sources to Bible Study without another document reload', async () => {
    mount();
    await waitFor(() => expect(footerLink('Sources & Licenses')).toBeTruthy());
    fireEvent.click(footerLink('Sources & Licenses'));
    const link = await screen.findByRole('link', { name: 'Return to Bible Study' });
    expect(fireEvent.click(link)).toBe(false);
    await waitFor(() => expect(footerLink('Feedback & Contact')).toBeTruthy());
    expect(status().path).toBe('/Study');
    expect(status().tabs).toHaveLength(2);
  });
});
