import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import FloatingZoomControls from '../../src/components/knowledgeweb/FloatingZoomControls';

describe('Knowledge Web zoom controls', () => {
  it('anchors its viewport without creating a hidden browser scroll container', () => {
    // jsdom cannot reproduce native focus scrolling. Guard the actual layout
    // contract here; tools/run-zoom-controls-proof.cjs covers it in Electron.
    const source = fs.readFileSync(path.resolve(import.meta.dirname, '../../src/pages/KnowledgeWeb.jsx'), 'utf8');
    const classes = source.match(/<div className="([^"]+)" data-testid="knowledge-web-viewport"/)?.[1].split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(['relative', 'overflow-clip', 'min-h-0', 'min-w-0']));
    expect(classes).not.toContain('overflow-hidden');
    expect(classes).not.toContain('overflow-auto');
  });

  function mount(zoom = 1) {
    let bounds = { left: 120, top: 80, width: 1000, height: 600 };
    const containerRef = { current: { getBoundingClientRect: () => bounds } };
    const multiplyZoom = vi.fn(), smoothZoomTo = vi.fn();
    const props = { zoom, multiplyZoom, smoothZoomTo, containerRef };
    const view = render(<FloatingZoomControls {...props} />);
    return { ...view, props, multiplyZoom, smoothZoomTo, resize: rect => { bounds = rect; } };
  }

  it('keeps the controls anchored to the lower-right corner', () => {
    mount();
    const classes = screen.getByTestId('zoom-controls').className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(['absolute', 'bottom-6', 'right-6']));
  });

  it('zooms in and out around the visible canvas center', () => {
    const { multiplyZoom } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(multiplyZoom.mock.calls).toEqual([[1.3, 500, 300], [1 / 1.3, 500, 300]]);
  });

  it('uses fresh bounds after a window resize or inspector opens', () => {
    const { multiplyZoom, smoothZoomTo, resize } = mount();
    resize({ left: 120, top: 80, width: 712, height: 480 });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset zoom to 100%' }));
    expect(multiplyZoom).toHaveBeenCalledWith(1.3, 356, 240);
    expect(smoothZoomTo).toHaveBeenCalledWith(1, 356, 240);
  });

  it('disables only the capped zoom direction and keeps reset available', () => {
    const { rerender, props } = mount(5);
    expect(screen.getByRole('button', { name: 'Zoom in' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Zoom out' }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Reset zoom to 100%' }).disabled).toBe(false);
    rerender(<FloatingZoomControls {...props} zoom={0.1} />);
    expect(screen.getByRole('button', { name: 'Zoom in' }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Zoom out' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Reset zoom to 100%' }).textContent).toBe('10%');
  });
});
