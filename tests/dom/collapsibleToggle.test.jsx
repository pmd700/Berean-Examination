import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  CollapsibleToggle,
  ToggleContent,
  ToggleSummary,
} from '@/components/editor/CollapsibleToggleExtension';

/**
 * The disclosure triangle, driven the way a user drives it.
 *
 * tests/collapsibleToggle.test.js can only assert that the source still contains
 * `default: false` and a `rotate(90deg)` assignment. These mount a real editor,
 * click the real button and read the resulting DOM — the behaviour I previously
 * had to verify by hand in a browser harness every single time.
 *
 * A minimal editor rather than the full TEXT_EDITOR_MACHINERY: the unit under test is
 * the toggle extension, and dragging in katex, images and the desktop bridge
 * would only add ways for this to fail for unrelated reasons.
 */

let editor;
let host;

function mountEditor(content) {
  host = document.createElement('div');
  document.body.appendChild(host);
  editor = new Editor({
    element: host,
    extensions: [StarterKit, CollapsibleToggle, ToggleSummary, ToggleContent],
    content,
  });
  return editor;
}

const toggleEl = () => host.querySelector('.toggle-block');
const chevronEl = () => host.querySelector('.toggle-block > .toggle-block__chevron');

function textEndPosition(text) {
  let position = null;
  editor.state.doc.descendants((node, pos) => {
    const index = node.isText ? node.text.indexOf(text) : -1;
    if (index === -1) return true;
    position = pos + index + text.length;
    return false;
  });
  if (position === null) throw new Error(`Could not find text: ${text}`);
  return position;
}

function selectionIsInside(typeName) {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === typeName) return true;
  }
  return false;
}

beforeEach(() => { editor = null; host = null; });

afterEach(() => {
  editor?.destroy();
  host?.remove();
});

const WITH_CONTENT = `
  <details open>
    <summary>Elaboration</summary>
    <div data-type="detailsContent"><p>Something inside.</p></div>
  </details>
`;

const EMPTY = `
  <details>
    <summary>Nothing here</summary>
    <div data-type="detailsContent"><p></p></div>
  </details>
`;

describe('disclosure triangle behaviour', () => {
  it('renders a solid triangle, not a stroked chevron', () => {
    mountEditor(EMPTY);
    const svg = chevronEl().querySelector('svg');
    expect(svg.querySelector('path')).toBeTruthy();
    // A stroked polyline is what it used to be, and at 11px it read as smudges.
    expect(svg.querySelector('polyline')).toBeNull();
    expect(svg.querySelector('path').getAttribute('fill')).toBe('currentColor');
  });

  it('opens when the triangle is clicked', () => {
    mountEditor(EMPTY);
    const chevron = chevronEl();

    expect(toggleEl().classList.contains('is-open')).toBe(false);
    expect(chevron.getAttribute('aria-expanded')).toBe('false');
    expect(chevron.style.transform).toBe('rotate(0deg)');

    chevron.click();

    expect(toggleEl().classList.contains('is-open')).toBe(true);
    expect(chevron.getAttribute('aria-expanded')).toBe('true');
    expect(chevron.style.transform).toBe('rotate(90deg)');
  });

  it('closes again on a second click', () => {
    mountEditor(WITH_CONTENT);
    const chevron = chevronEl();
    expect(toggleEl().classList.contains('is-open')).toBe(true);

    chevron.click();

    expect(toggleEl().classList.contains('is-open')).toBe(false);
    expect(chevron.getAttribute('aria-expanded')).toBe('false');
    expect(chevron.style.transform).toBe('rotate(0deg)');
  });

  it('opens from the keyboard as well as the mouse', () => {
    mountEditor(EMPTY);
    const chevron = chevronEl();
    chevron.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(chevron.getAttribute('aria-expanded')).toBe('true');
  });

  it('is created collapsed', () => {
    mountEditor('<p>plain</p>');
    editor.commands.setDetails();
    expect(toggleEl().classList.contains('is-open')).toBe(false);
    expect(chevronEl().getAttribute('aria-expanded')).toBe('false');
  });

  it('marks an empty toggle as having no content, and a filled one as having some', () => {
    mountEditor(EMPTY);
    expect(toggleEl().classList.contains('has-content')).toBe(false);

    editor.destroy();
    host.remove();
    mountEditor(WITH_CONTENT);
    expect(toggleEl().classList.contains('has-content')).toBe(true);
  });

  it('brightens as soon as the toggle is given something', async () => {
    mountEditor(EMPTY);
    expect(toggleEl().classList.contains('has-content')).toBe(false);

    // Type into the body the way the user would, through a real transaction.
    const position = editor.state.doc.content.size - 2;
    editor.chain().focus().setTextSelection(position).insertContent('now it holds a thought').run();

    expect(toggleEl().classList.contains('has-content')).toBe(true);
  });

  it('keeps a nested toggle pointing right while its parent is open', () => {
    mountEditor(`
      <details open>
        <summary>Parent</summary>
        <div data-type="detailsContent">
          <details>
            <summary>Child</summary>
            <div data-type="detailsContent"><p>body</p></div>
          </details>
        </div>
      </details>
    `);

    const parent = host.querySelector('.toggle-block');
    const child = host.querySelector('.toggle-block .toggle-block');
    expect(parent.classList.contains('is-open')).toBe(true);
    expect(child.classList.contains('is-open')).toBe(false);

    // The rotation is set by each node view on its own triangle, so a nested
    // closed toggle cannot inherit its parent's open state.
    const childChevron = child.querySelector(':scope > .toggle-block__chevron');
    expect(childChevron.style.transform).toBe('rotate(0deg)');
  });

  it('round-trips open state through HTML', () => {
    mountEditor(WITH_CONTENT);
    expect(editor.getHTML()).toMatch(/<details[^>]*\bopen\b/);

    chevronEl().click();
    expect(editor.getHTML()).not.toMatch(/<details[^>]*\bopen\b/);
  });

  it('turns "> " into a toggle rather than a blockquote', () => {
    mountEditor('<p></p>');
    editor.chain().focus().insertContent('>').run();

    // Input rules run from handleTextInput, not from insertContent — typing the
    // space is what triggers the rule, so the test has to type it.
    const { state, view } = editor;
    const { from } = state.selection;
    view.someProp('handleTextInput', (handler) => handler(view, from, from, ' '));

    expect(host.querySelector('.toggle-block')).toBeTruthy();
    expect(host.querySelector('blockquote')).toBeNull();
  });

  it('continues a numbered list inside a toggle from 1 to 2', () => {
    mountEditor(`
      <details open>
        <summary>4. I established that I need to stay</summary>
        <div data-type="detailsContent">
          <h2>Reasons why Sagemont</h2>
          <ol><li><p>Good preaching of the Word</p></li></ol>
        </div>
      </details>
    `);

    editor
      .chain()
      .focus()
      .setTextSelection(textEndPosition('Good preaching of the Word'))
      .run();
    expect(editor.commands.keyboardShortcut('Enter')).toBe(true);
    editor.commands.insertContent('Healthy community');

    let orderedList = null;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'orderedList' && !orderedList) orderedList = node;
    });

    expect(orderedList).toBeTruthy();
    expect(orderedList.attrs.start).toBe(1);
    expect(orderedList.childCount).toBe(2);
    expect(orderedList.child(0).textContent).toBe('Good preaching of the Word');
    expect(orderedList.child(1).textContent).toBe('Healthy community');
    expect(selectionIsInside('detailsContent')).toBe(true);
  });

  it('keeps repeated Enter presses inside the dropdown', () => {
    mountEditor(`
      <details open>
        <summary>Dropdown</summary>
        <div data-type="detailsContent"><p>Keep writing here</p></div>
      </details>
      <p>Outside text</p>
    `);

    editor
      .chain()
      .focus()
      .setTextSelection(textEndPosition('Keep writing here'))
      .run();

    for (let press = 0; press < 5; press += 1) {
      expect(editor.commands.keyboardShortcut('Enter')).toBe(true);
      expect(selectionIsInside('detailsContent')).toBe(true);
    }

    const details = editor.state.doc.firstChild;
    expect(details.type.name).toBe('details');
    expect(details.lastChild.type.name).toBe('detailsContent');
    expect(details.lastChild.childCount).toBeGreaterThan(4);
    expect(editor.state.doc.lastChild.textContent).toBe('Outside text');
  });
});
