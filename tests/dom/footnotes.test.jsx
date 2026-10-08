import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Footnote, {
  FOOTNOTE_JUMP_EVENT,
  collectFootnotes,
  getFootnoteState,
} from '@/components/editor/FootnoteExtension';

/**
 * Footnotes: ⌘⇧F, continuous numbering, and the jump to the foot of the page.
 *
 * The number a reader sees is never stored — it is painted on from document
 * order every transaction — so these tests read it back off the rendered DOM
 * rather than from the document, which is the only way to catch numbering that
 * silently stops following the prose.
 */

let editor;
let host;

function mount(content = '<p>Paul writes plainly</p>') {
  host = document.createElement('div');
  document.body.appendChild(host);
  editor = new Editor({ element: host, extensions: [StarterKit, Footnote], content });
  return editor;
}

afterEach(() => { editor?.destroy(); host?.remove(); });
beforeEach(() => { editor = null; host = null; });

const IS_MAC = /Mac/.test(navigator.platform || '');

function press(key, { shift = false } = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    metaKey: IS_MAC,
    ctrlKey: !IS_MAC,
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
  return editor.view.someProp('handleKeyDown', (handler) => handler(editor.view, event)) === true;
}

/** The numbers actually on screen, in reading order. */
const renderedNumbers = () =>
  Array.from(host.querySelectorAll('sup[data-footnote-id]'))
    .map(node => node.getAttribute('data-footnote-number'));

describe('raising a footnote', () => {
  it('drops a reference at the caret on ⌘⇧F and opens it for writing', () => {
    mount();
    editor.commands.setTextSelection(5);
    expect(press('f', { shift: true })).toBe(true);

    const footnotes = collectFootnotes(editor.state.doc);
    expect(footnotes).toHaveLength(1);
    expect(getFootnoteState(editor.state).draftId).toBe(footnotes[0].id);
  });

  it('attaches to the end of a highlighted phrase instead of replacing it', () => {
    mount('<p>Paul writes plainly</p>');
    editor.commands.setTextSelection({ from: 1, to: 5 });
    press('f', { shift: true });

    expect(editor.state.doc.textContent).toBe('Paul writes plainly');
    expect(collectFootnotes(editor.state.doc)[0].pos).toBe(5);
  });

  it('saves the body onto the reference itself, so it rides inside the note', () => {
    mount();
    editor.commands.setTextSelection(5);
    editor.commands.addFootnote();
    const { id } = collectFootnotes(editor.state.doc)[0];

    editor.commands.updateFootnote(id, '<p>Bauckham, 122.</p>');

    // HTML attribute serialization escapes `&` and `"` but never `<` or `>`,
    // so the body is written into the markup with its tags intact. Anything
    // that reads footnotes back out of saved markup has to expect that.
    expect(editor.getHTML()).toContain('data-footnote-text="<p>Bauckham, 122.</p>"');
    expect(collectFootnotes(editor.state.doc)[0].text).toBe('<p>Bauckham, 122.</p>');
  });

  it('survives a save and reload of the note', () => {
    mount();
    editor.commands.setTextSelection(5);
    editor.commands.addFootnote();
    editor.commands.updateFootnote(collectFootnotes(editor.state.doc)[0].id, '<p>Wright, 84.</p>');
    const saved = editor.getHTML();

    editor.destroy();
    host.remove();
    mount(saved);

    expect(collectFootnotes(editor.state.doc)[0].text).toBe('<p>Wright, 84.</p>');
  });
});

describe('numbering', () => {
  it('numbers references by where they sit, not by when they were made', () => {
    mount('<p>alpha beta gamma</p>');
    // Made last-to-first: the one nearest the end is created first.
    editor.commands.setTextSelection(17);
    editor.commands.addFootnote();
    editor.commands.setTextSelection(6);
    editor.commands.addFootnote();

    expect(renderedNumbers()).toEqual(['1', '2']);
  });

  it('renumbers what follows when a footnote is deleted', () => {
    mount('<p>alpha beta gamma</p>');
    editor.commands.setTextSelection(6);
    editor.commands.addFootnote();
    editor.commands.setTextSelection(12);
    editor.commands.addFootnote();
    editor.commands.setTextSelection(19);
    editor.commands.addFootnote();
    expect(renderedNumbers()).toEqual(['1', '2', '3']);

    const [first] = collectFootnotes(editor.state.doc);
    editor.commands.removeFootnote(first.id);

    expect(renderedNumbers()).toEqual(['1', '2']);
    expect(collectFootnotes(editor.state.doc)).toHaveLength(2);
  });

  it('continues the count across a book instead of restarting on each page', () => {
    mount('<p>alpha beta</p>');
    editor.commands.setFootnoteOffset(11);
    editor.commands.setTextSelection(6);
    editor.commands.addFootnote();
    editor.commands.setTextSelection(12);
    editor.commands.addFootnote();

    expect(renderedNumbers()).toEqual(['12', '13']);
    expect(collectFootnotes(editor.state.doc, 11).map(item => item.number)).toEqual([12, 13]);
  });

  it('leaves the number out of what gets saved, so it can never go stale', () => {
    mount();
    editor.commands.setTextSelection(5);
    editor.commands.addFootnote();
    expect(editor.getHTML()).not.toContain('data-footnote-number');
  });
});

describe('jumping to the note at the foot of the page', () => {
  it('announces which footnote was pressed rather than scrolling itself', () => {
    mount();
    editor.commands.setTextSelection(5);
    editor.commands.addFootnote();
    const { id, pos } = collectFootnotes(editor.state.doc)[0];

    const seen = [];
    editor.view.dom.addEventListener(FOOTNOTE_JUMP_EVENT, (event) => seen.push(event.detail));

    const node = editor.state.doc.nodeAt(pos);
    const handled = editor.view.someProp(
      'handleClickOn',
      handler => handler(editor.view, pos, node, pos, new MouseEvent('click'), true),
    );

    expect(handled).toBe(true);
    expect(seen).toEqual([{ id, pos }]);
    expect(getFootnoteState(editor.state).activeId).toBe(id);
  });
});
