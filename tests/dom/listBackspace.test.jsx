import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { ListBackspace } from '@/components/editor/ListBackspaceExtension';
import { ListExitBoundaries } from '@/components/editor/ListExitBoundaryExtension';

vi.mock('@/api/desktopClient', () => ({
  desktopClient: { entities: { Keyword: { list: async () => [] } } },
}));
import TEXT_EDITOR_MACHINERY from '@/components/editor/TEXT_EDITOR_MACHINERY';

let editor;
afterEach(() => { act(() => editor?.destroy()); editor = null; });
function open(content) {
  editor = new Editor({
    extensions: [StarterKit, ListExitBoundaries, ListBackspace],
    content,
    editorProps: { handleScrollToSelection: () => true },
  });
}
function caret(text, offset = 0) {
  let target;
  editor.state.doc.descendants((node, pos) => {
    if (target === undefined && node.isText && node.text.includes(text)) {
      target = pos + node.text.indexOf(text) + offset;
    }
  });
  editor.commands.setTextSelection(target);
}
function backspace() {
  const event = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
  return editor.view.someProp('handleKeyDown', handler => handler(editor.view, event)) === true;
}

describe('Backspace at a list marker', () => {
  it('removes the bullet in the shared editor, keeping the blank line, bold text and quote', async () => {
    const content = '<h2>Arguments</h2><p></p><ul><li><p><strong>Matthew 5:27-28</strong></p></li></ul><blockquote><p>The quotation</p></blockquote>';
    render(<MemoryRouter><TEXT_EDITOR_MACHINERY content={content} onChange={() => {}} onEditorReady={instance => { editor = instance; }} bare /></MemoryRouter>);
    await waitFor(() => expect(editor).toBeTruthy());
    editor.setOptions({ editorProps: { handleScrollToSelection: () => true } });
    const original = editor.getJSON();
    act(() => {
      caret('Matthew');
      expect(backspace()).toBe(true);
    });
    expect(editor.state.doc.content.content.map(node => node.type.name))
      .toEqual(['heading', 'paragraph', 'paragraph', 'blockquote']);
    expect(editor.state.doc.child(1).content.size).toBe(0);
    expect(editor.state.doc.child(2).firstChild.marks[0].type.name).toBe('bold');
    expect(editor.state.doc.child(2).textContent).toBe('Matthew 5:27-28');
    expect(editor.state.doc.lastChild.textContent).toBe('The quotation');
    act(() => { editor.commands.undo(); });
    expect(editor.getJSON()).toEqual(original);
  });

  it.each(['ul', 'ol'])('removes only the middle %s item marker and preserves its child blocks', tag => {
    open(`<${tag}><li><p>First</p></li><li><p>Target</p><blockquote><p>Quote</p></blockquote><p>Explanation</p></li><li><p>Last</p></li></${tag}>`);
    caret('Target');
    backspace();
    expect(editor.getHTML()).toBe(`<${tag}><li><p>First</p></li></${tag}><p>Target</p><blockquote><p>Quote</p></blockquote><p>Explanation</p><${tag}><li><p>Last</p></li></${tag}>`);
  });

  it.each(['ul', 'ol'])('joins the text on the second Backspace without recreating a %s marker', tag => {
    open(`<${tag}><li><p>First</p></li><li><p><strong>Target</strong></p></li></${tag}>`);
    caret('Target');
    expect(backspace()).toBe(true);
    expect(editor.getHTML()).toBe(`<${tag}><li><p>First</p></li></${tag}><p><strong>Target</strong></p>`);
    expect(backspace()).toBe(true);
    expect(editor.getHTML()).toBe(`<${tag}><li><p>First<strong>Target</strong></p></li></${tag}>`);
    expect(editor.state.selection.$from.parentOffset).toBe('First'.length);
  });

  it('joins ordinary text after removing the only list marker', () => {
    open('<p>ipsum lorem words</p><ol><li><p>text</p></li></ol>');
    caret('text');
    backspace();
    expect(editor.getHTML()).toBe('<p>ipsum lorem words</p><p>text</p>');
    backspace();
    expect(editor.getHTML()).toBe('<p>ipsum lorem wordstext</p>');
    expect(editor.state.selection.$from.parentOffset).toBe('ipsum lorem words'.length);
  });

  it('merges into the last paragraph, preserving numbering, marks and trailing content', () => {
    open('<ol start="5"><li><p>First</p><p>Explanation</p></li><li><p><em>Target</em></p><blockquote><p>Quote</p></blockquote></li><li><p>Last</p></li></ol>');
    caret('Target');
    backspace();
    backspace();
    expect(editor.getHTML()).toBe('<ol start="5"><li><p>First</p><p>Explanation<em>Target</em></p></li></ol><blockquote><p>Quote</p></blockquote><ol start="5"><li><p>Last</p></li></ol>');
    expect(editor.state.selection.$from.parentOffset).toBe('Explanation'.length);
    const merged = editor.getJSON();
    editor.commands.undo();
    editor.commands.redo();
    expect(editor.getJSON()).toEqual(merged);
  });

  it('joins the preceding nested list line without creating a new item', () => {
    open('<ul><li><p>Parent</p><ul><li><p>Child</p></li></ul></li></ul><p>Following</p>');
    caret('Following');
    backspace();
    expect(editor.getHTML()).toBe('<ul><li><p>Parent</p><ul><li><p>ChildFollowing</p></li></ul></li></ul>');
    expect(editor.state.selection.$from.parentOffset).toBe('Child'.length);
  });

  it('outdents a nested item one level', () => {
    open('<ul><li><p>Parent</p><ul><li><p>Child</p></li></ul></li></ul>');
    caret('Child');
    backspace();
    expect(editor.getHTML()).toBe('<ul><li><p>Parent</p></li><li><p>Child</p></li></ul>');
  });

  it('keeps normal joining at the start of a later paragraph in an item', () => {
    open('<ul><li><p>First</p><p>Second</p></li></ul>');
    caret('Second');
    backspace();
    expect(editor.getHTML()).toBe('<ul><li><p>FirstSecond</p></li></ul>');
  });

  it('leaves mid-text Backspace to normal character deletion', () => {
    open('<ul><li><p>Target</p></li></ul>');
    caret('Target', 3);
    expect(backspace()).toBe(false);
    expect(editor.getHTML()).toBe('<ul><li><p>Target</p></li></ul>');
  });

  it('deletes selected text without removing its bullet', () => {
    open('<ul><li><p>Target</p></li></ul>');
    caret('Target');
    const from = editor.state.selection.from;
    editor.commands.setTextSelection({ from, to: from + 3 });
    backspace();
    expect(editor.getHTML()).toBe('<ul><li><p>get</p></li></ul>');
  });
});
