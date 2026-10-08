import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/api/desktopClient', () => ({
  desktopClient: {
    entities: {
      Keyword: { list: async () => [] },
    },
  },
}));

import RichTextEditor from '@/components/editor/RichTextEditor';
import { blockDragPluginKey } from '@/components/editor/BlockDragExtension';

/**
 * Copying a whole-block ("itemized") selection.
 *
 * This never worked. The blocks were written with navigator.clipboard, which the
 * desktop app can never use — it denies every permission it is asked for — so
 * every attempt failed with "permission denied" while ordinary text copying,
 * which the browser performs through the clipboard event, always worked. The
 * fix is to use that same event, so these tests are about the event: that the
 * blocks reach it, in both formats, and that an ordinary copy is left alone.
 */

const CONTENT = `
<ul><li><p>You cannot cause fire to burn</p></li><li><p>You cannot bake or boil</p></li></ul>
<p>A plain paragraph.</p>`;

function mountEditor() {
  const api = {};
  render(
    <MemoryRouter>
      <RichTextEditor
        content={CONTENT}
        onChange={() => {}}
        onEditorReady={(editor) => { api.editor = editor; }}
        bare
      />
    </MemoryRouter>,
  );
  return api;
}

/**
 * Say that this editor is the one on screen.
 *
 * The handler ignores editors that are not visible, because a book keeps the
 * page it is turning away from mounted until the animation ends and only the
 * visible one may answer a copy. It asks `offsetParent`, which jsdom — having no
 * layout engine — reports as null for everything, so the test supplies it.
 */
function makeVisible(editor) {
  Object.defineProperty(editor.view.dom, 'offsetParent', {
    configurable: true,
    get: () => document.body,
  });
}

/** Select whole blocks, the way a gutter marquee does. */
function selectBlocks(editor, selected) {
  editor.view.dispatch(editor.state.tr.setMeta(blockDragPluginKey, {
    type: 'selection', selected, anchor: selected[0], previewing: false, source: 'marquee',
  }));
}

/**
 * The browser's own clipboard event. jsdom has no DataTransfer worth using, so
 * the event carries a stand-in that records what was written to it.
 */
function fireClipboardEvent(type = 'copy') {
  const written = {};
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { setData: (format, value) => { written[format] = value; } },
  });
  document.dispatchEvent(event);
  return { written, prevented: event.defaultPrevented };
}

describe('copying selected blocks', () => {
  it('puts them on the clipboard through the event, needing no permission', async () => {
    const api = mountEditor();
    await waitFor(() => expect(api.editor).toBeTruthy());
    makeVisible(api.editor);
    selectBlocks(api.editor, [0]);

    const { written, prevented } = fireClipboardEvent('copy');

    expect(prevented).toBe(true);
    expect(written['text/html']).toContain('<li>');
    expect(written['text/html']).toContain('You cannot bake or boil');
    expect(written['text/plain']).toContain('You cannot bake or boil');
  });

  it('separates itemized lines instead of running them together', async () => {
    const api = mountEditor();
    await waitFor(() => expect(api.editor).toBeTruthy());
    makeVisible(api.editor);
    selectBlocks(api.editor, [0]);

    const { written } = fireClipboardEvent('copy');

    // A list is one draggable block, so its text used to arrive as
    // "…to burnYou cannot bake or boil" — every item welded to the next.
    expect(written['text/plain']).toBe('You cannot cause fire to burn\nYou cannot bake or boil');
  });

  it('leaves an ordinary copy completely alone', async () => {
    const api = mountEditor();
    await waitFor(() => expect(api.editor).toBeTruthy());

    const { written, prevented } = fireClipboardEvent('copy');

    expect(prevented).toBe(false);
    expect(Object.keys(written)).toHaveLength(0);
  });

  it('takes the blocks out of the document on a cut', async () => {
    const api = mountEditor();
    await waitFor(() => expect(api.editor).toBeTruthy());
    makeVisible(api.editor);
    selectBlocks(api.editor, [0]);

    const { written, prevented } = fireClipboardEvent('cut');

    expect(prevented).toBe(true);
    expect(written['text/plain']).toContain('You cannot bake or boil');
    // The default was prevented, so the removal is ours to do — and it removes
    // whole blocks, not just the text inside them.
    expect(api.editor.getHTML()).not.toContain('You cannot bake or boil');
    expect(api.editor.getHTML()).toContain('A plain paragraph.');
  });

  it('keeps the document intact on a copy', async () => {
    const api = mountEditor();
    await waitFor(() => expect(api.editor).toBeTruthy());
    makeVisible(api.editor);
    selectBlocks(api.editor, [0]);

    fireClipboardEvent('copy');

    expect(api.editor.getHTML()).toContain('You cannot bake or boil');
  });
});
