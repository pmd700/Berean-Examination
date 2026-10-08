import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import LogicBlock from '@/components/editor/LogicBlockExtension';
import Highlight from '@/components/editor/HighlightExtension';
import { renderLogicToHtml } from '@/lib/logic/logic-render';
import { installAppTypography } from '@/styles/typography';
import '@/components/logic/logic-renderer.css';
import 'katex/dist/katex.min.css';

installAppTypography();
const reference = renderLogicToHtml('B→¬H', { display: 'inline' });
document.getElementById('reference').innerHTML = reference.html;
const editor = new Editor({
  element: document.getElementById('editor'),
  extensions: [StarterKit, LogicBlock, Highlight],
  content: '<p>Therefore: <span data-bex-logic="inline" data-logic-source="B→¬H" data-logic-format="unicode"></span> remains true.</p>',
});
window.logicProof = {
  editor,
  state() {
    const { from, to } = editor.state.selection;
    return {
      from, to,
      selected: editor.state.doc.textBetween(from, to),
      text: editor.getText(),
      sourceMode: Boolean(document.querySelector('.logic-renderer__source-editor')),
      formula: document.querySelector('.logic-renderer__content')?.textContent,
      mathFont: getComputedStyle(document.querySelector('.logic-renderer__content')).fontFamily,
    };
  },
  rect(index) {
    const text = document.querySelector('.logic-renderer__content').firstChild;
    const range = document.createRange();
    range.setStart(text, index);
    range.setEnd(text, index + 1);
    const { x, y, width, height } = range.getBoundingClientRect();
    return { x, y, width, height };
  },
};
