import { useState, useRef, useCallback, useEffect } from 'react';

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 5;

export default function useCanvasState() {
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });
  const panOrigin = useRef({ x: 0, y: 0 });
  const animFrameRef = useRef(null);

  // Mirror state into refs so the smooth-zoom tween can read the
  // *current* values mid-frame without stale closures, and so we can
  // chain rapidly-fired button clicks off the prior tween's target
  // instead of off whatever the displayed zoom happens to be at that
  // exact moment.
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const pendingZoomTargetRef = useRef(null);
  const cancelMotion = useCallback(() => {
    if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = null;
    // A button's queued zoom target is meaningful only while that tween owns
    // the canvas. A wheel/pan/fit interruption must resume from visible zoom.
    pendingZoomTargetRef.current = null;
  }, []);
  useEffect(() => cancelMotion, [cancelMotion]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current = pan; }, [pan]);

  // Zoom around the cursor so the hovered point stays fixed under the mouse.
  // Important: the zoom amount is tied to the *distance* of the wheel/trackpad
  // event (deltaY), not just its direction. With trackpads, fast two-finger
  // swipes fire many wheel events in quick succession; using a fixed direction
  // factor (e.g. 0.9 / 1.1) compounds those events exponentially and makes
  // zoom feel like it has runaway momentum. Using exp(-delta * sensitivity)
  // makes the total zoom proportional to total scroll distance, regardless of
  // how the OS chunks events. We also clamp per-event delta to tame outliers
  // produced by very quick flicks.
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    cancelMotion();

    // Distinguish trackpad pan from zoom intent.
    //
    // Zoom is reserved for two cases:
    //   1. Trackpad pinch  — browsers signal this with `ctrlKey === true`
    //                         on the wheel event.
    //   2. Mouse wheel     — `deltaMode !== 0` (line / page units). Real
    //                         mouse wheels report DOM_DELTA_LINE or
    //                         DOM_DELTA_PAGE; trackpads always report
    //                         DOM_DELTA_PIXEL.
    //
    // Everything else — any two-finger trackpad swipe in any direction —
    // pans the canvas. Previous versions also treated "large integer
    // vertical-only pixel deltas" as a mouse wheel, but Mac trackpads
    // routinely produce exactly that during a fast two-finger flick
    // (deltaX === 0, integer deltaY ≥ 50), which then snapped the user
    // to min/max zoom unexpectedly. Pinch-only zoom from a trackpad
    // removes that foot-gun completely.
    const isPinch = e.ctrlKey;
    const isMouseWheel = e.deltaMode !== 0;

    if (!isPinch && !isMouseWheel) {
      const dx = e.deltaX;
      const dy = e.deltaY;
      setPan((prev) => ({ x: prev.x - dx, y: prev.y - dy }));
      return;
    }

    const ZOOM_SENSITIVITY = 0.0045;
    const MAX_DELTA_PER_EVENT = 50;
    const rawDelta = e.deltaY;
    const clampedDelta = Math.max(-MAX_DELTA_PER_EVENT, Math.min(MAX_DELTA_PER_EVENT, rawDelta));
    const factor = Math.exp(-clampedDelta * ZOOM_SENSITIVITY);

    const container = e.currentTarget;
    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    setZoom((prevZoom) => {
      const newZoom = Math.max(0.1, Math.min(5, prevZoom * factor));

      setPan((prevPan) => {
        const worldX = (mouseX - prevPan.x) / prevZoom;
        const worldY = (mouseY - prevPan.y) / prevZoom;

        return {
          x: mouseX - worldX * newZoom,
          y: mouseY - worldY * newZoom,
        };
      });

      return newZoom;
    });
  }, [cancelMotion]);

  // Smooth, eased zoom toward an arbitrary pivot point. The pivot is in
  // viewport-pixel coordinates relative to the canvas container origin
  // (same convention as the wheel handler — `e.clientX - rect.left`).
  // Each animation frame we both update zoom AND adjust pan so the
  // world point under the pivot stays glued in place. That's what makes
  // the zoom feel like it's converging on what you're looking at,
  // instead of scaling away from canvas (0, 0) up in the corner.
  //
  // Cancels any in-flight pan/zoom animation (they share animFrameRef)
  // so rapidly re-clicking just retargets — no stacked tweens.
  const smoothZoomTo = useCallback((targetZoom, pivotX, pivotY) => {
    cancelMotion();
    const target = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, targetZoom));
    const startZoom = zoomRef.current;
    const startPan = panRef.current;
    // No-op if we're already at the target (button at the cap).
    if (Math.abs(target - startZoom) < 0.0005) {
      pendingZoomTargetRef.current = null;
      return;
    }
    pendingZoomTargetRef.current = target;
    // The world coordinate currently sitting under the pivot — this is
    // the invariant the pan equation preserves on every frame.
    const worldX = (pivotX - startPan.x) / startZoom;
    const worldY = (pivotY - startPan.y) / startZoom;
    const t0 = performance.now();
    const DUR = 260; // ms — fast enough to feel responsive, slow enough to read as a glide
    const ease = (p) => 1 - Math.pow(1 - p, 3); // easeOutCubic — decelerates into the target

    const step = () => {
      const elapsed = performance.now() - t0;
      const p = Math.min(1, elapsed / DUR);
      const k = ease(p);
      const z = startZoom + (target - startZoom) * k;
      setZoom(z);
      setPan({
        x: pivotX - worldX * z,
        y: pivotY - worldY * z,
      });
      if (p < 1) {
        animFrameRef.current = requestAnimationFrame(step);
      } else {
        animFrameRef.current = null;
        pendingZoomTargetRef.current = null;
      }
    };
    animFrameRef.current = requestAnimationFrame(step);
  }, [cancelMotion]);

  // Multiplicative variant for + / − buttons: a click multiplies the
  // *prior tween's target* by `factor` (or the current zoom if no tween
  // is in flight). Without this, hammering the + button while a tween
  // is mid-flight would chain off whatever the displayed zoom happens
  // to be on that frame — making the user's 5th click feel weaker than
  // their 1st even though the factor is identical.
  const multiplyZoom = useCallback((factor, pivotX, pivotY) => {
    const base = pendingZoomTargetRef.current ?? zoomRef.current;
    smoothZoomTo(base * factor, pivotX, pivotY);
  }, [smoothZoomTo]);

  const startPan = useCallback((e) => {
    if (e.button === 1 || (e.button === 0 && e.target.dataset.canvas === 'true')) {
      cancelMotion();
      setIsPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY };
      panOrigin.current = { x: 0, y: 0 };
      setPan(prev => {
        panOrigin.current = { ...prev };
        return prev;
      });
    }
  }, [cancelMotion]);

  const onPanMove = useCallback((e) => {
    if (!isPanning) return;
    if ('buttons' in e && e.buttons === 0) {
      setIsPanning(false);
      return;
    }
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    setPan({
      x: panOrigin.current.x + dx,
      y: panOrigin.current.y + dy,
    });
  }, [isPanning]);

  const endPan = useCallback(() => {
    setIsPanning(false);
  }, []);

  useEffect(() => {
    const stopPan = () => setIsPanning(false);
    window.addEventListener('mouseup', stopPan);
    window.addEventListener('touchend', stopPan);
    window.addEventListener('touchcancel', stopPan);

    return () => {
      window.removeEventListener('mouseup', stopPan);
      window.removeEventListener('touchend', stopPan);
      window.removeEventListener('touchcancel', stopPan);
    };
  }, []);

  const screenToCanvas = useCallback((screenX, screenY, containerRect) => {
    return {
      x: (screenX - containerRect.left - pan.x) / zoom,
      y: (screenY - containerRect.top - pan.y) / zoom,
    };
  }, [pan, zoom]);

  /**
   * Smoothly pan so that (canvasX, canvasY) ends up exactly centered
   * in the given viewport dimensions.
   */
  const smoothPanTo = useCallback((canvasX, canvasY, viewportWidth, viewportHeight, currentZoom) => {
    cancelMotion();

    const targetPanX = viewportWidth / 2 - canvasX * currentZoom;
    const targetPanY = viewportHeight / 2 - canvasY * currentZoom;

    // Read starting pan
    let startPanX = 0, startPanY = 0;
    setPan(prev => {
      startPanX = prev.x;
      startPanY = prev.y;
      return prev;
    });

    const duration = 300;
    let startTime = null;

    const animate = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const t = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - t, 3);

      const x = startPanX + (targetPanX - startPanX) * eased;
      const y = startPanY + (targetPanY - startPanY) * eased;
      setPan({ x, y });

      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(animate);
      } else {
        // Ensure exact final position
        setPan({ x: targetPanX, y: targetPanY });
        animFrameRef.current = null;
      }
    };

    animFrameRef.current = requestAnimationFrame(animate);
  }, [cancelMotion]);

  /**
   * Set pan and zoom in one step so the given world-space bounding box
   * fits inside the viewport with `padding` pixels of breathing room on
   * each side. Intended for "zoom to extents" actions like opening a
   * web — we want the whole web visible from frame 1 instead of
   * dropping the user into wherever they last were.
   *
   * Cancels any in-flight pan/zoom tween. Idempotent if `bounds` is
   * empty / degenerate (just centers at zoom 1).
   */
  const fitToBounds = useCallback((bounds, viewportWidth, viewportHeight, padding = 80) => {
    cancelMotion();
    if (
      !bounds ||
      !Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY) ||
      !Number.isFinite(bounds.maxX) || !Number.isFinite(bounds.maxY) ||
      viewportWidth <= 0 || viewportHeight <= 0
    ) {
      return;
    }
    const w = bounds.maxX - bounds.minX;
    const h = bounds.maxY - bounds.minY;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    if (w <= 0 || h <= 0) {
      // Single point or degenerate box: just center at zoom 1.
      const z = 1;
      setZoom(z);
      setPan({ x: viewportWidth / 2 - cx * z, y: viewportHeight / 2 - cy * z });
      return;
    }
    const availW = Math.max(50, viewportWidth - padding * 2);
    const availH = Math.max(50, viewportHeight - padding * 2);
    // Cap at 1.0 — never *zoom in past native scale*, otherwise a single
    // tiny card would punch up to 5x and feel disorienting on open.
    const targetZoom = Math.max(
      ZOOM_MIN,
      Math.min(ZOOM_MAX, Math.min(availW / w, availH / h, 1)),
    );
    setZoom(targetZoom);
    setPan({
      x: viewportWidth / 2 - cx * targetZoom,
      y: viewportHeight / 2 - cy * targetZoom,
    });
  }, [cancelMotion]);

  return {
    pan, setPan,
    zoom, setZoom,
    isPanning,
    handleWheel,
    startPan,
    onPanMove,
    endPan,
    screenToCanvas,
    smoothPanTo,
    smoothZoomTo,
    multiplyZoom,
    fitToBounds,
  };
}
