import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { QuoteBoundaries } from '@/components/editor/QuoteBoundaryExtension';
import { ListBackspace } from '@/components/editor/ListBackspaceExtension';
import { ListExitBoundaries } from '@/components/editor/ListExitBoundaryExtension';
import { CollapsibleToggle, ToggleSummary, ToggleContent } from '@/components/editor/CollapsibleToggleExtension';
import { getSlashState } from '@/components/editor/slashCommands';

vi.mock('@/api/desktopClient', () => ({
  desktopClient: { entities: { Keyword: { list: async () => [] } } },
}));
import TEXT_EDITOR_MACHINERY from '@/components/editor/TEXT_EDITOR_MACHINERY';

let editor;
afterEach(() => { act(() => editor?.destroy()); editor = null; });
function open(content) {
  editor = new Editor({
    extensions: [StarterKit.configure({ hardBreak: false }), QuoteBoundaries, ListBackspace, ListExitBoundaries,
      CollapsibleToggle.configure({ persist: true }), ToggleSummary, ToggleContent],
    content,
    editorProps: { handleScrollToSelection: () => true },
  });
}
function caret(text, offset = 0) {
  let target;
  editor.state.doc.descendants((node, pos) => {
    if (target === undefined && node.isText && node.text.includes(text)) target = pos + node.text.indexOf(text) + offset;
  });
  expect(target).toBeDefined();
  editor.commands.setTextSelection(target);
}
function emptyQuoteCaret() {
  let target;
  editor.state.doc.descendants((node, pos, parent) => {
    if (node.type.name === 'paragraph' && !node.content.size && parent?.type.name === 'blockquote') target = pos + 1;
  });
  expect(target).toBeDefined();
  editor.commands.setTextSelection(target);
}
function key(key, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
  return editor.view.someProp('handleKeyDown', handler => handler(editor.view, event)) === true;
}
async function shared(content) {
  render(<MemoryRouter><TEXT_EDITOR_MACHINERY bare noteAnnotations content={content} onChange={() => {}} onEditorReady={value => { editor = value; }} /></MemoryRouter>);
  await waitFor(() => expect(editor).toBeTruthy());
  editor.setOptions({ editorProps: { handleScrollToSelection: () => true } });
}

describe('quote typing boundaries', () => {
  it('deletes a blank line after a quote instead of adding it back inside the quote', async () => {
    const source = '<blockquote><p><em>First quotation</em></p></blockquote><p></p><h2>1 Timothy 3:2</h2><blockquote><p>Next quotation</p></blockquote>';
    await shared(source);
    const blankPos = editor.state.doc.firstChild.nodeSize + 1;
    act(() => { editor.commands.setTextSelection(blankPos); expect(key('Backspace')).toBe(true); });
    expect(editor.getHTML()).toBe(source.replace('</blockquote><p></p>', '</blockquote>'));
    expect(editor.state.doc.firstChild.childCount).toBe(1);
    expect(editor.state.selection.$from.parent.textContent).toBe('First quotation');
    expect(editor.state.selection.$from.parentOffset).toBe('First quotation'.length);
    const result = editor.getJSON();
    act(() => { editor.commands.undo(); }); expect(editor.getHTML()).toBe(source);
    act(() => { editor.commands.redo(); }); expect(editor.getJSON()).toEqual(result);
  });

  it('lets a second Backspace delete the blank line after the first removes its quote formatting', () => {
    open('<blockquote><p>Quote</p><p></p></blockquote>');
    emptyQuoteCaret(); key('Backspace');
    expect(editor.getHTML()).toBe('<blockquote><p>Quote</p></blockquote><p></p>');
    key('Backspace');
    expect(editor.getHTML()).toBe('<blockquote><p>Quote</p></blockquote>');
    expect(editor.state.selection.$from.parentOffset).toBe(5);
  });

  it('removes an unquoted blank line within a dropdown without removing or merging its surrounding quotes', () => {
    open('<details open><summary>Title</summary><div data-type="detailsContent"><blockquote><p>Quote</p></blockquote><p></p><blockquote><p>Next</p></blockquote></div></details>');
    caret('Quote', 5);
    editor.commands.setTextSelection(editor.state.selection.from + 3);
    expect(editor.state.selection.$from.parent.content.size).toBe(0);
    key('Backspace');
    expect(editor.state.doc.firstChild.lastChild.childCount).toBe(2);
    expect(editor.state.doc.firstChild.lastChild.child(0).childCount).toBe(1);
    expect(editor.isActive('detailsContent')).toBe(true);
  });
  it('starts a normal line after a quote in the shared editor, with atomic undo/redo', async () => {
    await shared('<blockquote><p><em>The quotation.</em></p></blockquote><ul><li><p>Explanation</p></li></ul>');
    const original = editor.getJSON();
    act(() => { caret('The quotation.', 14); expect(key('Enter')).toBe(true); });
    expect(editor.getHTML()).toBe('<blockquote><p><em>The quotation.</em></p></blockquote><p></p><ul><li><p>Explanation</p></li></ul>');
    expect(editor.isActive('blockquote')).toBe(false);
    const result = editor.getJSON();
    act(() => { editor.commands.undo(); });
    expect(editor.getJSON()).toEqual(original);
    act(() => { editor.commands.redo(); });
    expect(editor.getJSON()).toEqual(result);
  });

  it('Backspace removes the empty quoted line formatting without deleting its line or surrounding blocks', async () => {
    const source = '<blockquote><p>Quotation</p><p></p></blockquote><ul><li><p>Explanation</p></li></ul>';
    await shared(source);
    expect(editor.getHTML()).toBe(source); // No migration of existing writing.
    const original = editor.getJSON();
    act(() => { emptyQuoteCaret(); expect(key('Backspace')).toBe(true); });
    expect(editor.getHTML()).toBe('<blockquote><p>Quotation</p></blockquote><p></p><ul><li><p>Explanation</p></li></ul>');
    expect(editor.state.selection.$from.parent.content.size).toBe(0);
    expect(editor.isActive('blockquote')).toBe(false);
    act(() => { editor.commands.undo(); });
    expect(editor.getJSON()).toEqual(original);
  });

  it('removes only the current quoted paragraph and preserves marks and both sides', () => {
    open('<blockquote><p>Before</p><p><strong>Target</strong></p><p>After</p></blockquote>');
    caret('Target'); key('Backspace');
    expect(editor.getHTML()).toBe('<blockquote><p>Before</p></blockquote><p><strong>Target</strong></p><blockquote><p>After</p></blockquote>');
    expect(editor.state.selection.$from.parentOffset).toBe(0);
  });

  it('Backspace at an empty middle paragraph preserves later quoted material', () => {
    open('<blockquote><p>Before</p><p></p><p>After</p></blockquote>');
    emptyQuoteCaret(); key('Backspace');
    expect(editor.getHTML()).toBe('<blockquote><p>Before</p></blockquote><p></p><blockquote><p>After</p></blockquote>');
  });

  it('keeps mid-text Enter inside the quote without losing either half', () => {
    open('<blockquote><p>BeforeAfter</p></blockquote>');
    caret('BeforeAfter', 6); key('Enter');
    expect(editor.getHTML()).toBe('<blockquote><p>Before</p><p>After</p></blockquote>');
  });

  it('preserves an existing multi-paragraph quote when editing a non-final paragraph', () => {
    open('<blockquote><p>First</p><p>Second</p></blockquote>');
    caret('First', 5); key('Enter');
    expect(editor.getHTML()).toBe('<blockquote><p>First</p><p></p><p>Second</p></blockquote>');
  });

  it('Shift+Enter continues a quote and Enter on its last empty line exits it', () => {
    open('<blockquote><p>Quote</p></blockquote>');
    caret('Quote', 5); key('Enter', true);
    expect(editor.getHTML()).toBe('<blockquote><p>Quote</p><p></p></blockquote>');
    key('Enter');
    expect(editor.getHTML()).toBe('<blockquote><p>Quote</p></blockquote><p></p>');
  });

  it('removes one quote level at a time', () => {
    open('<blockquote><p>Outer</p><blockquote><p>Inner</p></blockquote></blockquote>');
    caret('Inner'); key('Backspace');
    expect(editor.getHTML()).toBe('<blockquote><p>Outer</p><p>Inner</p></blockquote>');
    key('Backspace');
    expect(editor.getHTML()).toBe('<blockquote><p>Outer</p></blockquote><p>Inner</p>');
  });

  it('leaves mid-text Backspace to character deletion', () => {
    open('<blockquote><p>Quote</p></blockquote>');
    caret('Quote', 3);
    expect(key('Backspace')).toBe(false);
    expect(editor.getHTML()).toBe('<blockquote><p>Quote</p></blockquote>');
  });

  it('deletes a selected word normally without removing quote structure', () => {
    open('<blockquote><p>Quote text</p></blockquote>');
    caret('Quote');
    const from = editor.state.selection.from;
    editor.commands.setTextSelection({ from, to: from + 5 });
    key('Backspace');
    expect(editor.getHTML()).toBe('<blockquote><p> text</p></blockquote>');
  });

  it('keeps list-marker Backspace working inside quotes', () => {
    open('<blockquote><ul><li><p>Item</p></li></ul></blockquote>');
    caret('Item'); key('Backspace');
    expect(editor.getHTML()).toBe('<blockquote><p>Item</p></blockquote>');
  });

  it('exits a quote inside a list without removing the list item', () => {
    open('<ul><li><p>Item</p><blockquote><p>Quote</p></blockquote></li></ul>');
    caret('Quote', 5); key('Enter');
    expect(editor.getHTML()).toBe('<ul><li><p>Item</p><blockquote><p>Quote</p></blockquote><p></p></li></ul>');
  });

  it('exits only the quote inside a dropdown; following Enter remains inside the dropdown', () => {
    open('<details open><summary>Title</summary><div data-type="detailsContent"><blockquote><p>Quote</p></blockquote></div></details>');
    caret('Quote', 5); key('Enter');
    expect(editor.isActive('blockquote')).toBe(false);
    expect(editor.isActive('detailsContent')).toBe(true);
    key('Enter');
    expect(editor.isActive('detailsContent')).toBe(true);
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
    expect(editor.state.doc.firstChild.lastChild.childCount).toBe(3);
  });

  it('leaves ordinary paragraphs and code blocks using their existing Enter behavior', () => {
    open('<p>Normal</p><pre><code>Code</code></pre>');
    caret('Normal', 6); key('Enter');
    expect(editor.getHTML()).toBe('<p>Normal</p><p></p><pre><code>Code</code></pre>');
    caret('Code', 4); key('Enter');
    expect(editor.state.doc.lastChild.textContent).toBe('Code\n');
  });

  it('does not change quotes on load or an unrelated edit', () => {
    const source = '<blockquote><p>First</p><p></p><p>Second</p><p></p></blockquote><p>Elsewhere</p>';
    open(source);
    expect(editor.getHTML()).toBe(source);
    caret('Elsewhere', 9); editor.commands.insertContent('!');
    expect(editor.getHTML()).toBe(source.replace('Elsewhere', 'Elsewhere!'));
  });

  it('lets the slash menu handle Enter inside a quote', async () => {
    await shared('<blockquote><p>/quote</p></blockquote>');
    act(() => { caret('/quote', 6); });
    expect(getSlashState(editor.state).menu.query).toBe('quote');
    act(() => { key('Enter'); });
    expect(getSlashState(editor.state).menu).toBeNull();
    expect(editor.isActive('blockquote')).toBe(true);
    expect(editor.getHTML()).toBe('<blockquote><p></p></blockquote>');
  });
});
