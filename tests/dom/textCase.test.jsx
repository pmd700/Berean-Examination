import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { TextCase, isAllUpperCase, nextCaseTransform } from '@/components/editor/TextCaseExtension';

/**
 * ⌘⇧C — capitals, and back down again on a second press.
 *
 * Which way it goes is read from the text rather than remembered, so the tests
 * press it repeatedly: the interesting question is not whether one press works
 * but whether the second and third still do the obvious thing.
 */

let editor;
let host;

function mount(content = '<p>Blasphemy of the Holy Spirit</p>') {
  host = document.createElement('div');
  document.body.appendChild(host);
  // Link comes from the real editor's extension list; StarterKit has none, so
  // without it an <a> is dropped at parse time and proves nothing.
  editor = new Editor({ element: host, extensions: [StarterKit, Link, TextCase], content });
  return editor;
}

afterEach(() => { editor?.destroy(); host?.remove(); });
beforeEach(() => { editor = null; host = null; });

const IS_MAC = /Mac/.test(navigator.platform || '');

function press() {
  const event = new KeyboardEvent('keydown', {
    key: 'c',
    metaKey: IS_MAC,
    ctrlKey: !IS_MAC,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });
  return editor.view.someProp('handleKeyDown', (handler) => handler(editor.view, event)) === true;
}

const text = () => editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n');
const selectAll = () => editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });

describe('deciding which way to go', () => {
  it('reads all-caps text as already up', () => {
    expect(isAllUpperCase('HOLY SPIRIT')).toBe(true);
    expect(isAllUpperCase('Holy Spirit')).toBe(false);
    expect(isAllUpperCase('holy spirit')).toBe(false);
  });

  it('does not call punctuation or digits "all caps"', () => {
    // Otherwise "12:37-40" would count as upper and the first press would
    // quietly lower-case a selection that has no case at all.
    expect(isAllUpperCase('12:37-40')).toBe(false);
    expect(nextCaseTransform('12:37-40')).toBeNull();
    expect(nextCaseTransform('   ')).toBeNull();
  });
});

describe('pressing it', () => {
  it('puts the selection into capitals', () => {
    mount();
    selectAll();
    expect(press()).toBe(true);
    expect(text()).toBe('BLASPHEMY OF THE HOLY SPIRIT');
  });

  it('brings it back down on a second press', () => {
    mount();
    selectAll();
    press();
    press();
    expect(text()).toBe('blasphemy of the holy spirit');
  });

  it('goes back up on a third, so it keeps toggling', () => {
    mount();
    selectAll();
    press();
    press();
    press();
    expect(text()).toBe('BLASPHEMY OF THE HOLY SPIRIT');
  });

  it('keeps the words selected so the next press can reverse it', () => {
    mount();
    selectAll();
    press();
    expect(editor.state.selection.empty).toBe(false);
  });

  it('touches only what is selected', () => {
    mount('<p>keep this loud part quiet</p>');
    editor.commands.setTextSelection({ from: 6, to: 10 });
    press();
    expect(text()).toBe('keep THIS loud part quiet');
  });
});

describe('what it leaves alone', () => {
  it('does nothing with no selection', () => {
    mount();
    editor.commands.setTextSelection(3);
    expect(press()).toBe(false);
    expect(text()).toBe('Blasphemy of the Holy Spirit');
  });

  it('does nothing to a selection with no letters in it', () => {
    mount('<p>12:37-40</p>');
    selectAll();
    expect(press()).toBe(false);
    expect(text()).toBe('12:37-40');
  });

  it('keeps the formatting the words were wearing', () => {
    mount('<p>the <strong>living</strong> word</p>');
    selectAll();
    press();
    expect(editor.getHTML()).toContain('<strong>LIVING</strong>');
    expect(text()).toBe('THE LIVING WORD');
  });

  it('recases across a link without unmaking it', () => {
    mount('<p>see <a href="https://example.com">the passage</a> now</p>');
    selectAll();
    press();
    const html = editor.getHTML();
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('THE PASSAGE');
  });

  it('undoes in a single step', () => {
    mount();
    selectAll();
    press();
    editor.commands.undo();
    expect(text()).toBe('Blasphemy of the Holy Spirit');
  });

  it('works across more than one paragraph', () => {
    mount('<p>first line</p><p>second line</p>');
    editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });
    press();
    expect(text()).toBe('FIRST LINE\nSECOND LINE');
  });
});
