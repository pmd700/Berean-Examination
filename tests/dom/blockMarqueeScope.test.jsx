import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { BlockDrag, blockDragPluginKey } from '@/components/editor/BlockDragExtension';

let pane;
const editors = [];
const rect = (element, x, y, width, height) => {
  element.getBoundingClientRect = () => new DOMRect(x, y, width, height);
};
function mount(x = 100) {
  if (!pane) {
    pane = document.createElement('div');
    pane.style.overflowY = 'auto';
    rect(pane, 0, 0, 1000, 700);
    document.body.appendChild(pane);
  }
  const box = document.createElement('div');
  box.dataset.bexGlobalEditor = 'true';
  rect(box, x, 100, 300, 200);
  pane.appendChild(box);
  const editor = new Editor({ element: box, extensions: [StarterKit, BlockDrag],
    content: '<p>First paragraph.</p><p>Second paragraph.</p>',
    editorProps: { handleScrollToSelection: () => true } });
  rect(editor.view.dom, x + 20, 110, 260, 170);
  [...editor.view.dom.children].forEach((child, index) => rect(child, x + 40, 120 + index * 60, 220, 40));
  editors.push(editor);
  return { editor, box };
}
function pointer(target, type, x, y) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  target.dispatchEvent(event);
  return event;
}
afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy());
  pane?.remove(); pane = null;
  window.getSelection().removeAllRanges();
});

describe('editor marquee boundaries', () => {
  it('leaves Scripture and workspace dragging alone, including with an existing block selection', () => {
    const { editor } = mount();
    const scripture = document.createElement('div');
    scripture.textContent = 'Scripture remains selectable';
    pane.appendChild(scripture);
    editor.view.dispatch(editor.state.tr.setMeta(blockDragPluginKey, { type: 'selection', selected: [0], source: 'marquee' }));
    const range = document.createRange(); range.selectNodeContents(scripture);
    window.getSelection().addRange(range);
    expect(pointer(scripture, 'pointerdown', 800, 140).defaultPrevented).toBe(false);
    expect(pointer(window, 'pointermove', 900, 250).defaultPrevented).toBe(false);
    expect(document.querySelector('.bex-block-drag-overlay.is-visible')).toBeNull();
    expect(blockDragPluginKey.getState(editor.state).selected).toEqual([]);
    expect(window.getSelection().toString()).toBe('Scripture remains selectable');
    expect(pointer(pane, 'pointerdown', 50, 180).defaultPrevented).toBe(false);
  });

  it('selects blocks from the editor margin and clips the rectangle when dragged beyond its box', () => {
    const { editor, box } = mount();
    expect(pointer(box, 'pointerdown', 110, 125).defaultPrevented).toBe(true);
    pointer(window, 'pointermove', 900, 600);
    const overlay = document.querySelector('.bex-block-drag-overlay.is-visible');
    expect(overlay).toBeTruthy();
    expect(overlay.style.left).toBe('110px');
    expect(overlay.style.top).toBe('125px');
    expect(overlay.style.width).toBe('290px');
    expect(overlay.style.height).toBe('175px');
    expect(blockDragPluginKey.getState(editor.state).selected).toEqual([0, 1]);
    pointer(window, 'pointercancel', 900, 600);
    expect(document.querySelector('.bex-block-drag-overlay.is-visible')).toBeNull();
    expect(editor.getHTML()).toBe('<p>First paragraph.</p><p>Second paragraph.</p>');
  });

  it('gives each editor its own box and preserves ordinary text selection', () => {
    const first = mount(); const second = mount(600);
    expect(pointer(second.box, 'pointerdown', 610, 125).defaultPrevented).toBe(true);
    pointer(window, 'pointermove', 650, 190);
    expect(blockDragPluginKey.getState(first.editor.state).selected).toEqual([]);
    expect(blockDragPluginKey.getState(second.editor.state).selected).toEqual([0, 1]);
    pointer(window, 'pointercancel', 650, 190);
    expect(pointer(first.editor.view.dom.firstChild, 'pointerdown', 180, 140).defaultPrevented).toBe(false);
    expect(pointer(first.box, 'pointerdown', 110, 400).defaultPrevented).toBe(false);
  });

  it.each([10, 990])('lets a full-page Note marquee start in the far margin at x=%s, without claiming nested editors or controls', x => {
    const { editor, box } = mount();
    pane.setAttribute('data-bex-marquee-surface', '');
    box.dataset.bexMarqueeScope = 'page';
    expect(pointer(pane, 'pointerdown', x, 125).defaultPrevented).toBe(true);
    pointer(window, 'pointermove', x, 190);
    expect(blockDragPluginKey.getState(editor.state).selected).toEqual([0, 1]);
    const overlay = document.querySelector('.bex-block-drag-overlay.is-visible');
    expect(overlay.style.left).toBe(`${x}px`);
    pointer(window, 'pointercancel', x, 190);

    expect(pointer(editor.view.dom.firstChild, 'pointerdown', 180, 140).defaultPrevented).toBe(false);
    const nested = mount(600);
    expect(pointer(nested.editor.view.dom.firstChild, 'pointerdown', 680, 140).defaultPrevented).toBe(false);
    expect(pointer(nested.box, 'pointerdown', 610, 125).defaultPrevented).toBe(true);
    pointer(window, 'pointermove', 650, 190);
    expect(blockDragPluginKey.getState(editor.state).selected).toEqual([]);
    pointer(window, 'pointercancel', 650, 190);
    const control = document.createElement('button'); pane.appendChild(control);
    expect(pointer(control, 'pointerdown', x, 130).defaultPrevented).toBe(false);
    expect(pointer(document.body, 'pointerdown', x, 130).defaultPrevented).toBe(false);
  });
});
