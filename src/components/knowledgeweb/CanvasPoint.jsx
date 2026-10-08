import React, { useRef, useState, useCallback } from 'react';

// A "point" is a tiny anchor on the canvas. It exists purely so connection
// lines can be redirected through it — most useful when straight-line mode
// is on. It is stored as a `canvas_objects` row of type 'point' so it
// participates in autosave, version history, and undo/redo just like every
// other canvas object. Width/height are fixed (the dot is always the same
// visual size regardless of zoom).
export const POINT_SIZE = 12;

export default function CanvasPoint({
  obj,
  zoom,
  isSelected,
  isConnectionSource,
  onSelect,
  onDragEnd,
  onPositionUpdate,
}) {
  const [dragging, setDragging] = useState(false);
  const [dragPos, setDragPos] = useState(null);
  const dragStartRef = useRef(null);
  const objStartRef = useRef(null);
  const didDragRef = useRef(false);

  const onMouseDown = useCallback((e) => {
    e.stopPropagation();
    // Cmd/Ctrl+click toggles this point in/out of the current multi-select
    // without entering drag mode — mirrors the cmd+drag marquee behavior.
    if (e.metaKey || e.ctrlKey) {
      onSelect(obj.id, e);
      return;
    }
    onSelect(obj.id, e);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    objStartRef.current = { x: obj.x, y: obj.y };
    setDragging(true);
    didDragRef.current = false;

    const onMove = (ev) => {
      const dx = (ev.clientX - dragStartRef.current.x) / zoom;
      const dy = (ev.clientY - dragStartRef.current.y) / zoom;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) didDragRef.current = true;
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
      if (didDragRef.current) onDragEnd(obj.id, objStartRef.current.x + dx, objStartRef.current.y + dy);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [obj, zoom, onSelect, onDragEnd, onPositionUpdate]);

  const x = dragging && dragPos ? dragPos.x : obj.x;
  const y = dragging && dragPos ? dragPos.y : obj.y;
  const isActive = isSelected || isConnectionSource;

  return (
    <div
      data-obj-id={obj.id}
      data-point-id={obj.id}
      className={`absolute select-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'} ${isSelected ? 'z-[10]' : 'z-[8]'}`}
      style={{
        left: x,
        top: y,
        width: POINT_SIZE,
        height: POINT_SIZE,
      }}
      onMouseDown={onMouseDown}
      title="Routing point — connect noodles through it"
    >
      <div
        className="absolute left-1/2 top-1/2 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full transition-[background-color,box-shadow]"
        style={{
          background: isActive ? '#f59e0b' : '#4b5563',
          border: 'none',
          boxShadow: isActive ? '0 0 7px rgba(245, 158, 11, 0.4)' : 'none',
        }}
      />
    </div>
  );
}
