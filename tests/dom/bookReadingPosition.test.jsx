import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PAGE_BREAK, setPageTitle } from '@/components/notes/bookModel';
import { flushPendingEditorSaves } from '@/lib/pendingEditorSaves';
const saved = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('@/api/desktopClient', () => ({ desktopClient: { entities: {
  Keyword: { list: async () => [] }, MindNote: { update: saved.update },
} } }));
import NoteEditorPanel from '@/components/knowledgeweb/NoteEditorPanel';
import PageWheelPicker from '@/components/notes/PageWheelPicker';

const pages = Array.from({ length: 12 }, (_, i) => setPageTitle(`<p>Writing on page ${i + 1}</p>`, `Page ${i + 1}`));
let note;
beforeEach(() => {
  note = { id: 50, title: 'Book', content: pages.join(PAGE_BREAK), last_page_index: 8 };
  saved.update.mockReset().mockImplementation(async (_id, patch) => Object.assign(note, patch));
});
function mount(props = {}) {
  return render(<MemoryRouter><NoteEditorPanel noteId={50} notes={[{ ...note }]} {...props} /></MemoryRouter>);
}
describe('book reading position', () => {
  it('clicks page 10 directly, persists the page with writing, and reopens there after a refresh', async () => {
    const change = vi.fn();
    const view = mount({ onPageChange: change });
    expect((await screen.findByTestId('text-page-indicator')).textContent).toBe('9 / 12');
    fireEvent.click(screen.getByTestId('button-page-wheel'));
    fireEvent.click(screen.getByTestId('page-wheel-option-10'));
    await waitFor(() => expect(screen.getByTestId('text-page-indicator').textContent).toBe('10 / 12'));
    expect(screen.getByTestId('book-surface').querySelector('.ProseMirror').textContent).toContain('Writing on page 10');
    expect(change).toHaveBeenLastCalledWith({ noteId: 50, index: 9 });
    await act(async () => { await flushPendingEditorSaves(); });
    expect(note.last_page_index).toBe(9);
    expect(note.content).toBe(pages.join(PAGE_BREAK));
    view.unmount();
    mount();
    expect((await screen.findByTestId('text-page-indicator')).textContent).toBe('10 / 12');
  });
  it('honors a resume page ahead of the remembered page and updates an already open book', async () => {
    const view = mount({ requestedPage: 2 });
    expect((await screen.findByTestId('text-page-indicator')).textContent).toBe('3 / 12');
    view.rerender(<MemoryRouter><NoteEditorPanel noteId={50} notes={[note]} requestedPage={9} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('text-page-indicator').textContent).toBe('10 / 12'));
    await act(async () => { await flushPendingEditorSaves(); });
    expect(note.last_page_index).toBe(9);
  });
  it('keeps the latest requested page when a previous turn is still running', async () => {
    mount();
    fireEvent.click(await screen.findByTestId('button-page-wheel'));
    fireEvent.click(screen.getByTestId('page-wheel-option-10'));
    fireEvent.click(screen.getByTestId('button-page-wheel'));
    fireEvent.click(screen.getByTestId('page-wheel-option-12'));
    await waitFor(() => expect(screen.getByTestId('text-page-indicator').textContent).toBe('12 / 12'), { timeout: 2400 });
    expect(screen.getByTestId('book-surface').querySelector('.ProseMirror').textContent).toContain('Writing on page 12');
  });
  it('clamps remembered positions after pages are removed and keeps different books separate', async () => {
    note.last_page_index = 99;
    const view = mount();
    expect((await screen.findByTestId('text-page-indicator')).textContent).toBe('12 / 12');
    view.rerender(<MemoryRouter><NoteEditorPanel noteId={51} notes={[{ id: 51, title: 'Other', content: pages.slice(0, 3).join(PAGE_BREAK), last_page_index: 1 }]} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('text-page-indicator').textContent).toBe('2 / 3'));
  });
  it('cancels the old book turn when switching notes before it lands', async () => {
    const view = mount();
    fireEvent.click(await screen.findByTestId('button-page-wheel'));
    fireEvent.click(screen.getByTestId('page-wheel-option-4'));
    expect(screen.getByTestId('book-page-turn')).toBeTruthy();
    view.rerender(<MemoryRouter><NoteEditorPanel noteId={51} notes={[{ id: 51, title: 'Other', content: pages.slice(0, 4).join(PAGE_BREAK), last_page_index: 1 }]} /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('text-page-indicator').textContent).toBe('2 / 4'));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 850)); });
    expect(screen.getByTestId('text-page-indicator').textContent).toBe('2 / 4');
    expect(screen.getByTestId('book-surface').querySelector('.ProseMirror').textContent).toContain('Writing on page 2');
  });
});

it('ignores intermediate smooth-scroll rows rather than choosing the wrong page', async () => {
  const select = vi.fn();
  render(<PageWheelPicker pages={pages} pageIndex={8} onSelect={select} />);
  fireEvent.click(screen.getByTestId('button-page-wheel'));
  await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
  fireEvent.wheel(screen.getByTestId('page-wheel-list'), { deltaY: 100 });
  const list = screen.getByTestId('page-wheel-list');
  list.scrollTop = 8 * 40;
  fireEvent.scroll(list);
  await waitFor(() => expect(select).toHaveBeenLastCalledWith(9));
  expect(select).toHaveBeenCalledTimes(1);
});
