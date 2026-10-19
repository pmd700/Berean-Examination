import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { InheritedPasteLink, surroundingPasteLink, inheritInsertedLink } from '@/components/editor/InheritedPasteLink';

let editor;
afterEach(() => editor?.destroy());
function setup(content = '<p>Before <a href="https://example.com/source">""</a> After.</p>') {
  editor = new Editor({ extensions: [StarterKit, Link.configure({ openOnClick: false }), InheritedPasteLink], content });
  editor.commands.setTextSelection(9);
  return editor;
}

describe('pasting within a shared hyperlink', () => {
  it('immediately links rich clipboard text between the linked quotes and keeps its formatting', () => {
    setup();
    editor.view.pasteHTML('<p><strong>Quoted title</strong> with <em>italics</em></p>', new Event('paste'));
    const html = document.createElement('div'); html.innerHTML = editor.getHTML();
    expect(html.querySelectorAll('a')).toHaveLength(1);
    expect(html.querySelector('a').textContent).toBe('"Quoted title with italics"');
    expect(html.querySelector('a strong').textContent).toBe('Quoted title');
    expect(html.querySelector('a em').textContent).toBe('italics');
    expect(html.querySelector('a').getAttribute('href')).toBe('https://example.com/source');
    editor.commands.undo();
    expect(editor.getText()).toBe('Before "" After.');
  });

  it('inherits the destination for plain text and for replacing text inside the linked quotes', () => {
    setup(); editor.view.pasteText('First title', new Event('paste'));
    editor.commands.setTextSelection({ from: 9, to: 20 });
    editor.view.pasteHTML('<span>Replacement title</span>', new Event('paste'));
    expect(editor.getHTML()).toContain('"Replacement title"</a>');
  });

  it('does not extend a link at its outer boundary or choose between different destinations', () => {
    setup(); editor.commands.setTextSelection(10);
    expect(surroundingPasteLink(editor.state.selection)).toBeNull();
    editor.view.pasteHTML('<span>Unlinked text</span>', new Event('paste'));
    expect(editor.getHTML()).toContain('""</a>Unlinked text');
    editor.destroy();
    setup('<p>Before <a href="https://example.com/one">"</a><a href="https://example.com/two">"</a> After.</p>');
    expect(surroundingPasteLink(editor.state.selection)).toBeNull();
    editor.view.pasteHTML('<span>Independent</span>', new Event('paste'));
    expect(editor.getHTML()).toMatch(/<\/a>Independent<a /);
  });

  it('uses the surrounding quotes destination even when the clipboard contains another link', () => {
    setup(); editor.view.pasteHTML('<a href="https://example.com/other">Other source</a>', new Event('paste'));
    expect(editor.getHTML()).not.toContain('href="https://example.com/other"');
    expect(editor.getHTML()).toContain('href="https://example.com/source"');
    expect(editor.getHTML()).toContain('"Other source"</a>');
  });

  it('applies the same inheritance to Markdown converted by the capture handler', () => {
    setup();
    const mark = surroundingPasteLink(editor.state.selection), start = editor.state.selection.from;
    editor.chain().insertContent('<p><strong>Converted title</strong></p>').command(({ tr }) => {
      inheritInsertedLink(tr, start, tr.selection.to, mark); return true;
    }).run();
    const html = document.createElement('div'); html.innerHTML = editor.getHTML();
    expect(html.querySelector('a strong').textContent).toBe('Converted title');
    expect([...html.querySelectorAll('a')].map(link => link.textContent).join('')).toBe('"Converted title"');
  });
});
