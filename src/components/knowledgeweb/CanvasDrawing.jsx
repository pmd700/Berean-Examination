import React, { useRef, useState, useCallback, useMemo } from 'react';
import { RotateCw } from 'lucide-react';

// A "drawing" is a fully vectorized freehand stroke stored as a
// canvas_objects row with object_type === 'drawing'. The raw point
// array, color, thickness, and rotation live in `strokes_data` as
// JSON; the row's x/y/width/height are the stroke's bounding box on
// the canvas. Stroke points are stored RELATIVE to the bbox origin
// so dragging the drawing only updates x/y, never the points
// themselves.
//
// Visual padding (`PAD`) is baked into both the bbox and the SVG
// viewBox so thick strokes aren't clipped at the edges and the
// selection ring sits cleanly around the stroke.
const PAD = 8;

export function parseStroke(obj) {
  if (!obj?.strokes_data) return null;
  try {
    const s = JSON.parse(obj.strokes_data);
    if (!Array.isArray(s.points) || s.points.length === 0) return null;
    return {
      points: s.points,
      color: typeof s.color === 'string' ? s.color : '#C9A94E',
      thickness: Number.isFinite(s.thickness) ? s.thickness : 3,
      rotation: Number.isFinite(s.rotation) ? s.rotation : 0,
    };
  } catch {
    return null;
  }
}

// Quadratic-smoothed SVG path from a polyline. Each interior segment
// is rendered as a Q-curve through the midpoint of the next segment
// so the stroke looks hand-drawn rather than jagged.
export function pointsToSmoothPath(points) {
  if (!points || points.length === 0) return '';
  if (points.length === 1) {
    const [x, y] = points[0];
    return `M ${x} ${y} L ${x + 0.01} ${y + 0.01}`;
  }
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    d += ` Q ${x1} ${y1} ${midX} ${midY}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last[0]} ${last[1]}`;
  return d;
}

export default function CanvasDrawing({
  obj,
  zoom,
  isSelected,
  onSelect,
  onDragEnd,
  onPositionUpdate,
  onUpdate,
}) {
  const [dragging, setDragging] = useState(false);
  const [dragPos, setDragPos] = useState(null);
  const [previewRot, setPreviewRot] = useState(null);
  const dragStartRef = useRef(null);
  const objStartRef = useRef(null);
  const didDrag = useRef(false);

  const stroke = useMemo(() => parseStroke(obj), [obj]);

  const onMouseDown = useCallback((e) => {
    e.stopPropagation();
    onSelect(obj.id);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    objStartRef.current = { x: obj.x, y: obj.y };
    setDragging(true);
    didDrag.current = false;

    const onMove = (ev) => {
      const dx = (ev.clientX - dragStartRef.current.x) / zoom;
      const dy = (ev.clientY - dragStartRef.current.y) / zoom;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didDrag.current = true;
      const nx = objStartRef.current.x + dx;
      const ny = objStartRef.current.y + dy;
      setDragPos({ x: nx, y: ny });
      if (onPositionUpdate) onPositionUpdate(obj.id, nx, ny);
    };

    const onUp = (ev) => {
      const dx = (ev.clientX - dragStartRef.current.x) / zoom;
      const dy = (ev.clientY - dragStartRef.current.y) / zoom;
      setDragging(false);
      setDragPos(null);
      if (didDrag.current) onDragEnd(obj.id, objStartRef.current.x + dx, objStartRef.current.y + dy);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [obj, zoom, onSelect, onDragEnd, onPositionUpdate]);

  // Rotation handle — drag around the bbox center to rotate the
  // entire stroke. Commits the new angle into strokes_data on mouseup
  // so undo/redo and persistence flow through the standard
  // updateCanvasObject path.
  const onRotateMouseDown = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    if (!stroke) return;
    const w = obj.width || 0;
    const h = obj.height || 0;
    // The handle's parent element is positioned absolutely inside the
    // drawing wrapper; computing the center in screen coords means we
    // rotate around the visible center regardless of zoom/pan.
    const wrapper = e.currentTarget.closest('[data-drawing-wrapper]');
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const startAngle = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI);
    const initialRot = stroke.rotation || 0;

    const onMove = (ev) => {
      const a = Math.atan2(ev.clientY - cy, ev.clientX - cx) * (180 / Math.PI);
      let next = initialRot + (a - startAngle);
      // Normalize into (-180, 180].
      while (next > 180) next -= 360;
      while (next <= -180) next += 360;
      setPreviewRot(next);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setPreviewRot(prev => {
        if (prev != null && onUpdate) {
          const nextData = { ...stroke, rotation: Math.round(prev * 100) / 100 };
          onUpdate(obj.id, { strokes_data: JSON.stringify(nextData) });
        }
        return null;
      });
      // Suppress next click so the synthetic mouseup doesn't deselect.
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [obj, stroke, onUpdate]);

  if (!stroke) return null;

  const x = dragging && dragPos ? dragPos.x : obj.x;
  const y = dragging && dragPos ? dragPos.y : obj.y;
  const w = obj.width || 1;
  const h = obj.height || 1;
  const rotation = previewRot != null ? previewRot : (stroke.rotation || 0);

  const d = pointsToSmoothPath(stroke.points);

  return (
    <div
      data-obj-id={obj.id}
      data-drawing-wrapper="true"
      className={`absolute select-none ${dragging ? 'cursor-grabbing z-[100]' : 'cursor-grab'} ${isSelected ? 'z-[20]' : 'z-[9]'}`}
      style={{
        left: x,
        top: y,
        width: w,
        height: h,
        transform: `rotate(${rotation}deg)`,
        transformOrigin: 'center center',
        willChange: dragging || previewRot != null ? 'transform' : 'auto',
      }}
      onMouseDown={onMouseDown}
    >
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        className={`absolute inset-0 transition-shadow rounded ${
          isSelected ? 'ring-2 ring-amber-400/70' : ''
        }`}
        style={{ overflow: 'visible' }}
      >
        <path
          d={d}
          stroke={stroke.color}
          strokeWidth={stroke.thickness}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>

      {isSelected && (
        <>
          {/* Rotation handle — above bbox top edge. */}
          <div
            className="absolute left-1/2 -translate-x-1/2 -top-8 w-6 h-6 rounded-full bg-app border-2 border-amber-400 cursor-grab flex items-center justify-center hover:bg-amber-400/20"
            onMouseDown={onRotateMouseDown}
            title="Drag to rotate"
            data-testid={`button-rotate-drawing-${obj.id}`}
          >
            <RotateCw className="w-3 h-3 text-amber-400" />
          </div>
          {/* Visual thin tether from bbox top to the handle. */}
          <div
            className="absolute left-1/2 -translate-x-1/2 -top-2 w-px h-2"
            style={{ background: 'rgba(245, 158, 11, 0.5)' }}
          />
        </>
      )}
    </div>
  );
}
