import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { closeHistory } from '@tiptap/pm/history';
import { DOMSerializer } from '@tiptap/pm/model';
import LogicBlock from '@/components/editor/LogicBlockExtension';
import Highlight from '@/components/editor/HighlightExtension';
import LogicRichHtml from '@/components/logic/LogicRichHtml';
import { editableLogicContent } from '@/lib/logic/editable-logic';

let editor;
let host;

function legacy(source, tag = 'span') {
  const element = document.createElement(tag);
  element.dataset.bexLogic = 'inline';
  element.dataset.logicSource = source;
  element.dataset.logicFormat = 'latex';
  element.innerHTML = '<code>old fallback that must not be duplicated</code>';
  return element.outerHTML;
}

function mount(html = '<p>Therefore: ' + legacy('B→¬H') + ' after.</p>') {
  host = document.createElement('div');
  document.body.appendChild(host);
  editor = new Editor({ element: host, extensions: [StarterKit, LogicBlock, Highlight], content: html });
  return editor;
}

function formula() {
  let result;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'logicBlock') { result = { node, pos, start: pos + 1 }; return false; }
  });
  return result;
}

function selectCharacter(character) {
  const { node, start } = formula();
  const offset = node.textContent.indexOf(character);
  expect(offset).toBeGreaterThanOrEqual(0);
  editor.commands.setTextSelection({ from: start + offset, to: start + offset + character.length });
}

function paste(text, html = '') {
  const event = {
    clipboardData: { getData: kind => kind === 'text/html' ? html : text },
    preventDefault() {},
  };
  return editor.view.someProp('handlePaste', handler => handler(editor.view, event));
}

afterEach(() => { editor?.destroy(); host?.remove(); });

describe('native editing of rendered logic', () => {
  it('opens saved LaTeX as visible letters and symbols without an atomic source editor', () => {
    mount('<p>' + legacy('B \\rightarrow \\neg H') + '</p>');
    expect(formula().node.textContent).toBe('B → ¬ H');
    expect(formula().node.isAtom).toBe(false);
    expect(host.textContent).toBe('B → ¬ H');
    expect(host.querySelector('[contenteditable="false"]')).toBeNull();
    expect(host.querySelector('.logic-renderer__source-editor')).toBeNull();
    const before = editor.getHTML();
    host.querySelector('.logic-renderer__content').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(editor.getHTML()).toBe(before);
    expect(host.textContent).not.toContain('\\rightarrow');
  });

  it('assigns a real text position to every visible letter and logic symbol', () => {
    mount();
    const text = host.querySelector('.logic-renderer__content').firstChild;
    const { start } = formula();
    Array.from('B→¬H').forEach((character, offset) => {
      const pos = editor.view.posAtDOM(text, offset);
      expect(pos).toBe(start + offset);
      editor.commands.setTextSelection({ from: pos, to: pos + 1 });
      expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)).toBe(character);
    });
  });

  it.each(['B', '→', '¬', 'H'])('deletes only the selected %s and restores it with undo', character => {
    mount();
    selectCharacter(character);
    editor.commands.deleteSelection();
    expect(formula().node.textContent).toBe('B→¬H'.replace(character, ''));
    expect(editor.getText()).toContain('Therefore:');
    expect(editor.getText()).toContain('after.');
    expect(editor.commands.undo()).toBe(true);
    expect(formula().node.textContent).toBe('B→¬H');
    expect(editor.commands.redo()).toBe(true);
    expect(formula().node.textContent).toBe('B→¬H'.replace(character, ''));
  });

  it('replaces one selected symbol without discarding the math formatting', () => {
    mount();
    selectCharacter('→');
    editor.commands.insertContent('↔');
    expect(formula().node.textContent).toBe('B↔¬H');
    expect(host.querySelector('.logic-renderer--editable')).toBeTruthy();
  });

  it('highlights just one symbol and keeps the mark after saving, loading and previewing', () => {
    mount();
    selectCharacter('¬');
    editor.commands.setHighlight('rgba(139, 92, 246, 0.40)');
    expect(host.querySelector('mark').textContent).toBe('¬');
    const saved = editor.getHTML();
    editor.commands.setContent(saved);
    expect(host.querySelector('mark').textContent).toBe('¬');
    render(<div data-testid="preview"><LogicRichHtml content={saved} /></div>);
    expect(screen.getByTestId('preview').querySelector('mark').textContent).toBe('¬');
    expect(screen.getByTestId('preview').textContent).toContain('B→¬H');
  });

  it('serializes current characters rather than resurrecting the original source', () => {
    mount();
    selectCharacter('H');
    editor.commands.insertContent('Q');
    const saved = editor.getHTML();
    expect(saved).toContain('data-logic-source="B→¬Q"');
    editor.commands.setContent(saved);
    expect(formula().node.textContent).toBe('B→¬Q');
  });

  it('can copy and cut only the arrow while leaving the formula around it', () => {
    mount();
    selectCharacter('→');
    const slice = editor.state.selection.content();
    const clipboard = document.createElement('div');
    clipboard.append(DOMSerializer.fromSchema(editor.schema).serializeFragment(slice.content));
    expect(clipboard.textContent).toBe('→');
    editor.commands.deleteSelection();
    expect(formula().node.textContent).toBe('B¬H');
  });

  it('converts explicit formula paste without creating another source mode', () => {
    mount('<p></p>');
    editor.commands.setTextSelection(1);
    expect(paste('{{logic: P\\land Q}}')).toBe(true);
    expect(formula().node.textContent).toBe('P∧ Q');
  });

  it('pastes symbols inside an existing formula without nesting math nodes', () => {
    mount();
    selectCharacter('→');
    expect(paste('\\leftrightarrow')).toBe(true);
    expect(formula().node.textContent).toBe('B↔¬H');
    expect(formula().node.childCount).toBe(1);
  });

  it('types a supported LaTeX command plus space as a visible symbol', () => {
    mount('<p>' + legacy('B\\neg') + '</p>');
    const { start, node } = formula();
    editor.commands.setTextSelection(start + node.content.size);
    editor.commands.insertContent('\\rightarrow');
    const pos = editor.state.selection.from;
    expect(editor.view.someProp('handleTextInput', handler => handler(editor.view, pos, pos, ' '))).toBe(true);
    expect(formula().node.textContent).toBe('B¬→');
  });

  it('only explicit Cmd+L removes math styling, keeping the visible text and its marks', () => {
    mount();
    selectCharacter('¬');
    editor.commands.setHighlight();
    editor.view.dispatch(closeHistory(editor.state.tr));
    editor.commands.toggleLogic();
    expect(formula()).toBeUndefined();
    expect(editor.getText()).toBe('Therefore: B→¬H after.');
    expect(host.querySelector('mark').textContent).toBe('¬');
    editor.commands.undo();
    expect(formula().node.textContent).toBe('B→¬H');
  });

  it('imports old block formulas and boxed text without losing their content', () => {
    mount(legacy('\\boxtext{Truth is objective.}', 'div'));
    expect(formula().node.textContent).toBe('Truth is objective.');
    expect(formula().node.attrs.presentation).toBe('boxed-text');
    expect(editor.getHTML()).toContain('data-logic-source="\\boxtext{Truth is objective.}"');
  });

  it('retains unsupported or incomplete source instead of deleting it', () => {
    expect(editableLogicContent('P\\unknown{Q}').text).toBe('P\\unknown{Q}');
    expect(editableLogicContent('\\text{unfinished').text).toBe('\\text{unfinished');
  });
});
