import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Study from '@/pages/Study';
import { platformEntities } from '@/lib/platform/entities';
import * as scriptureClient from '@/lib/scriptureClient';
import { FAVORITE_BIBLE_KEY } from '@/lib/favoriteBible';

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

import { ActiveTabProvider, useWorkspaceTabs, WorkspaceTabsProvider } from '@/lib/WorkspaceTabs';

function ActiveStudy() {
  const { activeId } = useWorkspaceTabs();
  return <ActiveTabProvider isActive tabId={activeId}><Study /></ActiveTabProvider>;
}

describe('Study scripture search purple pill', () => {
  let chapters;

  beforeEach(() => {
    localStorage.clear();
    chapters = [];
    platformEntities.StudyChapter.filter.mockImplementation(async query => chapters.filter(record => Object.entries(query).every(([key, value]) => record[key] === value)));
    platformEntities.StudyChapter.list.mockImplementation(async () => chapters);
    platformEntities.StudyChapter.create.mockImplementation(async data => { const record = { id: chapters.length + 1, ...data }; chapters.push(record); return record; });
    platformEntities.StudyChapter.update.mockImplementation(async (id, patch) => { const record = chapters.find(record => record.id === id); if (!record) throw new Error('Missing chapter'); Object.assign(record, patch); return record; });
    window.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    window.bexDesktop = {
      isDesktop: true,
      getScriptureStatus: vi.fn(async () => ({ ok: true, status: { configured: true } })),
      getLocalOwner: vi.fn(async () => ({ ok: true, owner: { id: 'owner-1', is_local_owner: true } })),
    };
  });

  afterEach(() => {
    localStorage.clear();
    delete window.bexDesktop;
    delete window.IntersectionObserver;
  });

  it('reads the saved favorite before its first startup query and keeps the two size controls side by side', async () => {
    const favorite = { id: 'a761ca71e0b3ddcf-01', abbreviation: 'NASB', name: 'New American Standard Bible 2020' };
    window.bexDesktop.getLocalOwner.mockResolvedValue({ ok: true, owner: { id: 'owner-1', is_local_owner: true, [FAVORITE_BIBLE_KEY]: favorite } });
    const fetch = vi.spyOn(scriptureClient, 'fetchScriptureBatch').mockResolvedValue([{ data: { content: [{ type: 'tag', name: 'para', attrs: { style: 'p' }, items: [{ type: 'tag', name: 'verse', attrs: { number: '1' } }, { type: 'text', text: 'Startup favorite passage.' }] }] } }]);
    render(<MemoryRouter initialEntries={['/Study?q=Romans%201']}><WorkspaceTabsProvider initialPath="/Study?q=Romans%201"><ActiveStudy /></WorkspaceTabsProvider></MemoryRouter>);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(fetch.mock.calls.every(([, options]) => options.bibleId === favorite.id)).toBe(true);
    await screen.findByTestId('reading-text-size-controls');
    expect(screen.getByTestId('reading-text-size-controls').className).toContain('grid-cols-2');
    expect(screen.getByRole('slider', { name: 'Scripture text size' })).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Notes text size' })).toBeTruthy();
    expect(document.querySelector('.bex-study').classList.contains('bex-study-spatial')).toBe(true);
    expect(document.querySelector('.bex-study-footer')).toBeTruthy();
  });

  it('keeps the old hover reader in document flow rather than the spatial canvas layout', async () => {
    window.bexDesktop.getLocalOwner.mockResolvedValue({ ok: true, owner: { id: 'owner-1', is_local_owner: true, scripture_annotation_display: 'hover' } });
    vi.spyOn(scriptureClient, 'fetchScriptureBatch').mockResolvedValue([{ data: { content: [{ type: 'tag', name: 'para', attrs: { style: 'p' }, items: [{ type: 'tag', name: 'verse', attrs: { number: '1' } }, { type: 'text', text: 'Hover reader passage.' }] }] } }]);
    render(<MemoryRouter initialEntries={['/Study?q=Romans%201']}><WorkspaceTabsProvider initialPath="/Study?q=Romans%201"><ActiveStudy /></WorkspaceTabsProvider></MemoryRouter>);
    await screen.findByTestId('reading-text-size-controls');
    await waitFor(() => expect(document.querySelector('.bex-study').classList.contains('bex-study-spatial')).toBe(false));
    expect(document.querySelector('.bex-scripture-viewport')).toBeNull();
  });

  it('preserves an explicit commentary edition despite a different saved favorite', async () => {
    window.bexDesktop.getLocalOwner.mockResolvedValue({ ok: true, owner: { id: 'owner-1', is_local_owner: true, [FAVORITE_BIBLE_KEY]: { id: '317e03834065a236-01', abbreviation: 'BSB' } } });
    const edition = 'a761ca71e0b3ddcf-01';
    const fetch = vi.spyOn(scriptureClient, 'fetchScriptureBatch').mockResolvedValue([{ data: { content: [{ type: 'tag', name: 'para', attrs: { style: 'p' }, items: [{ type: 'tag', name: 'verse', attrs: { number: '1' } }, { type: 'text', text: 'Specific source passage.' }] }] } }]);
    const path = `/Study?q=Romans%201&annotation_id=7&version=API%3A${edition}`;
    render(<MemoryRouter initialEntries={[path]}><WorkspaceTabsProvider initialPath={path}><ActiveStudy /></WorkspaceTabsProvider></MemoryRouter>);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(fetch.mock.calls.every(([, options]) => options.bibleId === edition)).toBe(true);
  });

  it('renders ScriptureSearch pill in Study view and removes redundant Romans 3 BSB header', async () => {
    vi.spyOn(scriptureClient, 'fetchScriptureBatch').mockResolvedValue([
      {
        data: {
          content: [
            {
              type: 'tag',
              name: 'para',
              attrs: { style: 'p' },
              items: [
                { type: 'tag', name: 'verse', attrs: { number: '1' } },
                { type: 'text', text: 'What advantage then has the Jew?' },
              ],
            },
          ],
        },
      },
    ]);

    render(
      <MemoryRouter initialEntries={['/Study?q=Romans%203']}>
        <WorkspaceTabsProvider>
          <Study />
        </WorkspaceTabsProvider>
      </MemoryRouter>
    );

    // The purple pill search bar is present on the page
    const searchInput = await screen.findByLabelText('Search scripture');
    expect(searchInput).toBeTruthy();

    // Type query and submit
    fireEvent.change(searchInput, { target: { value: 'Romans 3' } });
    fireEvent.submit(searchInput.closest('form'));

    // Wait for the scripture view to load
    await waitFor(() => {
      expect(screen.getByText('advantage')).toBeTruthy();
    });
    expect(document.body.textContent).toContain('What advantage then has the Jew?');

    // The search bar in the card now has the query
    const cardSearchInput = screen.getByLabelText('Search scripture');
    expect(cardSearchInput.value).toBe('Romans 3');

    // The redundant chapter title in red "Romans 3 BSB" was removed from top of card
    const h2Elements = document.querySelectorAll('h2');
    const titles = Array.from(h2Elements).map((el) => el.textContent);
    expect(titles.some((t) => t.includes('Romans 3 BSB'))).toBe(false);
  });

  it('renders individual verse number badges and footnote popover chips without text contamination', async () => {
    vi.spyOn(scriptureClient, 'fetchScriptureBatch').mockResolvedValue([
      {
        data: {
          content: [
            {
              name: 'para',
              type: 'tag',
              attrs: { style: 's1' },
              items: [{ type: 'text', text: 'God Remains Faithful' }],
            },
            {
              name: 'para',
              type: 'tag',
              attrs: { style: 'p' },
              items: [
                {
                  name: 'char',
                  type: 'tag',
                  attrs: { style: 'v' },
                  items: [{ type: 'text', text: '1' }],
                },
                {
                  type: 'text',
                  text: 'What advantage then has the Jew?',
                },
                {
                  name: 'char',
                  type: 'tag',
                  attrs: { style: 'v' },
                  items: [{ type: 'text', text: '2' }],
                },
                {
                  type: 'text',
                  text: 'Much in every way. First of all, they were entrusted with the words of God.',
                },
                {
                  name: 'note',
                  type: 'tag',
                  attrs: { style: 'f', caller: '+' },
                  items: [
                    { name: 'char', type: 'tag', attrs: { style: 'fr' }, items: [{ type: 'text', text: '3:2 ' }] },
                    { name: 'char', type: 'tag', attrs: { style: 'ft' }, items: [{ type: 'text', text: 'Or the oracles of God.' }] },
                  ],
                },
              ],
            },
          ],
        },
      },
    ]);

    render(
      <MemoryRouter initialEntries={['/Study?q=Romans%203']}>
        <WorkspaceTabsProvider>
          <Study />
        </WorkspaceTabsProvider>
      </MemoryRouter>
    );

    const searchInput = await screen.findByLabelText('Search scripture');
    fireEvent.change(searchInput, { target: { value: 'Romans 3' } });
    fireEvent.submit(searchInput.closest('form'));

    await waitFor(() => {
      expect(screen.getByText('advantage')).toBeTruthy();
    });

    // Both verse 1 and verse 2 badges exist
    expect(screen.getByLabelText('Open Bible Hub commentary for verse 1')).toBeTruthy();
    expect(screen.getByLabelText('Open Bible Hub commentary for verse 2')).toBeTruthy();

    // The footnote marker button exists
    const footnoteBtn = screen.getByLabelText('Footnote + for Romans 3:2');
    expect(footnoteBtn).toBeTruthy();

    // Clicking the footnote button toggles the popover
    fireEvent.click(footnoteBtn);
    expect(screen.getByText('Or the oracles of God.')).toBeTruthy();

    // Verse 2 clean text does NOT have the footnote body embedded into its words
    expect(document.body.textContent).not.toContain('words of God.3:2 Or the oracles of God.');
  });
});
