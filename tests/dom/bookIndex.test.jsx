import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import BookIndex from '@/components/notes/BookIndex';
import { buildBookIndex, indexRanges, parseIndexPages, remapIndexEntries } from '@/components/notes/bookIndexModel';
import { setPageTitle, joinBookPages } from '@/components/notes/bookModel';
const update = vi.hoisted(() => vi.fn(async (_id, data) => data));
vi.mock('@/api/desktopClient', () => ({ desktopClient: { entities: { Keyword: { list: async () => [] }, MindNote: { update } } } }));
import NoteEditorPanel from '@/components/knowledgeweb/NoteEditorPanel';
const pages = [setPageTitle('<h2>Training</h2><p>Notes</p>', 'Conscience'), setPageTitle('<h2>Evidence</h2>', 'Abuse'), setPageTitle('', 'Doubt')];

describe('traditional book index', () => {
  it('sorts main entries and indents real headings beneath their page topic', () => {
    const index = buildBookIndex(pages);
    expect(index.map(entry => entry.term)).toEqual(['Abuse', 'Conscience', 'Doubt']);
    expect(index[1].children[0]).toMatchObject({ term: 'Training', parent: 'Conscience', refs: [1] });
  });
  it('validates references and compresses consecutive pages without losing primary markers', () => {
    expect(parseIndexPages('1, 2–3, 2', 3)).toEqual([1, 2, 3]);
    expect(() => parseIndexPages('0, 4', 3)).toThrow();
    expect(() => parseIndexPages('3-1', 3)).toThrow();
    expect(() => parseIndexPages('1, x', 3)).toThrow();
    expect(indexRanges([1, 2, 3, 5], [3])).toEqual([{ start: 1, end: 2, bold: false }, { start: 3, end: 3, bold: true }, { start: 5, end: 5, bold: false }]);
  });
  it('keeps topic references attached to moved pages and removes deleted references', () => {
    const entries = [{ id: 'a', term: 'Test', refs: [1, 3], primary: [3], seeAlso: [] }];
    expect(remapIndexEntries(entries, [2, 0, 1])[0]).toMatchObject({ refs: [1, 2], primary: [1] });
    expect(remapIndexEntries(entries, [0, 1])[0]).toMatchObject({ refs: [1], primary: [] });
  });
  it('opens references and resolves see-also links through the searchable index', () => {
    const go = vi.fn();
    render(<BookIndex open pages={pages} onGoToPage={go} entries={[{ id: 'a', term: 'Anxiety', refs: [2, 3], primary: [], seeAlso: ['Conscience'] }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go to page 2, Anxiety' }));
    expect(go).toHaveBeenCalledWith(1, { kind: 'term', term: 'Anxiety' });
    fireEvent.click(screen.getByRole('button', { name: 'Conscience', exact: true }));
    expect(screen.getByLabelText('Search index').value).toBe('Conscience');
    expect(screen.getByRole('button', { name: 'Go to page 1, Training' })).toBeTruthy();
  });
  it('makes entry text navigate without link styling and preserves heading destinations', () => {
    const go = vi.fn();
    render(<BookIndex open pages={pages} onGoToPage={go} />);
    const entry = screen.getByRole('button', { name: 'Go to Evidence', exact: true });
    expect(entry.className).not.toMatch(/underline|font-bold|text-(?:purple|blue)/);
    fireEvent.click(entry);
    expect(go).toHaveBeenCalledWith(1, { page: 1, kind: 'heading', headingIndex: 0, term: 'Evidence' });
    fireEvent.click(screen.getByRole('button', { name: 'Go to Abuse', exact: true }));
    expect(go).toHaveBeenLastCalledWith(1, { page: 1, kind: 'title' });
  });
  it('turns to the indexed heading and reveals its nested dropdowns, not an earlier prose mention', async () => {
    const body = '<p>Evidence is mentioned here first.</p><details><summary>Outer</summary><div data-type="detailsContent"><details><summary>Inner</summary><div data-type="detailsContent"><h2>Evidence</h2><p>Destination</p></div></details></div></details>';
    const content = joinBookPages([pages[0], pages[2], setPageTitle(body, 'Sources')]);
    render(<MemoryRouter><NoteEditorPanel noteId={901} notes={[{ id: 901, title: 'Conscience', content }]} /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('button-book-index'));
    fireEvent.click(screen.getByRole('button', { name: 'Go to Evidence', exact: true }));
    await waitFor(() => expect(screen.getByTestId('book-page-turn')).toBeTruthy());
    await waitFor(() => expect(document.querySelectorAll('.ProseMirror .toggle-block.is-open')).toHaveLength(2), { timeout: 3000 });
    expect(document.querySelector('.ProseMirror h2').textContent).toBe('Evidence');
    expect(document.querySelector('.bex-spotlight-hit')).toBeNull();
    fireEvent.click(document.querySelector('.ProseMirror .toggle-block__chevron'));
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(document.querySelector('.ProseMirror .toggle-block').classList.contains('is-open')).toBe(false);
  });
  it('also reveals entries on the opening page without requiring a page turn', async () => {
    const first = setPageTitle('<details><summary>Closed</summary><div data-type="detailsContent"><h2>Local heading</h2></div></details>', 'Opening');
    render(<MemoryRouter><NoteEditorPanel noteId={902} notes={[{ id: 902, title: 'Opening', content: joinBookPages([first, pages[1]]) }]} /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('button-book-index'));
    fireEvent.click(screen.getByRole('button', { name: 'Go to Local heading', exact: true }));
    await waitFor(() => expect(document.querySelector('.ProseMirror .toggle-block.is-open')).toBeTruthy());
    expect(screen.queryByTestId('book-page-turn')).toBeNull();
  });
  it('saves curated subentries with the note and restores them on reopening', async () => {
    const note = { id: 999, title: 'Conscience', content: joinBookPages(pages) };
    const view = render(<MemoryRouter><NoteEditorPanel noteId={999} notes={[note]} /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('button-book-index'));
    fireEvent.click(screen.getByText('Edit index'));
    fireEvent.change(screen.getByLabelText('Topic'), { target: { value: 'Treatment' } });
    fireEvent.change(screen.getByLabelText('Main entry (optional)'), { target: { value: 'Anxiety' } });
    fireEvent.change(screen.getByLabelText('Pages (1–3)'), { target: { value: '2–3' } });
    fireEvent.change(screen.getByLabelText('Primary pages (optional)'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add entry' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(999, expect.objectContaining({ book_index_entries: [expect.objectContaining({ term: 'Treatment', parent: 'Anxiety', refs: [2, 3], primary: [3] })] })), { timeout: 2000 });
    const saved = update.mock.calls.at(-1)[1];
    view.unmount();
    render(<MemoryRouter><NoteEditorPanel noteId={999} notes={[{ ...note, ...saved }]} /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('button-book-index'));
    expect(screen.getByRole('button', { name: 'Go to page 3, Treatment' }).className).toContain('font-bold');
  });
});

it('does not parse whole-book headings while the index is closed',()=>{const spy=vi.spyOn(DOMParser.prototype,'parseFromString');try{const view=render(<BookIndex open={false} pages={pages} entries={[]} onGoToPage={()=>{}} onEntriesChange={()=>{}}/>);expect(spy).not.toHaveBeenCalled();view.rerender(<BookIndex open={false} pages={[...pages,'<h2>New</h2>']} entries={[]} onGoToPage={()=>{}} onEntriesChange={()=>{}}/>);expect(spy).not.toHaveBeenCalled();view.rerender(<BookIndex open pages={pages} entries={[]} onGoToPage={()=>{}} onEntriesChange={()=>{}}/>);expect(spy).toHaveBeenCalled();}finally{spy.mockRestore();}});
