import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import SlashCommands, { getSlashState } from '@/components/editor/slashCommands';
import SlashCommandMenu from '@/components/editor/SlashCommandMenu';

let editor;
let host;
function mount(content) {
  host = document.createElement('div');
  document.body.appendChild(host);
  editor = new Editor({
    element: host,
    extensions: [StarterKit, SlashCommands],
    editorProps: { handleScrollToSelection: () => true },
    content,
  });
  // jsdom has no text-range geometry; the menu needs a caret rectangle.
  editor.view.coordsAtPos = () => ({ left: 100, right: 100, top: 100, bottom: 120 });
  render(<SlashCommandMenu editor={editor} />);
  let commandEnd;
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text.includes('/quote')) commandEnd = pos + node.text.indexOf('/quote') + 6;
  });
  act(() => editor.commands.setTextSelection(commandEnd));
}
afterEach(() => { editor?.destroy(); host?.remove(); });

describe('/quote', () => {
  it('offers Quote and creates an empty quote ready for writing with Enter', () => {
    mount('<p>/quote</p>');
    expect(screen.getByTestId('button-slash-quote').textContent).toContain('Quote');
    fireEvent.keyDown(editor.view.dom, { key: 'Enter' });
    expect(editor.getHTML()).toBe('<blockquote><p></p></blockquote>');
    expect(getSlashState(editor.state).menu).toBeNull();
    act(() => editor.commands.insertContent('Words to quote'));
    expect(editor.getHTML()).toBe('<blockquote><p>Words to quote</p></blockquote>');
  });

  it('preserves text, formatting, and neighboring paragraphs when picked from the popup', () => {
    mount('<p>Before</p><p><strong>Quoted</strong> words /quote</p><p>After</p>');
    fireEvent.mouseDown(screen.getByTestId('button-slash-quote'));
    expect(editor.getHTML()).toBe('<p>Before</p><blockquote><p><strong>Quoted</strong> words </p></blockquote><p>After</p>');
  });

  it('supports Tab and undoes the conversion and command removal together', () => {
    const original = '<p>Text /quote</p>';
    mount(original);
    fireEvent.keyDown(editor.view.dom, { key: 'Tab' });
    expect(editor.getHTML()).toBe('<blockquote><p>Text </p></blockquote>');
    act(() => editor.commands.undo());
    expect(editor.getHTML()).toBe(original);
  });

  it('keeps an existing multi-paragraph quote continuous without nesting or removing it', () => {
    mount('<blockquote><p>First</p><p>Second /quote</p><p>Third</p></blockquote>');
    fireEvent.keyDown(editor.view.dom, { key: 'Enter' });
    expect(editor.getHTML()).toBe('<blockquote><p>First</p><p>Second </p><p>Third</p></blockquote>');
  });

  it('leaves the text alone if the slash menu is dismissed', () => {
    mount('<p>/quote</p>');
    fireEvent.keyDown(editor.view.dom, { key: 'Escape' });
    expect(editor.getHTML()).toBe('<p>/quote</p>');
    expect(screen.queryByTestId('button-slash-quote')).toBeNull();
  });
});
