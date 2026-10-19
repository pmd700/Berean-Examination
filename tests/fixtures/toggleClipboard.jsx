import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import TEXT_EDITOR_MACHINERY from '@/components/editor/TEXT_EDITOR_MACHINERY';
import { blockDragPluginKey } from '@/components/editor/BlockDragExtension';

let editor;
function Fixture() {
  const [html, setHtml] = React.useState('<p>Fixture</p>');
  return <MemoryRouter><TEXT_EDITOR_MACHINERY bare noteAnnotations content={html} onChange={setHtml} onEditorReady={value => { editor = value; }} /></MemoryRouter>;
}
createRoot(document.getElementById('editor')).render(<Fixture />);
window.toggleClipboardProof = {
  ready: () => !!editor,
  set: html => editor.commands.setContent(html, true),
  select(text) {
    let from;
    editor.state.doc.descendants((node, pos) => { if (node.isText && node.text.includes(text)) from = pos + node.text.indexOf(text); });
    if (from == null) throw new Error(`Missing ${text}`);
    editor.commands.setTextSelection({ from, to: from + text.length }); editor.view.focus();
  },
  whole: () => { editor.commands.setNodeSelection(0); editor.view.focus(); },
  marquee: () => editor.view.dispatch(editor.state.tr.setMeta(blockDragPluginKey, { type: 'selection', selected: [0], anchor: 0, previewing: false, source: 'marquee' })),
  copy(type = 'copy') {
    const clipboardData = new DataTransfer();
    const event = new ClipboardEvent(type, { bubbles: true, cancelable: true, clipboardData });
    editor.view.dom.dispatchEvent(event);
    return { html: clipboardData.getData('text/html'), text: clipboardData.getData('text/plain'), handled: event.defaultPrevented };
  },
  paste(data) {
    editor.commands.setTextSelection(editor.state.doc.content.size - 1); editor.view.focus();
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/html', data.html); clipboardData.setData('text/plain', data.text);
    editor.view.dom.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
    return { html: editor.getHTML(), text: editor.getText(), dropdowns: editor.view.dom.querySelectorAll('.toggle-block').length };
  },
  html: () => editor.getHTML(),
};
