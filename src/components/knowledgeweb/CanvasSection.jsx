import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Lock, Unlock, GripHorizontal } from 'lucide-react';

const NAMED_COLORS = {
  default: '#3b82f6',
  blue: '#3b82f6',
  violet: '#6B4C9A',
  green: '#22c55e',
  purple: '#a855f7',
  red: '#ef4444',
  amber: '#f59e0b',
  rose: '#f43f5e',
  cyan: '#06b6d4',
  emerald: '#10b981',
  slate: '#64748b',
};

function hexToRgb(hex) {
  const cleaned = String(hex || '').replace('#', '');
  if (cleaned.length !== 6) return { r: 59, g: 130, b: 246 };
  return {
    r: parseInt(cleaned.slice(0, 2), 16),
    g: parseInt(cleaned.slice(2, 4), 16),
    b: parseInt(cleaned.slice(4, 6), 16),
  };
}

function resolveSectionPalette(obj) {
  // obj.color may be a named color id (legacy) or a hex string.
  const raw = obj.color || 'default';
  const hex = raw.startsWith('#') ? raw : (NAMED_COLORS[raw] || NAMED_COLORS.default);
  const { r, g, b } = hexToRgb(hex);
  // opacity is a percent 0–100; default to 10 to roughly match the
  // historical soft tint (0.06 alpha) but slightly more visible.
  const fillPct = typeof obj.opacity === 'number' ? obj.opacity : 10;
  const fillAlpha = Math.max(0, Math.min(100, fillPct)) / 100;
  return {
    bg: `rgba(${r}, ${g}, ${b}, ${fillAlpha})`,
    border: `rgba(${r}, ${g}, ${b}, 0.45)`,
    text: hex,
    hex,
  };
}

export default function CanvasSection({ obj, zoom, isSelected, onSelect, onDragEnd, onPositionUpdate, onUpdate, onResize }) {
  const [dragging, setDragging] = useState(false);
  const [dragPos, setDragPos] = useState(null);
  const [resizing, setResizing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(obj.title || '');
  const dragStartRef = useRef(null);
  const objStartRef = useRef(null);
  const sizeStartRef = useRef(null);
  const didDrag = useRef(false);
  const inputRef = useRef(null);

  useEffect(() => { setEditTitle(obj.title || ''); }, [obj.title]);

  const colors = resolveSectionPalette(obj);
  const isLocked = !!obj.is_locked;

  const onMouseDown = useCallback((e) => {
    if (editing || resizing) return;
    // Locked sections swallow the click but do not select — the user
    // explicitly does not want the inspector to open. The unlock button
    // lives on the section itself, so the section is still actionable.
    if (isLocked) {
      e.stopPropagation();
      return;
    }
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
  }, [obj, zoom, onSelect, onDragEnd, onPositionUpdate, editing, resizing, isLocked]);

  // Resize handle (also disabled when locked)
  const onResizeDown = useCallback((e) => {
    if (isLocked) return;
    e.stopPropagation();
    setResizing(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    sizeStartRef.current = { w: obj.width || 400, h: obj.height || 300 };

    const onMove = (ev) => {
      const dw = (ev.clientX - dragStartRef.current.x) / zoom;
      const dh = (ev.clientY - dragStartRef.current.y) / zoom;
      const nw = Math.max(200, sizeStartRef.current.w + dw);
      const nh = Math.max(100, sizeStartRef.current.h + dh);
      if (onResize) onResize(obj.id, nw, nh);
    };

    const onUp = () => {
      setResizing(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [obj, zoom, onResize, isLocked]);

  const handleDoubleClick = (e) => {
    // Always swallow the double-click so it can't bubble up and trigger the
    // canvas-level "double-click to create" handler — even when the section
    // is locked.
    e.stopPropagation();
    if (isLocked) return;
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const commitTitle = () => {
    setEditing(false);
    if (editTitle !== obj.title) onUpdate(obj.id, { title: editTitle });
  };

  const toggleLock = (e) => {
    e.stopPropagation();
    onUpdate(obj.id, { is_locked: !isLocked });
  };

  const x = dragging && dragPos ? dragPos.x : obj.x;
  const y = dragging && dragPos ? dragPos.y : obj.y;
  const w = obj.width || 400;
  const h = obj.height || 300;

  // When locked, the entire section becomes click-through so the user can
  // pan the camera, click connection lines, and select cards layered above
  // it without the section eating the event. The lock toggle button itself
  // re-enables pointer events so it remains the one interactive surface.
  const fontSize = typeof obj.font_size === 'number' && obj.font_size > 0 ? obj.font_size : 18;

  return (
    <div
      data-obj-id={obj.id}
      className={`absolute select-none group ${
        isLocked ? 'cursor-default' : dragging ? 'cursor-grabbing' : 'cursor-grab'
      }`}
      style={{
        left: x, top: y,
        width: w,
        height: h,
        // No stacking context here: the fill belongs below noodles, while
        // section controls must remain above their wide invisible hit areas.
        pointerEvents: 'none',
      }}
      onMouseDown={isLocked ? undefined : onMouseDown}
      onDoubleClick={isLocked ? undefined : handleDoubleClick}
    >
      <div
        className={`absolute inset-0 rounded-2xl border-2 border-dashed transition-all duration-150 ${isSelected ? 'z-[5]' : 'z-[2]'} ${
          isSelected ? 'ring-2 ring-sky-400 ring-offset-1 ring-offset-gray-950' : ''
        }`}
        style={{ background: colors.bg, borderColor: colors.border, pointerEvents: isLocked ? 'none' : 'auto' }}
      />
        <div className="absolute inset-x-0 top-0 z-[8] px-3 py-2 flex items-start justify-between gap-2" style={{ pointerEvents: isLocked ? 'none' : 'auto' }}>
          {editing ? (
            <input
              ref={inputRef}
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={e => { if (e.key === 'Enter') commitTitle(); if (e.key === 'Escape') { setEditTitle(obj.title); setEditing(false); } }}
              className="bg-transparent font-semibold uppercase tracking-wider outline-none flex-1 min-w-0"
              style={{ color: colors.text, fontSize: `${fontSize}px`, lineHeight: 1.2 }}
              onClick={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
            />
          ) : (
            <div
              className="font-semibold uppercase tracking-wider truncate flex-1 min-w-0"
              style={{ color: colors.text, fontSize: `${fontSize}px`, lineHeight: 1.2 }}
            >
              {obj.title || 'Section'}
            </div>
          )}

          {/* Lock toggle — top right. Re-enables pointer-events so it can
              still be clicked even when the section wrapper is pass-through. */}
          <button
            type="button"
            onClick={toggleLock}
            onMouseDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            title={isLocked ? 'Unlock section' : 'Lock section (prevents accidental drags)'}
            data-testid={`button-section-lock-${obj.id}`}
            style={{ pointerEvents: 'auto' }}
            className={`flex-shrink-0 p-1 rounded-md transition-all ${
              isLocked
                ? 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25'
                : 'text-gray-500 hover:text-gray-200 opacity-0 group-hover:opacity-100'
            }`}
          >
            {isLocked
              ? <Lock className="w-3.5 h-3.5" />
              : <Unlock className="w-3.5 h-3.5" />}
          </button>
        </div>

      {/* Only the section's edges rise above connections. The interior stays
          below them so noodles and contained cards remain selectable. */}
      {!isLocked && [
        { top: -3, left: 0, right: 0, height: 8 },
        { bottom: -3, left: 0, right: 0, height: 8 },
        { left: -3, top: 0, bottom: 0, width: 8 },
        { right: -3, top: 0, bottom: 0, width: 8 },
      ].map((edge, index) => <div key={index} data-section-edge={index} className="absolute z-[8]" style={{ ...edge, pointerEvents: 'auto' }} />)}

      {/* Drag-handle indicator (bottom right, just inside the resize corner). */}
      {!isLocked && (
        <div
          className="absolute bottom-1 right-6 z-[8] pointer-events-none opacity-50 group-hover:opacity-90 transition-opacity"
          title="Drag from anywhere on the section"
          aria-hidden="true"
        >
          <GripHorizontal className="w-4 h-4" style={{ color: colors.text }} />
        </div>
      )}

      {/* Resize handle (disabled when locked). */}
      {!isLocked && (
        <div
          className="absolute bottom-0 right-0 z-[9] w-4 h-4 cursor-se-resize opacity-0 group-hover:opacity-100 transition-opacity"
          data-testid={`section-resize-${obj.id}`}
          onMouseDown={onResizeDown}
          style={{ pointerEvents: 'auto', borderRight: `3px solid ${colors.border}`, borderBottom: `3px solid ${colors.border}`, borderRadius: '0 0 8px 0' }}
        />
      )}
    </div>
  );
}
