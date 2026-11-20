import { useLayoutEffect } from 'react';

// View-only magnification: never changes editor content or the font preference.
export default function useNoteZoom(viewportRef, pageRef, noteId, available) {
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const page = pageRef.current;
    if (!viewport || !page || !available) return;
    let scale = 1;
    let pinch = null;
    const resize = () => {
      const width = viewport.clientWidth;
      // A modest expansion from the original 880px page, rather than filling
      // half of all available whitespace on a wide display.
      let pageWidth = Math.min(width, 880 + Math.max(0, width - 880) * 0.35);
      let left = (width - pageWidth) / 2;
      if (width >= 640 && page.querySelector('[data-bex-margin-comments]')) {
        const padding = parseFloat(getComputedStyle(page).paddingRight) || 0;
        const commentSpace = 280 + 16 + 12; // full card, gap, viewport inset
        pageWidth = Math.min(pageWidth, width - commentSpace + padding - 24);
        // Use the existing right margin first. Shift the page only as far as
        // needed so a full comment card fits beside, without covering, text.
        left = Math.min((width - pageWidth) / 2, width - pageWidth - commentSpace + padding);
      }
      page.style.width = `${pageWidth}px`;
      page.style.marginLeft = `${Math.max(0, left)}px`;
      page.style.marginRight = 'auto';
    };
    page.style.zoom = '1';
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(viewport);
    viewport.addEventListener('bex:comment-layout', resize);

    const zoomAt = (next, x, y, previousX = x, previousY = y) => {
      next = Math.max(0.5, Math.min(3, next));
      const before = page.getBoundingClientRect();
      const localX = (previousX - before.left) / scale;
      const localY = (previousY - before.top) / scale;
      scale = next;
      page.style.zoom = String(scale);
      const after = page.getBoundingClientRect();
      viewport.scrollLeft += after.left + localX * scale - x;
      viewport.scrollTop += after.top + localY * scale - y;
    };
    const wheel = (event) => {
      // Chromium/Electron delivers trackpad pinches as Ctrl+wheel.
      if (!event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
      zoomAt(scale * Math.exp(-event.deltaY * units * 0.01), event.clientX, event.clientY);
    };
    const points = (touches) => {
      const [a, b] = touches;
      return {
        distance: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY),
        x: (a.clientX + b.clientX) / 2,
        y: (a.clientY + b.clientY) / 2,
      };
    };
    const start = (event) => {
      pinch = event.touches.length === 2 ? points(event.touches) : null;
      if (pinch) event.preventDefault();
    };
    const move = (event) => {
      if (event.touches.length !== 2) { pinch = null; return; }
      event.preventDefault();
      const next = points(event.touches);
      if (pinch?.distance > 0) {
        zoomAt(scale * next.distance / pinch.distance, next.x, next.y, pinch.x, pinch.y);
      }
      pinch = next;
    };
    const end = () => { pinch = null; };
    viewport.addEventListener('wheel', wheel, { passive: false });
    viewport.addEventListener('touchstart', start, { passive: false });
    viewport.addEventListener('touchmove', move, { passive: false });
    viewport.addEventListener('touchend', end);
    viewport.addEventListener('touchcancel', end);
    return () => {
      observer.disconnect();
      viewport.removeEventListener('bex:comment-layout', resize);
      viewport.removeEventListener('wheel', wheel);
      viewport.removeEventListener('touchstart', start);
      viewport.removeEventListener('touchmove', move);
      viewport.removeEventListener('touchend', end);
      viewport.removeEventListener('touchcancel', end);
    };
  }, [viewportRef, pageRef, noteId, available]);
}
