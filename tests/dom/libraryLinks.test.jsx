import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ notes: vi.fn(), webs: vi.fn(), timelines: vi.fn(), getKey: () => null }));
vi.mock('@/api/desktopClient', () => ({ desktopClient: { entities: {
  Keyword: { list: async () => [] },
  MindNote: { listPage: api.notes },
  KnowledgeWeb: { listPage: api.webs },
  Timegraph: { listPage: api.timelines },
} } }));
vi.mock('@/lib/PrivateWebContext', () => ({ usePrivateWeb: () => ({ getKey: api.getKey }) }));
import TEXT_EDITOR_MACHINERY from '@/components/editor/TEXT_EDITOR_MACHINERY';
import MarkdownRenderer from '@/components/editor/MarkdownRenderer';
import { getSlashState, filterSlashCommands } from '@/components/editor/slashCommands';
import { libraryLinkHref, libraryLinkPath } from '@/lib/libraryLinks';
import { copyNoteLink } from '@/lib/noteLink';

let editor;
function Location() {
  const location = useLocation();
  return <output data-testid="route">{location.pathname}{location.search}{location.hash}</output>;
}
function mount(content = '<p>Before /link after</p>') {
  return render(<MemoryRouter><Location /><TEXT_EDITOR_MACHINERY bare content={content} onChange={() => {}} onEditorReady={value => { editor = value; }} /></MemoryRouter>);
}
async function openPicker() {
  await waitFor(() => expect(editor).toBeTruthy());
  // Place the caret just after /link, with unrelated text on both sides.
  act(() => editor.commands.setTextSelection(13));
  expect(getSlashState(editor.state).menu.query).toBe('link');
  expect(filterSlashCommands('link').map(item => item.id)).toEqual(['link']);
  fireEvent.keyDown(editor.view.dom, { key: 'Enter' });
  await screen.findByRole('dialog', { name: 'Link to your library' });
  await waitFor(() => expect(screen.queryByText('Loading your library…')).toBeNull());
  return screen.getByRole('combobox', { name: 'Search your library' });
}

beforeEach(() => {
  editor = null;
  vi.spyOn(window, 'open').mockImplementation(() => null);
  api.notes.mockReset().mockImplementation(async ({ cursor }) => cursor === null
    ? { records: [{ id: 1, title: 'Alpha note' }], nextCursor: 1 }
    : { records: [{ id: 8, title: 'Second page note' }], nextCursor: null });
  api.webs.mockReset().mockResolvedValue({ records: [{ id: 2, title: 'Beta web' }], nextCursor: null });
  api.timelines.mockReset().mockResolvedValue({ records: [{ id: 3, title: 'Gamma timeline' }], nextCursor: null });
});

describe('library link slash command', () => {
  it('pastes a copied note reference as a hyperlink and retains its exact page after saving', async () => {
    const payload = {};
    document.execCommand = vi.fn(() => {
      const event = new Event('copy', { cancelable: true });
      event.clipboardData = { setData: (type, text) => { payload[type] = text; } };
      window.dispatchEvent(event); return true;
    });
    try {
      expect(copyNoteLink({ id: 71, title: 'Updated View' }, 9, 'Sales')).toBe(true);
      const view = mount('<p>Reference: </p>');
      await waitFor(() => expect(editor).toBeTruthy());
      act(() => editor.commands.focus('end'));
      fireEvent.paste(editor.view.dom, { clipboardData: { getData: type => payload[type] || '', items: [], files: [] } });
      const anchor = view.container.querySelector('.ProseMirror a');
      expect(anchor?.textContent).toBe('Updated View — Sales');
      expect(anchor?.getAttribute('href')).toBe('/notes/updated-view-71?page=10');
      fireEvent.click(anchor);
      expect(screen.getByTestId('route').textContent).toBe('/notes/updated-view-71?page=10');
      expect(window.open).not.toHaveBeenCalled();
      const saved = editor.getHTML(); view.unmount();
      const reopened = mount(saved);
      await waitFor(() => expect(reopened.container.querySelector('.ProseMirror a')?.getAttribute('href')).toBe('/notes/updated-view-71?page=10'));
    } finally { delete document.execCommand; }
  });

  it('shows Link in the slash popup and opens its search on a menu click', async () => {
    mount('<p>/</p>');
    await waitFor(() => expect(editor).toBeTruthy());
    editor.view.coordsAtPos = () => ({ top: 100, bottom: 120, left: 100, right: 100 });
    act(() => editor.commands.setTextSelection(2));
    fireEvent.mouseDown(await screen.findByTestId('button-slash-link'));
    expect(await screen.findByRole('dialog', { name: 'Link to your library' })).toBeTruthy();
  });

  it.each([
    ['Alpha note', '/notes/1'],
    ['Beta web', '/knowledge-webs/2'],
    ['Gamma timeline', '/timegraphs/3'],
    ['Second page note', '/notes/8'],
  ])('searches and inserts %s at the original caret, then opens it inside BEX', async (title, href) => {
    const view = mount();
    const input = await openPicker();
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: title.toUpperCase() } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByTestId('library-link-picker')).toBeNull());
    const link = view.container.querySelector('.ProseMirror a');
    expect(link.textContent).toBe(title);
    expect(link.getAttribute('href')).toBe(href);
    expect(editor.getText()).toBe(`Before ${title}  after`);
    expect(api.notes).toHaveBeenCalledWith(expect.objectContaining({ cursor: 1 }));
    fireEvent.click(link);
    expect(screen.getByTestId('route').textContent).toBe(href);
    expect(window.open).not.toHaveBeenCalled();
    const saved = editor.getHTML();
    view.unmount();
    const reopened = mount(saved);
    await waitFor(() => expect(reopened.container.querySelector('.ProseMirror a')?.getAttribute('href')).toBe(href));
  });

  it('supports arrow selection, insertion by click, and undo', async () => {
    const view = mount();
    const input = await openPicker();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const chosen = screen.getAllByRole('option')[1];
    expect(chosen.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(chosen);
    await waitFor(() => expect(view.container.querySelector('.ProseMirror a')).toBeTruthy());
    // Undo scrolls the caret; jsdom has no text-range layout engine.
    editor.view.setProps({ handleScrollToSelection: () => true });
    act(() => editor.commands.undo());
    expect(view.container.querySelector('.ProseMirror a')).toBeNull();
    expect(editor.getText()).toContain('Before');
    expect(editor.getText()).toContain('after');
  });

  it('lets an internal link be renamed without changing its destination', async () => {
    const view = mount('<p><a href="/notes/1">Old label</a></p>');
    await waitFor(() => expect(view.container.querySelector('.ProseMirror a')).toBeTruthy());
    fireEvent.mouseOver(view.container.querySelector('.ProseMirror a'));
    fireEvent.mouseDown(await screen.findByRole('button', { name: 'Edit link' }));
    expect((await screen.findByTestId('input-link-url')).value).toBe('/notes/1');
    fireEvent.change(screen.getByTestId('input-link-text'), { target: { value: 'New label' } });
    fireEvent.click(screen.getByTestId('button-set-link'));
    await waitFor(() => expect(view.container.querySelector('.ProseMirror a').textContent).toBe('New label'));
    expect(view.container.querySelector('.ProseMirror a').getAttribute('href')).toBe('/notes/1');
  });

  it('maps the insertion point when the document changes while search is open', async () => {
    const view = mount();
    const input = await openPicker();
    act(() => editor.commands.insertContentAt(1, 'Prefix '));
    fireEvent.change(input, { target: { value: 'Alpha' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(view.container.querySelector('.ProseMirror a')).toBeTruthy());
    expect(editor.getText()).toBe('Prefix Before Alpha note  after');
  });

  it('allows an empty result and Escape without inserting anything', async () => {
    const view = mount();
    const input = await openPicker();
    fireEvent.change(input, { target: { value: 'nonexistent' } });
    expect(screen.getByText('No matching items.')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('library-link-picker')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('library-link-picker')).toBeNull());
    expect(view.container.querySelector('.ProseMirror a')).toBeNull();
  });

  it('reports failed collections, retains available results, and can retry', async () => {
    api.webs.mockRejectedValueOnce(new Error('Database unavailable'));
    mount();
    await openPicker();
    expect(screen.getByRole('alert').textContent).toContain('Knowledge web');
    expect(screen.getByRole('option', { name: /Alpha note/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByRole('option', { name: /Beta web/ })).toBeTruthy();
  });

  it('does not expose the stored name of a locked private web', async () => {
    api.webs.mockResolvedValue({ records: [{ id: 2, title: 'Hidden title', is_private: true, enc_name: 'ciphertext' }], nextCursor: null });
    mount();
    await openPicker();
    expect(screen.queryByText('Hidden title')).toBeNull();
    expect(screen.getByRole('option', { name: /Private knowledge web \(2\)/ })).toBeTruthy();
  });
});

describe('portable internal link destinations', () => {
  it('uses ids and restricts navigation to local document routes', () => {
    expect(libraryLinkHref({ kind: 'note', id: 12, title: 'Changed title' })).toBe('/notes/12');
    expect(libraryLinkPath('/notes/12')).toBe('/notes/12');
    expect(libraryLinkPath('/knowledge-webs/changed-name-12')).toBe('/knowledge-webs/changed-name-12');
    expect(libraryLinkPath('https://example.com/notes/12', 'https://local.test/')).toBeNull();
    expect(libraryLinkPath('//example.com/notes/12', 'https://local.test/')).toBeNull();
    expect(libraryLinkPath('javascript:alert(1)')).toBeNull();
    expect(() => libraryLinkHref({ kind: 'note', id: '../1' })).toThrow();
  });

  it.each([
    '<p>Read <a href="/notes/1">Alpha note</a></p>',
    'Read [Alpha note](/notes/1)',
  ])('opens saved HTML and Markdown previews in BEX', content => {
    render(<MemoryRouter><Location /><MarkdownRenderer content={content} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('link', { name: 'Alpha note' }));
    expect(screen.getByTestId('route').textContent).toBe('/notes/1');
    expect(window.open).not.toHaveBeenCalled();
  });
});
