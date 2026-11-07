import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import useCanvasState from '@/components/knowledgeweb/useCanvasState';

function frames() {
  let time = 1000, id = 0;
  const pending = new Map();
  vi.spyOn(performance, 'now').mockImplementation(() => time);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { pending.set(++id, callback); return id; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(handle => pending.delete(handle));
  const advance = milliseconds => {
    time += milliseconds;
    const callbacks = [...pending.values()]; pending.clear();
    act(() => callbacks.forEach(callback => callback(time)));
  };
  return { pending, advance };
}
const wheel = patch => ({ preventDefault: vi.fn(), deltaX: 0, deltaY: 0, ctrlKey: false, deltaMode: 0, clientX: 300, clientY: 200,
  currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0 }) }, ...patch });

describe('canvas motion ownership', () => {
  it.each(['zoom', 'pan'])('cancels the active %s animation when the canvas unmounts', motion => {
    const clock = frames(), hook = renderHook(() => useCanvasState());
    act(() => {
      const canvas = hook.result.current;
      if (motion === 'zoom') canvas.multiplyZoom(1.3, 300, 200);
      else canvas.smoothPanTo(10, 20, 800, 600, canvas.zoom);
    });
    clock.advance(80);
    expect(clock.pending.size).toBe(1);

    hook.unmount();
    expect(clock.pending.size).toBe(0);
    clock.advance(300);
    expect(clock.pending.size).toBe(0);
  });

  it('chains rapid zoom buttons from the pending target while preserving the pivot', () => {
    const clock = frames(), hook = renderHook(() => useCanvasState());
    act(() => { hook.result.current.multiplyZoom(1.3, 300, 200); hook.result.current.multiplyZoom(1.3, 300, 200); });
    expect(clock.pending.size).toBe(1);
    clock.advance(300);
    expect(hook.result.current.zoom).toBeCloseTo(1.69, 10);
    expect(hook.result.current.pan.x).toBeCloseTo(300 - 300 * 1.69, 10);
    expect(hook.result.current.pan.y).toBeCloseTo(200 - 200 * 1.69, 10);
    expect(clock.pending.size).toBe(0);
  });

  it.each(['trackpad pan', 'pinch zoom', 'mouse wheel', 'drag pan', 'smooth pan', 'fit bounds'])('discards the old zoom target when interrupted by %s', interruption => {
    const clock = frames(), hook = renderHook(() => useCanvasState());
    act(() => hook.result.current.smoothZoomTo(3, 300, 200));
    clock.advance(80);
    const displayedZoom = hook.result.current.zoom;
    expect(displayedZoom).toBeGreaterThan(1); expect(displayedZoom).toBeLessThan(3);
    act(() => {
      const canvas = hook.result.current;
      if (interruption === 'trackpad pan') canvas.handleWheel(wheel({ deltaX: 10, deltaY: 20 }));
      if (interruption === 'pinch zoom') canvas.handleWheel(wheel({ ctrlKey: true, deltaY: -10 }));
      if (interruption === 'mouse wheel') canvas.handleWheel(wheel({ deltaMode: 1, deltaY: -10 }));
      if (interruption === 'drag pan') canvas.startPan({ button: 1, target: { dataset: {} }, clientX: 20, clientY: 30 });
      if (interruption === 'smooth pan') canvas.smoothPanTo(10, 20, 800, 600, canvas.zoom);
      if (interruption === 'fit bounds') canvas.fitToBounds({ minX: 0, minY: 0, maxX: 1000, maxY: 1000 }, 800, 600);
    });
    const originZoom = hook.result.current.zoom;
    if (interruption === 'smooth pan') expect(clock.pending.size).toBe(1);
    else expect(clock.pending.size).toBe(0);
    // The subsequent + button must grow the actual displayed zoom by 30%,
    // rather than jump toward the interrupted 3x target's 3.9x successor.
    act(() => hook.result.current.multiplyZoom(1.3, 300, 200));
    expect(clock.pending.size).toBe(1);
    clock.advance(300);
    expect(hook.result.current.zoom).toBeCloseTo(Math.min(5, originZoom * 1.3), 10);
    expect(clock.pending.size).toBe(0);
  });
});
