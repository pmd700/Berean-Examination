import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CanvasCard from '../../src/components/knowledgeweb/CanvasCard';
import ConnectionLines from '../../src/components/knowledgeweb/ConnectionLines';
import * as geometry from '../../src/components/knowledgeweb/smartCardGeometry';
describe('card resize scheduling and geometry reuse', () => {
    let frames;
    beforeEach(() => {
        frames = new Map();
        let nextId = 0;
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++nextId, callback); return nextId; });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => frames.delete(id));
    });
    afterEach(() => { vi.restoreAllMocks(); });
    const move = (x, y, buttons = 1) => fireEvent.mouseMove(window, { clientX: x, clientY: y, buttons });
    const release = (x, y) => fireEvent.mouseUp(window, { clientX: x, clientY: y, button: 0 });
    const paint = () => act(() => {
        const callbacks = [...frames.values()];
        frames.clear();
        callbacks.forEach(callback => callback(0));
    });
    const baseCard = { id: 1, x: 0, y: 0, title: 'Manual', width: 200, height: 100, layout_mode: 'manual' };
    function mount(overrides = {}) {
        const onResize = vi.fn(), onGeometryChange = vi.fn();
        const props = { card: baseCard, zoom: 1, onResize, onGeometryChange, ...overrides };
        const view = render(<CanvasCard {...props}/>);
        const grip = view.getByRole('button', { name: 'Resize card' });
        const start = () => fireEvent.mouseDown(grip, { button: 0, clientX: 100, clientY: 100 });
        return { ...view, props, grip, start, onResize, onGeometryChange };
    }
    it('sends only the newest size once per frame, and flushes the release position', () => {
        const { start, onResize } = mount();
        start();
        move(110, 110);
        move(130, 120);
        move(160, 130);
        expect(onResize).not.toHaveBeenCalled();
        expect(frames.size).toBe(1);
        paint();
        expect(onResize.mock.calls).toEqual([[1, 260, 130, { layoutMode: 'manual' }]]);
        move(170, 140);
        release(180, 150);
        expect(onResize).toHaveBeenLastCalledWith(1, 280, 150, { layoutMode: 'manual' });
        expect(frames.size).toBe(0);
        paint();
        move(200, 200);
        expect(onResize).toHaveBeenCalledTimes(2);
    });
    it('clamps size and scales mouse deltas by the canvas zoom', () => {
        const { start, onResize } = mount({ zoom: 2 });
        start();
        move(140, 120);
        paint();
        expect(onResize).toHaveBeenLastCalledWith(1, 220, 110, { layoutMode: 'manual' });
        move(-1000, -1000);
        paint();
        expect(onResize).toHaveBeenLastCalledWith(1, 60, 28, { layoutMode: 'manual' });
        release(-1000, -1000);
        expect(onResize).toHaveBeenCalledTimes(2); // no duplicate final commit
    });
    it('does not change smart mode on a click or right-click of the grip', () => {
        const { start, onResize, grip } = mount({ card: { ...baseCard, layout_mode: 'smart' } });
        start();
        release(100, 100);
        fireEvent.mouseDown(grip, { button: 2, clientX: 100, clientY: 100 });
        move(200, 200);
        release(200, 200);
        expect(onResize).not.toHaveBeenCalled();
        expect(frames.size).toBe(0);
    });
    it('finishes on window blur and stops listening after the gesture', () => {
        const { start, onResize } = mount();
        start();
        move(140, 120);
        fireEvent.blur(window);
        expect(onResize).toHaveBeenCalledWith(1, 240, 120, { layoutMode: 'manual' });
        expect(frames.size).toBe(0);
        move(190, 190);
        release(190, 190);
        paint();
        expect(onResize).toHaveBeenCalledTimes(1);
    });
    it('removes listeners and cancels pending work if the card unmounts mid-drag', () => {
        const { start, onResize, unmount } = mount();
        start();
        move(140, 120);
        unmount();
        expect(frames.size).toBe(0);
        paint();
        move(160, 140);
        release(160, 140);
        expect(onResize).not.toHaveBeenCalled();
    });
    it('does not report manual sizes as fresh smart measurements or animate dimensions', () => {
        const { container, onGeometryChange, rerender, props } = mount();
        rerender(<CanvasCard {...props} card={{ ...baseCard, width: 250 }}/>);
        expect(onGeometryChange).not.toHaveBeenCalled();
        const shape = container.querySelector('[data-card-shape]');
        expect(shape.style.width).toBe('250px');
        expect(shape.className).not.toContain('transition-all');
        expect(shape.className).toContain('transition-[background-color,border-color,box-shadow]');
    });
    it('reuses current measured geometry and rebuilds only a stale fallback', () => {
        const card = { ...baseCard, layout_mode: 'smart' };
        const measured = geometry.estimateSmartCardGeometry(card);
        const estimate = vi.spyOn(geometry, 'estimateSmartCardGeometry');
        const { rerender, props } = mount({ card, geometry: measured });
        rerender(<CanvasCard {...props} isSelected/>);
        expect(estimate).not.toHaveBeenCalled();
        rerender(<CanvasCard {...props} card={{ ...card, width: 300 }}/>);
        expect(estimate).toHaveBeenCalledTimes(1);
    });
    it('connection routing reuses current endpoint shapes, but rejects stale shapes', () => {
        const cards = [baseCard, { ...baseCard, id: 2, x: 400, layout_mode: 'smart' }];
        const shapes = Object.fromEntries(cards.map(card => [card.id, geometry.estimateSmartCardGeometry(card)]));
        const estimate = vi.spyOn(geometry, 'estimateSmartCardGeometry');
        const props = { cards, connections: [{ id: 1, from_card_id: 1, to_card_id: 2 }], cardGeometries: shapes };
        const { rerender } = render(<ConnectionLines {...props}/>);
        expect(estimate).not.toHaveBeenCalled();
        rerender(<ConnectionLines {...props} cards={[{ ...baseCard, width: 300 }, cards[1]]}/>);
        expect(estimate).toHaveBeenCalledTimes(1);
        expect(estimate).toHaveBeenLastCalledWith(expect.objectContaining({ id: 1, width: 300 }));
    });
});
