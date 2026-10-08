import React, { useRef, useState, useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import { MoveDiagonal2 } from 'lucide-react';
import { displayCardTitle, normalizeCardTitle } from './cardTitle';
import {
  DEFAULT_CARD_WIDTH,
  estimateSmartCardGeometry,
  geometryFromLineBands,
  getCardGeometrySignature,
} from './smartCardGeometry';

const MIN_MANUAL_WIDTH = 60;
const MIN_MANUAL_HEIGHT = 28;

function getPlainTextPreview(content = '') {
  if (!content) return '';
  if (typeof window !== 'undefined') {
    const temp = document.createElement('div');
    temp.innerHTML = content;
    return (temp.textContent || temp.innerText || '').replace(/\s+/g, ' ').trim();
  }
  return String(content).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function hasMeaningfulContent(content = '') {
  return getPlainTextPreview(content).length > 0;
}

export default function CanvasCard({
  card, zoom, isSelected, onSelect, onDragEnd, onDragStart: onDragStartProp,
  onPositionUpdate, onQuickRename, onImageDrop, onClickNoDrag, onResize, tagColors = {},
  geometry: geometryProp, onGeometryChange, textScale = 1,
}) {
  const [dragging, setDragging] = useState(false);
  const [dragPos, setDragPos] = useState(null);
  const [editing, setEditing] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [editTitle, setEditTitle] = useState(normalizeCardTitle(card.title));
  const [dropHover, setDropHover] = useState(false);
  const isSmart = card.layout_mode !== 'manual';
  const dragStartRef = useRef(null);
  const cardStartRef = useRef(null);
  const resizeCleanupRef = useRef(null);
  const inputRef = useRef(null);
  const cardRootRef = useRef(null);
  const titleRef = useRef(null);
  const didDrag = useRef(false);
  // Guard against the Enter handler + onBlur both calling commitRename
  // in the same gesture. Without this, the second call can race against
  // React's pending state flush and re-fire onQuickRename with a stale
  // `card.title`, which manifests as the title visibly reverting.
  const committingRef = useRef(false);

  // Used to measure the intrinsic content width of the first tag row so the
  // description fade mask can be limited to that horizontal extent — text to
  // the RIGHT of the tags stays fully visible, which is the user's intent.
  const tagsRef = useRef(null);
  // Character-based estimate seeds the initial value AND acts as a fallback so
  // the fade is never full-width whenever tags are present — even before the
  // precise DOM measurement runs or if it can't measure (~6px/char + padding).
  const estimateTagsWidth = () =>
    (card.tags || []).reduce((sum, tag, i) => {
      const chars = String(tag || '').trim().length;
      return sum + (chars * 6 + 10) + (i > 0 ? 4 : 0);
    }, 0);
  const [tagsWidth, setTagsWidth] = useState(estimateTagsWidth);
  useLayoutEffect(() => {
    const el = tagsRef.current;
    if (!el || !card.tags || card.tags.length === 0) {
      setTagsWidth(0);
      return;
    }
    const measure = () => {
      const spans = el.querySelectorAll('span');
      if (!spans.length) { setTagsWidth(estimateTagsWidth()); return; }
      // Compare each span's offsetTop to the FIRST span's (a relative comparison
      // valid regardless of which ancestor is the offsetParent) to isolate the
      // first row, and measure widths relative to the first span's left edge.
      const firstTop = spans[0].offsetTop;
      const baseLeft = spans[0].offsetLeft;
      let maxRight = 0;
      spans.forEach((span) => {
        if (span.offsetTop <= firstTop + 1) {
          maxRight = Math.max(maxRight, (span.offsetLeft - baseLeft) + span.offsetWidth);
        }
      });
      setTagsWidth(maxRight > 0 ? maxRight : estimateTagsWidth());
    };
    measure();
    // Tag wrapping (and therefore the first-row width) depends on card width, so
    // re-measure whenever the tag container's box changes — covers manual resize,
    // auto-size changes and any late font-layout shifts.
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => measure());
      ro.observe(el);
    }
    return () => { if (ro) ro.disconnect(); };
  }, [isSmart, (card.tags || []).join(',')]); // re-attach when previews become visible

  // Only sync editTitle from props when we're NOT actively editing — a
  // re-render mid-edit (e.g. parent state churn from autosave) would
  // otherwise yank the user's in-flight text back to the saved value.
  useEffect(() => {
    if (!editing) setEditTitle(normalizeCardTitle(card.title));
  }, [card.title, editing]);

  const showDescription = useMemo(() => !isSmart && hasMeaningfulContent(card.description), [isSmart, card.description]);
  const geometrySignature = useMemo(() => getCardGeometrySignature(card), [card]);
  // The parent already provides the current outline. Do not build and throw
  // away a fresh stepped path for every other card while one card is resized.
  const geometry = useMemo(() => geometryProp?.signature === geometrySignature
    ? geometryProp
    : estimateSmartCardGeometry(card), [card, geometryProp, geometrySignature]);
  // Editing gets the full stable-width rectangle so a short/empty card's old
  // polygon cannot hide the input caret while the new title is being typed.
  const usesSteppedOutline = geometry.mode === 'smart' && !editing;
  // `card.width` remains the stable line-wrap constraint. The measured smart
  // silhouette may be narrower, but feeding that smaller width back into text
  // layout would recursively re-wrap the title toward one word per line.
  const layoutWidth = geometry.mode === 'manual'
    ? geometry.width
    : Math.max(MIN_MANUAL_WIDTH, Number(card.width) || DEFAULT_CARD_WIDTH);
  const smartGripLeft = Math.max(2, Math.min(geometry.width - 22, geometry.bottomRight.x - 22));
  const smartGripTop = Math.max(2, geometry.height - 22);

  const onMouseDown = useCallback((e) => {
    if (editing) return;
    e.stopPropagation();
    // Cmd/Ctrl+click toggles this card in/out of the current multi-select
    // without entering drag mode — mirrors the cmd+drag marquee behavior.
    if (e.metaKey || e.ctrlKey) {
      onSelect(card.id, e);
      return;
    }
    onSelect(card.id, e);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    cardStartRef.current = { x: card.x, y: card.y };
    setDragging(true);
    didDrag.current = false;
    if (onDragStartProp) onDragStartProp(card.id);

    const onMove = (ev) => {
      const dx = (ev.clientX - dragStartRef.current.x) / zoom;
      const dy = (ev.clientY - dragStartRef.current.y) / zoom;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didDrag.current = true;
      const newX = cardStartRef.current.x + dx;
      const newY = cardStartRef.current.y + dy;
      setDragPos((prev) => (prev?.x === newX && prev?.y === newY ? prev : { x: newX, y: newY }));
      if (onPositionUpdate) onPositionUpdate(card.id, newX, newY);
    };

    const onUp = (ev) => {
      const dx = (ev.clientX - dragStartRef.current.x) / zoom;
      const dy = (ev.clientY - dragStartRef.current.y) / zoom;
      const newX = cardStartRef.current.x + dx;
      const newY = cardStartRef.current.y + dy;
      setDragging(false);
      setDragPos(null);
      if (didDrag.current) {
        onDragEnd(card.id, newX, newY);
      } else {
        // Pure click (no drag) — notify parent for center behavior
        if (onClickNoDrag) onClickNoDrag(card.id);
      }
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [card, zoom, onSelect, onDragEnd, onDragStartProp, onPositionUpdate, editing]);

  const handleDoubleClick = (e) => {
    e.stopPropagation();
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const commitRename = () => {
    if (committingRef.current) return;
    committingRef.current = true;
    setEditing(false);
    const trimmed = (editTitle || '').trim();
    if (trimmed !== normalizeCardTitle(card.title).trim()) {
      // Mirror the saved value into local state so the input doesn't flash
      // back to the untrimmed value during the parent's commit cycle.
      setEditTitle(trimmed);
      onQuickRename(card.id, trimmed);
    } else {
      setEditTitle(normalizeCardTitle(card.title));
    }
    // Release the guard after the current event loop turn so the trailing
    // onBlur (fired on input unmount) doesn't get to re-enter, but a real
    // *next* edit gesture still works.
    setTimeout(() => { committingRef.current = false; }, 0);
  };

  const handleResizeMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    resizeCleanupRef.current?.();
    setResizing(true);
    const start = {
      x: e.clientX,
      y: e.clientY,
      // The smart grip lives on the last step, which can be much narrower
      // than the widest title line. Keep the same grip under the pointer
      // when this gesture switches to a manual rectangle (20px grip + 6px inset).
      width: usesSteppedOutline ? smartGripLeft + 26 : geometry.width,
      height: usesSteppedOutline ? smartGripTop + 26 : geometry.height,
    };
    let frame = null;
    let pending = null;
    let lastSent = null;
    let moved = false;

    const queueSize = (ev) => {
      const dx = (ev.clientX - start.x) / zoom;
      const dy = (ev.clientY - start.y) / zoom;
      if (!moved && dx === 0 && dy === 0) return;
      moved = true;
      pending = {
        width: Math.round(Math.max(MIN_MANUAL_WIDTH, start.width + dx)),
        height: Math.round(Math.max(MIN_MANUAL_HEIGHT, start.height + dy)),
      };
    };
    const flush = () => {
      frame = null;
      const next = pending;
      pending = null;
      if (!next || (lastSent?.width === next.width && lastSent?.height === next.height)) return;
      lastSent = next;
      onResize(card.id, next.width, next.height, { layoutMode: 'manual' });
    };
    const cleanup = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onUp);
      resizeCleanupRef.current = null;
    };
    const onUp = (ev) => {
      // A release can carry a newer position than the last mousemove. Flush
      // it synchronously, so a queued frame can never save an older size later.
      if (ev.type === 'mouseup') queueSize(ev);
      cleanup();
      flush();
      setResizing(false);
    };

    const onMove = (ev) => {
      if (ev.buttons === 0) { onUp(ev); return; }
      queueSize(ev);
      // High-rate mice can send several moves per paint. Keep only the latest
      // position instead of rerendering the entire graph for each event.
      if (frame === null) frame = requestAnimationFrame(flush);
    };

    resizeCleanupRef.current = cleanup;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onUp);
  }, [card.id, geometry.width, geometry.height, onResize, zoom, usesSteppedOutline, smartGripLeft, smartGripTop]);

  useEffect(() => () => resizeCleanupRef.current?.(), []);

  // Drag & drop image
  const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); setDropHover(true); };
  const handleDragLeave = () => setDropHover(false);
  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDropHover(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      if (onImageDrop) onImageDrop(card.id, file);
    }
  };

  const x = dragging && dragPos ? dragPos.x : card.x;
  const y = dragging && dragPos ? dragPos.y : card.y;
  const h = geometry.height;

  // Refine the synchronous estimate with the browser's real glyph layout.
  // Smart cards show and measure the title alone. Saved body/media/tags never
  // enter the canvas DOM or leave hidden whitespace in the silhouette. The
  // layout is measured against the stable persisted wrap width, while only the
  // smaller painted outline is reported to the canvas/connection layers.
  useLayoutEffect(() => {
    // Manual dimensions are already authoritative in the parent. Reporting
    // them as a new measurement caused a second full graph render per move.
    if (!onGeometryChange || !usesSteppedOutline) return undefined;

    let cancelled = false;
    let observer = null;
    const measure = () => {
      if (cancelled) return;
      const root = cardRootRef.current;
      const content = titleRef.current;
      if (!root || !content || typeof document === 'undefined' || !document.createRange) return;

      const rootRect = root.getBoundingClientRect();
      const scale = Math.max(Number(zoom) || 1, 0.001);
      const maximumRight = rootRect.left + layoutWidth * scale;
      const fragments = [];

      const addRect = (rect) => {
        if (!rect || rect.width <= 0 || rect.height <= 0) return;
        const left = rect.left;
        const right = Math.min(rect.right, maximumRight);
        const top = rect.top;
        const bottom = rect.bottom;
        if (right <= left || bottom <= top) return;
        fragments.push({
          top: (top - rootRect.top) / scale,
          bottom: (bottom - rootRect.top) / scale,
          right: (right - rootRect.left) / scale,
        });
      };

      const showText = document.defaultView?.NodeFilter?.SHOW_TEXT ?? 4;
      const walker = document.createTreeWalker(content, showText);
      let textNode = walker.nextNode();
      while (textNode) {
        if (String(textNode.textContent || '').trim()) {
          const range = document.createRange();
          range.selectNodeContents(textNode);
          let rects = [];
          try {
            rects = Array.from(range.getClientRects?.() || []);
          } catch {
            rects = [];
          }
          rects.forEach(addRect);
          if (typeof range.detach === 'function') range.detach();
        }
        textNode = walker.nextNode();
      }

      const rows = fragments
        .sort((a, b) => a.top - b.top || a.right - b.right)
        .reduce((merged, row) => {
          const previous = merged[merged.length - 1];
          if (previous && Math.abs(previous.top - row.top) <= 2) {
            previous.top = Math.min(previous.top, row.top);
            previous.bottom = Math.max(previous.bottom, row.bottom);
            previous.right = Math.max(previous.right, row.right);
          } else {
            merged.push({ ...row });
          }
          return merged;
        }, []);
      if (rows.length === 0) return;

      const lineBands = rows.map((row, index) => {
        const next = rows[index + 1];
        const previous = rows[index - 1];
        const top = index === 0
          ? 0
          : (previous.bottom + row.top) / 2;
        const bottom = next
          ? (row.bottom + next.top) / 2
          : row.bottom + 10;
        return {
          top: Math.max(0, top),
          bottom: Math.max(top + 1, bottom),
          right: Math.min(layoutWidth, Math.max(36, row.right + 10)),
        };
      });

      const measured = geometryFromLineBands(lineBands, {
        signature: geometrySignature,
        fallbackWidth: layoutWidth,
      });
      onGeometryChange(card.id, measured);
    };

    measure();
    if (typeof ResizeObserver !== 'undefined' && titleRef.current) {
      observer = new ResizeObserver(measure);
      observer.observe(titleRef.current);
    }
    if (document.fonts?.ready) {
      document.fonts.ready.then(measure).catch(() => undefined);
    }

    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [card.id, geometrySignature, layoutWidth, onGeometryChange, textScale, usesSteppedOutline, zoom]);

  // Tag tints support either a legacy string ('#hex') or the current
  // { color, opacity } object form. Normalize at the read site so the rest
  // of the render path can assume both fields are present.
  const tintEntry = (card.tags || []).reduce((found, tag) => {
    if (found) return found;
    const key = String(tag || '').trim().toLowerCase();
    if (!key) return null;
    const raw = tagColors[key];
    if (!raw) return null;
    if (typeof raw === 'string') return { color: raw, opacity: 30 };
    if (raw.color) return { color: raw.color, opacity: typeof raw.opacity === 'number' ? raw.opacity : 30 };
    return null;
  }, null);
  const tintColor = tintEntry?.color || null;
  // Convert opacity percent into the two alpha hex pairs the gradient + ring
  // already expected. Old code hard-coded '1A' (10%) for the gradient start
  // and '08' (~3%) for the gradient end; scale relative to the user's pick.
  const tintAlpha = tintEntry ? Math.max(0, Math.min(80, tintEntry.opacity)) / 100 : 0;
  const toHexAlpha = (a) => {
    const n = Math.round(Math.max(0, Math.min(1, a)) * 255);
    return n.toString(16).padStart(2, '0');
  };
  const gradStart = tintEntry ? toHexAlpha(tintAlpha * 0.55) : '00';
  const gradEnd = tintEntry ? toHexAlpha(tintAlpha * 0.18) : '00';
  const ringAlpha = tintEntry ? toHexAlpha(tintAlpha * 0.65) : '00';
  const glowAlpha = tintEntry ? toHexAlpha(tintAlpha * 0.30) : '00';
  const smartTintGradientId = `smart-card-tint-${String(card.id).replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  // Build the description fade mask as an inline style so the horizontal
  // extent can be limited to the measured tag-row width.
  //
  // Two-layer mask:
  //   Layer 1 — vertical: fades bottom 18px to transparent (full width)
  //   Layer 2 — horizontal: transparent→opaque from left to tag-row-width
  // Composited with union (add/source-over): a pixel is visible wherever
  // EITHER layer is opaque, so the right side of the card (past the tags)
  // stays fully visible even in the fade zone.
  const VERT_FADE = 'linear-gradient(to bottom, #000 calc(100% - 18px), transparent 100%)';
  let descriptionMaskStyle;
  if (!showDescription) {
    descriptionMaskStyle = {};
  } else if (card.tags && card.tags.length > 0) {
    // Tags present: limit the bottom fade to the tag-row width so text to the
    // right of the tags stays fully visible. tagsWidth is always > 0 here
    // (estimate fallback), so this never degrades to a full-width fade.
    const fadeEnd = Math.max(20, tagsWidth) + 10; // extra 10px for a smooth right edge
    const horizLimit = `linear-gradient(to right, transparent 0px, #000 ${fadeEnd}px)`;
    descriptionMaskStyle = {
      WebkitMaskImage: `${VERT_FADE}, ${horizLimit}`,
      maskImage: `${VERT_FADE}, ${horizLimit}`,
      WebkitMaskComposite: 'source-over', // webkit union: dest shows through transparent src
      maskComposite: 'add',              // standard union: max(layer1, layer2)
    };
  } else {
    // No tags: standard full-width bottom fade.
    descriptionMaskStyle = { WebkitMaskImage: VERT_FADE, maskImage: VERT_FADE };
  }

  return (
    <div
      ref={cardRootRef}
      data-card-id={card.id}
      className={`absolute select-none group transition-shadow ${
        resizing ? 'cursor-nwse-resize z-[110]' : dragging ? 'cursor-grabbing z-[100]' : 'cursor-grab'
      } ${isSelected ? 'z-50' : 'z-10'}`}
      style={{
        left: x,
        top: y,
        width: layoutWidth,
        height: h,
        willChange: dragging || resizing ? 'transform' : 'auto',
        pointerEvents: 'none',
        filter: usesSteppedOutline && !card.is_transparent
          ? (isSelected
            ? 'drop-shadow(0 0 5px rgba(124, 92, 183, 0.55))'
            : 'drop-shadow(0 7px 8px rgba(0, 0, 0, 0.24))')
          : undefined,
      }}
    >
      {/* Ports are rendered at SVG level in ConnectionLines for precise alignment */}
      <div
        data-card-shape="true"
        className={`relative z-10 overflow-hidden pointer-events-auto transition-[background-color,border-color,box-shadow] duration-150 ${
          usesSteppedOutline ? '' : 'rounded-xl'
        } ${
          usesSteppedOutline
            ? 'bg-transparent shadow-none'
            : card.is_transparent
            ? 'bg-transparent backdrop-blur-0 shadow-none'
            : 'bg-gray-800/95 backdrop-blur-sm shadow-lg'
        } ${
          usesSteppedOutline
            ? 'border-0'
            : isSelected
            ? 'border-2 border-brand-strong shadow-brand-strong/40 shadow-xl'
            : dropHover
              ? 'border-2 border-brand border-dashed'
              : card.is_transparent
                ? 'border border-transparent hover:border-gray-700/60'
                : tintColor
                  ? 'border border-gray-700/80 hover:border-gray-600'
                  : 'border border-gray-700/80 hover:border-gray-600'
        }`}
        style={{
          clipPath: usesSteppedOutline ? geometry.clipPath : undefined,
          width: layoutWidth,
          minHeight: h,
          height: geometry.mode === 'manual' ? h : undefined,
          ...(usesSteppedOutline
            ? {}
            : isSelected
              ? { boxShadow: '0 0 0 2px rgba(124, 92, 183, 0.55), 0 0 18px 2px rgba(124, 92, 183, 0.35)' }
              : (!card.is_transparent && tintColor)
                ? { boxShadow: `inset 0 0 0 1px ${tintColor}${ringAlpha}, 0 0 12px 0 ${tintColor}${glowAlpha}` }
                : {}),
        }}
        onMouseDown={onMouseDown}
        onDoubleClick={handleDoubleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {tintColor && !card.is_transparent && !usesSteppedOutline && (
          <div
            className="absolute inset-0 pointer-events-none rounded-xl z-0"
            style={{ background: `linear-gradient(135deg, ${tintColor}${gradStart} 0%, ${tintColor}${gradEnd} 100%)` }}
          />
        )}
        <div
          className="flex flex-col"
          style={{ minHeight: h, height: geometry.mode === 'manual' ? '100%' : undefined }}
        >
          {!isSmart && card.image_url && (
            <div data-smart-card-solid-band="true" className="h-24 shrink-0 bg-gray-900 overflow-hidden relative">
              <img src={card.image_url} alt="" className="w-full h-full object-cover" draggable={false} />
            </div>
          )}
          <div
            className={`p-2.5 flex flex-col ${geometry.mode === 'manual' ? 'flex-1' : ''}`}
            style={{ minHeight: 0 }}
          >
          {editing ? (
            <input
              ref={inputRef}
              value={editTitle}
              placeholder="card title"
              onChange={e => setEditTitle(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setEditTitle(normalizeCardTitle(card.title)); setEditing(false); } }}
              className="w-full bg-transparent border-b border-line text-sm font-semibold text-gray-100 outline-none pb-0.5"
              style={{ fontSize: `${14 * textScale}px` }}
              onClick={e => e.stopPropagation()}
              onMouseDown={e => e.stopPropagation()}
            />
          ) : (
            <h3
              ref={titleRef}
              className="text-sm font-semibold leading-snug text-gray-100 break-words"
              style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: `${14 * textScale}px` }}
            >
              {displayCardTitle(card.title)}
            </h3>
          )}
          {showDescription && (
            <div
              className={`canvas-card-preview text-[11px] text-gray-300 mt-1 leading-snug break-words overflow-hidden relative ${
                geometry.mode === 'manual' ? 'flex-1 min-h-0' : 'max-h-6'
              }`}
              style={{ wordBreak: 'break-word', fontSize: `${11 * textScale}px`, ...descriptionMaskStyle }}
              dangerouslySetInnerHTML={{ __html: card.description }}
            />
          )}
          {(!isSmart && card.tags && card.tags.length > 0) && (
            <div ref={tagsRef} className="relative flex items-center gap-1 mt-1.5 flex-wrap">
              {(card.tags || []).map((tag, i) => (
                <span
                  key={i}
                  data-smart-card-solid-band="true"
                  className="inline-block max-w-full break-all px-1 py-0.5 bg-gray-700/50 text-gray-500 text-[9px] rounded"
                  style={{ fontSize: `${9 * textScale}px` }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
          </div>
        </div>

        </div>

      {usesSteppedOutline && (
        <svg
          aria-hidden="true"
          className="absolute inset-0 z-0 overflow-visible pointer-events-none"
          width={layoutWidth}
          height={h}
          viewBox={`0 0 ${layoutWidth} ${h}`}
        >
          {tintColor && !card.is_transparent && (
            <defs>
              <linearGradient id={smartTintGradientId} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={tintColor} stopOpacity={tintAlpha * 0.55} />
                <stop offset="100%" stopColor={tintColor} stopOpacity={tintAlpha * 0.18} />
              </linearGradient>
            </defs>
          )}
          <path
            d={geometry.path}
            fill={card.is_transparent ? 'none' : '#1f2937'}
            fillOpacity={card.is_transparent ? 0 : 0.95}
          />
          {tintColor && !card.is_transparent && (
            <path d={geometry.path} fill={`url(#${smartTintGradientId})`} />
          )}
          <path
            d={geometry.path}
            fill="none"
            stroke={isSelected
              ? '#8b6fc0'
              : dropHover
                ? '#a78bfa'
                : card.is_transparent
                  ? 'transparent'
                  : '#374151'}
            strokeWidth={isSelected || dropHover ? 2 : 1}
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray={dropHover ? '5 4' : undefined}
          />
        </svg>
      )}

      <button
        type="button"
        aria-label="Resize card"
        title={usesSteppedOutline ? 'Drag for a fixed rectangular size' : 'Resize card'}
        onMouseDown={handleResizeMouseDown}
        onClick={(e) => e.stopPropagation()}
        className="absolute z-30 flex h-5 w-5 items-center justify-center rounded-md bg-gray-700/80 text-gray-300 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-gray-600 cursor-nwse-resize pointer-events-auto"
        style={usesSteppedOutline
          ? {
              left: smartGripLeft,
              top: smartGripTop,
            }
          : { right: 6, bottom: 6 }}
      >
        <MoveDiagonal2 className="h-3 w-3" />
      </button>
      </div>
  );
}
