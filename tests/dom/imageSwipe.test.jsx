import React from 'react';
import { fireEvent, render, screen, act } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ImageLightbox from '@/components/editor/ImageLightbox';
import { bindImageSwipe } from '@/components/editor/imageSwipe';
afterEach(() => vi.useRealTimers());
const images = Array.from({ length: 4 }, (_, i) => ({ src: `https://example.com/${i}.png`, alt: `Picture ${i}` }));
it('advances once per trackpad gesture including momentum, and reverses after the next gesture', () => {
  vi.useFakeTimers();
  render(<ImageLightbox images={images} onClose={() => {}} />);
  const surface = screen.getByTestId('image-viewer-surface');
  for (let i = 0; i < 12; i++) fireEvent.wheel(surface, { deltaX: 30, deltaY: 0 });
  expect(screen.getByRole('status').textContent).toBe('2 of 4');
  act(() => vi.advanceTimersByTime(250));
  fireEvent.wheel(surface, { deltaX: 100 });
  expect(screen.getByRole('status').textContent).toBe('3 of 4');
  act(() => vi.advanceTimersByTime(250));
  fireEvent.wheel(surface, { deltaX: -100 });
  expect(screen.getByRole('status').textContent).toBe('2 of 4');
  act(() => vi.advanceTimersByTime(250));
  fireEvent.wheel(surface, { deltaX: 1, deltaY: 150 });
  expect(screen.getByRole('status').textContent).toBe('2 of 4');
  fireEvent.change(screen.getByLabelText('Image zoom'), { target: { value: '200' } });
  fireEvent.wheel(surface, { deltaX: 150 });
  expect(screen.getByRole('status').textContent).toBe('2 of 4');
});
function pointer(surface, type, x, y = 40) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: 1 }); surface.dispatchEvent(event);
}
it('drags the inline strip without opening the viewer, but preserves ordinary clicks', () => {
  const surface = document.createElement('div');
  document.body.append(surface);
  const open = vi.fn(); surface.addEventListener('click', open);
  const dispose = bindImageSwipe(surface);
  pointer(surface, 'pointerdown', 240); pointer(surface, 'pointermove', 140); pointer(surface, 'pointerup', 140);
  expect(surface.scrollLeft).toBe(100);
  surface.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  expect(open).not.toHaveBeenCalled();
  pointer(surface, 'pointerdown', 140); pointer(surface, 'pointerup', 140);
  surface.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  expect(open).toHaveBeenCalledOnce();
  dispose(); surface.remove();
});
it('moves exactly one image per horizontal mouse or touch drag in the viewer', () => {
  render(<ImageLightbox images={images} onClose={() => {}} />);
  const surface = screen.getByTestId('image-viewer-surface');
  act(() => { pointer(surface, 'pointerdown', 600); pointer(surface, 'pointermove', 100); pointer(surface, 'pointerup', 100); });
  expect(screen.getByRole('status').textContent).toBe('2 of 4');
  act(() => { pointer(surface, 'pointerdown', 100); pointer(surface, 'pointermove', 600); pointer(surface, 'pointerup', 600); });
  expect(screen.getByRole('status').textContent).toBe('1 of 4');
});
