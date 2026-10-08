import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  CollapsibleToggle,
  ToggleContent,
  ToggleSummary,
} from '@/components/editor/CollapsibleToggleExtension';

/**
 * Changing one block into another keeps the words.
 *
 * The reported symptom was that turning a heading into a toggle "deleted" its
 * text. Nothing was deleted: the stock command files the block's content into
 * the toggle's BODY and leaves the title blank, and since toggles are created
 * collapsed, the words were simply behind a closed triangle.
 *
 * These run every conversion the block menu offers and assert the text survives
 * and is visible, because the failure mode here is silent — the document still
 * contains the words, so nothing throws and nothing looks broken in a snapshot.
 */

let editor;
let host;

function mount(content) {
  host = document.createElement('div');
  document.body.appendChild(host);
  editor = new Editor({
    element: host,
    extensions: [StarterKit, CollapsibleToggle, ToggleSummary, ToggleContent],
    content,
  });
  return editor;
}

/** Selects the text of the first block, the way the block menu does. */
function selectFirstBlockText() {
  const block = editor.state.doc.firstChild;
  let from = null;
  let to = null;
  block.descendants((node, relativePos) => {
    if (!node.isText) return true;
    const at = 1 + relativePos;
    if (from === null) from = at;
    to = at + node.nodeSize;
    return true;
  });
  editor.chain().focus().setTextSelection(from === null ? { from: 1, to: 1 } : { from, to }).run();
}

/** What the reader can actually see — a closed toggle hides its body. */
function visibleText() {
  let text = '';
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'details' && !node.attrs.open) {
      text += node.firstChild?.textContent || '';
      return false;
    }
    if (node.isText) text += node.text;
    return true;
  });
  return text;
}

const SOURCES = {
  'heading 1': '<h1>Beelzebul controversy</h1>',
  'heading 2': '<h2>Beelzebul controversy</h2>',
  'heading 3': '<h3>Beelzebul controversy</h3>',
  paragraph: '<p>Beelzebul controversy</p>',
  quote: '<blockquote><p>Beelzebul controversy</p></blockquote>',
  'bulleted list': '<ul><li><p>Beelzebul controversy</p></li></ul>',
  'numbered list': '<ol><li><p>Beelzebul controversy</p></li></ol>',
};

/** The block menu's conversions, as RichTextEditor chains them. */
function convert(format) {
  const current = editor.state.doc.firstChild.type.name;
  let chain = editor.chain().focus();
  if ((current === 'bulletList' || current === 'orderedList') && format !== 'list') {
    chain = chain.liftListItem('listItem');
  }
  if (current === 'details' && format !== 'toggle') chain = chain.unsetDetails();
  if (current === 'blockquote' && format !== 'quote') chain = chain.unsetBlockquote();

  if (format === 'toggle') chain = chain.setDetails();
  else if (format === 'text') chain = chain.setParagraph();
  else if (format === 'heading') chain = chain.setHeading({ level: 2 });
  else if (format === 'list') chain = chain.toggleBulletList();
  else if (format === 'quote') chain = chain.setBlockquote();
  chain.run();
}

beforeEach(() => { editor = null; host = null; });
afterEach(() => { editor?.destroy(); host?.remove(); });

describe('turning a block into a toggle', () => {
  Object.entries(SOURCES).forEach(([label, html]) => {
    it(`keeps the words visible when converting a ${label}`, () => {
      mount(html);
      selectFirstBlockText();
      convert('toggle');

      expect(editor.state.doc.textContent).toContain('Beelzebul controversy');
      // The actual bug: present in the document, but hidden in a closed body.
      expect(visibleText()).toContain('Beelzebul controversy');
    });
  });

  it('puts the words on the title line, not in the body', () => {
    mount('<h3>THST Jesus only spoke about this in 1 scene</h3>');
    selectFirstBlockText();
    convert('toggle');

    const details = editor.state.doc.firstChild;
    expect(details.type.name).toBe('details');
    expect(details.firstChild.type.name).toBe('detailsSummary');
    expect(details.firstChild.textContent).toBe('THST Jesus only spoke about this in 1 scene');
    expect(details.lastChild.textContent).toBe('');
  });

  it('carries the words bold and italic marks across', () => {
    mount('<h3>Plain <strong>bold</strong> and <em>italic</em></h3>');
    selectFirstBlockText();
    convert('toggle');

    const summary = editor.state.doc.firstChild.firstChild;
    expect(summary.textContent).toBe('Plain bold and italic');
    const marks = [];
    summary.descendants((node) => { node.marks.forEach((mark) => marks.push(mark.type.name)); });
    expect(marks).toContain('bold');
    expect(marks).toContain('italic');
  });

  it('leaves a new empty toggle collapsed, as before', () => {
    mount('<p></p>');
    editor.commands.setDetails();
    expect(editor.state.doc.firstChild.attrs.open).toBe(false);
  });

  it('opens the toggle when the conversion leaves content in the body', () => {
    // Two blocks: the first becomes the title, the rest the body — and a closed
    // toggle would hide that body, which is the bug all over again.
    mount('<h3>Title line</h3><p>Body line</p>');
    editor.chain().focus().setTextSelection({ from: 1, to: 20 }).run();
    editor.commands.setDetails();

    const details = editor.state.doc.firstChild;
    expect(details.firstChild.textContent).toBe('Title line');
    expect(details.lastChild.textContent).toBe('Body line');
    expect(details.attrs.open).toBe(true);
    expect(visibleText()).toContain('Body line');
  });
});

describe('turning a toggle back into something else', () => {
  ['text', 'heading', 'list', 'quote'].forEach((format) => {
    it(`keeps the title's words when converting to ${format}`, () => {
      mount('<h3>Beelzebul controversy</h3>');
      selectFirstBlockText();
      convert('toggle');
      convert(format);

      expect(editor.state.doc.firstChild.type.name).not.toBe('details');
      expect(visibleText()).toContain('Beelzebul controversy');
    });
  });

  it('does not leave a stray empty line behind', () => {
    // The body always carries one empty paragraph; merging it out whole left an
    // extra blank block under every un-toggled line.
    mount('<h3>Round trip words</h3>');
    selectFirstBlockText();
    convert('toggle');
    convert('text');

    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.getHTML()).toBe('<p>Round trip words</p>');
  });

  it('still keeps body content when the toggle actually holds something', () => {
    mount(`
      <details open>
        <summary>Title line</summary>
        <div data-type="detailsContent"><p>First body line</p><p>Second body line</p></div>
      </details>
    `);
    editor.chain().focus().setTextSelection({ from: 3, to: 3 }).run();
    editor.commands.unsetDetails();

    const text = editor.state.doc.textContent;
    expect(text).toContain('Title line');
    expect(text).toContain('First body line');
    expect(text).toContain('Second body line');
  });
});

describe('multi-block conversions', () => {
  it('turns marquee-selected paragraphs into one continuous quote', () => {
    mount('<p>Verse one</p><p>Verse two</p><p>Verse three</p>');
    const last = editor.state.doc.lastChild;
    const lastPos = editor.state.doc.content.size - last.nodeSize;
    editor.chain()
      .focus()
      .setTextSelection({ from: 1, to: lastPos + last.nodeSize - 1 })
      .setBlockquote()
      .run();

    expect(editor.getHTML()).toBe(
      '<blockquote><p>Verse one</p><p>Verse two</p><p>Verse three</p></blockquote>',
    );
    expect(host.querySelectorAll('blockquote')).toHaveLength(1);
    expect(host.querySelectorAll('blockquote > p')).toHaveLength(3);
  });
});

describe('conversions that never went through a toggle', () => {
  const FORMATS = ['text', 'heading', 'list', 'quote'];
  Object.entries(SOURCES).forEach(([label, html]) => {
    FORMATS.forEach((format) => {
      it(`keeps the words converting a ${label} to ${format}`, () => {
        mount(html);
        selectFirstBlockText();
        convert(format);
        expect(visibleText()).toContain('Beelzebul controversy');
      });
    });
  });
});
