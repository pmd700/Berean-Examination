import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { markdownBlocksToHtml } from '../../src/components/editor/pastedMarkdown';

describe('paste-only Markdown conversion', () => {
  let editor;
  let host;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: [StarterKit],
      content: '<p></p>',
    });
  });

  afterEach(() => {
    editor?.destroy();
    host?.remove();
  });

  const pasteMarkdown = (text) => {
    const html = markdownBlocksToHtml(text);
    expect(html).toBeTruthy();
    editor.commands.insertContent(html);
    return editor.getHTML();
  };

  it('keeps every dash and its text together as a bullet item', () => {
    const html = pasteMarkdown(`Therefore, their statement operated on two levels:

- They spoke **about Jesus**.
- They denigrated the **Spirit working through Jesus** by identifying that Spirit as demonic.`);

    expect(html).toContain('<ul>');
    expect(html.match(/<li>/g)).toHaveLength(2);
    expect(html).toContain('<li><p>They spoke <strong>about Jesus</strong>.</p></li>');
    expect(html).toContain('<li><p>They denigrated the <strong>Spirit working through Jesus</strong> by identifying that Spirit as demonic.</p></li>');
  });

  it('keeps every numbered line as a separate list item', () => {
    const html = pasteMarkdown(`1. First point
2. Second point
3. Third point`);

    expect(html).toContain('<ol>');
    expect(html.match(/<li>/g)).toHaveLength(3);
  });

  it('does not reinterpret existing saved rich HTML', () => {
    const savedHtml = '<p></p><hr><details class="toggle-block"><summary>Title</summary><div><table><tbody><tr><td>Cell</td></tr></tbody></table></div></details>';
    expect(markdownBlocksToHtml(savedHtml)).toBeNull();
  });

  it('keeps saved rich HTML as document structure instead of visible tags', () => {
    const savedHtml = '<h3>Heading</h3><p>Body</p><hr><p>After</p>';

    editor.commands.setContent(savedHtml, false);

    expect(editor.getText()).not.toContain('<h3>');
    expect(editor.getText()).not.toContain('<p>');
    expect(editor.getHTML()).toContain('<h3>Heading</h3>');
    expect(editor.getHTML()).toContain('<hr>');
  });

  it("leaves ordinary prose to the editor's normal paste handling", () => {
    expect(markdownBlocksToHtml('An ordinary paragraph with no Markdown blocks.')).toBeNull();
  });
});
