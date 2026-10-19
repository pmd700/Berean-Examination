import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import AnnotationWindow from '@/components/study/AnnotationWindow';

function resize(width, height) {
  act(() => {
    vi.stubGlobal('innerWidth', width);
    vi.stubGlobal('innerHeight', height);
    window.dispatchEvent(new Event('resize'));
  });
}
afterEach(() => vi.unstubAllGlobals());
function openWindow() {
  return render(<AnnotationWindow isOpen title="Annotation" onClose={() => {}}>
    <textarea aria-label="Annotation draft" defaultValue="Unsaved draft" />
  </AnnotationWindow>);
}
it('fits an already open annotation into Split View, retains its draft, and restores desktop geometry', () => {
  resize(1440, 900);
  openWindow();
  const textarea = screen.getByRole('textbox');
  fireEvent.change(textarea, { target: { value: 'Keep my unsaved writing' } });
  const popup = screen.getByTestId('window-annotation');
  const desktop = { width: popup.style.width, height: popup.style.height, left: popup.style.left, top: popup.style.top };
  resize(480, 480);
  expect(parseFloat(popup.style.left) + parseFloat(popup.style.width)).toBeLessThanOrEqual(464);
  expect(parseFloat(popup.style.top)).toBeGreaterThanOrEqual(52);
  expect(parseFloat(popup.style.top) + parseFloat(popup.style.height)).toBeLessThanOrEqual(464);
  expect(screen.getByRole('textbox')).toBe(textarea);
  expect(textarea.value).toBe('Keep my unsaved writing');
  resize(1440, 900);
  expect({ width: popup.style.width, height: popup.style.height, left: popup.style.left, top: popup.style.top }).toEqual(desktop);
});
it('does not let the annotation resize minimum exceed a narrow window', () => {
  resize(480, 480);
  openWindow();
  fireEvent.mouseDown(screen.getByTestId('handle-window-resize'), { clientX: 450, clientY: 450 });
  fireEvent.mouseMove(window, { clientX: 900, clientY: 900 });
  fireEvent.mouseUp(window);
  const popup = screen.getByTestId('window-annotation');
  expect(parseFloat(popup.style.width)).toBeLessThanOrEqual(448);
  expect(parseFloat(popup.style.height)).toBeLessThanOrEqual(412);
});

it('keeps the dropped position across repeated drags and editor updates', () => {
  resize(1440, 900);
  const view = render(<AnnotationWindow isOpen title="Annotation" onClose={() => {}} autoExpandContent="">
    <textarea aria-label="Annotation draft" defaultValue="Keep this" />
  </AnnotationWindow>);
  const popup = screen.getByTestId('window-annotation');
  const titlebar = screen.getByTestId('handle-window-drag');
  const left = parseFloat(popup.style.left);
  const top = parseFloat(popup.style.top);
  for (let i = 1; i <= 2; i++) {
    fireEvent.mouseDown(titlebar, { button: 0, clientX: 500, clientY: 300 });
    fireEvent.mouseMove(window, { clientX: 540, clientY: 320 });
    const beforeRelease = { left: popup.style.left, top: popup.style.top };
    fireEvent.mouseUp(window);
    expect({ left: popup.style.left, top: popup.style.top }).toEqual(beforeRelease);
    expect(parseFloat(popup.style.left)).toBe(left + i * 40);
    expect(parseFloat(popup.style.top)).toBe(top + i * 20);
  }
  view.rerender(<AnnotationWindow isOpen title="Annotation" onClose={() => {}} autoExpandContent="<p>Typed text</p>">
    <textarea aria-label="Annotation draft" defaultValue="Keep this" />
  </AnnotationWindow>);
  expect(parseFloat(popup.style.left)).toBe(left + 80);
  expect(screen.getByRole('textbox').value).toBe('Keep this');
});

it('starts compact, expands smoothly only above 465 text characters, and does not shrink on deletion', () => {
  resize(1440, 900);
  const props = { isOpen: true, title: 'Annotation', onClose: () => {} };
  const view = render(<AnnotationWindow {...props} autoExpandContent={`<p><strong>${'x'.repeat(465)}</strong></p>`} />);
  const popup = screen.getByTestId('window-annotation');
  expect(popup.style.width).toBe('560px');
  expect(popup.style.height).toBe('360px');
  view.rerender(<AnnotationWindow {...props} autoExpandContent={`<p><strong>${'x'.repeat(466)}</strong></p>`} />);
  expect(popup.style.width).toBe('820px');
  expect(popup.style.height).toBe('560px');
  expect(popup.style.transition).toContain('240ms');
  view.rerender(<AnnotationWindow {...props} autoExpandContent="<p>Shorter</p>" />);
  expect(popup.style.width).toBe('820px');
});

it('expands a long pasted or saved annotation on opening and counts decoded Unicode text', () => {
  resize(1440, 900);
  render(<AnnotationWindow isOpen title="Annotation" onClose={() => {}} autoExpandContent={`<p>${'&#128512;'.repeat(466)}</p>`} />);
  expect(screen.getByTestId('window-annotation').style.width).toBe('820px');
});

it('applies manual resizing immediately, preserves the draft, and stops at the right and bottom edges', () => {
  resize(1440, 900);
  render(<AnnotationWindow isOpen title="Annotation" onClose={() => {}} autoExpandContent="">
    <textarea aria-label="Annotation draft" defaultValue="Unsaved" />
  </AnnotationWindow>);
  const popup = screen.getByTestId('window-annotation');
  const textarea = screen.getByRole('textbox');
  fireEvent.mouseDown(screen.getByTestId('handle-window-resize'), { button: 0, clientX: 800, clientY: 600 });
  fireEvent.mouseMove(window, { clientX: 830, clientY: 620 });
  expect(popup.style.width).toBe('590px');
  expect(popup.style.height).toBe('380px');
  expect(popup.style.transition).toBe('none');
  fireEvent.mouseMove(window, { clientX: 3000, clientY: 3000 });
  expect(parseFloat(popup.style.left) + parseFloat(popup.style.width)).toBe(1424);
  expect(parseFloat(popup.style.top) + parseFloat(popup.style.height)).toBe(884);
  const size = { width: popup.style.width, height: popup.style.height };
  fireEvent.mouseUp(window);
  fireEvent.mouseMove(window, { clientX: 100, clientY: 100 });
  expect({ width: popup.style.width, height: popup.style.height }).toEqual(size);
  expect(screen.getByRole('textbox')).toBe(textarea);
  expect(textarea.value).toBe('Unsaved');
});

it('clamps dragging in Split View and lets controls respond without starting a drag', () => {
  resize(800, 780);
  render(<AnnotationWindow isOpen title="Annotation" onClose={() => {}} autoExpandContent="" />);
  const popup = screen.getByTestId('window-annotation');
  fireEvent.mouseDown(screen.getByTestId('handle-window-drag'), { button: 0, clientX: 300, clientY: 300 });
  fireEvent.mouseMove(window, { clientX: -500, clientY: -500 });
  fireEvent.mouseUp(window);
  expect(popup.style.left).toBe('16px');
  expect(popup.style.top).toBe('52px');
  fireEvent.mouseDown(screen.getByTestId('button-window-maximize'), { button: 0, clientX: 50, clientY: 65 });
  fireEvent.mouseMove(window, { clientX: 300, clientY: 300 });
  fireEvent.mouseUp(window);
  expect(popup.style.left).toBe('16px');
  expect(popup.style.top).toBe('52px');
});
