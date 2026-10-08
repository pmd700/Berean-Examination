import React, { useState, useRef, useCallback, useLayoutEffect } from 'react';
import {
  estimateSmartCardGeometry,
  getCardGeometrySignature,
  getGeometryPort,
  getGeometrySideSpan,
} from './smartCardGeometry';

// Renders a connection label pill sized to the ACTUAL rendered text width
// rather than a character-count estimate. The app font is proportional so
// the per-character estimate diverges badly for longer strings (lots of
// narrow characters like spaces and lowercase letters).  We render the text
// first, measure it with getComputedTextLength(), then update the rect.
function ConnectionLabel({ text, midX, midY, angle, isSelected }) {
  const textRef = useRef(null);
  // Seed with a character-count estimate so the rect is roughly right on the
  // first paint; the layout effect corrects it after the browser has
  // actually rendered the glyphs with the real font.
  const [measured, setMeasured] = useState(null);

  useLayoutEffect(() => {
    if (textRef.current) {
      try {
        const w = textRef.current.getComputedTextLength();
        if (w > 0) setMeasured(w);
      } catch { /* SVG not yet in layout tree — ignore */ }
    }
  });           // run every render so zoom / font-load changes are caught

  const PAD_X = 6; // pixels of breathing room each side
  const halfWidth = measured != null
    ? measured / 2 + PAD_X
    : text.length * 2.8 + PAD_X; // fallback estimate

  const safeAngle = Number.isFinite(angle) ? angle : 0;
  const safeMidX  = Number.isFinite(midX)  ? midX  : 0;
  const safeMidY  = Number.isFinite(midY)  ? midY  : 0;

  return (
    <g className="pointer-events-none" transform={`rotate(${safeAngle} ${safeMidX} ${safeMidY})`}>
      <rect
        x={safeMidX - halfWidth} y={safeMidY - 8}
        width={halfWidth * 2} height={16}
        rx="4"
        fill={isSelected ? 'rgba(245,158,11,0.12)' : 'rgba(15,23,42,0.9)'}
        stroke={isSelected ? 'rgba(245,158,11,0.25)' : 'rgba(75,85,99,0.25)'}
        strokeWidth="1"
      />
      <text
        ref={textRef}
        x={safeMidX} y={safeMidY}
        textAnchor="middle"
        dominantBaseline="central"
        fill={isSelected ? '#fbbf24' : '#9ca3af'}
        style={{ fontSize: '10px', fontFamily: 'var(--bex-app-font-family, serif)', fontWeight: 500 }}
      >
        {text}
      </text>
    </g>
  );
}

// ─── Port geometry ───
const STEM_LENGTH = 12;
const DIRS = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };

const clampPortRatio = (ratio) => Math.min(1, Math.max(0, Number.isFinite(Number(ratio)) ? Number(ratio) : 0.5));

function withPortStem(port) {
  const direction = DIRS[port.side] || DIRS.right;
  return {
    ...port,
    stemX: port.x + direction.x * STEM_LENGTH,
    stemY: port.y + direction.y * STEM_LENGTH,
  };
}

function getRectPort(card, side, ratio = 0.5) {
  const x = card.x || 0;
  const y = card.y || 0;
  const w = card.width || 200;
  const h = card.height || 120;
  const r = clampPortRatio(ratio);

  switch (side) {
    case 'top': return withPortStem({ x: x + w * r, y, side: 'top', ratio: r });
    case 'bottom': return withPortStem({ x: x + w * r, y: y + h, side: 'bottom', ratio: r });
    case 'left': return withPortStem({ x, y: y + h * r, side: 'left', ratio: r });
    case 'right':
    default: return withPortStem({ x: x + w, y: y + h * r, side: 'right', ratio: r });
  }
}

function getSmartPort(card, geometry, side, ratio = 0.5) {
  const local = getGeometryPort(geometry, side, clampPortRatio(ratio));
  const port = {
    ...local,
    x: (card.x || 0) + local.x,
    y: (card.y || 0) + local.y,
    side: local.side || side,
    ratio: clampPortRatio(local.ratio ?? ratio),
  };
  return withPortStem(port);
}

function getEffectiveGeometry(card, geometryOverride) {
  if (card?.object_type != null) return null;
  if (geometryOverride) return geometryOverride;
  try {
    return estimateSmartCardGeometry(card);
  } catch {
    // Geometry is presentation-only. Corrupt legacy card data should still
    // get usable rectangular ports rather than making every noodle vanish.
    return null;
  }
}

function getPort(card, side, ratio = 0.5, geometryOverride) {
  const geometry = getEffectiveGeometry(card, geometryOverride);
  if (geometry) {
    try {
      return getSmartPort(card, geometry, side, ratio);
    } catch {
      // Keep connections available while a measured geometry is being
      // replaced after a title/font/width change.
    }
  }
  return getRectPort(card, side, ratio);
}

export function getPorts(card, geometryOverride) {
  return {
    top: getPort(card, 'top', 0.5, geometryOverride),
    right: getPort(card, 'right', 0.5, geometryOverride),
    bottom: getPort(card, 'bottom', 0.5, geometryOverride),
    left: getPort(card, 'left', 0.5, geometryOverride),
  };
}

function getAnchorFromOffset(card, offset = {}, geometryOverride) {
  const side = offset.side || 'right';
  return getPort(card, side, offset.ratio ?? 0.5, geometryOverride);
}

function readGeometryMapEntry(cardGeometries, cardId) {
  if (!cardGeometries || cardId == null) return null;
  if (cardGeometries instanceof Map) {
    return cardGeometries.get(cardId) ?? cardGeometries.get(String(cardId)) ?? null;
  }
  return cardGeometries[cardId] ?? cardGeometries[String(cardId)] ?? null;
}

function resolveCardGeometry(card, cardGeometries) {
  if (card?.object_type != null) return null;

  const entry = readGeometryMapEntry(cardGeometries, card?.id);
  const measured = entry?.geometry || entry;
  // ResizeObserver measurements can arrive one render after a title or wrap
  // width changes. Never route against that stale silhouette: the synchronous
  // estimate is less exact, but it matches the current card immediately.
  if (measured?.signature && measured.signature === getCardGeometrySignature(card)) {
    return measured;
  }
  // Validate the cheap signature first. Rebuilding both endpoint outlines for
  // every connection discarded identical curved paths on every resize frame.
  try {
    return estimateSmartCardGeometry(card);
  } catch {
    return null;
  }
}

function getEntityCenter(entity, geometry) {
  if (geometry) {
    return {
      x: (entity.x || 0) + (geometry.center?.x ?? geometry.width / 2),
      y: (entity.y || 0) + (geometry.center?.y ?? geometry.height / 2),
    };
  }
  return {
    x: (entity.x || 0) + (entity.width || 200) / 2,
    y: (entity.y || 0) + (entity.height || 120) / 2,
  };
}

function getPortSpan(card, geometry, side) {
  const vertical = side === 'left' || side === 'right';
  if (geometry) return Math.max(1, getGeometrySideSpan(geometry, side));
  return Math.max(1, vertical ? (card.height || 120) : (card.width || 200));
}

function spreadPortRatio(card, geometry, side, baseRatio, pixelOffset) {
  return clampPortRatio(baseRatio + pixelOffset / getPortSpan(card, geometry, side));
}

function hasExplicitPortRatio(offset) {
  return offset?.ratio != null && Number.isFinite(Number(offset.ratio));
}

function pickBestPorts(fromCard, toCard, connectionIndex, totalSameDirection, connection, cardGeometries = {}) {
  const fromGeometry = resolveCardGeometry(fromCard, cardGeometries);
  const toGeometry = resolveCardGeometry(toCard, cardGeometries);
  const fromPorts = getPorts(fromCard, fromGeometry);
  const toPorts = getPorts(toCard, toGeometry);

  const fromCenter = getEntityCenter(fromCard, fromGeometry);
  const toCenter = getEntityCenter(toCard, toGeometry);

  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;

  let fromPort, toPort;

  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx >= 0) { fromPort = { ...fromPorts.right }; toPort = { ...toPorts.left }; }
    else { fromPort = { ...fromPorts.left }; toPort = { ...toPorts.right }; }
  } else {
    if (dy >= 0) { fromPort = { ...fromPorts.bottom }; toPort = { ...toPorts.top }; }
    else { fromPort = { ...fromPorts.top }; toPort = { ...toPorts.bottom }; }
  }

  if (connection?.from_anchor_offset) {
    fromPort = getAnchorFromOffset(fromCard, connection.from_anchor_offset, fromGeometry);
  }
  if (connection?.to_anchor_offset) {
    toPort = getAnchorFromOffset(toCard, connection.to_anchor_offset, toGeometry);
  }

  if (totalSameDirection > 1) {
    const spread = 10;
    const offset = (connectionIndex - (totalSameDirection - 1) / 2) * spread;
    // Fan-out has to move the boundary anchor itself. Moving only `stemX/Y`
    // was ineffective because rendering intentionally collapses the stem to
    // the edge point below. An explicitly persisted ratio remains authoritative.
    if (!hasExplicitPortRatio(connection?.from_anchor_offset)) {
      const ratio = spreadPortRatio(fromCard, fromGeometry, fromPort.side, fromPort.ratio ?? 0.5, offset);
      fromPort = getPort(fromCard, fromPort.side, ratio, fromGeometry);
    }
    if (!hasExplicitPortRatio(connection?.to_anchor_offset)) {
      const ratio = spreadPortRatio(toCard, toGeometry, toPort.side, toPort.ratio ?? 0.5, offset);
      toPort = getPort(toCard, toPort.side, ratio, toGeometry);
    }
  }

  return { from: fromPort, to: toPort };
}

/** Build a path through reroute points using smooth cubics */
function buildStraightPathWithReroutes(from, to, reroutes) {
  if (!reroutes || reroutes.length === 0) {
    return `M ${from.stemX} ${from.stemY} L ${to.stemX} ${to.stemY}`;
  }

  const points = [
    { x: from.stemX, y: from.stemY },
    ...reroutes,
    { x: to.stemX, y: to.stemY },
  ];

  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

function buildNoodlePathWithReroutes(from, to, reroutes) {
  if (!reroutes || reroutes.length === 0) {
    return buildSegmentPath(from.stemX, from.stemY, from.side, to.stemX, to.stemY, to.side);
  }

  // Build segments: start → reroute1 → reroute2 → ... → end
  const points = [
    { x: from.stemX, y: from.stemY },
    ...reroutes,
    { x: to.stemX, y: to.stemY },
  ];

  let path = `M ${points[0].x} ${points[0].y}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const tension = Math.min(Math.max(dist * 0.35, 30), 180);

    let outDir, inDir;
    if (i === 0) {
      const fd = DIRS[from.side] || { x: 1, y: 0 };
      outDir = fd;
    } else {
      // For reroute points, direction based on neighbors
      const prev = points[i - 1];
      const pdx = p0.x - prev.x;
      const pdy = p0.y - prev.y;
      const pmag = Math.sqrt(pdx * pdx + pdy * pdy) || 1;
      outDir = { x: pdx / pmag, y: pdy / pmag };
    }

    if (i === points.length - 2) {
      const td = DIRS[to.side] || { x: -1, y: 0 };
      inDir = td;
    } else {
      const next = points[i + 2];
      const ndx = next.x - p1.x;
      const ndy = next.y - p1.y;
      const nmag = Math.sqrt(ndx * ndx + ndy * ndy) || 1;
      inDir = { x: -ndx / nmag, y: -ndy / nmag };
    }

    const cp1x = p0.x + outDir.x * tension;
    const cp1y = p0.y + outDir.y * tension;
    const cp2x = p1.x + inDir.x * tension;
    const cp2y = p1.y + inDir.y * tension;

    path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p1.x} ${p1.y}`;
  }

  return path;
}

function buildSegmentPath(x1, y1, fromSide, x2, y2, toSide) {
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  const dist = Math.sqrt(dx * dx + dy * dy);
  const tension = Math.min(Math.max(dist * 0.45, 40), 250);

  const fd = DIRS[fromSide] || { x: 1, y: 0 };
  const td = DIRS[toSide] || { x: -1, y: 0 };

  return `M ${x1} ${y1} C ${x1 + fd.x * tension} ${y1 + fd.y * tension}, ${x2 + td.x * tension} ${y2 + td.y * tension}, ${x2} ${y2}`;
}

function shouldHideArrowhead(from, to) {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const straightDistance = Math.sqrt(dx ** 2 + dy ** 2);
  const crampedAxisDistance = (to.side === 'top' || to.side === 'bottom')
    ? dy
    : dx;

  return straightDistance < 64 || crampedAxisDistance < 42 || (dx < 26 && dy < 26);
}

/** Get a point on a cubic bezier at t ∈ [0,1] */
function bezierPoint(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return {
    x: u*u*u*p0.x + 3*u*u*t*p1.x + 3*u*t*t*p2.x + t*t*t*p3.x,
    y: u*u*u*p0.y + 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t*p3.y,
  };
}

/** First derivative of a cubic bezier at t (returns the tangent vector). */
function bezierTangent(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return {
    x: 3*u*u*(p1.x - p0.x) + 6*u*t*(p2.x - p1.x) + 3*t*t*(p3.x - p2.x),
    y: 3*u*u*(p1.y - p0.y) + 6*u*t*(p2.y - p1.y) + 3*t*t*(p3.y - p2.y),
  };
}

/**
 * Parse a simple "M ... C ..." or "M ... L ..." SVG path and return the
 * midpoint along with the tangent angle at that midpoint (in degrees).
 * The angle is normalized to (-90, 90] so labels never render upside-down.
 */
function getMidpointAndTangent(pathD) {
  const nums = pathD.match(/-?[\d.]+/g)?.map(Number);
  if (!nums || nums.length < 4) return null;

  // Straight path "M x y L x y" produces 4 numbers.
  if (nums.length === 4) {
    const dx = nums[2] - nums[0];
    const dy = nums[3] - nums[1];
    return {
      x: (nums[0] + nums[2]) / 2,
      y: (nums[1] + nums[3]) / 2,
      angle: normalizeLabelAngle(Math.atan2(dy, dx) * 180 / Math.PI),
    };
  }

  // Polyline "M ... L ... L ..." (straight w/ reroutes) — pick middle segment.
  // 2 numbers for M, then 2 per L. So segCount = (nums.length - 2) / 2.
  if (pathD.includes('L') && !pathD.includes('C')) {
    const segCount = (nums.length - 2) / 2;
    if (segCount >= 1) {
      const midSeg = Math.floor(segCount / 2);
      const aIdx = midSeg === 0 ? 0 : 2 + (midSeg - 1) * 2;
      const bIdx = 2 + midSeg * 2;
      if (bIdx + 1 < nums.length) {
        const dx = nums[bIdx] - nums[aIdx];
        const dy = nums[bIdx + 1] - nums[aIdx + 1];
        return {
          x: (nums[aIdx] + nums[bIdx]) / 2,
          y: (nums[aIdx + 1] + nums[bIdx + 1]) / 2,
          angle: normalizeLabelAngle(Math.atan2(dy, dx) * 180 / Math.PI),
        };
      }
    }
  }

  if (nums.length === 8) {
    // Single cubic segment: M x y C cp1x cp1y cp2x cp2y ex ey
    const p0 = { x: nums[0], y: nums[1] };
    const p1 = { x: nums[2], y: nums[3] };
    const p2 = { x: nums[4], y: nums[5] };
    const p3 = { x: nums[6], y: nums[7] };
    const mid = bezierPoint(p0, p1, p2, p3, 0.5);
    const tan = bezierTangent(p0, p1, p2, p3, 0.5);
    return { x: mid.x, y: mid.y, angle: normalizeLabelAngle(Math.atan2(tan.y, tan.x) * 180 / Math.PI) };
  }

  // Multi-cubic: pick the middle C segment. Each C adds 6 nums after M (2).
  const segCount = (nums.length - 2) / 6;
  const midSeg = Math.floor(segCount / 2);
  const base = 2 + midSeg * 6;
  const prevEnd = midSeg === 0
    ? { x: nums[0], y: nums[1] }
    : { x: nums[base - 2], y: nums[base - 1] };

  if (base + 5 < nums.length) {
    const p0 = prevEnd;
    const p1 = { x: nums[base], y: nums[base + 1] };
    const p2 = { x: nums[base + 2], y: nums[base + 3] };
    const p3 = { x: nums[base + 4], y: nums[base + 5] };
    const mid = bezierPoint(p0, p1, p2, p3, 0.5);
    const tan = bezierTangent(p0, p1, p2, p3, 0.5);
    return { x: mid.x, y: mid.y, angle: normalizeLabelAngle(Math.atan2(tan.y, tan.x) * 180 / Math.PI) };
  }

  // Fallback: just average start and end.
  return {
    x: (nums[0] + nums[nums.length - 2]) / 2,
    y: (nums[1] + nums[nums.length - 1]) / 2,
    angle: 0,
  };
}

/** Keep label angle in (-90, 90] so text always reads left-to-right. */
function normalizeLabelAngle(deg) {
  let a = deg;
  while (a > 90) a -= 180;
  while (a <= -90) a += 180;
  return a;
}

// Backwards-compat wrapper for any other consumers expecting { x, y } only.
function getMidpointOfPath(pathD) {
  const r = getMidpointAndTangent(pathD);
  return r ? { x: r.x, y: r.y } : null;
}


export default function ConnectionLines({
  connections, cards, points = [], images = [], webLinks = [], timegraphs = [],
  cardGeometries = {},
  connectorStyle = 'curvy', selectedConnectionId, onSelectConnection,
  tempLine, hoveredConnectionId, onHoverConnection,
  onDragReroutePoint, onRemoveReroutePoint,
  onDragConnectionEndpoint, onRequestMidpointMenu,
  // User-configurable default color for connections that don't set
  // their own `color`. Falls back to the legacy slate tone.
  globalConnectionColor = '#4b556399',
}) {
  // Endpoints can be cards, routing points, images, web-link nodes, or timelines.
  // Index every kind in a single map keyed by `${kind}:${id}` so the
  // lookup below stays uniform. Images and web_links are treated like
  // cards for port geometry — they have width/height bounding boxes.
  const endpointMap = {};
  cards.forEach(c => { endpointMap[`card:${c.id}`] = { entity: c, kind: 'card' }; });
  points.forEach(p => { endpointMap[`point:${p.id}`] = { entity: p, kind: 'point' }; });
  images.forEach(o => { endpointMap[`image:${o.id}`] = { entity: o, kind: 'image' }; });
  webLinks.forEach(o => { endpointMap[`web_link:${o.id}`] = { entity: o, kind: 'web_link' }; });
  timegraphs.forEach(o => { endpointMap[`timegraph:${o.id}`] = { entity: o, kind: 'timegraph' }; });

  // Fan-out calculation — kind matters too because a card and a point could
  // share a numeric id across their separate sequences.
  const pairCounts = {};
  const pairIndices = {};
  const pairKeyFor = (conn) => {
    const a = `${conn.from_kind || 'card'}:${conn.from_card_id}`;
    const b = `${conn.to_kind || 'card'}:${conn.to_card_id}`;
    return [a, b].sort().join('::');
  };
  connections.forEach(conn => {
    const key = pairKeyFor(conn);
    pairCounts[key] = (pairCounts[key] || 0) + 1;
  });
  const pairCurrentIndex = {};
  connections.forEach(conn => {
    const key = pairKeyFor(conn);
    pairCurrentIndex[key] = (pairCurrentIndex[key] || 0);
    pairIndices[conn.id] = pairCurrentIndex[key];
    pairCurrentIndex[key]++;
  });

  // State for dragging reroute points
  const [draggingReroute, setDraggingReroute] = useState(null);

  const getCanvasPointFromMouseEvent = useCallback((ev) => {
    const svgEl = document.querySelector('[data-noodle-svg]');
    if (!svgEl) return null;
    const transformDiv = svgEl.parentElement;
    const style = transformDiv?.style?.transform || '';
    const translateMatch = style.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/);
    const scaleMatch = style.match(/scale\(([\d.]+)\)/);
    const panX = translateMatch ? parseFloat(translateMatch[1]) : 0;
    const panY = translateMatch ? parseFloat(translateMatch[2]) : 0;
    const zoom = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
    const containerRect = transformDiv?.parentElement?.getBoundingClientRect();
    if (!containerRect) return null;
    return {
      x: (ev.clientX - containerRect.left - panX) / zoom,
      y: (ev.clientY - containerRect.top - panY) / zoom,
    };
  }, []);

  const handleRerouteMouseDown = useCallback((e, connId, pointIndex) => {
    e.stopPropagation();
    e.preventDefault();
    setDraggingReroute({ connId, pointIndex });

    const onMove = (ev) => {
      // We need to convert screen coords to canvas coords
      // The SVG is inside the transform div, so coordinates are already in canvas space
      // We'll use a custom event to pass delta
      if (onDragReroutePoint) {
        const point = getCanvasPointFromMouseEvent(ev);
        if (!point) return;
        onDragReroutePoint(connId, pointIndex, point.x, point.y);
      }
    };

    const onUp = () => {
      setDraggingReroute(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [getCanvasPointFromMouseEvent, onDragReroutePoint]);

  // Start an endpoint-detach drag from a known anchor + entity. Used by
  // both the legacy endpoint-dot handles (now removed) and the new
  // drag-from-anywhere-on-line behavior: when the user grabs the curve,
  // we pick the closer endpoint and fire this same handshake so the
  // existing parent-side logic (rubber band, hit-test, re-attach) just
  // works without duplication.
  const startEndpointDrag = useCallback((conn, endpoint, entity, anchor, initialEv) => {
    if (!onDragConnectionEndpoint) return;
    onDragConnectionEndpoint(conn.id, endpoint, entity, anchor.x, anchor.y, 'start', anchor);
    if (initialEv) {
      const initialPoint = getCanvasPointFromMouseEvent(initialEv);
      if (initialPoint) {
        onDragConnectionEndpoint(conn.id, endpoint, entity, initialPoint.x, initialPoint.y, 'move', anchor);
      }
    }
    const onMove = (ev) => {
      const point = getCanvasPointFromMouseEvent(ev);
      if (!point) return;
      onDragConnectionEndpoint(conn.id, endpoint, entity, point.x, point.y, 'move', anchor);
    };
    const onUp = (ev) => {
      const point = getCanvasPointFromMouseEvent(ev);
      const fx = point ? point.x : anchor.x;
      const fy = point ? point.y : anchor.y;
      onDragConnectionEndpoint(conn.id, endpoint, entity, fx, fy, 'end', anchor);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [getCanvasPointFromMouseEvent, onDragConnectionEndpoint]);

  // Mousedown anywhere on the line hit-area. If the user drags more
  // than DRAG_THRESHOLD pixels we detach the endpoint that was closest
  // to the down-point and rubber-band it to the cursor. If they release
  // without dragging, treat it as a plain selection click (preserves
  // the old click-to-select behavior).
  const DRAG_THRESHOLD = 5;
  const handleLineMouseDown = useCallback((e, conn, fromEntity, toEntity, fromAnchor, toAnchor) => {
    if (e.button !== 0) return; // ignore right/middle clicks
    e.stopPropagation();
    const startScreenX = e.clientX;
    const startScreenY = e.clientY;
    const startCanvas = getCanvasPointFromMouseEvent(e);
    let dragStarted = false;

    const onMove = (ev) => {
      if (dragStarted) return;
      const dx = ev.clientX - startScreenX;
      const dy = ev.clientY - startScreenY;
      if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
      // Crossed the drag threshold — figure out which endpoint to
      // detach. Closer (by euclidean distance to the line's stem)
      // wins. Then hand off to the existing endpoint-drag machinery.
      dragStarted = true;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const ref = startCanvas || { x: (fromAnchor.x + toAnchor.x) / 2, y: (fromAnchor.y + toAnchor.y) / 2 };
      const distFrom = (ref.x - fromAnchor.x) ** 2 + (ref.y - fromAnchor.y) ** 2;
      const distTo = (ref.x - toAnchor.x) ** 2 + (ref.y - toAnchor.y) ** 2;
      if (distFrom <= distTo) {
        startEndpointDrag(conn, 'from', fromEntity, fromAnchor, ev);
      } else {
        startEndpointDrag(conn, 'to', toEntity, toAnchor, ev);
      }
    };
    const onUp = (ev) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (!dragStarted) {
        // Treated as a click — select the connection.
        onSelectConnection?.(conn.id);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [getCanvasPointFromMouseEvent, startEndpointDrag, onSelectConnection]);

  return (
    <svg
      data-noodle-svg="true"
      className="absolute inset-0 pointer-events-none z-[7]"
      style={{ overflow: 'visible', width: '100%', height: '100%' }}
    >
      <defs>
        <marker id="arrowhead-dim" markerWidth="14" markerHeight="10" refX="14" refY="5" orient="auto">
          <polygon points="0 0, 10 5, 0 10" fill="#6b7280" />
        </marker>
        <marker id="arrowhead-selected" markerWidth="14" markerHeight="10" refX="14" refY="5" orient="auto">
          <polygon points="0 0, 10 5, 0 10" fill="#f59e0b" />
        </marker>
      </defs>

      {/* Render noodles. The currently-selected connection is rendered LAST so
          its hit-area path and endpoint handles paint on top of any overlapping
          noodles — SVG pointer events follow paint order, so without this the
          user would click their highlighted noodle and accidentally grab a
          different one that happened to render later. Stable order otherwise. */}
      {[...connections].sort((a, b) => {
        if (a.id === selectedConnectionId) return 1;
        if (b.id === selectedConnectionId) return -1;
        return 0;
      }).map(conn => {
        const fromKind = conn.from_kind || 'card';
        const toKind = conn.to_kind || 'card';
        const fromEntry = endpointMap[`${fromKind}:${conn.from_card_id}`];
        const toEntry = endpointMap[`${toKind}:${conn.to_card_id}`];
        if (!fromEntry || !toEntry) return null;
        const fromCard = fromEntry.entity;
        const toCard = toEntry.entity;

        const pairKey = pairKeyFor(conn);
        const total = pairCounts[pairKey] || 1;
        const idx = pairIndices[conn.id] || 0;
        let { from, to } = pickBestPorts(fromCard, toCard, idx, total, conn, cardGeometries);
        // Routing points are tiny anchors — collapse the stem so the noodle
        // terminates right at the dot instead of sticking out a port nub.
        if (fromEntry.kind === 'point') from = { ...from, stemX: from.x, stemY: from.y };
        if (toEntry.kind === 'point') to = { ...to, stemX: to.x, stemY: to.y };
        const reroutes = conn.reroute_points || [];
        const isSelected = selectedConnectionId === conn.id;
        const isHovered = hoveredConnectionId === conn.id;
        // Port-stem endpoint dots were removed: the line now terminates
        // flush against the card/image edge, and dragging anywhere on
        // the line itself handles endpoint detach. So always collapse
        // the stem to the edge point — no more 12px nub or visible
        // endpoint circle.
        const pathFrom = { ...from, stemX: from.x, stemY: from.y };
        const pathTo = { ...to, stemX: to.x, stemY: to.y };
        // Per-connection override wins; fall back to global setting.
        const effectiveStyle = (conn.line_style === 'straight' || conn.line_style === 'curvy')
          ? conn.line_style : connectorStyle;
        const pathD = effectiveStyle === 'straight'
          ? buildStraightPathWithReroutes(pathFrom, pathTo, reroutes)
          : buildNoodlePathWithReroutes(pathFrom, pathTo, reroutes);
        const midpoint = getMidpointAndTangent(pathD);

        // Color resolution: per-connection override wins, then the
        // global user setting, then the legacy slate default. Selection
        // still bumps to gold for affordance.
        const baseColor = conn.color || globalConnectionColor || '#4b556399';
        const noodleColor = isSelected ? '#f59e0b' : isHovered ? '#9ca3af' : baseColor;
        const noodleWidth = isSelected ? 2.5 : isHovered ? 2 : 1.8;
        const hideArrowhead = shouldHideArrowhead(from, to);

        // Label position at midpoint
        const midX = midpoint ? midpoint.x : (from.stemX + to.stemX) / 2;
        const midY = midpoint ? midpoint.y : (from.stemY + to.stemY) / 2;
        const midAngle = midpoint ? midpoint.angle : 0;

        // Hide the midpoint dot when the two endpoints are visually
        // close — otherwise the dot lands almost on top of the cards
        // and reads as random noise. Selection/hover keep it visible
        // so the right-click insert affordance is still discoverable
        // even on short noodles.
        const endpointDist = Math.hypot(from.x - to.x, from.y - to.y);
        const showMidpoint = endpointDist >= 60 || isSelected || isHovered;

        // Persistent endpoint bulges — small filled dots right where
        // the line meets each card/image/web-link. Visible at all
        // zooms and distances so the connection always reads as
        // "anchored" to its endpoints (per user spec).
        const bulgeColor = isSelected ? '#f59e0b' : baseColor;
        const bulgeR = isSelected ? 2.5 : 2;

        return (
          <g key={conn.id}>
            {/* Wide invisible hit area. Mousedown anywhere on the line
                either selects (click without drag) or detaches the
                closer endpoint for re-routing (drag past threshold). */}
            <path
              d={pathD}
              stroke="transparent"
              strokeWidth="18"
              fill="none"
              className="pointer-events-auto cursor-grab"
              onMouseDown={(e) => handleLineMouseDown(
                e, conn, fromCard, toCard,
                { x: from.x, y: from.y },
                { x: to.x, y: to.y },
              )}
              onMouseEnter={() => onHoverConnection?.(conn.id)}
              onMouseLeave={() => onHoverConnection?.(null)}
            />

            {/* Glow for selected */}
            {isSelected && (
              <path d={pathD} stroke="#f59e0b" strokeWidth="8" fill="none" opacity="0.12" strokeLinecap="round" className="pointer-events-none" />
            )}

            {/* The noodle */}
            <path
              d={pathD}
              stroke={noodleColor}
              strokeWidth={noodleWidth}
              fill="none"
              strokeLinecap="round"
              markerEnd={conn.has_arrow && !hideArrowhead ? (isSelected ? 'url(#arrowhead-selected)' : 'url(#arrowhead-dim)') : undefined}
              className="pointer-events-none"
              style={{ transition: 'stroke 0.15s, stroke-width 0.15s' }}
            />

            {/* Reroute points (draggable dots) */}
            {reroutes.map((pt, i) => (
              <g key={i}>
                {/* Hit area for reroute */}
                <circle
                  cx={pt.x} cy={pt.y} r="12"
                  fill="transparent"
                  className="pointer-events-auto cursor-grab"
                  onMouseDown={(e) => handleRerouteMouseDown(e, conn.id, i)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (onRemoveReroutePoint) onRemoveReroutePoint(conn.id, i);
                  }}
                />
                {/* Visible dot */}
                <circle
                  cx={pt.x} cy={pt.y}
                  r={isSelected ? 3.5 : 3}
                  fill={isSelected ? '#f59e0b' : '#4b5563'}
                  stroke="none"
                  className="pointer-events-none"
                />
              </g>
            ))}

            {/* Midpoint node — always visible. Replaces the old 4
                endpoint port dots (one per side per card). Left-click
                selects the connection AND opens the "insert object"
                menu (Card / Image / Weblink / Point), which splits the
                connection through the new object. Right-click opens the
                same menu, kept for muscle memory. */}
            {midpoint && showMidpoint && (
              <g>
                {/* Wide invisible hit area for easy targeting */}
                <circle
                  cx={midX} cy={midY} r="10"
                  fill="transparent"
                  className="pointer-events-auto cursor-pointer"
                  onMouseDown={(e) => { e.stopPropagation(); }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectConnection?.(conn.id);
                    onRequestMidpointMenu?.(conn.id, e.clientX, e.clientY, midX, midY);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onRequestMidpointMenu?.(conn.id, e.clientX, e.clientY, midX, midY);
                  }}
                />
                {/* Visible dot */}
                <circle
                  cx={midX} cy={midY}
                  r={isSelected ? 3.75 : isHovered ? 3.5 : 3.25}
                  fill={isSelected ? '#f59e0b' : isHovered ? '#6b7280' : '#4b5563'}
                  stroke="none"
                  className="pointer-events-none"
                />
              </g>
            )}

            {/* Persistent endpoint bulges — small dots anchoring each
                end of the connection to its card/image/web-link. Drawn
                LAST in this group so they sit visually on top of the
                noodle stroke and the card border. Skipped for `point`
                endpoints because the routing-point IS already a dot —
                a second dot stacked on it just looks like noise. */}
            {fromEntry.kind !== 'point' && (
              <circle
                cx={from.x} cy={from.y} r={bulgeR}
                fill={bulgeColor}
                className="pointer-events-none"
              />
            )}
            {toEntry.kind !== 'point' && (
              <circle
                cx={to.x} cy={to.y} r={bulgeR}
                fill={bulgeColor}
                className="pointer-events-none"
              />
            )}

            {/* Label — rotated to flow along the noodle's tangent so it
                reads diagonally on diagonal lines instead of crossing them.
                ConnectionLabel measures actual rendered glyph width via
                getComputedTextLength() so the pill always hugs the text
                regardless of whether it is a short or long label. */}
            {(() => {
              const labelText = conn.label == null ? '' : String(conn.label).trim();
              if (!labelText) return null;
              return (
                <ConnectionLabel
                  key={conn.id}
                  text={labelText}
                  midX={midX} midY={midY}
                  angle={midAngle}
                  isSelected={isSelected}
                />
              );
            })()}
          </g>
        );
      })}

      {/* Temp noodle (live preview while creating) */}
      {tempLine && (() => {
        // Prefer explicit sides supplied by the caller (KnowledgeWeb
        // computes them from the locked source anchor + hit-tested
        // target anchor) so the preview matches the committed shape
        // exactly. Fall back to inferring from the line vector when
        // the cursor is over empty canvas.
        const inferredFromSide = (() => {
          const dx = tempLine.x2 - tempLine.x1;
          const dy = tempLine.y2 - tempLine.y1;
          if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
          return dy >= 0 ? 'bottom' : 'top';
        })();
        const fromSide = tempLine.fromSide || inferredFromSide;
        const inferredToSide = fromSide === 'right' ? 'left' : fromSide === 'left' ? 'right' : fromSide === 'bottom' ? 'top' : 'bottom';
        const toSide = tempLine.toSide || inferredToSide;
        const tempPath = connectorStyle === 'straight'
          ? `M ${tempLine.x1} ${tempLine.y1} L ${tempLine.x2} ${tempLine.y2}`
          : buildSegmentPath(tempLine.x1, tempLine.y1, fromSide, tempLine.x2, tempLine.y2, toSide);

        return (
          <>
            <path d={tempPath} stroke="#f59e0b" strokeWidth="2.5" fill="none" strokeLinecap="round" className="pointer-events-none" opacity="0.6" />
            <circle cx={tempLine.x2} cy={tempLine.y2} r="3" fill="#f59e0b" opacity="0.5" className="pointer-events-none" />
          </>
        );
      })()}
    </svg>
  );
}
