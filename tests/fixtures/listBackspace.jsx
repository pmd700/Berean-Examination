import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import RichTextEditor from '@/components/editor/RichTextEditor';

let editor;
function Fixture() {
  const [html, setHtml] = React.useState('<p>List Backspace fixture</p>');
  return <MemoryRouter><RichTextEditor bare noteAnnotations content={html} onChange={setHtml}
    onEditorReady={instance => { editor = instance; }} /></MemoryRouter>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
window.listBackspaceProof = {
  ready: () => Boolean(editor),
  load(html, text) {
    editor.commands.setContent(html);
    let from;
    editor.state.doc.descendants((node, pos) => {
      if (from === undefined && node.isText && node.text.includes(text)) from = pos + node.text.indexOf(text);
    });
    editor.commands.setTextSelection(from);
    editor.view.focus();
  },
  snapshot: () => ({
    html: editor.getHTML(), text: editor.state.doc.textContent,
    nodes: editor.state.doc.content.content.map(node => node.type.name),
    offset: editor.state.selection.$from.parentOffset,
    listItems: editor.view.dom.querySelectorAll('li').length,
  }),
};
