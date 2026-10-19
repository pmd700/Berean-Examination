import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { closeHistory } from '@tiptap/pm/history';
import TEXT_EDITOR_MACHINERY from '@/components/editor/TEXT_EDITOR_MACHINERY';
import { blockDragPluginKey } from '@/components/editor/BlockDragExtension';
import { getDraggableBlocks } from '@/components/editor/blockDragModel';
import '@/index.css';

let editor;
const content = '<details open><summary>Further analysis</summary><div data-type="detailsContent"><ul><li><p>Isaiah</p><blockquote><p>First quotation</p></blockquote></li><li><p>Explanation to select</p></li><li><p>Matthew</p><blockquote><p>Second quotation</p></blockquote></li></ul><p>After the list</p></div></details>';
const dropContent = '<details open><summary>Professor Mindset</summary><div data-type="detailsContent"><p></p></div></details><h2>Principles:</h2><p>You find the real problem <strong>under the surface.</strong></p><p></p><ol><li><p>surface</p></li><li><p>mechanism</p></li><li><p>impact</p></li><li><p>attempt</p></li><li><p>priority</p></li></ol><p>Keep outside</p>';
function Fixture() {
  const [html, setHtml] = React.useState(content);
  return <MemoryRouter><main data-bex-marquee-surface><TEXT_EDITOR_MACHINERY bare marqueeScope="page" noteAnnotations content={html} onChange={setHtml} onEditorReady={value => { editor = value; }} /></main></MemoryRouter>;
}
createRoot(document.getElementById('editor')).render(<Fixture />);
window.listMarqueeProof = {
  ready: () => !!editor,
  reset() { editor.commands.setContent(content, true); editor.view.dispatch(closeHistory(editor.state.tr)); },
  resetDrop() { editor.commands.setContent(dropContent, true); editor.view.dispatch(closeHistory(editor.state.tr)); },
  dropPoints() {
    const heading = editor.view.dom.querySelector('h2').getBoundingClientRect();
    const last = [...editor.view.dom.querySelectorAll('li')].at(-1).getBoundingClientRect();
    const target = editor.view.dom.querySelector('.toggle-block__body > p').getBoundingClientRect();
    return { start: { x: 20, y: Math.ceil(heading.top + 3) }, end: { x: 30, y: Math.floor(last.bottom - 3) },
      hover: { x: Math.round(heading.left + 20), y: Math.round(heading.top + 8) },
      target: { x: Math.round(target.left + 40), y: Math.round(target.top + 2) } };
  },
  dropResult() {
    const body = editor.view.dom.querySelector('.toggle-block__body');
    return { heading: body.querySelector('h2')?.textContent, bold: body.querySelector('strong')?.textContent,
      items: [...body.querySelectorAll('ol li')].map(node => node.textContent),
      headings: editor.view.dom.querySelectorAll('h2').length, last: editor.state.doc.lastChild.textContent };
  },
  points() {
    const element = [...editor.view.dom.querySelectorAll('li')].find(node => node.textContent === 'Explanation to select');
    const rect = element.getBoundingClientRect();
    return { start: { x: 20, y: Math.ceil(rect.top + 3) }, end: { x: 30, y: Math.floor(rect.bottom - 3) } };
  },
  snapshot() {
    const rows = getDraggableBlocks(editor.state.doc);
    return { html: editor.getHTML(), selected: (blockDragPluginKey.getState(editor.state)?.selected || []).map(index => rows[index]?.node.textContent),
      selectedItems: editor.view.dom.querySelectorAll('li.bex-block-selected').length,
      selectedLists: editor.view.dom.querySelectorAll('ul.bex-block-selected').length };
  },
  copy() {
    const clipboardData = new DataTransfer();
    document.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData }));
    return { html: clipboardData.getData('text/html'), text: clipboardData.getData('text/plain') };
  },
  undo: () => editor.commands.undo(),
  redo: () => editor.commands.redo(),
};
