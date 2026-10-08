import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  CollapsibleToggle,
  ToggleContent,
  ToggleSummary,
} from '@/components/editor/CollapsibleToggleExtension';

let editor;
let host;

afterEach(() => {
  editor?.destroy();
  host?.remove();
});

function mount(content) {
  host = document.createElement('div');
  document.body.appendChild(host);
  editor = new Editor({
    element: host,
    extensions: [StarterKit, CollapsibleToggle, ToggleSummary, ToggleContent],
    content,
  });
}

function textStart(text) {
  let result;
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text.includes(text)) result = pos + node.text.indexOf(text);
  });
  if (result === undefined) throw new Error(`Missing text: ${text}`);
  return result;
}

function preparePaste(format) {
  mount(`
    <details open><summary>Open dropdown</summary><div data-type="detailsContent">
      <p>Insert here</p>
      <details><summary>Closed child</summary><div data-type="detailsContent">
        <p>Hidden text</p>
      </div></details>
    </div></details>
  `);
  // Model browser visibility in jsdom. The DOM itself stays real: after paste,
  // the new caret position points into the closed child in the PREVIOUS DOM.
  host.querySelector('.toggle-block .toggle-block [data-type="detailsContent"]').hidden = true;
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function () {
    return this.closest('[hidden]') ? null : document.body;
  });
  const from = textStart('Insert here') + 'Insert here'.length;
  const staleHiddenPosition = textStart('Hidden text');
  const payload = 'x'.repeat(staleHiddenPosition - from - (format === 'converted Markdown' ? 2 : 0));
  editor.commands.setTextSelection(from);
  return { from, payload };
}

describe('pasting inside dropdowns', () => {
  it.each(['plain text', 'rich HTML', 'converted Markdown'])(
    'leaves the caret after pasted %s even when the old DOM has hidden content at that position',
    (format) => {
      const { payload } = preparePaste(format);
      const event = new Event('paste');
      if (format === 'plain text') editor.view.pasteText(payload, event);
      else if (format === 'rich HTML') editor.view.pasteHTML(`<p><strong>${payload}</strong></p>`, event);
      else editor.commands.insertContent(`<p><strong>${payload}</strong></p>`);

      expect(editor.state.doc.firstChild.firstChild.textContent).toBe('Open dropdown');
      expect(editor.state.selection.from).toBe(textStart(payload) + payload.length);
      expect(editor.state.selection.$from.parent.textContent).toContain(payload);
      editor.commands.insertContent(' continued');
      expect(editor.state.selection.$from.parent.textContent).toContain(`${payload} continued`);
    },
  );

  it('keeps multiline paste and undo/redo in an open nested dropdown', () => {
    mount(`<details open><summary>Parent</summary><div data-type="detailsContent">
      <details open><summary>Child</summary><div data-type="detailsContent">
        <p>Before TARGET after</p>
      </div></details>
    </div></details>`);
    const from = textStart('TARGET');
    editor.commands.setTextSelection({ from, to: from + 'TARGET'.length });
    editor.view.pasteText('First pasted line\nSecond pasted line', new Event('paste'));

    const pastedDoc = editor.getJSON();
    const pastedPosition = textStart('Second pasted line') + 'Second pasted line'.length;
    expect(editor.state.selection.from).toBe(pastedPosition);
    expect(editor.state.selection.$from.parent.textContent).toBe('Second pasted line after');
    expect(editor.state.selection.$from.node(4).type.name).toBe('detailsContent');
    expect(editor.commands.undo()).toBe(true);
    expect(editor.state.doc.textContent).toContain('Before TARGET after');
    expect(editor.commands.redo()).toBe(true);
    expect(editor.getJSON()).toEqual(pastedDoc);
    expect(editor.state.selection.from).toBe(pastedPosition);
  });

  it('keeps the caret at the end of a large rich paste in an empty body', () => {
    mount('<details open><summary>Title</summary><div data-type="detailsContent"><p></p></div></details>');
    let emptyPosition;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph') emptyPosition = pos + 1;
    });
    editor.commands.setTextSelection(emptyPosition);
    editor.view.pasteHTML(
      '<h2>Heading</h2>' + '<p><strong>Long paragraph</strong></p>'.repeat(50) + '<p>Final line</p>',
      new Event('paste'),
    );
    expect(editor.state.selection.from).toBe(textStart('Final line') + 'Final line'.length);
    expect(editor.state.doc.firstChild.firstChild.textContent).toBe('Title');
  });

  it('still prevents a caret in a genuinely closed body and leaves its title editable', () => {
    preparePaste('plain text');
    editor.commands.setTextSelection(textStart('Hidden text'));
    expect(editor.state.selection.$from.parent.type.name).toBe('detailsSummary');
    expect(editor.state.selection.$from.parent.textContent).toBe('Closed child');
    editor.view.pasteText('Added ', new Event('paste'));
    expect(editor.state.selection.$from.parent.textContent).toBe('Added Closed child');
    expect(editor.state.selection.$from.parentOffset).toBe('Added '.length);
  });

  it('moves a hidden caret to the outer title when an ancestor is collapsed', () => {
    mount(`<details open><summary>Parent</summary><div data-type="detailsContent">
      <details open><summary>Child</summary><div data-type="detailsContent">
        <p>Writing inside</p>
      </div></details>
    </div></details>`);
    editor.commands.setTextSelection(textStart('Writing inside'));
    host.querySelector('.toggle-block__chevron').click();
    expect(editor.state.selection.$from.parent.type.name).toBe('detailsSummary');
    expect(editor.state.selection.$from.parent.textContent).toBe('Parent');
    expect(editor.state.doc.textContent).toContain('Writing inside');
  });
});
