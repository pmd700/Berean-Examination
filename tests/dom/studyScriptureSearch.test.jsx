import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Study from '@/pages/Study';
import * as scriptureReferences from '@/lib/scriptureReferences';
import * as scriptureClient from '@/lib/scriptureClient';

vi.mock('@/api/desktopClient', () => ({
  desktopClient: {
    entities: {
      Keyword: { list: vi.fn(async () => []) },
    },
    localOwner: {
      get: vi.fn(async () => ({ id: 'owner-1', is_local_owner: true })),
    },
  },
}));

vi.mock('@/lib/platform/entities', () => ({
  platformEntities: {
    StudyChapter: {
      filter: vi.fn(async () => []),
      list: vi.fn(async () => []),
    },
    Annotation: { filter: vi.fn(async () => []) },
    Drawing: { filter: vi.fn(async () => []) },
    TextHighlight: { filter: vi.fn(async () => []) },
  },
}));

import { WorkspaceTabsProvider } from '@/lib/WorkspaceTabs';

describe('Study scripture search purple pill', () => {
  beforeEach(() => {
    window.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    window.bexDesktop = {
      isDesktop: true,
      getScriptureStatus: vi.fn(async () => ({ ok: true, status: { configured: true } })),
      getLocalOwner: vi.fn(async () => ({ id: 'owner-1', is_local_owner: true })),
    };
  });

  afterEach(() => {
    delete window.bexDesktop;
    delete window.IntersectionObserver;
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
});
