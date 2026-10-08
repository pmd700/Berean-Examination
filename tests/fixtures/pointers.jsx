import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import RichTextEditor from '@/components/editor/RichTextEditor';
import { collectPointers } from '@/components/editor/pointerModel';
import { getPointerState } from '@/components/editor/PointerExtension';
import { copyNotePage } from '@/components/notes/copyNotePage';
import { blockDragPluginKey } from '@/components/editor/BlockDragExtension';

const paragraphs = Array.from({ length: 22 }, (_, index) => `<p>Research paragraph ${index + 1}. Notes and observations belong here, with room to follow each connection.</p>`).join('');
const content = `<h2>Pointers</h2>
<p><strong>Pellentesque</strong> a <em>venenatis</em> nunc, vel sollicitudin ante.</p>
<p>Nunc varius tempus erat, sit amet pretium <strong>nibh</strong> molestie eget. Sed convallis commodo nulla. Fusce egestas pulvinar dapibus. Fusce at purus nec quam commodo facilisis non a nulla. Nulla vehicula at odio ut bibendum. Donec finibus felis varius urna placerat, ut ullamcorper tortor <strong>tincidunt</strong>.</p>
<p>In dapibus orci ipsum, non <strong>condimentum</strong> lorem aliquet id. This pointer leads to the exact destination, inside a closed section far below.</p>
${paragraphs}<details open><summary>Evidence and sources</summary><div data-type="detailsContent"><p>Read the surrounding context.</p><details open><summary>A closer examination</summary><div data-type="detailsContent"><p>This is the exact <strong>destination</strong> that the pointer remembers.</p></div></details></div></details>${paragraphs}`;
let editor;
function select(text, last = false) {
  const matches = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text.includes(text)) matches.push(pos + node.text.indexOf(text));
  });
  const from = last ? matches.at(-1) : matches[0];
  editor.commands.setTextSelection({ from, to: from + text.length });
  editor.view.focus();
}
function Fixture() {
  const [html, setHtml] = React.useState(content);
  return <MemoryRouter><RichTextEditor bare noteAnnotations content={html} onChange={setHtml} onEditorReady={instance => { editor = instance; }} /></MemoryRouter>;
}
createRoot(document.getElementById('editor')).render(<Fixture />);
window.pointerProof = {
  ready: () => Boolean(editor), select,
  snapshot: () => ({
    count: collectPointers(editor.state.doc).length,
    pending: getPointerState(editor.state).pending.find().length,
    kinds: [...document.querySelectorAll('[data-pointer-kind]')].map(el => el.dataset.pointerKind),
    sections: [...document.querySelectorAll('.toggle-block')].map(el => el.classList.contains('is-open')),
    hit: document.querySelector('.bex-spotlight-hit')?.textContent,
    hitY: document.querySelector('.bex-spotlight-hit')?.getBoundingClientRect().top,
    scroll: document.getElementById('scroll').scrollTop,
    paths: [...document.querySelectorAll('.bex-pointer-line-ink')].map(el => el.getAttribute('d')),
  }),
  closeSections() {
    editor.commands.setTextSelection(1);
    document.querySelectorAll('.toggle-block.is-open > .toggle-block__chevron').forEach(button => button.click());
    editor.commands.cancelPointer();
    document.getElementById('scroll').scrollTop = 0;
  },
  linePoint() {
    const path = document.querySelector('[data-pointer-kind="gutter"] .bex-pointer-line-hit');
    const point = path.getPointAtLength(25).matrixTransform(path.getScreenCTM());
    return { x: Math.round(point.x), y: Math.round(point.y) };
  },
  scrollAlignment() {
    const scroller = document.getElementById('scroll');
    const lines = [...document.querySelectorAll('[data-pointer-line-id]')];
    const offsets = () => lines.map(line => {
      const origin = line.querySelector('circle').getBoundingClientRect();
      const anchor = [...editor.view.dom.querySelectorAll('[data-pointer-role="source"]')]
        .find(span => span.getAttribute('data-pointer-id') === line.dataset.pointerLineId).getBoundingClientRect();
      return { x: (origin.left + origin.right) / 2 - anchor.left, y: (origin.top + origin.bottom) / 2 - anchor.top };
    });
    scroller.scrollTop = 0;
    const initial = offsets();
    const paths = lines.map(line => line.querySelector('path').getAttribute('d'));
    let maxDrift = 0;
    // Intentionally NO await: a fixed overlay cannot catch up between these
    // measurements. The browser must move the text and lines as one surface.
    for (const top of [175, 35, 410, 90, 280, 0]) {
      scroller.scrollTop = top;
      offsets().forEach((offset, index) => {
        maxDrift = Math.max(maxDrift, Math.abs(offset.x - initial[index].x), Math.abs(offset.y - initial[index].y));
      });
    }
    return { maxDrift, pathsUnchanged: lines.every((line, index) => line.querySelector('path').getAttribute('d') === paths[index]) };
  },
  dropdownRoute() {
    editor.commands.setContent('<details open><summary>Source dropdown</summary><div data-type="detailsContent"><p>Source material</p></div></details><p>Between sections</p><details open><summary>Target dropdown</summary><div data-type="detailsContent"><p>Target material</p></div></details>');
    document.getElementById('scroll').scrollTop = 0;
  },
  caretAlignment() {
    const path = document.querySelector('.bex-pointer-line-ink');
    const carets = [...editor.view.dom.querySelectorAll('.toggle-block > .toggle-block__chevron svg path')];
    const points = [path.getPointAtLength(0), path.getPointAtLength(path.getTotalLength())]
      .map(point => point.matrixTransform(path.getScreenCTM()));
    return points.map((point, index) => {
      const rect = carets[index].getBoundingClientRect();
      return { dx: point.x - rect.left, dy: point.y - (rect.top + rect.bottom) / 2 };
    });
  },
  echoFixture() {
    editor.commands.setContent('<p><strong>Linked passage</strong></p><p>placeholder</p><p>Unchanged prose</p>');
    document.getElementById('scroll').scrollTop = 0;
  },
  copy(method) {
    const data = {};
    const event = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: {
      clearData: () => {}, setData: (type, value) => { data[type] = value; },
    } });
    if (method === 'page') {
      const original = document.execCommand;
      document.execCommand = () => { document.dispatchEvent(event); return true; };
      try { copyNotePage(editor.getHTML(), 'Echo test', 0, editor); }
      finally { document.execCommand = original; }
    } else if (method === 'block') {
      editor.view.dispatch(editor.state.tr.setMeta(blockDragPluginKey, { type: 'selection', selected: [1], anchor: 1 }));
      document.dispatchEvent(event);
      editor.view.dispatch(editor.state.tr.setMeta(blockDragPluginKey, { type: 'selection', selected: [], anchor: null }));
    } else editor.view.dom.dispatchEvent(event);
    return data;
  },
  rightRoute() {
    document.getElementById('editor').classList.add('right-route-proof');
    editor.commands.setContent(`<p>Right source</p>${paragraphs}<p>Right target</p>`);
    document.getElementById('scroll').scrollTop = 0;
  },
  gutterBounds() {
    const line = document.querySelector('[data-pointer-kind="gutter"]');
    const path = line?.querySelector('path');
    const box = editor.view.dom.getBoundingClientRect();
    const end = path?.getPointAtLength(path.getTotalLength()).matrixTransform(path.getScreenCTM());
    const target = editor.view.dom.querySelector('[data-pointer-role="target"]')?.getBoundingClientRect();
    return { side: line?.dataset.pointerSide, routeRight: path?.getBoundingClientRect().right,
      textRight: box.right, endpointGap: end && target ? end.x - target.right : null };
  },
  reload() { const html = editor.getHTML(); editor.commands.setContent(html); },
  saved: () => editor.getHTML(),
  text: () => editor.state.doc.textContent,
  undo: () => editor.commands.undo(),
  cancel: () => editor.commands.cancelPointer(),
  blockSelect() {
    editor.view.dispatch(editor.state.tr.setMeta(blockDragPluginKey, { type: 'selection', selected: [1], anchor: 1 }));
    editor.view.dom.blur();
  },
  remove: () => editor.commands.removePointer(collectPointers(editor.state.doc)[0].id),
};
