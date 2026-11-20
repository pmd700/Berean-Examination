// A wheel gesture includes momentum events. Advance only once until it rests.
/**
 * @param {HTMLElement} surface
 * @param {{ step?: ((direction: number) => void) | null, canSwipe?: () => boolean }} options
 */
export function bindImageSwipe(surface, { step = null, canSwipe = () => true } = {}) {
  let pointer = null, suppressClick = false, wheelTotal = 0, wheelUsed = false, idle = null;
  const down = event => {
    suppressClick = false;
    if (event.button !== 0 || !canSwipe()) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, scroll: surface.scrollLeft, dragging: false };
  };
  const move = event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
    if (!pointer.dragging && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      pointer.dragging = true;
      surface.setPointerCapture?.(event.pointerId);
    }
    if (!pointer.dragging) return;
    event.preventDefault(); event.stopPropagation();
    if (!step) surface.scrollLeft = pointer.scroll - dx;
  };
  const up = event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const gesture = pointer; pointer = null;
    if (!gesture.dragging) return;
    suppressClick = true;
    if (surface.hasPointerCapture?.(event.pointerId)) surface.releasePointerCapture(event.pointerId);
    const dx = event.clientX - gesture.x;
    if (event.type !== 'pointercancel' && step && Math.abs(dx) >= 40) step(dx < 0 ? 1 : -1);
  };
  const click = event => { if (suppressClick && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); suppressClick = false; } };
  const wheel = event => {
    if (!step || !canSwipe() || event.ctrlKey || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    event.preventDefault(); event.stopPropagation();
    clearTimeout(idle);
    idle = setTimeout(() => { wheelTotal = 0; wheelUsed = false; }, 220);
    if (wheelUsed) return;
    wheelTotal += event.deltaX;
    if (Math.abs(wheelTotal) >= 35) { wheelUsed = true; step(wheelTotal > 0 ? 1 : -1); }
  };
  surface.addEventListener('pointerdown', down);
  surface.addEventListener('pointermove', move);
  surface.addEventListener('pointerup', up);
  surface.addEventListener('pointercancel', up);
  surface.addEventListener('click', click, true);
  surface.addEventListener('wheel', wheel, { passive: false });
  return () => {
    clearTimeout(idle);
    surface.removeEventListener('pointerdown', down); surface.removeEventListener('pointermove', move);
    surface.removeEventListener('pointerup', up); surface.removeEventListener('pointercancel', up);
    surface.removeEventListener('click', click, true); surface.removeEventListener('wheel', wheel);
  };
}
