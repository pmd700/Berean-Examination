import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import useCanvasKeyboardShortcuts from '@/components/knowledgeweb/useCanvasKeyboardShortcuts';

const ref = value => ({ current: value });
function handlers(overrides = {}) {
  return {
    isActive: true, activeNoteIdRef: ref(null), selectedConnectionId: null,
    selectedCardIds: [], selectedPointIds: [], selectedCardId: null, selectedObjectId: null,
    undoRef: ref(vi.fn()), redoRef: ref(vi.fn()), copyCardsRef: ref(vi.fn()), cutCardsRef: ref(vi.fn()),
    pasteCardsRef: ref(vi.fn()), canPasteCardsRef: ref(() => true), kwKeyToToolRef: ref({ '7': 'point' }),
    deleteCardRef: ref(vi.fn()), deleteCanvasObjectRef: ref(vi.fn()), deleteConnectionRef: ref(vi.fn()),
    setMode: vi.fn(), setConnectionSource: vi.fn(), setTempLine: vi.fn(), setPendingBulkDelete: vi.fn(),
    bulkDeleteThreshold: 7, ...overrides,
  };
}
function Canvas({ config }) { useCanvasKeyboardShortcuts(config); return null; }

describe('canvas shortcut ownership across kept-alive workspaces', () => {
  it('only deletes from the active canvas and transfers ownership when switching tabs', () => {
    const one = handlers({ selectedCardIds: [1], selectedPointIds: [2] });
    const two = handlers({ isActive: false, selectedCardIds: [3], selectedPointIds: [4] });
    const view = render(<><Canvas config={one} /><Canvas config={two} /></>);
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(one.deleteCardRef.current).toHaveBeenCalledWith(1);
    expect(one.deleteCanvasObjectRef.current).toHaveBeenCalledWith(2);
    expect(two.deleteCardRef.current).not.toHaveBeenCalled();
    expect(two.deleteCanvasObjectRef.current).not.toHaveBeenCalled();
    view.rerender(<><Canvas config={{ ...one, isActive: false }} /><Canvas config={{ ...two, isActive: true }} /></>);
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(one.deleteCardRef.current).toHaveBeenCalledTimes(1);
    expect(two.deleteCardRef.current).toHaveBeenCalledWith(3);
    expect(two.deleteCanvasObjectRef.current).toHaveBeenCalledWith(4);
    view.unmount(); fireEvent.keyDown(window, { key: 'Delete' });
    expect(two.deleteCardRef.current).toHaveBeenCalledTimes(1);
  });
  it('keeps note, input and editable text shortcuts out of canvas deletion', () => {
    const config = handlers({ selectedCardIds: [1] });
    const view = render(<><Canvas config={config} /><input aria-label="Title" /><div contentEditable data-testid="editor" /></>);
    fireEvent.keyDown(view.getByLabelText('Title'), { key: 'Backspace', bubbles: true });
    fireEvent.keyDown(view.getByTestId('editor'), { key: 'Backspace', bubbles: true });
    expect(config.deleteCardRef.current).not.toHaveBeenCalled();
    config.activeNoteIdRef.current = 99;
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(config.deleteCardRef.current).not.toHaveBeenCalled();
  });
  it('runs tools, clipboard and undo only for the foreground canvas', () => {
    const active = handlers({ selectedCardIds: [1] }), background = handlers({ isActive: false, selectedCardIds: [2] });
    render(<><Canvas config={active} /><Canvas config={background} /></>);
    fireEvent.keyDown(window, { key: '7' });
    fireEvent.keyDown(window, { key: 'c', metaKey: true });
    fireEvent.keyDown(window, { key: 'v', metaKey: true });
    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    expect(active.setMode).toHaveBeenCalledWith('point');
    expect(active.copyCardsRef.current).toHaveBeenCalledTimes(1);
    expect(active.pasteCardsRef.current).toHaveBeenCalledTimes(1);
    expect(active.undoRef.current).toHaveBeenCalledTimes(1);
    expect(background.setMode).not.toHaveBeenCalled();
    expect(background.copyCardsRef.current).not.toHaveBeenCalled();
    expect(background.pasteCardsRef.current).not.toHaveBeenCalled();
    expect(background.undoRef.current).not.toHaveBeenCalled();
  });
  it('retains bulk deletion confirmation without deleting the accompanying points prematurely', () => {
    const config = handlers({ selectedCardIds: [1,2,3,4,5,6,7,8], selectedPointIds: [9] });
    render(<Canvas config={config} />); fireEvent.keyDown(window, { key: 'Backspace' });
    expect(config.setPendingBulkDelete).toHaveBeenCalledWith({ ids: [1,2,3,4,5,6,7,8], pointIds: [9] });
    expect(config.deleteCardRef.current).not.toHaveBeenCalled();
    expect(config.deleteCanvasObjectRef.current).not.toHaveBeenCalled();
  });
});
