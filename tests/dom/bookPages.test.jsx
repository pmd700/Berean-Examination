import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const updateMindNote = vi.hoisted(() => vi.fn(async (_id, updates) => updates));

vi.mock('@/api/desktopClient', () => ({
  desktopClient: {
    entities: {
      Keyword: { list: async () => [] },
      MindNote: {
        update: updateMindNote,
        delete: vi.fn(async () => undefined),
      },
    },
  },
}));

import BookSurface from '@/components/notes/BookSurface';
import BookOverview from '@/components/notes/BookOverview';
import NoteEditorPanel from '@/components/knowledgeweb/NoteEditorPanel';
import TabBar from '@/components/tabs/TabBar';
import { ActiveTabProvider, WorkspaceTabsProvider } from '@/lib/WorkspaceTabs';
import {
  PAGE_BREAK,
  getPageTitle,
  setPageTitle,
  splitBookPages,
} from '@/components/notes/bookModel';

afterEach(() => {
  window.localStorage.removeItem('bex_workspace_tabs_v1');
  window.localStorage.removeItem('text_size');
  document.documentElement.removeAttribute('style');
});

describe('Spotlight navigation in books', () => {
  it('turns to a body match on a later page before starting its reveal', async () => {
    const content = ['<p>Opening</p>', '<p>Middle</p>', '<details><summary>Evidence</summary><div data-type="detailsContent"><p>A clear conscience</p></div></details>'].join(PAGE_BREAK);
    render(<MemoryRouter><NoteEditorPanel noteId={88} notes={[{ id: 88, title: 'Research', content }]}
      spotlightQuery="conscience" spotlightField="body" spotlightPage={2} spotlightToken="page-three" /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('book-page-turn')).toBeTruthy());
    expect(document.querySelector('.bex-spotlight-hit')).toBeNull();
    await waitFor(() => expect(document.querySelector('.bex-spotlight-hit')?.textContent).toBe('conscience'), { timeout: 2500 });
    expect(screen.getByTestId('book-surface').querySelector('.ProseMirror').textContent).toContain('conscience');
    expect(document.querySelector('.ProseMirror .toggle-block.is-open')).toBeTruthy();
  });

  it('finds later pages from older links without a page number', async () => {
    const content = ['<p>Opening</p>', '<p>Hidden destination</p>'].join(PAGE_BREAK);
    render(<MemoryRouter><NoteEditorPanel noteId={89} notes={[{ id: 89, title: 'Legacy', content }]}
      spotlightQuery="destination" spotlightField="body" spotlightToken="old-link" /></MemoryRouter>);
    await waitFor(() => expect(document.querySelector('.bex-spotlight-hit')?.textContent).toBe('destination'), { timeout: 2500 });
  });
});

/**
 * The page surface: the cut line at the foot of every note, and what pressing it
 * does. A note that has never been split still shows the line — it is page one
 * of a book nobody has started — so the check that it is there matters as much
 * as the check that pressing it adds a page.
 */

/** A book that keeps its own pages, the way the note editor does. */
function Book({ initial = '', onContent }) {
  const [content, setContent] = React.useState(initial);
  const [pageIndex, setPageIndex] = React.useState(0);
  const pages = React.useMemo(() => splitBookPages(content), [content]);

  return (
    <MemoryRouter>
      <BookSurface
        noteId={7}
        pages={pages}
        pageIndex={Math.min(pageIndex, pages.length - 1)}
        onPagesChange={(nextPages, nextIndex) => {
          const joined = nextPages.join(PAGE_BREAK);
          setContent(joined);
          onContent?.(joined);
          if (Number.isInteger(nextIndex)) setPageIndex(nextIndex);
        }}
        onPageIndexChange={setPageIndex}
      />
    </MemoryRouter>
  );
}

describe('the cut line at the foot of a page', () => {
  it('appears on a note that has never been split', async () => {
    render(<Book initial="<p>An ordinary note</p>" />);
    await waitFor(() => expect(screen.getByTestId('page-cut-line')).toBeTruthy());
  });

  it('turns a one-page note into a two-page book when pressed', async () => {
    const seen = [];
    render(<Book initial="<p>Page one</p>" onContent={value => seen.push(value)} />);

    fireEvent.click(await screen.findByTestId('page-cut-line'));

    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(splitBookPages(seen[seen.length - 1])).toEqual(['<p>Page one</p>', '']);
  });

  it('lands the reader on the new page, not the one they left', async () => {
    render(<Book initial="<p>Page one</p>" />);
    fireEvent.click(await screen.findByTestId('page-cut-line'));
    await waitFor(() => expect(screen.getByTestId('book-page-turn')).toBeTruthy());
  });

  it('changes the owning workspace icon from a notepad to a book automatically', async () => {
    const tabId = 'note-book-status';
    const path = '/notes/92-icon-test';
    window.localStorage.setItem('bex_workspace_tabs_v1', JSON.stringify({
      activeId: tabId,
      tabs: [{ id: tabId, kind: 'notes', path, title: 'Icon Test', isBook: false }],
    }));

    render(
      <MemoryRouter>
        <WorkspaceTabsProvider initialPath={path}>
          <TabBar />
          <ActiveTabProvider isActive tabId={tabId}>
            <NoteEditorPanel
              noteId={92}
              notes={[{ id: 92, title: 'Icon Test', content: '<p>Page one</p>' }]}
            />
          </ActiveTabProvider>
        </WorkspaceTabsProvider>
      </MemoryRouter>,
    );

    const iconType = () => screen.getByTestId(`workspace-tab-icon-${tabId}`).getAttribute('data-document-type');

    await screen.findByTestId(`workspace-tab-icon-${tabId}`);
    expect(iconType()).toBe('note');

    fireEvent.click(await screen.findByTestId('page-cut-line'));

    // Re-queried each time, never held: the icon is keyed on which document it
    // is, so becoming a book replaces the element rather than editing it. A
    // reference taken beforehand is left pointing at a node no longer on screen,
    // whose attribute will read "note" forever.
    await waitFor(() => expect(iconType()).toBe('book'));
  });
});

describe('footnote numbering across a book', () => {
  const footnote = id => `<sup data-footnote-id="${id}" data-footnote-text="<p>note</p>"></sup>`;

  it('continues onto the next page instead of restarting at one', async () => {
    // Page one carries two footnotes, so page two's first note is number three.
    const content = [
      `<p>First${footnote('fn-1')} and second${footnote('fn-2')}</p>`,
      `<p>Third${footnote('fn-3')}</p>`,
    ].join(PAGE_BREAK);

    const { container } = render(<Book initial={content} />);

    // Page one starts the count.
    await waitFor(() => {
      const numbers = Array.from(container.querySelectorAll('.ProseMirror sup[data-footnote-id]'))
        .map(node => node.getAttribute('data-footnote-number'));
      expect(numbers).toEqual(['1', '2']);
    });

    fireEvent.click(screen.getByTestId('page-cut-line'));

    // Page two carries on from it.
    await waitFor(() => {
      const numbers = Array.from(container.querySelectorAll('.ProseMirror sup[data-footnote-id]'))
        .map(node => node.getAttribute('data-footnote-number'));
      expect(numbers).toEqual(['3']);
    });
  });

  it('prints the same numbers at the foot of the page as in the prose', async () => {
    const content = [
      `<p>First${footnote('fn-1')} and second${footnote('fn-2')}</p>`,
      `<p>Third${footnote('fn-3')}</p>`,
    ].join(PAGE_BREAK);

    render(<Book initial={content} />);
    fireEvent.click(await screen.findByTestId('page-cut-line'));

    await waitFor(() => expect(screen.getByTestId('footnote-entry-3')).toBeTruthy());
  });
});

describe('the overview', () => {
  const PAGES = ['<p>One</p>', '<p>Two</p>', '<p>Three</p>'];

  function mountOverview(overrides = {}) {
    return render(
      <BookOverview
        open
        title="On the Resurrection"
        pages={PAGES}
        pageIndex={1}
        onClose={() => {}}
        onGoToPage={() => {}}
        onAddPage={() => {}}
        onMovePage={() => {}}
        onDeletePages={() => {}}
        onExportPages={() => {}}
        {...overrides}
      />,
    );
  }

  it('shows a card for every page', () => {
    mountOverview();
    expect(screen.getByTestId('page-card-1')).toBeTruthy();
    expect(screen.getByTestId('page-card-2')).toBeTruthy();
    expect(screen.getByTestId('page-card-3')).toBeTruthy();
  });

  it('makes the card itself the thing you drag, with no grip drawn on it', () => {
    mountOverview();
    const card = screen.getByTestId('page-card-1');

    // A page card is plainly an object on a board; a grip stuck in its corner
    // only repeats what the card already says. The drag lives on the card.
    expect(card.querySelector('[data-testid^="handle-page-"]')).toBeNull();
    expect(card.getAttribute('aria-roledescription')).toBe('sortable');
    expect(card.className).toContain('cursor-grab');
  });

  it('leaves a single-page book undraggable', () => {
    mountOverview({ pages: ['<p>Only</p>'] });
    const card = screen.getByTestId('page-card-1');
    expect(card.className).not.toContain('cursor-grab');
  });

  it('adds a page from the overview action row', () => {
    const added = vi.fn();
    mountOverview({ onAddPage: added });

    fireEvent.click(screen.getByTestId('button-pages-add'));

    expect(added).toHaveBeenCalledTimes(1);
  });

  it('starts below the workspace tab bar so its action buttons stay visible', () => {
    mountOverview();
    expect(screen.getByTestId('book-overview').style.top).toBe('var(--bex-tabbar-height, 0px)');
  });

  it('offers nothing to delete or export until pages are picked', () => {
    mountOverview();
    expect(screen.getByTestId('button-pages-delete').disabled).toBe(true);
    expect(screen.getByTestId('button-pages-export').disabled).toBe(true);
  });

  it('hands the selected pages to delete, by index', () => {
    const deleted = [];
    mountOverview({ onDeletePages: indices => deleted.push(indices) });

    fireEvent.click(screen.getByTestId('checkbox-page-1'));
    fireEvent.click(screen.getByTestId('checkbox-page-3'));
    fireEvent.click(screen.getByTestId('button-pages-delete'));

    expect(deleted).toEqual([[0, 2]]);
  });

  it('hands the selected pages to export, in page order', () => {
    const exported = [];
    mountOverview({ onExportPages: indices => exported.push(indices) });

    fireEvent.click(screen.getByTestId('checkbox-page-3'));
    fireEvent.click(screen.getByTestId('checkbox-page-2'));
    fireEvent.click(screen.getByTestId('button-pages-export'));

    expect(exported).toEqual([[1, 2]]);
  });

  it('selects and clears every page at once', () => {
    mountOverview();
    fireEvent.click(screen.getByTestId('button-pages-select-all'));
    expect(screen.getByTestId('button-pages-delete').disabled).toBe(false);

    fireEvent.click(screen.getByTestId('button-pages-select-all'));
    expect(screen.getByTestId('button-pages-delete').disabled).toBe(true);
  });

  it('opens a page when its card is pressed', () => {
    const opened = [];
    mountOverview({ onGoToPage: index => opened.push(index) });
    fireEvent.click(screen.getByTestId('button-page-open-3'));
    expect(opened).toEqual([2]);
  });
});

describe('page titles', () => {
  it('remeasures a wrapped title when the shared text size reaches maximum', async () => {
    render(
      <MemoryRouter>
        <NoteEditorPanel
          noteId={38}
          notes={[{
            id: 38,
            title: 'Blasphemy Against The Holy Spirit',
            content: '<p>Body</p>',
          }]}
        />
      </MemoryRouter>,
    );

    const title = await screen.findByTestId('input-note-title');
    let measuredHeight = 56;
    Object.defineProperty(title, 'scrollHeight', {
      configurable: true,
      get: () => measuredHeight,
    });
    measuredHeight = 112;

    fireEvent.change(screen.getByTestId('note-text-size'), { target: { value: '5' } });

    await waitFor(() => expect(title.style.height).toBe('112px'));
  });

  it('spins the page counter like a wheel and snaps to the chosen page', async () => {
    const content = [
      setPageTitle('<p>One</p>', 'Opening'),
      setPageTitle('<p>Two</p>', 'Context'),
      setPageTitle('<p>Three</p>', 'Evidence'),
      setPageTitle('<p>Four</p>', 'Conclusion'),
    ].join(PAGE_BREAK);

    render(
      <MemoryRouter>
        <NoteEditorPanel
          noteId={40}
          notes={[{ id: 40, title: 'Opening', content }]}
        />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByTestId('button-page-wheel'));
    expect(screen.getByTestId('page-wheel-picker')).toBeTruthy();
    expect(screen.getByTestId('page-wheel-option-3').textContent).toContain('Evidence');

    fireEvent.wheel(screen.getByTestId('page-wheel-list'), { deltaY: 100 });

    await waitFor(
      () => expect(screen.getByTestId('text-page-indicator').textContent).toBe('2 / 4'),
      { timeout: 700 },
    );
    await waitFor(
      () => expect(screen.getByTestId('page-wheel-option-2').getAttribute('aria-selected')).toBe('true'),
      { timeout: 700 },
    );
  });

  it('turns the final forward arrow purple and uses it to create a page', async () => {
    updateMindNote.mockClear();
    const content = [
      setPageTitle('<p>One</p>', 'Opening'),
      setPageTitle('<p>Two</p>', 'Ending'),
    ].join(PAGE_BREAK);

    render(
      <MemoryRouter>
        <NoteEditorPanel
          noteId={39}
          notes={[{ id: 39, title: 'Opening', content }]}
        />
      </MemoryRouter>,
    );

    const next = await screen.findByTestId('button-page-next');
    expect(next.getAttribute('data-creates-page')).toBe('false');
    fireEvent.click(next);
    await waitFor(() => expect(screen.getByTestId('text-page-indicator').textContent).toBe('2 / 2'));
    expect(next.getAttribute('data-creates-page')).toBe('true');
    expect(next.getAttribute('aria-label')).toBe('Create the next page');
    expect(next.className).toContain('text-violet-300');

    await waitFor(() => expect(screen.queryByTestId('book-page-turn')).toBeNull(), { timeout: 1000 });
    fireEvent.click(next);

    await waitFor(() => expect(screen.getByTestId('text-page-indicator').textContent).toBe('3 / 3'));
    await waitFor(() => expect(updateMindNote).toHaveBeenCalled(), { timeout: 2000 });
    expect(splitBookPages(updateMindNote.mock.calls.at(-1)[1].content).length).toBe(3);
  });

  it('appends a page from the overview without leaving the page being read', async () => {
    updateMindNote.mockClear();
    const content = [
      setPageTitle('<p>First body</p>', 'The Book'),
      setPageTitle('<p>Second body</p>', 'Second Page'),
    ].join(PAGE_BREAK);

    render(
      <MemoryRouter>
        <NoteEditorPanel
          noteId={41}
          notes={[{ id: 41, title: 'The Book', content }]}
        />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByTestId('button-page-next'));
    await waitFor(() => expect(screen.getByTestId('input-note-title').value).toBe('Second Page'));
    fireEvent.click(screen.getByTestId('button-page-overview'));
    fireEvent.click(await screen.findByTestId('button-pages-add'));

    await waitFor(() => expect(screen.getByTestId('book-overview').textContent).toContain('3 pages'));
    await waitFor(() => expect(updateMindNote).toHaveBeenCalled(), { timeout: 2000 });
    const updates = updateMindNote.mock.calls.at(-1)[1];
    expect(splitBookPages(updates.content).length).toBe(3);
    expect(screen.getByTestId('page-card-2').textContent).toContain('open');
  });

  it('renaming page two leaves page one and the book title unchanged', async () => {
    updateMindNote.mockClear();
    const content = [
      setPageTitle('<p>First body</p>', 'The Book'),
      setPageTitle('<p>Second body</p>', 'Second Page'),
      setPageTitle('<p>Third body</p>', 'Third Page'),
    ].join(PAGE_BREAK);

    render(
      <MemoryRouter>
        <NoteEditorPanel
          noteId={42}
          notes={[{ id: 42, title: 'The Book', content }]}
        />
      </MemoryRouter>,
    );

    expect((await screen.findByTestId('input-note-title')).value).toBe('The Book');
    fireEvent.click(screen.getByTestId('button-page-next'));
    await waitFor(() => expect(screen.getByTestId('input-note-title').value).toBe('Second Page'));

    fireEvent.change(screen.getByTestId('input-note-title'), { target: { value: 'Renamed Second Page' } });

    await waitFor(() => expect(updateMindNote).toHaveBeenCalled(), { timeout: 2000 });
    const updates = updateMindNote.mock.calls.at(-1)[1];
    const savedPages = splitBookPages(updates.content);
    expect(updates.title).toBeUndefined();
    expect(getPageTitle(savedPages[0])).toBe('The Book');
    expect(getPageTitle(savedPages[1])).toBe('Renamed Second Page');
    expect(getPageTitle(savedPages[2])).toBe('Third Page');

    fireEvent.click(screen.getByTestId('button-page-previous'));
    await waitFor(() => expect(screen.getByTestId('input-note-title').value).toBe('The Book'));

    updateMindNote.mockClear();
    fireEvent.change(screen.getByTestId('input-note-title'), { target: { value: 'Renamed Book' } });
    await waitFor(() => expect(updateMindNote).toHaveBeenCalled(), { timeout: 2000 });
    const firstPageUpdates = updateMindNote.mock.calls.at(-1)[1];
    expect(firstPageUpdates.title).toBe('Renamed Book');
    expect(getPageTitle(splitBookPages(firstPageUpdates.content)[0])).toBe('Renamed Book');
  });
});

describe('the first-page index', () => {
  it('starts closed, indexes every page, and fans through distant pages', async () => {
    const content = [
      setPageTitle('<p>Opening argument</p>', 'The Book'),
      setPageTitle('<p>Historical setting</p>', 'Background'),
      setPageTitle('<p>Primary evidence</p>', 'The Evidence'),
      setPageTitle('<p>Final synthesis</p>', 'Conclusion'),
    ].join(PAGE_BREAK);

    render(
      <MemoryRouter>
        <NoteEditorPanel
          noteId={77}
          notes={[{ id: 77, title: 'The Book', content }]}
        />
      </MemoryRouter>,
    );

    const toggle = await screen.findByTestId('button-book-index');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByTestId('book-index')).toBeNull();

    fireEvent.click(toggle);
    expect(await screen.findByTestId('book-index')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Index' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go to page 2, Background' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go to page 3, The Evidence' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go to page 4, Conclusion' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Go to page 4, Conclusion' }));

    const turn = await screen.findByTestId('book-page-turn');
    expect(turn.getAttribute('data-multi-page')).toBe('true');
    expect(screen.getAllByTestId('book-turn-sheet').length).toBeGreaterThan(1);
    await waitFor(() => expect(screen.getByTestId('input-note-title').value).toBe('Conclusion'));
    expect(screen.queryByTestId('button-book-index')).toBeNull();
    await waitFor(() => expect(screen.queryByTestId('book-index')).toBeNull());
  });
});
