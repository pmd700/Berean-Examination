import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Highlight, {
  DEFAULT_HIGHLIGHT,
  HIGHLIGHT_COLORS,
  HIGHLIGHT_MENU_EVENT,
} from '@/components/editor/HighlightExtension';

/**
 * Strikethrough on Cmd+S and highlighting on Cmd+H.
 *
 * Both shortcuts are already spoken for elsewhere — Cmd+S is the browser's
 * "save page", Cmd+H is macOS's "hide application" — so the handlers must
 * report that they consumed the key, which is what suppresses the other
 * behaviour. That return value is asserted as carefully as the formatting.
 */

let editor;
let host;

function mount(content = '<p>Blasphemy of the Holy Spirit</p>') {
  host = document.createElement('div');
  document.body.appendChild(host);
  editor = new Editor({ element: host, extensions: [StarterKit, Highlight], content });
  return editor;
}

afterEach(() => { editor?.destroy(); host?.remove(); });
beforeEach(() => { editor = null; host = null; });

/**
 * A real keypress, down the path a real one takes.
 *
 * `Mod` is Cmd on a Mac and Ctrl everywhere else, and prosemirror-keymap
 * decides which by reading navigator.platform — which jsdom reports as an empty
 * string. So the test has to press whichever key IS Mod here, or the binding it
 * is checking simply never matches.
 */
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

const selectAll = () => editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });

describe('strikethrough on Cmd+S', () => {
  it('strikes the selected text', () => {
    mount();
    selectAll();
    expect(press('s')).toBe(true);
    expect(editor.getHTML()).toContain('<s>');
  });

  it('lifts it again on a second press', () => {
    mount();
    selectAll();
    press('s');
    press('s');
    expect(editor.getHTML()).not.toContain('<s>');
  });

  it('reports the key as consumed, which is what stops the browser saving', () => {
    mount();
    selectAll();
    expect(press('s')).toBe(true);
  });

  it('survives a round trip through saved HTML', () => {
    mount();
    selectAll();
    press('s');
    const saved = editor.getHTML();
    editor.commands.setContent(saved);
    expect(editor.isActive('strike') || editor.getHTML().includes('<s>')).toBe(true);
  });
});

describe('highlighting on Cmd+H', () => {
  it('asks for a colour rather than picking one', () => {
    // The menu is the feature: Cmd+H should not silently paint yellow.
    mount();
    const listener = vi.fn();
    editor.view.dom.addEventListener(HIGHLIGHT_MENU_EVENT, listener);
    selectAll();

    expect(press('h')).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(editor.getHTML()).not.toContain('<mark');
  });

  it('does nothing with an empty caret, since there is no text to colour', () => {
    mount();
    const listener = vi.fn();
    editor.view.dom.addEventListener(HIGHLIGHT_MENU_EVENT, listener);
    editor.commands.setTextSelection(2);

    expect(press('h')).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('also answers to Cmd+Shift+H, which no operating system has claimed', () => {
    // On macOS the App menu takes Cmd+H before the page can see it; this is
    // the binding that works regardless.
    mount();
    const listener = vi.fn();
    editor.view.dom.addEventListener(HIGHLIGHT_MENU_EVENT, listener);
    selectAll();

    expect(press('h', { shift: true })).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('applying a highlight colour', () => {
  it('paints the selection in the chosen colour', () => {
    mount();
    selectAll();
    editor.commands.setHighlight('rgba(52, 168, 111, 0.34)');

    const html = editor.getHTML();
    expect(html).toContain('<mark');
    expect(html).toContain('data-highlight="rgba(52, 168, 111, 0.34)"');
  });

  it('renders an inline style too, for everywhere the editor is not running', () => {
    mount();
    selectAll();
    editor.commands.setHighlight(HIGHLIGHT_COLORS[3].value);
    expect(editor.getHTML()).toContain(`background-color: ${HIGHLIGHT_COLORS[3].value}`);
  });

  it('keeps the surrounding text colour instead of the browser mark default', () => {
    mount();
    selectAll();
    editor.commands.setHighlight(HIGHLIGHT_COLORS[4].value);
    expect(editor.getHTML()).toContain('color: inherit');
  });

  it('survives the round trip through saved HTML', () => {
    // Notes are stored as HTML; a colour that does not parse back vanishes the
    // next time the note is opened.
    mount();
    selectAll();
    editor.commands.setHighlight(HIGHLIGHT_COLORS[5].value);
    editor.commands.setContent(editor.getHTML());

    let colour = null;
    editor.state.doc.descendants((node) => {
      node.marks.forEach((mark) => {
        if (mark.type.name === 'highlight') colour = mark.attrs.color;
      });
    });
    expect(colour).toBe(HIGHLIGHT_COLORS[5].value);
  });

  it('recolours an already-highlighted run rather than nesting a second mark', () => {
    mount();
    selectAll();
    editor.commands.setHighlight(HIGHLIGHT_COLORS[0].value);
    editor.commands.setHighlight(HIGHLIGHT_COLORS[4].value);

    const html = editor.getHTML();
    expect((html.match(/<mark/g) || []).length).toBe(1);
    expect(html).toContain(HIGHLIGHT_COLORS[4].value);
  });

  it('clears the highlight again', () => {
    mount();
    selectAll();
    editor.commands.setHighlight(HIGHLIGHT_COLORS[0].value);
    editor.commands.unsetHighlight();
    expect(editor.getHTML()).not.toContain('<mark');
  });

  it('falls back to a colour when asked for none', () => {
    mount();
    selectAll();
    editor.commands.setHighlight();
    expect(editor.getHTML()).toContain(DEFAULT_HIGHLIGHT);
  });

  it('leaves the text itself untouched', () => {
    mount();
    selectAll();
    editor.commands.setHighlight(HIGHLIGHT_COLORS[1].value);
    expect(editor.state.doc.textContent).toBe('Blasphemy of the Holy Spirit');
  });

  it('highlights only what was selected', () => {
    mount('<p>one two three</p>');
    editor.commands.setTextSelection({ from: 5, to: 8 });
    editor.commands.setHighlight(HIGHLIGHT_COLORS[0].value);

    let marked = '';
    editor.state.doc.descendants((node) => {
      if (node.isText && node.marks.some((mark) => mark.type.name === 'highlight')) marked += node.text;
    });
    expect(marked).toBe('two');
  });
});
