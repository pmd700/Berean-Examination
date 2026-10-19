import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { LargeDeletionGuard } from '@/components/editor/LargeDeletionGuard';
import { CollapsibleToggle, ToggleSummary, ToggleContent } from '@/components/editor/CollapsibleToggleExtension';

let editor;
afterEach(() => { editor?.destroy(); editor = null; });
function setup(content, confirm) {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, CollapsibleToggle, ToggleSummary, ToggleContent, LargeDeletionGuard.configure({ confirm })],
    content,
  });
  editor.commands.selectAll();
  return editor;
}
function pressDelete(key = 'Backspace') {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  editor.view.dom.dispatchEvent(event);
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe('large note deletion confirmation', () => {
  it('counts collapsed dropdown text and preserves content until confirmed', async () => {
    let resolve;
    const confirm = vi.fn(() => new Promise(done => { resolve = done; }));
    setup('<p>Title</p><details><summary>Hidden</summary><div data-type="detailsContent"><p>' + 'x'.repeat(5001) + '</p></div></details>', confirm);
    expect(editor.getJSON().content[1].type).toBe('details');
    expect(editor.getJSON().content[1].attrs.open).toBe(false);
    const before = editor.getHTML();
    pressDelete();
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0][0].confirmDelaySeconds).toBe(5);
    expect(editor.getHTML()).toBe(before);
    pressDelete();
    expect(confirm).toHaveBeenCalledOnce();
    resolve(false); await settle();
    expect(editor.getHTML()).toBe(before);
  });

  it('lets exactly 5,000 characters delete normally', () => {
    const confirm = vi.fn(async () => true);
    setup('<p>' + 'a'.repeat(5000) + '</p>', confirm);
    pressDelete('Delete');
    expect(confirm).not.toHaveBeenCalled();
    expect(editor.getText()).toBe('');
  });

  it('confirms above 5,000 and leaves deletion undoable', async () => {
    const confirm = vi.fn(async () => true);
    setup('<p>' + 'a'.repeat(5001) + '</p>', confirm);
    pressDelete('Delete'); await settle();
    expect(confirm).toHaveBeenCalledOnce();
    expect(editor.getText()).toBe('');
    editor.commands.undo();
    expect(editor.getText()).toBe('a'.repeat(5001));
  });

  it('does not delete changed content after a stale confirmation', async () => {
    let resolve;
    setup('<p>' + 'a'.repeat(5001) + '</p>', () => new Promise(done => { resolve = done; }));
    pressDelete();
    editor.commands.setContent('<p>Replacement content</p>');
    resolve(true); await settle();
    expect(editor.getText()).toBe('Replacement content');
  });
});
