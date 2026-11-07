import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Exercise the real collectors, plugin-state readers and composer logic while
// replacing only the nested text widget (already covered by composer tests).
vi.mock('@/components/editor/TEXT_EDITOR_MACHINERY', () => ({
  default: ({ content, onChange }) => <textarea aria-label="Annotation text" value={content} onChange={event => onChange(event.target.value)} />,
}));
import TooltipLayer from '@/components/editor/TooltipLayer';
import FootnoteComposer from '@/components/editor/FootnoteComposer';
import { tooltipKey } from '@/components/editor/TooltipExtension';
import { footnoteKey } from '@/components/editor/FootnoteExtension';

const elements = [];
afterEach(() => { elements.splice(0).forEach(element => element.remove()); });

function makeDoc(body = 'Existing citation') {
  return { descendants: vi.fn(callback => {
    callback({ type: { name: 'footnote' }, attrs: { id: 'fn-1', text: body } }, 4);
    callback({ type: { name: 'text' }, isText: true, nodeSize: 6, text: 'anchor', marks: [
      { type: { name: 'tooltip' }, attrs: { id: 'tip-1', text: body } },
    ] }, 10);
  }) };
}
function makeEditor(doc = makeDoc()) {
  const handlers = new Map(), dom = document.createElement('div');
  elements.push(dom); document.body.appendChild(dom);
  return {
    state: { doc, [footnoteKey.key]: { draftId: null, offset: 0 }, [tooltipKey.key]: { activeId: null, draftId: null } },
    view: { dom, coordsAtPos: () => ({ left: 100, right: 110, top: 100, bottom: 120 }) },
    on: vi.fn((event, handler) => { if (!handlers.has(event)) handlers.set(event, new Set()); handlers.get(event).add(handler); }),
    off: vi.fn((event, handler) => handlers.get(event)?.delete(handler)),
    transaction: () => { for (const handler of [...(handlers.get('transaction') || [])]) handler(); },
    commands: Object.fromEntries(['focus', 'updateFootnote', 'removeFootnote', 'clearFootnoteDraft', 'updateTooltip', 'removeTooltip', 'clearTooltipDraft', 'setActiveTooltip'].map(name => [name, vi.fn()])),
  };
}

describe('annotation collection follows immutable documents', () => {
  it('avoids repeated tooltip collection while active selection and drafting still work', () => {
    const editor = makeEditor(), doc = editor.state.doc;
    const view = render(<TooltipLayer editor={editor} />);
    expect(doc.descendants).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 100; i++) act(() => editor.transaction());
    expect(doc.descendants).toHaveBeenCalledTimes(1);
    editor.state[tooltipKey.key] = { activeId: 'tip-1', draftId: null };
    act(() => editor.transaction());
    expect(screen.getByTestId('text-tooltip-body').textContent).toBe('Existing citation');
    expect(doc.descendants).toHaveBeenCalledTimes(1);
    const changed = makeDoc('Updated citation'); editor.state.doc = changed;
    act(() => editor.transaction());
    expect(changed.descendants).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('text-tooltip-body').textContent).toBe('Updated citation');
    editor.state[tooltipKey.key] = { activeId: null, draftId: 'tip-1' };
    act(() => editor.transaction());
    const input = screen.getByLabelText('Annotation text');
    expect(input.value).toBe('Updated citation');
    fireEvent.change(input, { target: { value: 'Draft kept intact' } });
    act(() => editor.transaction());
    expect(input.value).toBe('Draft kept intact');
    fireEvent.click(screen.getByTestId('button-tooltip-save'));
    expect(editor.commands.updateTooltip).toHaveBeenCalledWith('tip-1', 'Draft kept intact');
    view.unmount();
    expect(editor.off).toHaveBeenCalledWith('transaction', expect.any(Function));
  });

  it('avoids repeated footnote collection while draft selection and numbering offsets remain fresh', () => {
    const editor = makeEditor(), doc = editor.state.doc;
    const view = render(<FootnoteComposer editor={editor} />);
    expect(doc.descendants).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 100; i++) act(() => editor.transaction());
    expect(doc.descendants).toHaveBeenCalledTimes(1);
    editor.state[footnoteKey.key] = { draftId: 'fn-1', offset: 0 };
    act(() => editor.transaction());
    expect(screen.getByLabelText('Annotation text').value).toBe('Existing citation');
    expect(doc.descendants).toHaveBeenCalledTimes(1);
    editor.state[footnoteKey.key] = { draftId: 'fn-1', offset: 5 };
    act(() => editor.transaction());
    expect(doc.descendants).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('footnote-composer').textContent).toContain('6');
    fireEvent.change(screen.getByLabelText('Annotation text'), { target: { value: 'New draft' } });
    act(() => editor.transaction());
    fireEvent.click(screen.getByTestId('button-footnote-save'));
    expect(editor.commands.updateFootnote).toHaveBeenCalledWith('fn-1', 'New draft');
    view.unmount();
    expect(editor.off).toHaveBeenCalledWith('transaction', expect.any(Function));
  });

  it.each([TooltipLayer, FootnoteComposer])('refreshes memo and subscription when an editor instance is replaced', Component => {
    const editor = makeEditor(), doc = editor.state.doc;
    const view = render(<Component editor={editor} />);
    expect(doc.descendants).toHaveBeenCalledTimes(1);
    const replacement = makeEditor(doc);
    view.rerender(<Component editor={replacement} />);
    expect(doc.descendants).toHaveBeenCalledTimes(2);
    expect(editor.off).toHaveBeenCalledWith('transaction', expect.any(Function));
  });
});
