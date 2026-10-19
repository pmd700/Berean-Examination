import React, { useRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { MemoryRouter } from 'react-router-dom';
import StarterKit from '@tiptap/starter-kit';
import Footnote, { collectFootnotes } from '@/components/editor/FootnoteExtension';
import StudyPageFind, { findStudyPageRanges } from '@/components/study/StudyPageFind';
import GlobalSearch from '@/components/search/GlobalSearch';
import TEXT_EDITOR_MACHINERY from '@/components/editor/TEXT_EDITOR_MACHINERY';
import MarkdownRenderer from '@/components/editor/MarkdownRenderer';
import { LOCAL_FIND_SHORTCUT_REQUEST, requestPageFindShortcut } from '@/lib/localFindShortcut';

const state = vi.hoisted(() => ({ active: true, kind: 'study' }));
vi.mock('@/lib/WorkspaceTabs', () => ({
  TAB_KINDS: { HOME: 'home' },
  useIsActiveTab: () => state.active,
  useWorkspaceTabs: () => ({ tabs: [], activeTab: { kind: state.kind } }),
}));
vi.mock('@/lib/platform/entities', () => ({ platformEntities: new Proxy({}, { get: () => ({ list: async () => [] }) }) }));
vi.mock('@/api/desktopClient', () => ({ desktopClient: { entities: { Keyword: { list: async () => [] } } } }));

let editor, host;
afterEach(() => { editor?.destroy(); host?.remove(); editor = null; host = null; state.active = true; state.kind = 'study'; });

function Harness() {
  const root = useRef(null);
  return <><GlobalSearch /><div ref={root}>
    <p data-testid="scripture">The living <strong>word</strong> endures.</p>
    <aside><p data-testid="commentary">My commentary on the living word.</p></aside>
    <StudyPageFind rootRef={root} />
  </div></>;
}
function press(target = document.body, shiftKey = false, control = false) {
  fireEvent.keyDown(target, { key: 'f', metaKey: !control, ctrlKey: control, shiftKey });
}

describe('Chapter Study find shortcuts', () => {
  it('routes Cmd+F to page search, searches Scripture and commentary across marks, cycles, and toggles closed', async () => {
    render(<Harness />);
    const editorRequest = vi.fn();
    window.addEventListener(LOCAL_FIND_SHORTCUT_REQUEST, editorRequest);
    try {
      press();
      const input = screen.getByRole('textbox', { name: 'Find in this chapter study' });
      expect(document.activeElement).toBe(input);
      expect(screen.queryByTestId('global-spotlight')).toBeNull();
      expect(editorRequest).not.toHaveBeenCalled();
      fireEvent.change(input, { target: { value: 'LIVING word' } });
      expect(screen.getByRole('status').textContent).toBe('1/2');
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(screen.getByRole('status').textContent).toBe('2/2');
      fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
      expect(screen.getByRole('status').textContent).toBe('1/2');
      press(input);
      expect(screen.queryByRole('search', { name: 'Find in Chapter Study' })).toBeNull();
      expect(screen.getByTestId('scripture').innerHTML).toBe('The living <strong>word</strong> endures.');
    } finally { window.removeEventListener(LOCAL_FIND_SHORTCUT_REQUEST, editorRequest); }
  });

  it('opens global search on Shift+Cmd+F outside text boxes', async () => {
    render(<Harness />);
    press(document.body, true);
    expect(await screen.findByTestId('global-spotlight')).toBeTruthy();
    expect(screen.queryByRole('search', { name: 'Find in Chapter Study' })).toBeNull();
  });

  it('lets Shift+Cmd/Ctrl+F reach the focused editor footnote keymap without opening either search', async () => {
    render(<Harness />);
    host = document.createElement('div'); document.body.appendChild(host);
    editor = new Editor({ element: host, extensions: [StarterKit, Footnote], content: '<p>My idea.</p>' });
    act(() => { editor.commands.setTextSelection(4); editor.view.focus(); });
    press(editor.view.dom, true, !/Mac/.test(navigator.platform || ''));
    await waitFor(() => expect(collectFootnotes(editor.state.doc)).toHaveLength(1));
    expect(screen.queryByTestId('global-spotlight')).toBeNull();
    expect(screen.queryByRole('search', { name: 'Find in Chapter Study' })).toBeNull();
  });

  it('does not claim page find from a background Study tab and retains editor-local find elsewhere', () => {
    state.active = false; state.kind = 'note';
    render(<Harness />);
    expect(requestPageFindShortcut()).toBe(false);
    const claim = event => event.preventDefault();
    window.addEventListener(LOCAL_FIND_SHORTCUT_REQUEST, claim);
    try { press(document.body, false, true); expect(screen.queryByTestId('global-spotlight')).toBeNull(); }
    finally { window.removeEventListener(LOCAL_FIND_SHORTCUT_REQUEST, claim); }
  });

  it('creates and saves a footnote in the actual Study text editor and renders its body outside editing', async () => {
    const api = {};
    const view = render(<MemoryRouter><GlobalSearch /><TEXT_EDITOR_MACHINERY bare footnotes content="<p>A claim.</p>" onChange={() => {}} onEditorReady={value => { api.editor = value; }} /></MemoryRouter>);
    await waitFor(() => expect(api.editor).toBeTruthy());
    expect(screen.queryByTestId('page-foot')).toBeNull();
    act(() => { api.editor.commands.setTextSelection(4); api.editor.view.focus(); });
    press(api.editor.view.dom, true, !/Mac/.test(navigator.platform || ''));
    await screen.findByTestId('footnote-composer');
    const note = collectFootnotes(api.editor.state.doc)[0];
    act(() => { api.editor.commands.updateFootnote(note.id, '<p>Supporting source.</p>'); });
    expect(screen.getByTestId('footnote-entry-1').textContent).toContain('Supporting source.');
    expect(screen.queryByTestId('page-cut-line')).toBeNull();
    expect(screen.queryByTestId('global-spotlight')).toBeNull();
    const saved = api.editor.getHTML();
    view.unmount();
    render(<MemoryRouter><MarkdownRenderer content={saved} sourcesById={{}} /></MemoryRouter>);
    expect(screen.getByRole('list', { name: 'Footnotes' }).textContent).toContain('Supporting source.');
  });

  it('counts visible prose only, preserves inline markup, and excludes controls and collapsed material', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>living <em>word</em></p><button>living word</button><p hidden>living word</p><details><summary>Other</summary><p>living word</p></details><p>living word</p>';
    document.body.appendChild(root);
    try {
      const ranges = findStudyPageRanges(root, 'living word');
      expect(ranges.map(range => range.toString())).toEqual(['living word', 'living word']);
    } finally { root.remove(); }
  });
});
