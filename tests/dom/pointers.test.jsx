import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Slice, DOMSerializer } from '@tiptap/pm/model';
import { expandPointerEcho } from '@/components/editor/pointerClipboard';
import { copyNotePage } from '@/components/notes/copyNotePage';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { PointerAnchor, PointerCodeBlock, getPointerState, remapPastedPointers } from '@/components/editor/PointerExtension';
import { collectPointers, pointerGutterSide, pointerPath } from '@/components/editor/pointerModel';
import { BlockDrag, blockDragPluginKey } from '@/components/editor/BlockDragExtension';
import { CollapsibleToggle, ToggleSummary, ToggleContent } from '@/components/editor/CollapsibleToggleExtension';
import { SpotlightJourney, startEditorRangeSpotlight } from '@/components/editor/spotlightJourney';
import { buildNoteBackupMarkdown, extractNoteBackupPayload } from '@/lib/noteBackupMarkdown';
vi.mock('@/api/desktopClient', () => ({ desktopClient: { entities: { Keyword: { list: async () => [] } } } }));
import RichTextEditor from '@/components/editor/RichTextEditor';

let editor;
let trip;
const content = '<p>A <strong>source</strong> phrase.</p><p>A target passage.</p>';
function mount(html = content) {
  editor = new Editor({
    extensions: [StarterKit.configure({ codeBlock: false }), PointerCodeBlock, PointerAnchor, BlockDrag, CollapsibleToggle, ToggleSummary, ToggleContent, SpotlightJourney],
    content: html, editorProps: { handleScrollToSelection: () => true },
  });
  document.body.appendChild(editor.view.dom);
}
function select(text, nth = 0) {
  const found = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text.includes(text)) found.push(pos + node.text.indexOf(text));
  });
  editor.commands.setTextSelection({ from: found[nth], to: found[nth] + text.length });
}
function key(key, modifiers = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers });
  return editor.view.someProp('handleKeyDown', handler => handler(editor.view, event)) === true;
}
function connect(source = 'source', target = 'target') {
  select(source); key('p', { metaKey: true }); select(target); key('p', { metaKey: true });
  return getPointerState(editor.state).pointers[0];
}
afterEach(async () => {
  trip?.cancel();
  await trip?.finished;
  act(() => { const dom = editor?.view.dom; editor?.destroy(); dom?.remove(); });
  editor = trip = null;
  vi.useRealTimers();
});

describe('note pointers', () => {
  it('uses two presses, saves no incomplete pointer, preserves formatting, and supports undo/redo', () => {
    mount();
    const original = editor.getJSON();
    select('source'); expect(key('p', { metaKey: true })).toBe(true);
    expect(getPointerState(editor.state).pending.find()).toHaveLength(1);
    expect(editor.getJSON()).toEqual(original);
    select('target'); key('p', { metaKey: true });
    const [pointer] = collectPointers(editor.state.doc);
    expect(pointer.source.text).toBe('source');
    expect(pointer.target.text).toBe('target');
    expect(editor.getHTML()).toContain('<strong>');
    editor.commands.undo(); expect(editor.getJSON()).toEqual(original);
    editor.commands.redo(); expect(collectPointers(editor.state.doc)).toHaveLength(1);
  });

  it('anchors code-block text without enabling rich formatting in code', () => {
    mount('<p>source</p><pre><code>const target = 1;</code></pre>');
    const pointer = connect();
    expect(pointer.target.text).toBe('target');
    expect(editor.state.doc.lastChild.type.name).toBe('codeBlock');
    expect(editor.state.doc.lastChild.type.allowsMarkType(editor.schema.marks.bold)).toBe(false);
    editor.commands.setContent(editor.getHTML());
    expect(collectPointers(editor.state.doc)[0].target.text).toBe('target');
  });

  it('round trips through saved HTML and a rich-note backup', () => {
    mount(); const pointer = connect();
    const html = editor.getHTML();
    const backup = buildNoteBackupMarkdown({ title: 'Pointers', content: html });
    const restored = extractNoteBackupPayload(backup);
    expect(restored.html).toBe(html);
    editor.commands.setContent(restored.html);
    expect(collectPointers(editor.state.doc)[0]).toEqual(pointer);
  });

  it('maps a pending source through edits above it', () => {
    mount(); select('source'); editor.commands.pointerStep();
    editor.commands.insertContentAt(1, 'Inserted text. ');
    select('target'); editor.commands.pointerStep();
    expect(collectPointers(editor.state.doc)[0].source.text).toBe('source');
  });

  it('keeps anchors attached when surrounding text changes and cleans orphan endpoints with undo', () => {
    mount(); connect();
    editor.commands.insertContentAt(1, 'Before. ');
    let pointer = collectPointers(editor.state.doc)[0];
    expect(pointer.source.text).toBe('source'); expect(pointer.target.text).toBe('target');
    editor.commands.deleteRange(pointer.target.ranges[0]);
    expect(collectPointers(editor.state.doc)).toHaveLength(0);
    expect(editor.getHTML()).not.toContain('data-pointer-id');
    editor.commands.undo();
    pointer = collectPointers(editor.state.doc)[0];
    expect(pointer.source.text).toBe('source'); expect(pointer.target.text).toBe('target');
  });

  it('cancels when the pending source is deleted', () => {
    mount(); select('source'); editor.commands.pointerStep();
    editor.commands.deleteSelection();
    expect(getPointerState(editor.state).pending.find()).toHaveLength(0);
    expect(getPointerState(editor.state).notice).toContain('removed');
  });

  it('rejects overlapping targets, ignores held keys, and Escape cancels', () => {
    mount(); select('source'); key('p', { ctrlKey: true });
    select('target'); key('p', { ctrlKey: true, repeat: true });
    expect(collectPointers(editor.state.doc)).toHaveLength(0);
    select('source'); key('p', { ctrlKey: true });
    expect(getPointerState(editor.state).notice).toContain('different');
    key('Escape'); expect(getPointerState(editor.state).pending.find()).toHaveLength(0);
    expect(editor.getHTML()).not.toContain('data-pointer-id');
  });

  it('does not create duplicate connections and permits shared endpoints', () => {
    mount(); connect(); connect();
    expect(collectPointers(editor.state.doc)).toHaveLength(1);
    connect('source', 'passage');
    expect(collectPointers(editor.state.doc)).toHaveLength(2);
    const first = collectPointers(editor.state.doc)[0];
    editor.commands.removePointer(first.id);
    expect(collectPointers(editor.state.doc)).toHaveLength(1);
    expect(editor.state.doc.textContent).toBe('A source phrase.A target passage.');
  });

  it('accepts whole blocks selected from the gutter without selecting intervening blocks', () => {
    mount('<p>source</p><p>target one</p><p>unrelated</p><p>target two</p>');
    select('source'); editor.commands.pointerStep();
    editor.view.dispatch(editor.state.tr.setMeta(blockDragPluginKey, { type: 'selection', selected: [1, 3], anchor: 1 }));
    editor.commands.pointerStep();
    const [pointer] = collectPointers(editor.state.doc);
    expect(pointer.target.text).toBe('target one target two');
    expect(pointer.target.ranges).toHaveLength(2);
  });

  it('assigns copied complete pairs new identities and strips incomplete copies', () => {
    mount(); const pointer = connect();
    const complete = remapPastedPointers(editor.state.doc.slice(0, editor.state.doc.content.size));
    const [copy] = collectPointers(complete.content);
    expect(copy.id).not.toBe(pointer.id);
    expect(copy.source.text).toBe('source');
    const partial = remapPastedPointers(editor.state.doc.slice(pointer.source.ranges[0].from, pointer.source.ranges[0].to));
    expect(collectPointers(partial.content)).toHaveLength(0);
    expect(partial.content.textBetween(0, partial.content.size)).toBe('source');
  });

  it('navigates to the exact target inside nested dropdowns and leaves manual closing in control', async () => {
    vi.useFakeTimers();
    mount('<p>source and repeated target</p><details open><summary>Outer</summary><div data-type="detailsContent"><details open><summary>Inner</summary><div data-type="detailsContent"><p>repeated target</p></div></details></div></details>');
    // Complete the pair against exact positions, then navigate with both dropdowns closed.
    select('source'); editor.commands.pointerStep();
    const matches = [];
    editor.state.doc.descendants((node, pos) => { if (node.isText && node.text.includes('repeated target')) matches.push(pos + node.text.indexOf('repeated target')); });
    editor.commands.setTextSelection({ from: matches[1], to: matches[1] + 15 });
    editor.commands.pointerStep();
    const pointer = collectPointers(editor.state.doc)[0];
    editor.commands.setTextSelection(1);
    editor.view.dom.querySelectorAll('.toggle-block__chevron').forEach(button => button.click());
    await vi.advanceTimersByTimeAsync(250);
    trip = startEditorRangeSpotlight(editor, () => ({ ...pointer.target.ranges[0], ranges: pointer.target.ranges }));
    await vi.advanceTimersByTimeAsync(700);
    const sections = [...editor.view.dom.querySelectorAll('.toggle-block')];
    expect(sections.every(section => section.classList.contains('is-open'))).toBe(true);
    expect(editor.view.dom.querySelector('.bex-spotlight-hit').textContent).toBe('repeated target');
    expect(editor.view.dom.querySelector('p .bex-spotlight-hit').closest('.toggle-block')).toBe(sections[1]);
    sections[0].querySelector('button').click();
    await vi.advanceTimersByTimeAsync(600);
    expect(sections[0].classList.contains('is-open')).toBe(false);
    expect(collectPointers(editor.state.doc)[0].id).toBe(pointer.id);
  });

  it('shows the nonblocking mode prompt in notes and keeps the shortcut out of other editors', async () => {
    const { unmount } = render(<MemoryRouter><RichTextEditor bare noteAnnotations content={content} onChange={() => {}} onEditorReady={instance => { editor = instance; }} /></MemoryRouter>);
    await waitFor(() => expect(editor).toBeTruthy());
    editor.view.dom.getBoundingClientRect = () => ({ left: 100, top: 0, right: 700, bottom: 500, width: 600, height: 500 });
    act(() => { select('source'); key('p', { metaKey: true }); });
    await waitFor(() => expect(document.querySelector('[data-testid="pointer-status"]')?.textContent).toContain('Pointer mode enabled'));
    fireEvent.click(document.querySelector('[aria-label="Cancel pointer"]'));
    expect(getPointerState(editor.state).pending.find()).toHaveLength(0);
    unmount(); editor = null;
    render(<MemoryRouter><RichTextEditor bare content={content} onChange={() => {}} onEditorReady={instance => { editor = instance; }} /></MemoryRouter>);
    await waitFor(() => expect(editor).toBeTruthy());
    expect(editor.schema.marks.pointerAnchor).toBeUndefined();
    expect(key('p', { metaKey: true })).toBe(false);
  });
});

describe('Echo Copy', () => {
  function copied(slice = new Slice(editor.state.doc.content, 0, 0)) {
    const result = expandPointerEcho(slice, editor.state.doc);
    const wrapper = document.createElement('div');
    wrapper.appendChild(DOMSerializer.fromSchema(editor.schema).serializeFragment(result.content));
    return { slice: result, html: wrapper.innerHTML, text: result.content.textBetween(0, result.content.size, '\n\n') };
  }
  it('is opt-in, persists through HTML, uses current rich text, and leaves the note untouched', () => {
    mount('<p>placeholder</p><p>A <strong>passage</strong>.</p>');
    const pointer = connect('placeholder', 'passage');
    expect(copied().text).toContain('placeholder');
    editor.commands.togglePointerEcho(pointer.id);
    const saved = editor.getHTML();
    expect(saved).toContain('data-pointer-echo="true"');
    editor.commands.setContent(saved);
    expect(copied().text).toBe('passage\n\nA passage.');
    expect(copied().html).toContain('<strong>passage</strong>');
    expect(editor.getHTML()).toBe(saved);
    const target = collectPointers(editor.state.doc)[0].target.ranges[0];
    editor.commands.insertContentAt(target.from + 2, 'NEW');
    expect(copied().text).toBe('paNEWssage\n\nA paNEWssage.');
    editor.commands.togglePointerEcho(pointer.id);
    expect(copied().text).toContain('placeholder');
  });
  it('copies a placeholder alone, but does not expand a partial selection', () => {
    mount('<p>placeholder</p><p>passage</p>');
    const pointer = connect('placeholder', 'passage');
    editor.commands.togglePointerEcho(pointer.id);
    const { from, to } = pointer.source.ranges[0];
    expect(copied(editor.state.doc.slice(from, to, true)).text).toBe('passage');
    select('placeholder');
    const clipboard = editor.view.serializeForClipboard(editor.state.selection.content());
    expect(clipboard.text).toBe('passage');
    expect(clipboard.dom.textContent).toBe('passage');
    expect(copied(editor.state.doc.slice(from, to - 2, true)).text).toBe('placehold');
  });
  it('preserves multiple paragraphs and formatting without swallowing surrounding text', () => {
    mount('<p>Before placeholder after.</p><p><strong>First paragraph</strong></p><p></p><p><em>Last paragraph</em></p>');
    select('placeholder'); editor.commands.pointerStep();
    select('First paragraph'); const from = editor.state.selection.from;
    select('Last paragraph'); const to = editor.state.selection.to;
    editor.commands.setTextSelection({ from, to }); editor.commands.pointerStep();
    editor.commands.togglePointerEcho(collectPointers(editor.state.doc)[0].id);
    const result = copied();
    expect(result.text).not.toContain('placeholder');
    expect(result.text).toContain('Before First paragraph');
    expect(result.text).toContain('Last paragraph after.');
    expect(result.html).toContain('<p></p>');
    expect(result.html).toContain('<strong>First paragraph</strong>');
    expect(result.html).toContain('<em>Last paragraph</em>');
    editor.schema.topNodeType.create(null, result.slice.content).check();
  });
  it('omits unselected prose between separate target blocks and supports undoing the toggle', () => {
    mount('<p>placeholder</p><p>first</p><p>Do not include</p><p>last</p>');
    select('placeholder'); editor.commands.pointerStep();
    editor.view.dispatch(editor.state.tr.setMeta(blockDragPluginKey, { type: 'selection', selected: [1, 3], anchor: 1 }));
    editor.commands.pointerStep();
    const pointer = collectPointers(editor.state.doc)[0];
    editor.commands.togglePointerEcho(pointer.id);
    const { from, to } = pointer.source.ranges[0];
    const selection = editor.state.doc.slice(from, to, true);
    expect(copied(selection).text).toBe('first\n\nlast');
    editor.commands.undo();
    expect(copied(selection).text).toBe('placeholder');
    editor.commands.redo();
    expect(copied(selection).text).toBe('first\n\nlast');
  });
  it('expands once for cycles and allows only one echo for overlapping placeholders', () => {
    mount('<p>source</p><p>target</p><p>third</p>');
    const one = connect('source', 'target'); editor.commands.togglePointerEcho(one.id);
    connect('target', 'source');
    const two = collectPointers(editor.state.doc).find(item => item.id !== one.id);
    editor.commands.togglePointerEcho(two.id);
    expect(copied().text).toBe('target\n\nsource\n\nthird');
    connect('source', 'third');
    const three = collectPointers(editor.state.doc).find(item => item.target.text === 'third');
    editor.commands.togglePointerEcho(three.id);
    expect(collectPointers(editor.state.doc).find(item => item.id === one.id).echoCopy).toBeUndefined();
    expect(copied().text).toBe('third\n\nsource\n\nthird');
  });
  it('applies to the page Copy button in HTML and text, including the title', () => {
    mount('<p>placeholder</p><p>passage</p>');
    const pointer = connect('placeholder', 'passage'); editor.commands.togglePointerEcho(pointer.id);
    const data = new Map();
    const previous = document.execCommand;
    document.execCommand = () => {
      const event = new Event('copy', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: { setData: (type, value) => data.set(type, value) } });
      document.dispatchEvent(event); return true;
    };
    try { expect(copyNotePage(editor.getHTML(), 'Title', 0, editor)).toBe(true); }
    finally { document.execCommand = previous; }
    expect(data.get('text/plain')).toBe('Title\n\npassage\n\npassage');
    expect(data.get('text/html')).toContain('<h1>Title</h1>');
    expect(data.get('text/html')).not.toContain('placeholder');
    expect(editor.state.doc.textContent).toBe('placeholderpassage');
  });
});

describe('pointer routing', () => {
  it('chooses the nearest gutter using both anchors, with the source breaking ties', () => {
    const bounds = { left: 100, right: 700 };
    const left = { left: 120, right: 180 };
    const right = { left: 620, right: 680 };
    expect(pointerGutterSide(left, left, bounds)).toBe('left');
    expect(pointerGutterSide(right, right, bounds)).toBe('right');
    expect(pointerGutterSide(right, left, bounds)).toBe('right');
    expect(pointerGutterSide(left, right, bounds)).toBe('left');
  });
  it('mirrors gutter lanes and endpoints on the right, above or below the source', () => {
    const source = { left: 620, right: 680, top: 100, bottom: 122 };
    const target = { left: 610, right: 670, top: 600, bottom: 622 };
    const down = pointerPath(source, target, { gutter: 756, side: 'right', lane: 2 });
    expect(down.start).toEqual({ x: 680, y: 125 });
    expect(down.d).toBe('M 680 125 H 764 Q 774 125 774 135 V 615 Q 774 625 764 625 H 673');
    const up = pointerPath(target, source, { gutter: 756, side: 'right' });
    expect(up.d).toBe('M 670 625 H 746 Q 756 625 756 615 V 135 Q 756 125 746 125 H 683');
  });
  const source = { left: 100, right: 160, top: 100, bottom: 122 };
  it('bounces above the same line', () => expect(pointerPath(source, { left: 240, right: 310, top: 100, bottom: 122 }).kind).toBe('bounce'));
  it('draws a diagonal for nearby lines in either direction', () => {
    const target = { left: 200, right: 260, top: 155, bottom: 177 };
    expect(pointerPath(source, target).kind).toBe('diagonal');
    expect(pointerPath(target, source).kind).toBe('diagonal');
  });
  it('routes distant or collapsed targets through the gutter', () => {
    const target = { left: 200, right: 260, top: 600, bottom: 622 };
    expect(pointerPath(source, target, { gutter: 44 }).kind).toBe('gutter');
    expect(pointerPath(source, source, { gutter: 44, forceGutter: true }).kind).toBe('gutter');
  });
});
