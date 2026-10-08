import React from 'react';
import { renameTimegraph, useTimegraph } from '@/lib/timegraph/timegraphStore';
import { eventsBounds } from '@/lib/timegraph/timegraphLayout';
import { eventSpan } from '@/lib/timegraph/timegraphDate';
import TimelineGlyph from '@/components/timegraph/TimelineGlyph';
import { toast } from 'sonner';

const DEFAULT_W = 240;
const DEFAULT_H = 150;
const MIN_W = 150;
const MIN_H = 96;
const MAX_MARKS = 120;

function MiniTimeline({ events, width, height }) {
  const bounds = eventsBounds(events);
  const safeEvents = (events || []).filter((event) => eventSpan(event));
  const sampled = safeEvents.length <= MAX_MARKS
    ? safeEvents
    : Array.from({ length: MAX_MARKS }, (_, index) => safeEvents[Math.floor(index * safeEvents.length / MAX_MARKS)]);
  const left = 12;
  const right = Math.max(left + 1, width - 12);
  const axisY = height / 2;
  const span = bounds ? Math.max(0.0001, bounds.to - bounds.from) : 1;
  const xFor = (year) => left + ((year - (bounds?.from || 0)) / span) * (right - left);

  return (
    <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <defs>
        <linearGradient id="timeline-axis" x1="0" x2="1">
          <stop offset="0" stopColor="#7c5cb7" stopOpacity="0.25" />
          <stop offset="0.5" stopColor="#c4b5fd" stopOpacity="0.85" />
          <stop offset="1" stopColor="#7c5cb7" stopOpacity="0.25" />
        </linearGradient>
      </defs>
      <line x1={left} x2={right} y1={axisY} y2={axisY} stroke="url(#timeline-axis)" strokeWidth="1.5" />
      {sampled.map((event, index) => {
        const eventRange = eventSpan(event);
        const x = xFor(eventRange.start);
        const above = event.position !== 'below';
        const densityLane = index % 3;
        const stem = 8 + densityLane * 4;
        const endY = axisY + (above ? -stem : stem);
        return (
          <g key={`${event.id || index}-${index}`}>
            {eventRange.isRange && (
              <line
                x1={x}
                x2={xFor(eventRange.end)}
                y1={axisY}
                y2={axisY}
                stroke="#8b5cf6"
                strokeOpacity="0.28"
                strokeWidth="3"
              />
            )}
            <line x1={x} x2={x} y1={axisY} y2={endY} stroke="#a78bfa" strokeOpacity="0.58" strokeWidth="0.8" />
            <circle cx={x} cy={axisY} r="1.4" fill="#c4b5fd" opacity="0.9" />
            <rect x={x - 2.3} y={above ? endY - 3 : endY} width="4.6" height="3" rx="1" fill="#7c5cb7" opacity="0.82" />
          </g>
        );
      })}
      {!safeEvents.length && (
        <circle cx={width / 2} cy={axisY} r="2" fill="#7c5cb7" opacity="0.45" />
      )}
    </svg>
  );
}

export default function CanvasTimegraph({
  obj,
  zoom,
  isSelected,
  isInteractive,
  onSelect,
  onDragEnd,
  onPositionUpdate,
  onResize,
  onOpen,
  textScale = 1,
}) {
  const { timegraph, status } = useTimegraph(obj.timegraph_id);
  const [dragPos, setDragPos] = React.useState(null);
  const [dragging, setDragging] = React.useState(false);
  const [resizing, setResizing] = React.useState(false);
  const [editingTitle, setEditingTitle] = React.useState(false);
  const [titleDraft, setTitleDraft] = React.useState('');
  const dragStart = React.useRef(null);
  const objectStart = React.useRef(null);
  const sizeStart = React.useRef(null);
  const didDrag = React.useRef(false);
  const titleInput = React.useRef(null);
  const cancelRename = React.useRef(false);

  const width = obj.width || DEFAULT_W;
  const height = obj.height || DEFAULT_H;
  const x = dragPos?.x ?? obj.x;
  const y = dragPos?.y ?? obj.y;
  const events = timegraph?.events || [];
  const title = timegraph?.title || (status === 'error' ? 'Timeline unavailable' : 'Unnamed timeline');

  React.useEffect(() => {
    if (!editingTitle) setTitleDraft(timegraph?.title || '');
  }, [editingTitle, timegraph?.title]);

  React.useLayoutEffect(() => {
    if (!editingTitle) return;
    titleInput.current?.focus();
    titleInput.current?.select();
  }, [editingTitle]);

  const saveTitle = React.useCallback(async () => {
    if (!editingTitle || !timegraph?.id) return;
    setEditingTitle(false);
    if (cancelRename.current) {
      cancelRename.current = false;
      setTitleDraft(timegraph.title || '');
      return;
    }
    const nextTitle = titleDraft.trim();
    if (nextTitle === (timegraph.title || '')) return;
    try {
      await renameTimegraph(timegraph.id, nextTitle);
    } catch (error) {
      setTitleDraft(timegraph.title || '');
      toast.error(error?.message || 'BEX could not rename that timeline.');
    }
  }, [editingTitle, timegraph, titleDraft]);

  const handleMouseDown = React.useCallback((event) => {
    if (resizing) return;
    event.stopPropagation();
    onSelect(obj.id);
    if (!isInteractive) return;
    dragStart.current = { x: event.clientX, y: event.clientY };
    objectStart.current = { x: obj.x, y: obj.y };
    didDrag.current = false;
    setDragging(true);

    const move = (moveEvent) => {
      const dx = (moveEvent.clientX - dragStart.current.x) / zoom;
      const dy = (moveEvent.clientY - dragStart.current.y) / zoom;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didDrag.current = true;
      const nextX = objectStart.current.x + dx;
      const nextY = objectStart.current.y + dy;
      setDragPos({ x: nextX, y: nextY });
      onPositionUpdate?.(obj.id, nextX, nextY);
    };
    const up = (upEvent) => {
      const dx = (upEvent.clientX - dragStart.current.x) / zoom;
      const dy = (upEvent.clientY - dragStart.current.y) / zoom;
      setDragging(false);
      setDragPos(null);
      if (didDrag.current) onDragEnd(obj.id, objectStart.current.x + dx, objectStart.current.y + dy);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, [isInteractive, obj, onDragEnd, onPositionUpdate, onSelect, resizing, zoom]);

  const handleDoubleClick = React.useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isInteractive || resizing || editingTitle || didDrag.current || !timegraph?.id) return;
    onOpen?.(timegraph);
  }, [editingTitle, isInteractive, onOpen, resizing, timegraph]);

  const handleResize = React.useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    setResizing(true);
    sizeStart.current = { x: event.clientX, y: event.clientY, width, height };
    const move = (moveEvent) => {
      const nextWidth = Math.max(MIN_W, Math.round(sizeStart.current.width + (moveEvent.clientX - sizeStart.current.x) / zoom));
      const nextHeight = Math.max(MIN_H, Math.round(sizeStart.current.height + (moveEvent.clientY - sizeStart.current.y) / zoom));
      onResize?.(obj.id, nextWidth, nextHeight, false);
    };
    const up = (upEvent) => {
      const nextWidth = Math.max(MIN_W, Math.round(sizeStart.current.width + (upEvent.clientX - sizeStart.current.x) / zoom));
      const nextHeight = Math.max(MIN_H, Math.round(sizeStart.current.height + (upEvent.clientY - sizeStart.current.y) / zoom));
      setResizing(false);
      onResize?.(obj.id, nextWidth, nextHeight, true);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, [height, obj.id, onResize, width, zoom]);

  return (
    <div
      className="absolute select-none overflow-hidden rounded-xl border bg-slate-950/90 shadow-xl transition-[border-color,box-shadow] duration-150"
      style={{
        left: x,
        top: y,
        width,
        height,
        zIndex: isSelected ? 24 : 18,
        borderColor: isSelected ? 'rgba(167,139,250,0.9)' : 'rgba(100,116,139,0.38)',
        boxShadow: isSelected ? '0 0 0 1px rgba(124,92,183,0.45), 0 12px 34px rgba(0,0,0,0.38)' : '0 10px 28px rgba(0,0,0,0.30)',
        cursor: dragging ? 'grabbing' : isInteractive ? 'pointer' : 'default',
      }}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      data-testid={`canvas-timegraph-${obj.id}`}
      aria-label={`Double-click to open timeline ${title}`}
    >
      <div className="absolute inset-x-0 top-0 z-10 flex h-8 items-center gap-1.5 border-b border-white/[0.06] bg-slate-950/70 px-2.5">
        <TimelineGlyph className="h-3.5 w-3.5 shrink-0 text-violet-300" />
        {editingTitle ? (
          <input
            ref={titleInput}
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onMouseDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onBlur={saveTitle}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') {
                cancelRename.current = true;
                event.currentTarget.blur();
              }
            }}
            placeholder="Unnamed timeline"
            aria-label="Timeline name"
            className="h-5 min-w-0 flex-1 rounded border border-violet-400/60 bg-slate-900 px-1 text-[10.5px] font-semibold text-slate-100 outline-none placeholder:text-slate-500 placeholder:opacity-100"
            style={{ fontFamily: 'inherit', fontSize: `${10.5 * textScale}px`, fontWeight: 600, lineHeight: '1rem' }}
            data-testid={`canvas-timegraph-title-input-${obj.id}`}
          />
        ) : (
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left text-[10.5px] font-semibold text-slate-100 cursor-text"
            style={{ fontSize: `${10.5 * textScale}px` }}
            onMouseDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => {
              event.stopPropagation();
              if (!timegraph?.id) return;
              cancelRename.current = false;
              setTitleDraft(timegraph.title || '');
              setEditingTitle(true);
            }}
            aria-label="Double-click to rename timeline"
            data-testid={`canvas-timegraph-title-${obj.id}`}
          >
            {title}
          </button>
        )}
        <span className="text-[9px] tabular-nums text-slate-500" style={{ fontSize: `${9 * textScale}px` }}>{events.length}</span>
      </div>
      <div className="absolute inset-x-2 bottom-2 top-9 overflow-hidden rounded-md bg-gradient-to-b from-violet-500/[0.04] to-transparent">
        <MiniTimeline events={events} width={Math.max(1, width - 16)} height={Math.max(1, height - 44)} />
      </div>
      {isSelected && (
        <button
          type="button"
          aria-label="Resize timeline overview"
          className="absolute bottom-0 right-0 z-20 h-3 w-3 cursor-nwse-resize rounded-tl bg-violet-300/80"
          onMouseDown={handleResize}
          onDoubleClick={(event) => event.stopPropagation()}
          data-testid={`resize-timegraph-${obj.id}`}
        />
      )}
    </div>
  );
}
