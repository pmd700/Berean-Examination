import React, { useRef } from 'react';
import { act, render, fireEvent, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import useNoteZoom from '@/components/notes/useNoteZoom';

function Note({ id = 1 }) {
  const viewport = useRef(null);
  const page = useRef(null);
  useNoteZoom(viewport, page, id, true);
  return <><input aria-label="Font size" defaultValue="18" /><div ref={viewport} data-testid="viewport"><div ref={page} data-testid="page"><textarea defaultValue="My study notes" /></div></div></>;
}
const touches = (distance) => [
  { clientX: 100, clientY: 100 },
  { clientX: 100 + distance, clientY: 100 },
];

describe('Note page magnification', () => {
  it('keeps a modest wider page and reserves room for full margin comments as the window narrows', () => {
    render(<Note />);
    const viewport = screen.getByTestId('viewport'), page = screen.getByTestId('page');
    let width = 1470;
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, get: () => width });
    page.style.paddingRight = '36px';
    const relayout = () => act(() => viewport.dispatchEvent(new Event('bex:comment-layout', { bubbles: true })));
    relayout();
    expect(parseFloat(page.style.width)).toBeGreaterThan(880);
    expect(parseFloat(page.style.width)).toBeLessThan((width + 880) / 2);
    const marker = document.createElement('div'); marker.setAttribute('data-bex-margin-comments', ''); page.append(marker);
    for (const size of [1470, 1100, 800]) {
      width = size; relayout();
      const textRight = parseFloat(page.style.marginLeft) + parseFloat(page.style.width) - 36;
      expect(textRight + 16 + 280).toBeLessThanOrEqual(width - 12);
      expect(parseFloat(page.style.marginLeft)).toBeGreaterThanOrEqual(24);
    }
    marker.remove(); width = 1470; relayout();
    expect(parseFloat(page.style.marginLeft)).toBeCloseTo((width - parseFloat(page.style.width)) / 2);
    expect(screen.getByDisplayValue('My study notes').value).toBe('My study notes');
  });
  it('handles trackpad pinch separately from regular scrolling and font size', () => {
    render(<Note />);
    const viewport = screen.getByTestId('viewport');
    const page = screen.getByTestId('page');
    expect(fireEvent.wheel(viewport, { deltaY: -50, cancelable: true })).toBe(true);
    expect(page.style.zoom).toBe('1');
    expect(fireEvent.wheel(viewport, { deltaY: -50, ctrlKey: true, cancelable: true })).toBe(false);
    expect(Number(page.style.zoom)).toBeGreaterThan(1);
    fireEvent.wheel(viewport, { deltaY: 50, ctrlKey: true });
    expect(Number(page.style.zoom)).toBeCloseTo(1);
    expect(screen.getByLabelText('Font size').value).toBe('18');
    expect(screen.getByDisplayValue('My study notes').value).toBe('My study notes');
  });

  it('supports touchscreen pinch in both directions, clamps zoom, and resets for another note', () => {
    const { rerender } = render(<Note />);
    const viewport = screen.getByTestId('viewport');
    const page = screen.getByTestId('page');
    fireEvent.touchStart(viewport, { touches: touches(100) });
    fireEvent.touchMove(viewport, { touches: touches(200) });
    expect(page.style.zoom).toBe('2');
    fireEvent.touchMove(viewport, { touches: touches(100) });
    expect(page.style.zoom).toBe('1');
    fireEvent.touchCancel(viewport);
    fireEvent.touchMove(viewport, { touches: touches(200) });
    expect(page.style.zoom).toBe('1');
    fireEvent.wheel(viewport, { deltaY: -10000, ctrlKey: true });
    expect(page.style.zoom).toBe('3');
    fireEvent.wheel(viewport, { deltaY: 10000, ctrlKey: true });
    expect(page.style.zoom).toBe('0.5');
    rerender(<Note id={2} />);
    expect(page.style.zoom).toBe('1');
  });
});
