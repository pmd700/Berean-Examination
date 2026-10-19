import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import { afterEach, describe, expect, it } from 'vitest';
import { CollapsibleToggle, ToggleSummary, ToggleContent } from '@/components/editor/CollapsibleToggleExtension';
import { PointerAnchor, getPointerState } from '@/components/editor/PointerExtension';

const editors = [];
afterEach(() => { for (const editor of editors.splice(0)) { const dom = editor.view.dom; editor.destroy(); dom.remove(); } });
function mount(content = '<p>Paste here:</p>') {
  const editor = new Editor({ extensions: [StarterKit, Link, Underline, CollapsibleToggle, ToggleSummary, ToggleContent, PointerAnchor], content, editorProps: { handleScrollToSelection: () => true } });
  document.body.appendChild(editor.view.dom); editors.push(editor); return editor;
}
function select(editor, text) {
  let from;
  editor.state.doc.descendants((node, pos) => { if (node.isText && node.text.includes(text)) from = pos + node.text.indexOf(text); });
  if (from == null) throw new Error(`Missing ${text}`);
  editor.commands.setTextSelection({ from, to: from + text.length });
}
function copy(editor, type = 'copy') {
  const data = {};
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { clearData: () => {}, setData: (format, value) => { data[format] = value; } } });
  editor.view.dom.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  return data;
}
function paste(data) {
  const target = mount();
  target.commands.setTextSelection(target.state.doc.content.size - 1);
  target.view.pasteHTML(data['text/html'], new Event('paste'));
  return target;
}

describe('copy text from dropdowns without their unselected structure', () => {
  it.each([false, true])('copies just an emoji from a dropdown title (open=%s)', open => {
    const source = mount(`<details${open ? ' open' : ''}><summary>John 20:23 ❌</summary><div data-type="detailsContent"><p>Unselected body</p></div></details>`);
    const original = source.getJSON();
    select(source, '❌');
    const data = copy(source);
    expect(data['text/plain']).toBe('❌');
    expect(data['text/html']).not.toMatch(/details|summary|chevron/);
    const target = paste(data);
    expect(target.getText()).toBe('Paste here:❌');
    expect(target.getHTML()).not.toContain('<details');
    expect(source.getJSON()).toEqual(original);
  });

  it('does not restore either ancestor when copying from a nested title', () => {
    const source = mount('<details open><summary>Outer</summary><div data-type="detailsContent"><details><summary>Inner ❌</summary><div data-type="detailsContent"><p>Hidden body</p></div></details></div></details>');
    select(source, '❌');
    const data = copy(source);
    expect(data['text/html']).not.toMatch(/details|summary/);
    expect(paste(data).getHTML()).toBe('<p>Paste here:❌</p>');
  });

  it('preserves selected inline formatting and links and copies body text without a dropdown', () => {
    const source = mount('<details open><summary>Heading</summary><div data-type="detailsContent"><p>Before <strong><em><u><a href="https://example.test/source">chosen text</a></u></em></strong> after</p></div></details>');
    select(source, 'chosen text');
    const data = copy(source);
    expect(data['text/plain']).toBe('chosen text');
    expect(data['text/html']).toContain('<strong>'); expect(data['text/html']).toContain('<em>'); expect(data['text/html']).toContain('<u>'); expect(data['text/html']).toContain('https://example.test/source');
    expect(data['text/html']).not.toMatch(/details|summary/);
    expect(paste(data).getHTML()).not.toContain('<details');
  });

  it('copies a complete selected dropdown intact, with exactly one dropdown on paste', () => {
    const source = mount('<details open><summary>Whole title</summary><div data-type="detailsContent"><p>Whole body</p></div></details>');
    source.commands.setNodeSelection(0);
    const data = copy(source);
    const target = paste(data);
    expect(data['text/html']).toContain('<details');
    expect(target.view.dom.querySelectorAll('.toggle-block')).toHaveLength(1);
    expect(target.getText()).toContain('Whole body');
  });

  it('preserves a fully selected child dropdown without copying its unselected parent', () => {
    const source = mount('<details open><summary>Outer</summary><div data-type="detailsContent"><details open><summary>Whole child</summary><div data-type="detailsContent"><p>Child body</p></div></details></div></details>');
    let from;
    source.state.doc.descendants((node, pos) => { if (node.type.name === 'details' && node.firstChild.textContent === 'Whole child') from = pos; });
    source.commands.setNodeSelection(from);
    const data = copy(source);
    expect(data['text/html']).not.toContain('Outer');
    expect(data['text/html']).toContain('<details');
    expect(paste(data).view.dom.querySelectorAll('.toggle-block')).toHaveLength(1);
  });

  it('cuts just the selected title text, leaves the source dropdown intact, and supports undo', () => {
    const source = mount('<details><summary>Title ❌</summary><div data-type="detailsContent"><p>Keep body</p></div></details>');
    const original = source.getJSON(); select(source, '❌');
    const data = copy(source, 'cut');
    expect(source.getText()).not.toContain('❌');
    expect(source.view.dom.querySelectorAll('.toggle-block')).toHaveLength(1);
    expect(paste(data).getHTML()).toBe('<p>Paste here:❌</p>');
    source.commands.undo(); expect(source.getJSON()).toEqual(original);
  });

  it('keeps a literal selected > character and handles a range crossing title and body', () => {
    const source = mount('<details open><summary>Literal &gt; ❌</summary><div data-type="detailsContent"><p>Body words</p></div></details>');
    select(source, '> ❌'); expect(copy(source)['text/plain']).toBe('> ❌');
    const from = source.state.selection.from;
    select(source, 'Body'); source.commands.setTextSelection({ from, to: source.state.selection.to });
    const data = copy(source);
    expect(data['text/html']).not.toMatch(/details|summary/);
    const target = paste(data);
    expect(target.getText()).toContain('> ❌'); expect(target.getText()).toContain('Body');
    expect(target.getHTML()).not.toContain('<details');
  });

  it('keeps Echo Copy HTML and plain text consistent for a placeholder in a dropdown title', () => {
    const source = mount('<details><summary>placeholder</summary><div data-type="detailsContent"><p>Hidden</p></div></details><p><strong>Linked passage</strong></p>');
    select(source, 'placeholder'); source.commands.pointerStep();
    select(source, 'Linked passage'); source.commands.pointerStep();
    source.commands.togglePointerEcho(getPointerState(source.state).pointers[0].id);
    select(source, 'placeholder');
    const data = copy(source);
    expect(data['text/plain']).toContain('Linked passage');
    expect(data['text/plain']).not.toContain('placeholder');
    expect(data['text/html']).toContain('<strong>Linked passage</strong>');
    expect(data['text/html']).not.toMatch(/details|summary/);
  });
});
