import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { CollapsibleToggle, ToggleContent, ToggleSummary } from '@/components/editor/CollapsibleToggleExtension';
import { BlockDrag, blockDragPluginKey } from '@/components/editor/BlockDragExtension';
import { convertDraggableBlocksToItems, deleteDraggableBlocks, dropSlotsForDoc, getDraggableBlocks, moveDraggableBlocksToPos, nodesForDraggableBlocks } from '@/components/editor/blockDragModel';

const LIST = '<ul><li><p>Isaiah</p><blockquote><p>First quotation</p></blockquote></li><li><p>Explanation</p></li><li><p>Matthew</p><blockquote><p>Second quotation</p></blockquote></li></ul>';
const wrap = body => `<details open><summary>Further analysis</summary><div data-type="detailsContent">${body}</div></details>`;
let editor;
let box;
function open(content = wrap(`${LIST}<p>After the list</p>`)) {
  box = document.createElement('div');
  box.dataset.bexGlobalEditor = 'true';
  document.body.appendChild(box);
  editor = new Editor({ element: box, extensions: [StarterKit, CollapsibleToggle.configure({ persist: true }), ToggleSummary, ToggleContent, BlockDrag],
    content, editorProps: { handleScrollToSelection: () => true } });
  const rect = (element, x, y, width, height) => { element.getBoundingClientRect = () => new DOMRect(x, y, width, height); };
  rect(box, 0, 0, 1000, 650); rect(editor.view.dom, 150, 0, 700, 650);
  rows().forEach((block, index) => rect(editor.view.nodeDOM(block.markPos), 200, 20 + index * 100, 600, 80));
  Object.defineProperty(editor.view.dom, 'offsetParent', { configurable: true, get: () => document.body });
}
const rows = () => getDraggableBlocks(editor.state.doc);
const row = text => rows().find(block => block.node.textContent === text);
const selectedTexts = () => blockDragPluginKey.getState(editor.state).selected.map(index => rows()[index].node.textContent);
function pointer(target, type, y) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 20, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  target.dispatchEvent(event);
}
function select(indexes) {
  editor.view.dispatch(editor.state.tr.setMeta(blockDragPluginKey, { type: 'selection', selected: indexes, anchor: indexes[0], source: 'marquee' }));
}
function copy(type = 'copy') {
  const data = {};
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { setData: (key, value) => { data[key] = value; } } });
  document.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  return data;
}
afterEach(() => { editor?.destroy(); box?.remove(); editor = null; box = null; window.getSelection().removeAllRanges(); });

describe('individual list entries in a dropdown marquee', () => {
  it('finds each list entry separately alongside the dropdown header and ordinary blocks', () => {
    open();
    expect(rows().map(block => block.node.type.name)).toEqual(['details', 'listItem', 'listItem', 'listItem', 'paragraph']);
    expect(rows().map(block => block.node.textContent)).toContain('Explanation');
    expect(rows().filter(block => block.node.type.name === 'listItem')).toHaveLength(3);
  });

  it('selects only the touched entry during and after an actual gutter drag', () => {
    open(); const before = editor.getJSON();
    pointer(box, 'pointerdown', 230); pointer(window, 'pointermove', 270);
    expect(selectedTexts()).toEqual(['Explanation']);
    expect(box.querySelectorAll('li.bex-block-selected')).toHaveLength(1);
    expect(box.querySelector('ul').classList.contains('bex-block-selected')).toBe(false);
    expect(box.querySelector('summary').classList.contains('bex-block-selected')).toBe(false);
    pointer(window, 'pointerup', 270);
    expect(selectedTexts()).toEqual(['Explanation']);
    expect(editor.getJSON()).toEqual(before);
  });

  it('copies and cuts one item without including its siblings or dropdown', () => {
    open(); select([row('Explanation').index]);
    const data = copy();
    expect(data['text/html']).toBe('<ul><li><p>Explanation</p></li></ul>');
    expect(data['text/plain']).toBe('Explanation');
    expect(editor.getHTML()).toContain('First quotation');
    copy('cut');
    expect(editor.getHTML()).not.toContain('Explanation');
    expect(editor.getHTML()).toContain('Second quotation');
    expect(editor.getHTML()).toContain('<summary>Further analysis</summary>');
  });

  it('deletes only the selected item and restores it on Undo', () => {
    open(); const before = editor.getJSON(); select([row('Explanation').index]);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    expect(editor.getHTML()).not.toContain('Explanation');
    expect(editor.getHTML()).toContain('First quotation');
    expect(editor.getHTML()).toContain('After the list');
    editor.commands.undo(); expect(editor.getJSON()).toEqual(before);
  });

  it('removes an emptied list without leaving a phantom bullet or losing the dropdown', () => {
    open(wrap(LIST));
    const selected = rows().filter(block => block.node.type.name === 'listItem').map(block => block.index);
    editor.view.dispatch(deleteDraggableBlocks(editor.state.tr, selected).tr);
    expect(editor.getHTML()).not.toContain('<ul>');
    expect(editor.state.doc.firstChild.lastChild.firstChild.type.name).toBe('paragraph');
    editor.state.doc.check();
  });

  it('retains the original numbering when copying a subset of a numbered list', () => {
    open(wrap('<ol start="4"><li><p>First</p></li><li><p>Second</p></li><li><p>Third</p></li></ol>'));
    select([row('Second').index]);
    const data = copy();
    expect(data['text/html']).toBe('<ol start="5"><li><p>Second</p></li></ol>');
    expect(data['text/plain']).toBe('Second');
    editor.commands.setContent('<p>Destination</p>'); editor.commands.insertContentAt(editor.state.doc.content.size, data['text/html']);
    expect(editor.getHTML()).toContain('<ol start="5"><li><p>Second</p></li></ol>');
  });

  it('moves an entry within its list and carries only that entry out of the list', () => {
    open();
    let slots = dropSlotsForDoc(editor.state.doc, () => true);
    const first = row('IsaiahFirst quotation');
    let moved = moveDraggableBlocksToPos(editor.state.tr, [row('Explanation').index], slots.find(slot => slot.pos === first.pos));
    expect(moved.changed).toBe(true); editor.view.dispatch(moved.tr);
    expect(editor.state.doc.firstChild.lastChild.firstChild.firstChild.textContent).toBe('Explanation');
    slots = dropSlotsForDoc(editor.state.doc, () => true);
    const after = row('After the list');
    moved = moveDraggableBlocksToPos(editor.state.tr, [row('Explanation').index], slots.find(slot => slot.pos === after.pos));
    expect(moved.changed).toBe(true); editor.view.dispatch(moved.tr);
    const body = editor.state.doc.firstChild.lastChild;
    expect(body.child(0).childCount).toBe(2);
    expect(body.child(1).type.name).toBe('bulletList');
    expect(body.child(1).textContent).toBe('Explanation');
    expect(moved.selectedPositions).toContain(row('Explanation').pos);
    editor.state.doc.check();
  });

  it('rejects incompatible drops without deleting the source', () => {
    open(); const before = editor.getJSON();
    const moved = moveDraggableBlocksToPos(editor.state.tr, [row('After the list').index], { pos: row('Explanation').pos });
    expect(moved.changed).toBe(false); expect(moved.tr.doc.toJSON()).toEqual(before);
  });

  it('formats just the selected entry while retaining its attached quote and other list entries', () => {
    open();
    const converted = convertDraggableBlocksToItems(editor.state.tr, [row('IsaiahFirst quotation').index], 'toggle', editor.schema);
    expect(converted.changed).toBe(true); editor.view.dispatch(converted.tr);
    expect(editor.getHTML()).toContain('<summary>Isaiah</summary>');
    expect(editor.getHTML()).toContain('<blockquote><p>First quotation</p></blockquote>');
    expect(editor.getHTML()).toContain('<li><p>Explanation</p></li>');
    editor.state.doc.check();
  });

  it('keeps collapsed dropdown content out of the marquee and complete-dropdown copies intact', () => {
    open(wrap(LIST).replace('<details open>', '<details>'));
    expect(rows()).toHaveLength(1);
    expect(nodesForDraggableBlocks(rows())[0].type.name).toBe('details');
  });
});
