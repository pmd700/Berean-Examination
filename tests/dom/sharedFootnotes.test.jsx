import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CardEditor from '@/components/knowledgeweb/CardEditor';
import TimegraphDescriptionEditor from '@/components/timegraph/TimegraphDescriptionEditor';
import TEXT_EDITOR_MACHINERY from '@/components/editor/TEXT_EDITOR_MACHINERY';
import { collectFootnotes } from '@/components/editor/FootnoteExtension';
import { flushPendingEditorSaves } from '@/lib/pendingEditorSaves';

vi.mock('@/api/desktopClient', () => ({ desktopClient: { entities: { Keyword: { list: async () => [] } } } }));
// jsdom has no Range geometry; ProseMirror measures the inline caret on focus.
// These tests exercise editing/persistence, not layout.
if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => [];
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 });
beforeEach(() => localStorage.clear());

function outerEditor() {
  return document.querySelector('.bex-card-text-editor .ProseMirror, [data-testid="shared-writing"] .ProseMirror').editor;
}
async function addNote() {
  const editor = outerEditor();
  act(() => { editor.commands.setTextSelection(5); editor.view.focus(); });
  // ProseMirror maps Mod to Cmd on macOS and Ctrl on Windows/Linux.
  const mac = /Mac|iP(hone|ad|od)/.test(navigator.platform || '');
  fireEvent.keyDown(editor.view.dom, { key: 'f', shiftKey: true, metaKey: mac, ctrlKey: !mac });
  const panel = await screen.findByTestId('footnote-composer');
  await act(async () => { panel.querySelector('.ProseMirror').editor.commands.insertContent('Original source.'); });
  fireEvent.click(screen.getByTestId('button-footnote-save'));
  await waitFor(() => expect(screen.queryByTestId('footnote-composer')).toBeNull());
  expect(screen.getByTestId('footnote-entry-1').textContent).toContain('Original source.');
  expect(screen.queryByTestId('page-cut-line')).toBeNull();
  return editor;
}
async function editNote() {
  fireEvent.click(screen.getByTestId('button-footnote-edit-1'));
  expect(screen.queryByTestId('footnote-composer')).toBeNull();
  const panel = screen.getByTestId('footnote-entry-1');
  expect(panel.textContent).toContain('Original source.');
  await act(async () => { panel.querySelector('.ProseMirror').editor.commands.setContent('<p>Revised source.</p>', true); });
  fireEvent.click(screen.getByRole('button', { name: 'Done editing footnote' }));
  expect(panel.querySelector('.ProseMirror')).toBeNull();
  expect(screen.getByTestId('footnote-entry-1').textContent).toContain('Revised source.');
}

describe('footnotes throughout the shared writing machinery', () => {
  it('finishes pending card writing before Escape closes the editor', async () => {
    let release;
    const save = vi.fn(() => new Promise(resolve => { release = resolve; }));
    const close = vi.fn();
    render(<MemoryRouter><CardEditor initialMode="fullscreen" card={{ id: 1, title: 'Card', description: '<p>Original</p>', tags: [] }} allCards={[]} onUpdate={save} onClose={close} onDelete={() => {}} /></MemoryRouter>);
    await act(async () => outerEditor().commands.setContent('<p>Last edit before Escape.</p>', true));
    fireEvent.keyDown(outerEditor().view.dom, { key: 'Escape' });
    expect(save).toHaveBeenCalledWith(1, { description: '<p>Last edit before Escape.</p>' });
    expect(close).not.toHaveBeenCalled();
    await act(async () => release());
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('registers card debounces with the existing refresh save-flushing machinery', async () => {
    const save = vi.fn(async () => {});
    render(<MemoryRouter><CardEditor card={{ id: 1, title: 'Card', description: '<p>Original</p>', tags: [] }} allCards={[]} onUpdate={save} onClose={() => {}} onDelete={() => {}} /></MemoryRouter>);
    await act(async () => outerEditor().commands.setContent('<p>Saved before refresh.</p>', true));
    await act(async () => expect(await flushPendingEditorSaves()).toBe(true));
    expect(save).toHaveBeenCalledWith(1, { description: '<p>Saved before refresh.</p>' });
    expect(await flushPendingEditorSaves()).toBe(false);
  });
  it.each(['Compact', 'Expanded', 'Full screen'])('adds, edits and persists card footnotes in %s mode', async mode => {
    const saved = vi.fn();
    const card = { id: 1, title: 'Card', description: '<p>Some writing here.</p>', tags: [] };
    const mount = record => render(<MemoryRouter><CardEditor card={record} allCards={[]} onUpdate={saved} onClose={() => {}} onDelete={() => {}} /></MemoryRouter>);
    const view = mount(card);
    fireEvent.click(screen.getByRole('button', { name: mode, exact: true }));
    const editor = await addNote();
    await editNote();
    const id = collectFootnotes(editor.state.doc)[0].id;
    await waitFor(() => expect(saved.mock.calls.at(-1)?.[1]?.description).toContain('Revised source.'));
    const description = saved.mock.calls.at(-1)[1].description;
    view.unmount();
    mount({ ...card, description });
    await waitFor(() => expect(screen.getByTestId('footnote-entry-1').textContent).toContain('Revised source.'));
    expect(collectFootnotes(outerEditor().state.doc)[0].id).toBe(id);
    fireEvent.click(screen.getByTestId('button-footnote-delete-1'));
    expect(collectFootnotes(outerEditor().state.doc)).toHaveLength(0);
  });

  it('uses the same editable footnotes in a timeline description', async () => {
    let saved;
    render(<MemoryRouter><TimegraphDescriptionEditor content="<p>Timeline writing.</p>" onChange={html => { saved = html; }} /></MemoryRouter>);
    await addNote();
    fireEvent.click(screen.getByRole('button', { name: 'Full screen', exact: true }));
    await editNote();
    expect(saved).toContain('data-footnote-text="<p>Revised source.</p>"');
  });

  it('preserves references by default while keeping nested citation editors free of recursive footnotes', async () => {
    const html = '<p>A claim<sup data-footnote-id="existing" data-footnote-text="&lt;p&gt;Saved source.&lt;/p&gt;"></sup></p>';
    const view = render(<MemoryRouter><div data-testid="shared-writing"><TEXT_EDITOR_MACHINERY content={html} onChange={() => {}} /></div></MemoryRouter>);
    expect(collectFootnotes(outerEditor().state.doc)[0].text).toBe('<p>Saved source.</p>');
    expect(screen.getByTestId('footnote-entry-1').textContent).toContain('Saved source.');
    view.unmount();
    const api = {};
    render(<MemoryRouter><TEXT_EDITOR_MACHINERY nested content="<p>Citation body</p>" onChange={() => {}} onEditorReady={editor => { api.editor = editor; }} /></MemoryRouter>);
    await waitFor(() => expect(api.editor).toBeTruthy());
    expect(api.editor.commands.addFootnote).toBeUndefined();
    expect(screen.queryByTestId('page-foot')).toBeNull();
  });

  it('edits an existing footnote by clicking its text, autosaves formatting, and closes on Escape', async () => {
    const api = {};
    let saved;
    render(<MemoryRouter><TEXT_EDITOR_MACHINERY content={'<p>A claim<sup data-footnote-id="existing" data-footnote-text="&lt;p&gt;Saved source.&lt;/p&gt;"></sup></p>'} onChange={html => { saved = html; }} onEditorReady={editor => { api.editor = editor; }} /></MemoryRouter>);
    fireEvent.click(screen.getByText('Saved source.'));
    const entry = screen.getByTestId('footnote-entry-1');
    expect(screen.queryByTestId('footnote-composer')).toBeNull();
    const inline = entry.querySelector('.ProseMirror');
    await waitFor(() => expect(document.activeElement).toBe(inline));
    await act(async () => inline.editor.commands.setContent('<p><em>Updated source.</em></p>', true));
    expect(saved).toContain('Updated source.');
    expect(collectFootnotes(api.editor.state.doc)[0].text).toContain('<em>Updated source.</em>');
    fireEvent.keyDown(inline, { key: 'Escape' });
    expect(entry.querySelector('.ProseMirror')).toBeNull();
    expect(entry.querySelector('em').textContent).toBe('Updated source.');
    expect(screen.queryByTestId('footnote-composer')).toBeNull();
  });
});
