import React, { useCallback } from 'react';
import { Plus, Minus } from 'lucide-react';

// Tiny floating zoom widget that lives at the bottom-right of the
// canvas, opposite the FloatingToolbar (which sits bottom-center). Gives
// users a discoverable click-target for zoom — the wheel/pinch gestures
// already work, but plenty of users (and trackpad-shy users especially)
// expect explicit + / − controls.
//
// Behavior:
// - Each + / − click multiplies the prior tween's *target* zoom by
//   ZOOM_STEP (so rapid clicks chain naturally instead of fighting the
//   in-flight animation) and tweens to it via useCanvasState's
//   `multiplyZoom`. The tween is eased and pivots around the viewport
//   center, so the spot the user is looking at stays put — no more
//   "zooms toward the corner" feeling.
// - The middle "100%" button is a smooth reset: it tweens zoom back to
//   1.0× while keeping the same center pivot, so the user lands exactly
//   where they were just looking, only at native scale.

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 5;
const ZOOM_STEP = 1.3;

export default function FloatingZoomControls({
  zoom,
  multiplyZoom,
  smoothZoomTo,
  containerRef,
}) {
  // Pivot at the visible center of the canvas container. We read the
  // rect lazily on each click so window resizes don't matter and so we
  // don't capture a stale rect at mount.
  const getCenterPivot = useCallback(() => {
    const el = containerRef?.current;
    if (!el) {
      return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    }
    const r = el.getBoundingClientRect();
    return { x: r.width / 2, y: r.height / 2 };
  }, [containerRef]);

  const zoomIn = useCallback(() => {
    const { x, y } = getCenterPivot();
    multiplyZoom(ZOOM_STEP, x, y);
  }, [multiplyZoom, getCenterPivot]);

  const zoomOut = useCallback(() => {
    const { x, y } = getCenterPivot();
    multiplyZoom(1 / ZOOM_STEP, x, y);
  }, [multiplyZoom, getCenterPivot]);

  const resetZoom = useCallback(() => {
    const { x, y } = getCenterPivot();
    smoothZoomTo(1, x, y);
  }, [smoothZoomTo, getCenterPivot]);

  const atMax = zoom >= ZOOM_MAX - 0.001;
  const atMin = zoom <= ZOOM_MIN + 0.001;

  return (
    <div
      className="absolute bottom-6 right-6 z-30 flex flex-col items-stretch bg-[#0F1318]/95 border border-line rounded-lg shadow-xl backdrop-blur-sm overflow-hidden"
      data-testid="zoom-controls"
    >
      <button
        onClick={zoomIn}
        disabled={atMax}
        className="w-9 h-9 flex items-center justify-center text-gray-300 hover:bg-elevated hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title="Zoom in (or scroll up / pinch out)"
        aria-label="Zoom in"
        data-testid="button-zoom-in"
      >
        <Plus className="w-4 h-4" />
      </button>

      <button
        onClick={resetZoom}
        className="px-2 h-7 flex items-center justify-center text-[11px] font-medium text-gray-400 hover:bg-elevated hover:text-white border-y border-elevated transition-colors"
        title="Smoothly reset to 100%"
        aria-label="Reset zoom to 100%"
        data-testid="button-zoom-reset"
      >
        {Math.round(zoom * 100)}%
      </button>

      <button
        onClick={zoomOut}
        disabled={atMin}
        className="w-9 h-9 flex items-center justify-center text-gray-300 hover:bg-elevated hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title="Zoom out (or scroll down / pinch in)"
        aria-label="Zoom out"
        data-testid="button-zoom-out"
      >
        <Minus className="w-4 h-4" />
      </button>
    </div>
  );
}
