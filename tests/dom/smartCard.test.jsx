import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CanvasCard from '../../src/components/knowledgeweb/CanvasCard';
import { estimateSmartCardGeometry } from '../../src/components/knowledgeweb/smartCardGeometry';

function renderCard(card, overrides = {}) {
  const geometry = estimateSmartCardGeometry(card);
  const onGeometryChange = vi.fn();
  const result = render(
    <CanvasCard
      card={card}
      geometry={geometry}
      zoom={1}
      isSelected={false}
      onSelect={vi.fn()}
      onDragEnd={vi.fn()}
      onPositionUpdate={vi.fn()}
      onQuickRename={vi.fn()}
      onResize={vi.fn()}
      onGeometryChange={onGeometryChange}
      {...overrides}
    />,
  );
  return { ...result, geometry, onGeometryChange };
}

describe('CanvasCard smart edges', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses measured title fragments for one clipped outline and reports that same geometry', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect() {
      if (this.matches?.('[data-card-id]')) {
        return { left: 100, top: 200, right: 300, bottom: 300, width: 200, height: 100 };
      }
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    });
    vi.spyOn(document, 'createRange').mockReturnValue({
      selectNodeContents: vi.fn(),
      getClientRects: () => [
        { left: 110, top: 210, right: 190, bottom: 228, width: 80, height: 18 },
        { left: 110, top: 230, right: 160, bottom: 248, width: 50, height: 18 },
      ],
      detach: vi.fn(),
    });

    const card = { id: 1, title: 'Measured title wraps', x: 20, y: 30, width: 200, height: 120 };
    const onGeometryChange = vi.fn();
    function ControlledCard() {
      const [geometry, setGeometry] = React.useState(() => estimateSmartCardGeometry(card));
      const handleGeometry = React.useCallback((id, nextGeometry) => {
        onGeometryChange(id, nextGeometry);
        setGeometry((current) => current.path === nextGeometry.path ? current : nextGeometry);
      }, []);
      return (
        <CanvasCard
          card={card}
          geometry={geometry}
          zoom={1}
          isSelected={false}
          onSelect={vi.fn()}
          onDragEnd={vi.fn()}
          onPositionUpdate={vi.fn()}
          onQuickRename={vi.fn()}
          onResize={vi.fn()}
          onGeometryChange={handleGeometry}
        />
      );
    }
    const { container } = render(<ControlledCard />);

    await waitFor(() => expect(onGeometryChange).toHaveBeenCalled());
    const measured = onGeometryChange.mock.calls.at(-1)[1];
    expect(measured.bands).toEqual([
      { top: 0, bottom: 29, right: 100 },
      { top: 29, bottom: 58, right: 70 },
    ]);

    await waitFor(() => {
      const shape = container.querySelector('[data-card-shape]');
      expect(shape.style.clipPath).toBe(`path("${measured.path}")`);
      expect(container.querySelector('svg path')?.getAttribute('d')).toBeTruthy();
    });
    expect(container.querySelector('[data-card-id]').style.pointerEvents).toBe('none');
  });

  it('keeps an explicitly manual card rectangular', async () => {
    const card = {
      id: 2,
      title: 'Manual card',
      x: 0,
      y: 0,
      width: 260,
      height: 90,
      layout_mode: 'manual',
    };
    const { container, onGeometryChange } = renderCard(card);

    expect(onGeometryChange).not.toHaveBeenCalled();
    expect(container.querySelector('[data-card-shape]').style.clipPath).toBe('');
    expect(container.querySelector('svg.absolute.inset-0')).toBeNull();
    expect(container.querySelector('[data-card-id]').style.width).toBe('260px');
    expect(container.querySelector('[data-card-id]').style.height).toBe('90px');
  });

  it('temporarily opens the full wrapping surface while the title is edited', async () => {
    const card = { id: 4, title: 'Short', x: 0, y: 0, width: 240, height: 120 };
    const { container } = renderCard(card);
    const shape = container.querySelector('[data-card-shape]');

    expect(shape.style.clipPath).toContain('path(');
    fireEvent.doubleClick(shape);

    await waitFor(() => expect(container.querySelector('input')).not.toBeNull());
    expect(shape.style.clipPath).toBe('');
    expect(shape.style.width).toBe('240px');
  });

  it('measures only the title and keeps hidden rich content out of the outline and DOM', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect() {
      if (this.matches?.('[data-card-id]')) {
        return { left: 100, top: 200, right: 340, bottom: 320, width: 240, height: 120 };
      }
      if (this.matches?.('.canvas-card-preview')) {
        return { left: 110, top: 232, right: 330, bottom: 254, width: 220, height: 22 };
      }
      if (this.matches?.('[data-smart-card-solid-band="true"]')) {
        const alpha = this.textContent?.trim() === 'alpha';
        return alpha
          ? { left: 110, top: 260, right: 150, bottom: 276, width: 40, height: 16 }
          : { left: 156, top: 260, right: 202, bottom: 276, width: 46, height: 16 };
      }
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    });
    const measuredText = [];
    vi.spyOn(document, 'createRange').mockImplementation(() => {
      let selectedNode = null;
      return {
        selectNodeContents(node) {
          selectedNode = node;
          measuredText.push(node?.textContent?.trim() || '');
        },
        getClientRects() {
          const text = selectedNode?.textContent?.trim() || '';
          if (text === 'Rich title') {
            return [{ left: 110, top: 210, right: 190, bottom: 228, width: 80, height: 18 }];
          }
          if (text.includes('Body preview')) {
            return [
              { left: 110, top: 232, right: 300, bottom: 244, width: 190, height: 12 },
              { left: 110, top: 246, right: 250, bottom: 258, width: 140, height: 12 },
            ];
          }
          if (text === 'alpha') {
            return [{ left: 114, top: 262, right: 146, bottom: 274, width: 32, height: 12 }];
          }
          if (text === 'beta') {
            return [{ left: 160, top: 262, right: 198, bottom: 274, width: 38, height: 12 }];
          }
          return [];
        },
        detach: vi.fn(),
      };
    });

    const card = {
      id: 3,
      title: 'Rich title',
      description: '<p>Body preview wraps here</p>',
      image_url: 'data:image/png;base64,ignored',
      tags: ['alpha', 'beta'],
      x: 0,
      y: 0,
      width: 240,
      height: 120,
    };
    const onGeometryChange = vi.fn();
    function ControlledRichCard() {
      const [geometry, setGeometry] = React.useState(() => estimateSmartCardGeometry(card));
      const handleGeometry = React.useCallback((id, nextGeometry) => {
        onGeometryChange(id, nextGeometry);
        setGeometry((current) => current.path === nextGeometry.path ? current : nextGeometry);
      }, []);
      return (
        <CanvasCard
          card={card}
          geometry={geometry}
          zoom={1}
          isSelected={false}
          onSelect={vi.fn()}
          onDragEnd={vi.fn()}
          onPositionUpdate={vi.fn()}
          onQuickRename={vi.fn()}
          onResize={vi.fn()}
          onGeometryChange={handleGeometry}
        />
      );
    }
    const { container } = render(<ControlledRichCard />);

    await waitFor(() => {
      const reported = onGeometryChange.mock.calls.at(-1)?.[1];
      expect(reported?.mode).toBe('smart');
      expect(reported?.bands).toEqual([{ top: 0, bottom: 38, right: 100 }]);
      expect(reported?.width).toBeLessThan(240);
    });

    // The transparent layout envelope remains the saved wrapping width, while
    // the SVG/clip polygon paints and receives clicks only on the tighter shape.
    expect(container.querySelector('[data-card-id]').style.width).toBe('240px');
    const reported = onGeometryChange.mock.calls.at(-1)[1];
    expect(container.querySelector('[data-card-shape]').style.clipPath).toBe(reported.clipPath);
    const baseFill = container.querySelector('svg.absolute.inset-0 path');
    expect(baseFill?.getAttribute('fill')).toBe('#1f2937');
    expect(measuredText).not.toContain('alpha');
    expect(measuredText).not.toContain('beta');
    expect(measuredText).not.toContain('Body preview wraps here');
    expect(container.querySelector('.canvas-card-preview')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('Rich title');
  });

  it('shows saved content again when smart edges are switched off, without modifying it', () => {
    const card = Object.freeze({ id: 9, title: 'Only this title', description: '<p><strong>Saved</strong> body</p>',
      tags: Object.freeze(['source']), image_url: 'data:image/png;base64,ignored', x: 0, y: 0, width: 220, height: 180 });
    const { container, rerender } = renderCard(card);
    expect(container.textContent).toBe('Only this title');
    const manual = { ...card, layout_mode: 'manual' };
    rerender(<CanvasCard card={manual} geometry={estimateSmartCardGeometry(manual)} zoom={1} />);
    expect(container.querySelector('.canvas-card-preview strong')?.textContent).toBe('Saved');
    expect(container.querySelector('img')?.getAttribute('src')).toBe(card.image_url);
    expect(container.textContent).toContain('source');
    expect(card.description).toBe('<p><strong>Saved</strong> body</p>');
    rerender(<CanvasCard card={card} geometry={estimateSmartCardGeometry(card)} zoom={1} />);
    expect(container.textContent).toBe('Only this title');
    expect(container.querySelector('.canvas-card-preview')).toBeNull();
  });

  it('does not expose hidden content while renaming a smart card or selecting it', async () => {
    const card = { id: 10, title: 'Title', description: '<p>Hidden body</p>', tags: ['hidden tag'], x: 0, y: 0 };
    const onSelect = vi.fn(); const onQuickRename = vi.fn();
    const { container } = renderCard(card, { onSelect, onQuickRename });
    const shape = container.querySelector('[data-card-shape]');
    fireEvent.mouseDown(shape, { metaKey: true });
    expect(onSelect).toHaveBeenCalledWith(10, expect.anything());
    fireEvent.doubleClick(shape);
    const input = container.querySelector('input');
    expect(input).toBeTruthy();
    expect(container.textContent).not.toContain('Hidden body');
    fireEvent.change(input, { target: { value: 'New title' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onQuickRename).toHaveBeenCalledWith(10, 'New title');
    expect(container.querySelector('.canvas-card-preview')).toBeNull();
  });
});
