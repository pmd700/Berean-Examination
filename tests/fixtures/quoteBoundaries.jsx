import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { closeHistory } from '@tiptap/pm/history';
import TEXT_EDITOR_MACHINERY from '@/components/editor/TEXT_EDITOR_MACHINERY';

let editor;
function Fixture() {
  const [html, setHtml] = React.useState('<p>Fixture</p>');
  return <MemoryRouter><TEXT_EDITOR_MACHINERY bare noteAnnotations content={html} onChange={setHtml} onEditorReady={value => { editor = value; }} /></MemoryRouter>;
}
createRoot(document.getElementById('editor')).render(<Fixture />);
window.quoteBoundaryProof = {
  ready: () => !!editor,
  load(html, text, offset = 0) {
    editor.commands.setContent(html, true);
    let target;
    editor.state.doc.descendants((node, pos, parent) => {
      if (text === null && node.type.name === 'paragraph' && !node.content.size && parent?.type.name === 'blockquote') target = pos + 1;
      if (text !== null && node.isText && node.text.includes(text)) target = pos + node.text.indexOf(text) + offset;
    });
    if (target == null) throw new Error('Missing caret target');
    editor.commands.setTextSelection(target);
    // A fixture replacement is not typing; keep the next edit's Undo isolated.
    editor.view.dispatch(closeHistory(editor.state.tr));
    editor.view.focus();
  },
  undo: () => editor.commands.undo(),
  redo: () => editor.commands.redo(),
  snapshot: () => ({ html: editor.getHTML(), offset: editor.state.selection.$from.parentOffset,
    quoted: editor.isActive('blockquote'), dropdown: editor.isActive('detailsContent') }),
};
