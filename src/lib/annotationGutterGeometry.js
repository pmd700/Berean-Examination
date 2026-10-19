export function normalizeGutterRoute(route) {
  return { x: Number.isFinite(route?.x) ? route.x : 0,
    y: Number.isFinite(route?.y) ? route.y : 18 };
}
export function gutterConnector(start, end, route, width, height, minX = 0) {
  const bend = normalizeGutterRoute(route);
  const scale = Math.max(100, Math.abs(end.x - start.x));
  const midpoint = { x: (start.x + end.x) / 2 + bend.x * scale,
    y: (start.y + end.y) / 2 + bend.y };
  // Solve Q(t=.5), so the draggable dot is ON the cable, not at an
  // off-curve Bezier control point that behaves unlike the user's drawing.
  const control = { x: 2 * midpoint.x - (start.x + end.x) / 2, y: 2 * midpoint.y - (start.y + end.y) / 2 };
  return { midpoint, path: `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}` };
}
export function routeFromMidpoint(point, start, end) {
  return normalizeGutterRoute({ x: (point.x - (start.x + end.x) / 2) / Math.max(100, Math.abs(end.x - start.x)),
    y: point.y - (start.y + end.y) / 2 });
}
export function stackGutterCards(items, gap = 16) {
  let bottom = 0;
  return [...items].sort((a, b) => a.anchor.y - b.anchor.y || String(a.id).localeCompare(String(b.id))).map(item => {
    const top = Math.max(0, item.anchor.y - item.height / 2, bottom);
    bottom = top + item.height + gap;
    return { ...item, top };
  });
}
export function normalizeGutterPosition(position) {
  return { x: Number.isFinite(position?.x) ? position.x : 0,
    y: Number.isFinite(position?.y) ? position.y : 0,
    ...(position?.absolute === true ? { absolute: true } : {}) };
}


export function normalizeGutterSize(size) {
  return size && Number.isFinite(size.width) && Number.isFinite(size.height)
    ? { width: Math.max(180, size.width), height: Math.max(96, size.height) } : null;
}
