import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  ListExitBoundaries,
  normalizeListExitBoundaries,
} from '@/components/editor/ListExitBoundaryExtension';

vi.mock('@/api/desktopClient', () => ({
  desktopClient: {
    entities: {
      Keyword: { list: async () => [] },
    },
  },
}));

import RichTextEditor from '@/components/editor/RichTextEditor';

const STRANDED_LIST_CONTENT = `
  <ol>
    <li>
      <p>The numbered argument</p>
      <p></p>
      <p></p>
      <p><strong>if the final clause were parenthetical</strong></p>
      <p><strong>13:04</strong></p>
    </li>
  </ol>
`;

describe('list exit boundaries in the global editor', () => {
  it('turns two blank lines and following text into independent draggable blocks', async () => {
    let editor = null;
    const { container } = render(
      <MemoryRouter>
        <RichTextEditor
          content={STRANDED_LIST_CONTENT}
          onChange={() => {}}
          onEditorReady={(instance) => { editor = instance; }}
          bare
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(editor).not.toBeNull();
      expect(editor.state.doc.childCount).toBe(5);
    });

    const nodes = Array.from(
      { length: editor.state.doc.childCount },
      (_, index) => editor.state.doc.child(index),
    );
    expect(nodes.map(node => node.type.name)).toEqual([
      'orderedList',
      'paragraph',
      'paragraph',
      'paragraph',
      'paragraph',
    ]);
    expect(nodes.map(node => node.textContent)).toEqual([
      'The numbered argument',
      '',
      '',
      'if the final clause were parenthetical',
      '13:04',
    ]);
    expect(nodes[3].firstChild.marks.some(mark => mark.type.name === 'bold')).toBe(true);

    await waitFor(() => {
      expect(container.querySelectorAll('.bex-draggable-block')).toHaveLength(5);
    });
  });

  it('normalizes the same structure when it arrives in a later rich paste transaction', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const pastedEditor = new Editor({
      element: host,
      extensions: [StarterKit, ListExitBoundaries],
      content: '<p>Start</p>',
    });

    pastedEditor.commands.setContent(STRANDED_LIST_CONTENT);

    expect(pastedEditor.state.doc.childCount).toBe(5);
    expect(pastedEditor.state.doc.child(3).textContent)
      .toBe('if the final clause were parenthetical');

    pastedEditor.destroy();
    host.remove();
  });
});

/**
 * Pressing Enter below a pasted passage.
 *
 * The passage was living inside the list's final <li> — invisible, because a
 * list item renders its children in order and everything looked right. Enter in
 * a list item splits the *item*, so a paragraph five blocks below the last
 * bullet turned into "3." the moment the writer pressed it.
 */
describe('Enter under a passage that was pasted into a list item', () => {
  const PASSAGE_IN_A_LIST_ITEM = `
    <ol start="0">
      <li><p>The context is about unbelieving cities</p></li>
      <li><p>The father hides these things</p></li>
      <li>
        <p>No one can know the father</p>
        <hr>
        <h3>Matthew 11</h3>
        <p>11 And He answered them. 12 For whoever has</p>
      </li>
    </ol>`;

  /** Mirrors RichTextEditor's onCreate, which normalizes before anyone types. */
  function openDocument(content) {
    const editor = new Editor({ extensions: [StarterKit, ListExitBoundaries], content });
    const normalized = normalizeListExitBoundaries(editor.state.tr);
    if (normalized.changed) editor.view.dispatch(normalized.tr);
    return editor;
  }

  /** A real Enter, down the path a real one takes. */
  function pressEnter(editor) {
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    return editor.view.someProp('handleKeyDown', (handler) => handler(editor.view, event)) === true;
  }

  function caretBefore(editor, needle) {
    let target = null;
    editor.state.doc.descendants((node, pos) => {
      if (target === null && node.isText && node.text.includes(needle)) {
        target = pos + node.text.indexOf(needle);
      }
      return true;
    });
    editor.commands.setTextSelection(target);
  }

  it('splits the paragraph instead of minting a numbered bullet', () => {
    const editor = openDocument(PASSAGE_IN_A_LIST_ITEM);
    caretBefore(editor, '12 For whoever');
    pressEnter(editor);

    const html = editor.getHTML();
    expect(html).toContain('<p>12 For whoever has</p>');
    // Three bullets went in and three come out: nothing became a fourth item.
    expect(html.match(/<li>/g)).toHaveLength(3);
    editor.destroy();
  });

  it('leaves the passage where the reader can see it belongs', () => {
    const editor = openDocument(PASSAGE_IN_A_LIST_ITEM);
    const html = editor.getHTML();

    // The heading and rule are out of the list, not buried in its last item.
    expect(html.indexOf('<h3>Matthew 11</h3>')).toBeGreaterThan(html.indexOf('</ol>'));
    expect(html.indexOf('<hr>')).toBeGreaterThan(html.indexOf('</ol>'));
    editor.destroy();
  });

  it('still makes a new bullet when the caret really is in one', () => {
    const editor = openDocument('<ul><li><p>a real bullet</p></li></ul>');
    editor.commands.setTextSelection(editor.state.doc.content.size - 2);
    pressEnter(editor);

    expect(editor.getHTML().match(/<li>/g)).toHaveLength(2);
    editor.destroy();
  });
});
