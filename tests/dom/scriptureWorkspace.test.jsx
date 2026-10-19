import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ScriptureWorkspace from '@/components/study/ScriptureWorkspace';

function mount(enabled = true) {
  const view = render(<ScriptureWorkspace enabled={enabled}><div className="bex-study-page"><p>Scripture text to select</p><input aria-label="Note writing" /></div></ScriptureWorkspace>);
  const viewport = screen.getByTestId('scripture-workspace');
  Object.defineProperties(viewport, { clientWidth: { configurable: true, value: 800 }, scrollWidth: { configurable: true, value: 1760 } });
  viewport.getBoundingClientRect = () => ({ left: 0, right: 800, top: 80, bottom: 1000 });
  viewport.querySelector('.bex-study-page').getBoundingClientRect = () => ({ left: 80 - Number(viewport.dataset.panX || 0), right: 720 - Number(viewport.dataset.panX || 0) });
  fireEvent(window, new Event('resize'));
  return { ...view, viewport };
}

describe('spatial Scripture workspace', () => {
  it.each(['top', 'bottom'])('uses the camera for the reader %s shortcut without changing horizontal pan or zoom', async align => {
    const { viewport } = mount();
    viewport.getBoundingClientRect = () => new DOMRect(0, 80, 800, 600);
    fireEvent.wheel(viewport, { deltaX: 200 });
    const reader = viewport.querySelector('.bex-study-page');
    reader.getBoundingClientRect = () => new DOMRect(-200, 400 - Number(viewport.dataset.panY || 0), 1000, 1200);
    fireEvent(reader, new CustomEvent('scripture-workspace-center', { bubbles: true, detail: { target: reader, axis: 'vertical', align } }));
    const expected = align === 'top' ? 296 : 944;
    await waitFor(() => expect(Number(viewport.dataset.panY)).toBe(expected), { timeout: 2000 });
    expect(Number(viewport.dataset.panX)).toBe(200);
    expect(Number(viewport.dataset.zoom)).toBe(1);
  });
  it('continues one gesture across overflowing notes and beyond the old walls without resize snapping', () => {
    const { viewport } = mount();
    const note = document.createElement('div'); note.setAttribute('data-workspace-native-scroll', '');
    Object.defineProperties(note, { clientWidth: { value: 400 }, scrollWidth: { value: 1000 } });
    viewport.firstElementChild.appendChild(note);
    for (let i = 0; i < 20; i++) fireEvent.wheel(note, { deltaX: -200 });
    expect(Number(viewport.dataset.panX)).toBe(-4000);
    fireEvent.wheel(note, { deltaX: -12, deltaY: 40 });
    expect(Number(viewport.dataset.panX)).toBe(-4012);
    fireEvent(window, new Event('resize'));
    expect(Number(viewport.dataset.panX)).toBe(-4012);
    fireEvent.wheel(note, { deltaX: 10000 });
    expect(Number(viewport.dataset.panX)).toBe(5988);
  });
  it('keeps the icon mounted while fading out, makes it noninteractive, and cancels exit when panning back', async () => {
    const { viewport } = mount();
    fireEvent.wheel(viewport, { deltaX: -200 }); fireEvent.scroll(viewport);
    const icon = screen.getByRole('button', { name: 'Center reader' });
    expect(icon.style.left).toBe('280px');
    fireEvent.wheel(viewport, { deltaX: 200 });
    expect(icon.isConnected).toBe(true);
    expect(icon.disabled).toBe(true);
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icon.style.pointerEvents).toBe('none');
    expect(icon.style.left).toBe('80px'); // Still aligned after the reader moved.
    fireEvent.wheel(viewport, { deltaX: -200 }); fireEvent.scroll(viewport);
    expect(screen.getByRole('button', { name: 'Center reader' })).toBe(icon);
    expect(icon.disabled).toBe(false);
    fireEvent.wheel(viewport, { deltaX: 200 });
    await waitFor(() => expect(icon.isConnected).toBe(false), { timeout: 2200 });
  });
  it('starts centered and pans without distance limits to either side, then recenters', async () => {
    const { viewport } = mount();
    expect(Number(viewport.dataset.panX)).toBe(0);
    fireEvent.wheel(viewport, { deltaX: -240, deltaY: 3, deltaMode: 0 });
    expect(Number(viewport.dataset.panX)).toBe(-240);
    fireEvent.scroll(viewport);
    expect(screen.getByRole('button', { name: 'Center reader' }).classList.contains('bex-workspace-center-left')).toBe(true);
    expect(screen.getByRole('button', { name: 'Center reader' }).querySelector('.lucide-focus')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Center reader' }).textContent).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Center reader' }));
    await waitFor(() => expect(Number(viewport.dataset.panX)).toBe(0), { timeout: 1000 });
    fireEvent.wheel(viewport, { deltaX: 1000, deltaMode: 0 });
    expect(Number(viewport.dataset.panX)).toBe(1000);
    fireEvent.scroll(viewport);
    expect(screen.getByRole('button', { name: 'Center reader' }).classList.contains('bex-workspace-center-right')).toBe(true);
    fireEvent.wheel(viewport, { deltaX: -2000, deltaMode: 0 });
    expect(Number(viewport.dataset.panX)).toBe(-1000);
    expect(screen.getByText('Scripture text to select')).toBeTruthy();
  });

  it('supports unlimited vertical panning and pointer-centered pinch zoom while leaving mouse text selection and line wheels alone', async () => {
    const { viewport } = mount();
    fireEvent.wheel(viewport, { deltaY: -10000000 });
    expect(Number(viewport.dataset.panY)).toBe(-10000000);
    fireEvent.wheel(viewport, { deltaY: 20000000 });
    expect(Number(viewport.dataset.panY)).toBe(10000000);
    fireEvent.keyDown(viewport, { key: 'Home' });
    await waitFor(() => expect(Number(viewport.dataset.panY)).toBe(0));
    fireEvent.wheel(viewport, { deltaY: -40, ctrlKey: true, clientX: 300, clientY: 300 });
    const zoom = Number(viewport.dataset.zoom);
    expect(zoom).toBeGreaterThan(1);
    expect((300 + Number(viewport.dataset.panX)) / zoom).toBeCloseTo(300);
    expect((220 + Number(viewport.dataset.panY)) / zoom).toBeCloseTo(220);
    fireEvent.wheel(viewport, { deltaY: 80, ctrlKey: true, clientX: 300, clientY: 300 });
    expect(Number(viewport.dataset.zoom)).toBeLessThan(1);
    fireEvent.keyDown(viewport, { key: 'Home' });
    await waitFor(() => expect(Number(viewport.dataset.zoom)).toBe(1));
    for (const options of [{ deltaX: 60, deltaMode: 1 }, { deltaX: 60, shiftKey: true }]) {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...options }); fireEvent(viewport, event);
      expect(event.defaultPrevented).toBe(false);
    }
    fireEvent.pointerDown(viewport, { button: 0, clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(viewport, { buttons: 1, clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(viewport, { button: 0, clientX: 100, pointerId: 1 });
    expect(Number(viewport.dataset.panX)).toBe(0);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'ArrowLeft' });
    expect(Number(viewport.dataset.panX)).toBe(0);
  });

  it('pinches with two touchscreen fingers without changing saved font settings', () => {
    const { viewport } = mount();
    fireEvent.touchStart(viewport, { touches: [{ clientX: 200, clientY: 200 }, { clientX: 300, clientY: 200 }] });
    fireEvent.touchMove(viewport, { touches: [{ clientX: 150, clientY: 200 }, { clientX: 350, clientY: 200 }] });
    expect(Number(viewport.dataset.zoom)).toBe(2);
    expect(Number(viewport.dataset.panX)).toBe(250);
    fireEvent.touchMove(viewport, { touches: [{ clientX: 200, clientY: 200 }, { clientX: 300, clientY: 200 }] });
    expect(Number(viewport.dataset.zoom)).toBe(1);
  });

  it('requires two touchscreen fingers and stops on cancellation or loss of a finger', () => {
    const { viewport } = mount();
    const point = clientX => ({ clientX, clientY: 100 });
    fireEvent.touchStart(viewport, { touches: [point(300)] });
    fireEvent.touchMove(viewport, { touches: [point(200)] });
    expect(Number(viewport.dataset.panX)).toBe(0);
    fireEvent.touchStart(viewport, { touches: [point(300), point(350)] });
    fireEvent.touchMove(viewport, { touches: [point(200), point(250)] });
    expect(Number(viewport.dataset.panX)).toBe(100);
    fireEvent.touchCancel(viewport);
    fireEvent.touchMove(viewport, { touches: [point(100), point(150)] });
    expect(Number(viewport.dataset.panX)).toBe(100);
    fireEvent.touchStart(viewport, { touches: [point(300), point(350)] });
    fireEvent.touchMove(viewport, { touches: [point(200)] });
    fireEvent.touchMove(viewport, { touches: [point(100), point(150)] });
    expect(Number(viewport.dataset.panX)).toBe(100);
  });

  it('preserves the camera during resize and disables spatial movement for the old hover mode', async () => {
    const { viewport, rerender } = mount();
    fireEvent.wheel(viewport, { deltaX: -100 });
    fireEvent.scroll(viewport);
    Object.defineProperties(viewport, { clientWidth: { configurable: true, value: 480 }, scrollWidth: { configurable: true, value: 1440 } });
    fireEvent(window, new Event('resize'));
    expect(Number(viewport.dataset.panX)).toBe(-100);
    rerender(<ScriptureWorkspace enabled={false}><p>Scripture text to select</p></ScriptureWorkspace>);
    await act(async () => {});
    fireEvent.wheel(viewport, { deltaX: 100 });
    expect(Number(viewport.dataset.panX)).toBe(-100);
    expect(viewport.className).toBe('');
    expect(screen.queryByRole('button', { name: 'Center reader' })).toBeNull();
  });
});
