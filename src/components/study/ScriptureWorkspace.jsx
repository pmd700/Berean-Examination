import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Focus } from 'lucide-react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'framer-motion';
import './scriptureWorkspace.css';
import { ScriptureCanvasContext } from './scriptureCanvasContext';

function iconPlacement(element, side) {
  const reader = element?.querySelector('.bex-study-page');
  if (!reader) return null;
  const bounds = element.parentElement.getBoundingClientRect();
  const view = element.getBoundingClientRect();
  const page = reader.getBoundingClientRect();
  const pane = element.closest('.bex-tab-pane');
  const paneBounds = pane?.getBoundingClientRect() || { top: 0, bottom: window.innerHeight };
  const top = Math.max(view.top, paneBounds.top), bottom = Math.min(view.bottom, paneBounds.bottom);
  if (bottom - top < 48) return null;
  const edge = side === 'left' ? page.left : page.right;
  return { left: Math.max(view.left + 24, Math.min(view.right - 24, edge)) - bounds.left,
    top: (top + bottom) / 2 - bounds.top };
}

function CenterReaderButton({ side, placement, onCenter, reducedMotion, viewport }) {
  const present = useIsPresent();
  const button = useRef(null);
  // AnimatePresence retains the last props when a child exits. Continue
  // following the moving border independently until the fade has finished.
  useLayoutEffect(() => {
    if (present) return;
    let frame;
    const follow = () => {
      const next = iconPlacement(viewport.current, side);
      if (next && button.current) {
        button.current.style.left = `${next.left}px`;
        button.current.style.top = `${next.top}px`;
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [present, viewport, side]);
  return <motion.button ref={button} type="button"
    className={`bex-workspace-center bex-workspace-center-${side}`}
    style={{ ...placement, pointerEvents: present ? 'auto' : 'none' }}
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    transition={{ duration: reducedMotion ? 0 : present ? 2 : 1.5, ease: 'easeInOut' }}
    aria-label="Center reader" aria-hidden={!present || undefined} tabIndex={present ? 0 : -1}
    title="Center reader" disabled={!present} onClick={onCenter}>
    <Focus size={28} strokeWidth={2.2} aria-hidden="true" />
  </motion.button>;
}

// The OS sends two-finger trackpad scrolling as pixel wheel deltas. It does
// not expose a finger count in WheelEvent; touchscreen gestures do expose it.
// Never turn pointer/mouse dragging or line-mode wheel scrolling into a pan.
export default function ScriptureWorkspace({ enabled, children }) {
  const viewport = useRef(null);
  const surface = useRef(null);
  const camera = useRef({ x: 0, y: 0, zoom: 1 }), animation = useRef(null);
  const touch = useRef(null);
  const [side, setSide] = useState(null);
  const [placement, setPlacement] = useState(null);
  const reducedMotion = useReducedMotion();
  const applyCamera = useCallback(value => {
    if (![value.x, value.y, value.zoom].every(Number.isFinite) || value.zoom <= 0) return;
    camera.current = value;
    if (!viewport.current || !surface.current) return;
    surface.current.style.transform = `translate3d(${-value.x}px, ${-value.y}px, 0) scale(${value.zoom})`;
    surface.current.style.setProperty('--bex-canvas-control-scale', String(Math.max(1, 1 / value.zoom)));
    viewport.current.dataset.panX = String(value.x);
    viewport.current.dataset.panY = String(value.y);
    viewport.current.dataset.zoom = String(value.zoom);
    setSide(value.x < -12 ? 'left' : value.x > 12 ? 'right' : Math.abs(value.y) > 12 || Math.abs(value.zoom - 1) > .001 ? 'left' : null);
    viewport.current.dispatchEvent(new Event('scripture-workspace-pan', { bubbles: true }));
  }, []);
  const pan = useCallback((dx, dy = 0) => {
    cancelAnimationFrame(animation.current);
    applyCamera({ ...camera.current, x: camera.current.x + dx, y: camera.current.y + dy });
  }, [applyCamera]);
  const animateTo = useCallback(target => {
    cancelAnimationFrame(animation.current);
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) { applyCamera(target); return; }
    const start = performance.now(), from = camera.current;
    const tick = now => {
      const progress = Math.min(1, (now - start) / 420), ease = 1 - Math.pow(1 - progress, 3);
      applyCamera(progress === 1 ? target : { x: from.x + (target.x - from.x) * ease, y: from.y + (target.y - from.y) * ease, zoom: from.zoom + (target.zoom - from.zoom) * ease });
      if (progress < 1) animation.current = requestAnimationFrame(tick);
    };
    animation.current = requestAnimationFrame(tick);
  }, [applyCamera]);
  const center = useCallback(() => animateTo({ x: 0, y: 0, zoom: 1 }), [animateTo]);
  const panTo = useCallback((x, y) => animateTo({ ...camera.current, x, y }), [animateTo]);
  const zoomAt = useCallback((factor, clientX, clientY) => {
    const rect = viewport.current.getBoundingClientRect();
    const from = camera.current;
    // Zoom changes the camera, never the browser or saved font settings.
    const zoom = Math.max(.05, Math.min(8, from.zoom * factor));
    const x = clientX - rect.left, y = clientY - rect.top;
    cancelAnimationFrame(animation.current);
    applyCamera({ zoom, x: (x + from.x) * zoom / from.zoom - x, y: (y + from.y) * zoom / from.zoom - y });
  }, [applyCamera]);

  // Links and reader shortcuts navigate the camera in both directions. The
  // fixed canvas has no document scroll range to reveal off-screen material.
  useEffect(() => {
    const element = viewport.current;
    if (!element || !enabled) return undefined;
    const reveal = event => {
      const target = event.detail?.target;
      if (!(target instanceof Element) || !element.contains(target)) return;
      const view = element.getBoundingClientRect(), box = target.getBoundingClientRect();
      if (!view.width || !box.width) return;
      const margin = 24;
      const deltaX = event.detail?.axis === 'vertical' ? 0 : box.width > view.width - margin * 2
        ? box.left - (view.left + margin)
        : box.left + box.width / 2 - (view.left + view.width / 2);
      const align = event.detail?.align;
      const deltaY = !view.height ? 0 : align === 'bottom'
        ? box.bottom - view.bottom + margin
        : align === 'top' || box.height > view.height - margin * 2
          ? box.top - view.top - margin
          : box.top + box.height / 2 - (view.top + view.height / 2);
      if (Math.abs(deltaX) >= 1 || Math.abs(deltaY) >= 1) {
        panTo(camera.current.x + deltaX, camera.current.y + deltaY);
      }
    };
    element.addEventListener('scripture-workspace-center', reveal);
    return () => element.removeEventListener('scripture-workspace-center', reveal);
  }, [enabled, panTo]);

  useLayoutEffect(() => {
    if (!surface.current) return;
    if (!enabled) { surface.current.style.transform = ''; setSide(null); return; }
    applyCamera(camera.current);
  }, [enabled, applyCamera]);
  useEffect(() => () => cancelAnimationFrame(animation.current), []);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element || !enabled || !side) { setPlacement(null); return; }
    const pane = element.closest('.bex-tab-pane');
    let frame;
    const measure = () => {
      const next = iconPlacement(element, side);
      if (!next) { setPlacement(null); return; }
      setPlacement(previous => previous?.left === next.left && previous?.top === next.top ? previous : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure();
    element.addEventListener('scripture-workspace-pan', schedule);
    pane?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(element);
    return () => {
      cancelAnimationFrame(frame); observer?.disconnect();
      element.removeEventListener('scripture-workspace-pan', schedule); pane?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [enabled, side, children]);

  useEffect(() => {
    const element = viewport.current;
    if (!element || !enabled) return;
    const wheel = event => {
      if (event.deltaMode !== 0 || event.shiftKey) return;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        zoomAt(Math.exp(-event.deltaY * .01), event.clientX, event.clientY);
        return;
      }
      if (!event.deltaX && !event.deltaY) return;
      event.preventDefault();
      const writing = event.target.closest?.('.bex-gutter-card-sized [data-workspace-native-scroll]');
      if (writing && Math.abs(event.deltaY) > Math.abs(event.deltaX) && writing.scrollHeight > writing.clientHeight) {
        const previous = writing.scrollTop;
        writing.scrollTop += event.deltaY / camera.current.zoom;
        // Pass any remainder into the canvas so reaching a resized note's
        // scroll boundary never creates a wall or needs a second gesture.
        const consumed = (writing.scrollTop - previous) * camera.current.zoom;
        pan(event.deltaX, event.deltaY - consumed);
        return;
      }
      pan(event.deltaX, event.deltaY);
    };
    const point = touches => ({ x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
      distance: Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY) });
    const start = event => {
      touch.current = event.touches.length === 2 ? point(event.touches) : null;
      if (touch.current) event.preventDefault();
    };
    const move = event => {
      if (event.touches.length !== 2 || !touch.current) { touch.current = null; return; }
      const next = point(event.touches), previous = touch.current;
      touch.current = next;
      event.preventDefault();
      if (previous.distance > 0 && next.distance > 0) zoomAt(next.distance / previous.distance, previous.x, previous.y);
      pan(previous.x - next.x, previous.y - next.y);
    };
    const end = () => { touch.current = null; };
    element.addEventListener('wheel', wheel, { passive: false, capture: true });
    element.addEventListener('touchstart', start, { passive: false });
    element.addEventListener('touchmove', move, { passive: false });
    element.addEventListener('touchend', end);
    element.addEventListener('touchcancel', end);
    return () => {
      element.removeEventListener('wheel', wheel, true); element.removeEventListener('touchstart', start);
      element.removeEventListener('touchmove', move); element.removeEventListener('touchend', end);
      element.removeEventListener('touchcancel', end); touch.current = null;
    };
  }, [enabled, pan, zoomAt]);

  return <ScriptureCanvasContext.Provider value={{ viewport, surface, camera, pan, zoomAt }}><div className={enabled ? 'bex-scripture-workspace' : undefined}>
    {enabled && <AnimatePresence>
      {side && placement && <CenterReaderButton key={side} side={side} placement={placement}
        onCenter={center} reducedMotion={reducedMotion} viewport={viewport} />}
    </AnimatePresence>}
    <div ref={viewport} className={enabled ? 'bex-scripture-viewport' : undefined}
      data-testid="scripture-workspace" tabIndex={enabled ? 0 : undefined}
      role={enabled ? 'region' : undefined} aria-label={enabled ? 'Scripture canvas. Use two fingers to pan in any direction or pinch to zoom. Home centers the reader.' : undefined}
      onKeyDown={event => {
        if (!enabled || event.target !== event.currentTarget) return;
        if (event.key === 'Home') { event.preventDefault(); center(); }
        const delta = { ArrowLeft: [-80, 0], ArrowRight: [80, 0], ArrowUp: [0, -80], ArrowDown: [0, 80] }[event.key];
        if (delta) { event.preventDefault(); pan(...delta); }
      }}>
      <div ref={surface} className={enabled ? 'bex-scripture-surface' : undefined}>{children}</div>
    </div>
  </div></ScriptureCanvasContext.Provider>;
}
