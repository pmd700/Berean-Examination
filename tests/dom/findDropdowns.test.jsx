import React from 'react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { render, fireEvent, screen, waitFor, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FindInEditor, getFindState } from '@/components/editor/findInEditor';
import { CollapsibleToggle, ToggleSummary, ToggleContent } from '@/components/editor/CollapsibleToggleExtension';
import EditorFindBar from '@/components/editor/EditorFindBar';
let editor;
let host;
afterEach(() => { editor?.destroy(); host?.remove(); });
const dropdown = (title, body, open = false) => `<details${open ? ' open' : ''}><summary>${title}</summary><div data-type="detailsContent">${body}</div></details>`;
function mount(content) {
  host = document.createElement('div');
  document.body.appendChild(host);
  editor = new Editor({ element: host, extensions: [StarterKit, CollapsibleToggle, ToggleSummary, ToggleContent, FindInEditor], content });
}
const openStates = () => [...host.querySelectorAll('.toggle-block')].map(el => el.classList.contains('is-open'));

describe('find inside dropdowns', () => {
  it('reveals only the active dropdown, restores it on next/previous/clear, and never edits saved content', () => {
    mount(dropdown('One', '<p>faith first</p>') + dropdown('Two', '<p>faith second</p>') + dropdown('Already open', '<p>other</p>', true));
    const saved = editor.getHTML();
    const onUpdate = vi.fn(); editor.on('update', onUpdate);
    editor.commands.setFindTerm('faith');
    expect(openStates()).toEqual([true, false, true]);
    editor.commands.setFindActiveIndex(1);
    expect(openStates()).toEqual([false, true, true]);
    editor.commands.setFindActiveIndex(0);
    expect(openStates()).toEqual([true, false, true]);
    editor.commands.clearFind();
    expect(openStates()).toEqual([false, false, true]);
    expect(editor.getHTML()).toBe(saved);
    expect(onUpdate).not.toHaveBeenCalled();
  });
  it('opens all necessary ancestors, but not a dropdown whose summary is the match', () => {
    mount(dropdown('Outer', dropdown('Inner', '<p>hidden word</p>')) + dropdown('word in summary', '<p>other</p>'));
    editor.commands.setFindTerm('word');
    expect(openStates()).toEqual([true, true, false]);
    editor.commands.setFindActiveIndex(1);
    expect(openStates()).toEqual([false, false, false]);
  });
  it('keeps replaced content visible until another find command, and releases it on a missing query', () => {
    mount(dropdown('One', '<p>faith</p>') + dropdown('Two', '<p>hope</p>'));
    editor.commands.setFindTerm('faith');
    editor.commands.replaceFindMatch('charity');
    expect(editor.getText()).toContain('charity');
    expect(openStates()).toEqual([true, false]);
    editor.commands.setFindTerm('hope');
    expect(openStates()).toEqual([false, true]);
    editor.commands.setFindTerm('missing');
    expect(openStates()).toEqual([false, false]);
  });
  it('scrolls after revealing the active hit even when the new query has the same match count', async () => {
    mount(dropdown('One', '<p>faith</p>') + dropdown('Two', '<p>hope</p>'));
    const scrolled = [];
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function(options) {
      scrolled.push({ text: this.textContent, open: this.closest('.toggle-block').classList.contains('is-open'), options });
    });
    render(<EditorFindBar editor={editor} anchorRef={{ current: host }} onClose={() => {}} />);
    fireEvent.change(screen.getByTestId('input-editor-find'), { target: { value: 'faith' } });
    await waitFor(() => expect(scrolled.at(-1)).toMatchObject({ text: 'faith', open: true, options: { behavior: 'smooth' } }));
    fireEvent.change(screen.getByTestId('input-editor-find'), { target: { value: 'hope' } });
    await waitFor(() => expect(scrolled.at(-1)).toMatchObject({ text: 'hope', open: true }));
    expect(openStates()).toEqual([false, true]);
    act(() => editor.commands.clearFind());
  });
});


describe('manual control while finding', () => {
  it('lets the user close a revealed dropdown until the next arrow press', () => {
    mount(dropdown('One', '<p>faith first faith second</p>'));
    editor.commands.setFindTerm('faith');
    const button = host.querySelector('.toggle-block__chevron');
    fireEvent.click(button);
    expect(openStates()).toEqual([false]);
    editor.commands.insertContent('A');
    expect(openStates()).toEqual([false]);
    editor.commands.setFindActiveIndex(1);
    expect(openStates()).toEqual([true]);
    fireEvent.click(button);
    expect(openStates()).toEqual([false]);
  });

  it('does not scroll or reveal the next dropdown when the active word is deleted', async () => {
    mount(dropdown('One', '<p>faith first</p>') + dropdown('Two', '<p>faith second</p>'));
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    render(<EditorFindBar editor={editor} anchorRef={{ current: host }} onClose={() => {}} />);
    fireEvent.change(screen.getByTestId('input-editor-find'), { target: { value: 'faith' } });
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    scroll.mockClear();
    const match = getFindState(editor.state).matches[0];
    act(() => editor.view.dispatch(editor.state.tr.delete(match.from, match.to)));
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(scroll).not.toHaveBeenCalled();
    expect(openStates()).toEqual([true, false]);
    fireEvent.click(screen.getByTestId('button-editor-find-next'));
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    expect(openStates()).toEqual([false, true]);
  });
});


describe('editing with find still open', () => {
  it('keeps the caret, typing, rich paste and undo in a temporarily revealed nested body', () => {
    mount(dropdown('Outer', dropdown('Inner', '<p>faith here</p>')) + dropdown('Other', '<p>faith elsewhere</p>'));
    editor.commands.setFindTerm('faith');
    const match = getFindState(editor.state).matches[0];
    const navigationId = getFindState(editor.state).navigationId;
    editor.commands.setTextSelection(match.from + 2);
    expect(editor.state.selection.from).toBe(match.from + 2);
    editor.commands.insertContent('!');
    expect(editor.state.selection.from).toBe(match.from + 3);
    expect(editor.state.selection.$from.parent.textContent).toBe('fa!ith here');
    editor.view.pasteHTML('<strong>PASTED</strong>', new Event('paste'));
    expect(editor.state.selection.$from.parent.textContent).toBe('fa!PASTEDith here');
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
    expect(getFindState(editor.state).navigationId).toBe(navigationId);
    expect(openStates()).toEqual([true, true, false]);
    expect(editor.state.doc.firstChild.attrs.open).toBe(false);
    expect(editor.state.doc.firstChild.lastChild.firstChild.attrs.open).toBe(false);
    editor.commands.undo();
    editor.commands.redo();
    expect(editor.state.selection.$from.parent.textContent).toBe('fa!PASTEDith here');
  });

  it('allows continued typing after deleting the last result without closing its body', () => {
    mount(dropdown('Outer', dropdown('Inner', '<p>faith</p>')));
    editor.commands.setFindTerm('faith');
    const match = getFindState(editor.state).matches[0];
    editor.commands.setTextSelection(match);
    editor.commands.deleteSelection();
    expect(getFindState(editor.state).matches).toHaveLength(0);
    expect(openStates()).toEqual([true, true]);
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
    editor.commands.insertContent('new text');
    expect(editor.state.selection.$from.parent.textContent).toBe('new text');
    editor.commands.clearFind();
    expect(openStates()).toEqual([false, false]);
    expect(editor.state.selection.$from.parent.textContent).toBe('Outer');
  });

  it('respects manual closure, including after position changes, until explicit navigation', () => {
    mount('<p>Before</p>' + dropdown('Outer', dropdown('Inner', '<p>faith here</p>')));
    editor.commands.setFindTerm('faith');
    host.querySelector('.toggle-block__chevron').click();
    expect(openStates()).toEqual([false, true]);
    editor.commands.setTextSelection(1);
    editor.commands.insertContent('Added before ');
    const match = getFindState(editor.state).matches[0];
    editor.commands.setTextSelection(match.from);
    expect(editor.state.selection.$from.parent.textContent).toBe('Outer');
    expect(openStates()).toEqual([false, true]);
    editor.commands.setFindActiveIndex(0);
    editor.commands.setTextSelection(match.from);
    expect(editor.state.selection.from).toBe(match.from);
    expect(openStates()).toEqual([true, true]);
  });

  it('still blocks a caret in an unrevealed child of a revealed parent', () => {
    mount(dropdown('Outer', '<p>faith here</p>' + dropdown('Hidden child', '<p>faith there</p>')));
    editor.commands.setFindTerm('faith');
    const second = getFindState(editor.state).matches[1];
    editor.commands.setTextSelection(second.from);
    expect(openStates()).toEqual([true, false]);
    expect(editor.state.selection.$from.parent.textContent).toBe('Hidden child');
  });
});
