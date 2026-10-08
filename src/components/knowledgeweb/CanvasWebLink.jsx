import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Network, ExternalLink } from 'lucide-react';

// A canvas object that visually represents a link to another knowledge web.
// Looks like an abstract node-network ring around a glowing title — the
// linked web's name sits in the center with a soft fade behind it making
// it pop forward from the network.
//
// Interaction model (in hand mode):
//   - Single click  → opens a small popover with the destination web's
//                      title and an "Open" button. This gives the user a
//                      moment to preview where the click would take them
//                      before committing.
//   - Double click  → jumps immediately, skipping the popover.
//   - Click outside / Esc → dismisses the popover.
//
// In any non-hand mode (erase, draw, etc.) clicks fall through to the
// parent's selection / delete logic so the node can be moved or removed
// without ever opening the menu or jumping.
//
// The rendered title is looked up live from the parent's `webs` list so
// renames in the linked web propagate automatically. If the linked web
// no longer exists we degrade to "(deleted web)" rather than orphaning
// the canvas object.

// Pre-computed positions for the outer node ring. Twelve nodes spread
// evenly around a circle, plus an inner cluster of six closer to the
// center for the "abstract network" feel. Coordinates are unit vectors
// scaled at render time.
const OUTER_NODES = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2;
  return { x: Math.cos(a), y: Math.sin(a), ring: 'outer', i };
});
const INNER_NODES = Array.from({ length: 6 }, (_, i) => {
  const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
  return { x: Math.cos(a) * 0.55, y: Math.sin(a) * 0.55, ring: 'inner', i: i + 12 };
});
const ALL_NODES = [...OUTER_NODES, ...INNER_NODES];

// Edges connect each outer node to its two neighbors and to one inner
// node, plus the inner ring fully connects to itself. Picked by hand for
// a balanced "neural" look without any single hot spot.
const EDGES = [
  ...OUTER_NODES.map((_, i) => [i, (i + 1) % 12]),
  ...OUTER_NODES.map((_, i) => [i, 12 + (i % 6)]),
  ...INNER_NODES.map((_, i) => [12 + i, 12 + ((i + 1) % 6)]),
  ...INNER_NODES.map((_, i) => [12 + i, 12 + ((i + 2) % 6)]),
];

// Default size for newly-created web-link nodes. Smaller than text
// blocks since the node itself is the focal point and excessive
// whitespace inside the ring just looks empty. Resize handle still
// allows users to grow them on demand.
const DEFAULT_W = 180;
const DEFAULT_H = 140;
const MIN_W = 100;
const MIN_H = 80;

export default function CanvasWebLink({
  obj,
  zoom,
  isSelected,
  webs,
  isInteractive,
  onSelect,
  onDragEnd,
  onPositionUpdate,
  onResize,
  onJump,
}) {
  const [dragging, setDragging] = useState(false);
  const [dragPos, setDragPos] = useState(null);
  const [resizing, setResizing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const dragStartRef = useRef(null);
  const objStartRef = useRef(null);
  const sizeStartRef = useRef(null);
  const didDrag = useRef(false);
  const containerEl = useRef(null);
  const menuEl = useRef(null);

  // Live title lookup. webs may briefly be empty during initial load so
  // we tolerate undefined and show a quiet placeholder.
  const linked = useMemo(
    () => (webs || []).find((w) => w.id === obj.link_web_id),
    [webs, obj.link_web_id],
  );
  const titleText = linked
    ? (linked.is_private ? (linked.title || 'Private Web') : (linked.title || 'Untitled'))
    : (obj.link_web_id ? '(deleted web)' : 'Pick a web…');
  const isPrivate = !!linked?.is_private;
  const isDangling = !linked && !!obj.link_web_id;

  // Close the popover whenever the node loses interactivity (e.g. user
  // switches into erase mode) so a stale menu doesn't sit on top of an
  // un-clickable node.
  useEffect(() => {
    if (!isInteractive && menuOpen) setMenuOpen(false);
  }, [isInteractive, menuOpen]);

  // Outside-click + Esc dismiss for the popover. Installed only while
  // open so we're not paying for global listeners on every node.
  useEffect(() => {
    if (!menuOpen) return;
    const onDocDown = (e) => {
      // Clicks on the node itself are fine — they re-trigger "open" and
      // are no-ops. Clicks on the popover are obviously fine. Anything
      // else closes.
      if (menuEl.current?.contains(e.target)) return;
      if (containerEl.current?.contains(e.target)) return;
      setMenuOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const onMouseDown = useCallback(
    (e) => {
      if (resizing) return;
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
    },
    [obj, zoom, onSelect, onDragEnd, onPositionUpdate, resizing],
  );

  const onResizeMouseDown = useCallback(
    (e) => {
      e.stopPropagation();
      e.preventDefault();
      setResizing(true);
      sizeStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        w: obj.width,
        h: obj.height,
      };

      const onMove = (ev) => {
        const dw = (ev.clientX - sizeStartRef.current.mouseX) / zoom;
        const dh = (ev.clientY - sizeStartRef.current.mouseY) / zoom;
        const nw = Math.max(MIN_W, Math.round(sizeStartRef.current.w + dw));
        const nh = Math.max(MIN_H, Math.round(sizeStartRef.current.h + dh));
        if (onResize) onResize(obj.id, nw, nh, /*persist*/ false);
      };
      const onUp = (ev) => {
        const dw = (ev.clientX - sizeStartRef.current.mouseX) / zoom;
        const dh = (ev.clientY - sizeStartRef.current.mouseY) / zoom;
        const nw = Math.max(MIN_W, Math.round(sizeStartRef.current.w + dw));
        const nh = Math.max(MIN_H, Math.round(sizeStartRef.current.h + dh));
        setResizing(false);
        if (onResize) onResize(obj.id, nw, nh, /*persist*/ true);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [obj, zoom, onResize],
  );

  // Single-click in hand mode: open the popover. We never auto-jump
  // here; jumping requires either double-click or explicitly clicking
  // the "Open" button in the popover.
  const handleClick = useCallback(
    (e) => {
      if (didDrag.current) return;
      if (!isInteractive) return;
      e.stopPropagation();
      // Even for dangling links we open the menu — it surfaces the
      // "(deleted web)" label so the user understands why nothing
      // happens on Open.
      setMenuOpen(true);
    },
    [isInteractive],
  );

  // Double-click: close the menu (in case it just opened on the first
  // click) and jump immediately. This is the "I know where I'm going,
  // take me there" shortcut.
  const handleDoubleClick = useCallback(
    (e) => {
      if (didDrag.current) return;
      if (!isInteractive) return;
      if (!obj.link_web_id || isDangling) return;
      e.stopPropagation();
      setMenuOpen(false);
      onJump?.(obj);
    },
    [obj, isInteractive, isDangling, onJump],
  );

  // Explicit "Open" button inside the popover — same effect as a
  // double-click, useful for users who didn't realize double-click was
  // an option.
  const handleOpenClick = useCallback(
    (e) => {
      e.stopPropagation();
      if (!obj.link_web_id || isDangling) return;
      setMenuOpen(false);
      onJump?.(obj);
    },
    [obj, isDangling, onJump],
  );

  const x = dragPos ? dragPos.x : obj.x;
  const y = dragPos ? dragPos.y : obj.y;
  const w = obj.width || DEFAULT_W;
  const h = obj.height || DEFAULT_H;

  // The visual "node network" SVG fills the box. The outer ring lives
  // at 92% radius so it doesn't kiss the bounding edges; nodes are tiny
  // dots with a soft glow that brightens on hover.
  const cx = w / 2;
  const cy = h / 2;
  const rx = (w / 2) * 0.92;
  const ry = (h / 2) * 0.92;

  const ringColor = isDangling
    ? '#7f1d1d'
    : isPrivate
    ? '#a78bfa'
    : '#7dd3fc';
  const ringGlow = isDangling
    ? 'rgba(220,38,38,0.45)'
    : isPrivate
    ? 'rgba(167,139,250,0.45)'
    : 'rgba(125,211,252,0.45)';
  const titleColor = isDangling ? '#fca5a5' : '#f8fafc';

  // Title font scales gently with the smaller dimension so a small
  // default-size node still has readable text and a resized-up node
  // doesn't get a tiny title swimming in space.
  const titleFontPx = Math.max(11, Math.min(20, Math.round(Math.min(w, h) * 0.11)));
  const iconPx = Math.max(12, Math.min(20, Math.round(Math.min(w, h) * 0.12)));

  return (
    <div
      ref={containerEl}
      className="absolute select-none"
      style={{
        left: x,
        top: y,
        width: w,
        height: h,
        zIndex: isSelected || menuOpen ? 25 : hovered ? 22 : 20,
        cursor: dragging ? 'grabbing' : isInteractive && obj.link_web_id ? 'pointer' : 'grab',
      }}
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      data-testid={`canvas-weblink-${obj.id}`}
    >
      {/* Soft circular fade behind the title to make it pop forward
          from the network. Sized larger than the node ring so the glow
          spills past it. */}
      <div
        className="absolute pointer-events-none transition-opacity duration-300"
        style={{
          left: '50%',
          top: '50%',
          width: Math.min(w, h) * 0.85,
          height: Math.min(w, h) * 0.85,
          transform: 'translate(-50%, -50%)',
          background: `radial-gradient(closest-side, ${ringGlow} 0%, rgba(15,23,42,0.55) 55%, rgba(15,23,42,0) 78%)`,
          opacity: hovered || menuOpen ? 1 : 0.85,
          filter: 'blur(2px)',
        }}
      />

      {/* The node-network SVG sits on top of the fade but behind the
          title text so the title visually "punches through" it. */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
      >
        <defs>
          <radialGradient id={`node-glow-${obj.id}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={ringColor} stopOpacity="0.95" />
            <stop offset="100%" stopColor={ringColor} stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* Edges first so dots paint on top */}
        <g
          stroke={ringColor}
          strokeOpacity={hovered || menuOpen ? 0.55 : 0.32}
          strokeWidth={1}
          style={{ transition: 'stroke-opacity 200ms ease' }}
        >
          {EDGES.map(([a, b], i) => {
            const na = ALL_NODES[a];
            const nb = ALL_NODES[b];
            return (
              <line
                key={i}
                x1={cx + na.x * rx}
                y1={cy + na.y * ry}
                x2={cx + nb.x * rx}
                y2={cy + nb.y * ry}
              />
            );
          })}
        </g>
        {/* Soft halo per node */}
        <g>
          {ALL_NODES.map((n) => (
            <circle
              key={`h-${n.i}`}
              cx={cx + n.x * rx}
              cy={cy + n.y * ry}
              r={n.ring === 'outer' ? 7 : 5}
              fill={`url(#node-glow-${obj.id})`}
            />
          ))}
        </g>
        {/* Hard dots */}
        <g fill={ringColor}>
          {ALL_NODES.map((n) => (
            <circle
              key={`d-${n.i}`}
              cx={cx + n.x * rx}
              cy={cy + n.y * ry}
              r={n.ring === 'outer' ? 2.2 : 1.8}
              opacity={hovered || menuOpen ? 1 : 0.85}
              style={{ transition: 'opacity 200ms ease' }}
            />
          ))}
        </g>
      </svg>

      {/* Centered title — the focal point. The icon hints at "network /
          jump" so the affordance is clear even before hover. */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-4">
        <Network
          className="mb-1 opacity-80"
          style={{ width: iconPx, height: iconPx, color: ringColor }}
        />
        <div
          className="text-center font-semibold leading-tight"
          style={{
            color: titleColor,
            fontSize: titleFontPx,
            textShadow: `0 0 12px ${ringGlow}, 0 1px 2px rgba(0,0,0,0.6)`,
            wordBreak: 'break-word',
          }}
          data-testid={`text-weblink-title-${obj.id}`}
        >
          {titleText}
        </div>
        {isDangling && (
          <div className="text-[10px] uppercase tracking-wider mt-1 text-red-300/80">
            link broken
          </div>
        )}
      </div>

      {/* Selection outline + resize handle — appear only when selected
          so the visual stays clean by default. */}
      {isSelected && (
        <>
          <div
            className="absolute inset-0 rounded-2xl pointer-events-none"
            style={{ boxShadow: `0 0 0 2px ${ringColor}, 0 0 30px ${ringGlow}` }}
          />
          <div
            onMouseDown={onResizeMouseDown}
            className="absolute -bottom-1 -right-1 w-3 h-3 bg-white border border-gray-400 rounded-sm cursor-nwse-resize"
            data-testid={`resize-weblink-${obj.id}`}
          />
        </>
      )}

      {/* Popover menu — opens on single-click in hand mode. Counter-
          scaled by 1/zoom so it stays readable at any zoom level, and
          anchored just above the node so it never covers the title.
          Pointer-events forced back on (the node container has them
          off in some child layers) so the buttons are clickable. */}
      {menuOpen && isInteractive && (
        <div
          ref={menuEl}
          className="absolute"
          style={{
            left: '50%',
            top: 0,
            transform: `translate(-50%, calc(-100% - 10px)) scale(${1 / zoom})`,
            transformOrigin: 'bottom center',
            pointerEvents: 'auto',
            zIndex: 30,
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          data-testid={`menu-weblink-${obj.id}`}
        >
          <div
            className="bg-[#0F1318] border border-line rounded-lg shadow-2xl px-3 py-2.5 min-w-[200px] max-w-[280px]"
            style={{
              boxShadow: `0 8px 30px rgba(0,0,0,0.5), 0 0 0 1px ${ringGlow}`,
            }}
          >
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
              {isDangling ? 'Broken link' : isPrivate ? 'Private web' : 'Linked web'}
            </div>
            <div
              className="text-sm font-semibold text-white leading-snug mb-2.5 break-words"
              style={{ color: titleColor }}
              data-testid={`menu-weblink-title-${obj.id}`}
            >
              {titleText}
            </div>
            <button
              onClick={handleOpenClick}
              disabled={isDangling || !obj.link_web_id}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: isDangling ? '#374151' : ringColor,
                color: isDangling ? '#9ca3af' : '#0B0E13',
              }}
              title="Open this web"
              data-testid={`button-weblink-open-${obj.id}`}
            >
              <ExternalLink className="w-3 h-3" />
              Open
            </button>
          </div>
          {/* Tiny pointer triangle so the popover visibly belongs to
              this node. */}
          <div
            className="absolute left-1/2 -translate-x-1/2"
            style={{
              bottom: -5,
              width: 10,
              height: 10,
              background: '#0F1318',
              borderRight: '1px solid #2A3040',
              borderBottom: '1px solid #2A3040',
              transform: 'translateX(-50%) rotate(45deg)',
            }}
          />
        </div>
      )}
    </div>
  );
}
