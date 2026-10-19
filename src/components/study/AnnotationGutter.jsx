import React, { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Copy, Edit2, GripVertical, Link2, PenLine } from 'lucide-react';
import MarkdownRenderer from '@/components/editor/MarkdownRenderer';
import { gutterConnector, normalizeGutterPosition, normalizeGutterSize, normalizeGutterRoute, routeFromMidpoint, stackGutterCards } from '@/lib/annotationGutterGeometry';
import { registerPendingEditorSave } from '@/lib/pendingEditorSaves';
import { commentaryVersionLabel } from '@/lib/commentaryLink';
import './annotationGutter.css';

// Moving a large note must not reparse its writing or remount its live editor.
const FullGutterNote = memo(/** @param {{content: string}} props */ function FullGutterNote({ content }) {
  const expanded = useMemo(() => {
    if (!content || !/<(?:p|img|h[1-4]|details|div)\b/i.test(content)) return content || '';
    // This is a reading-only transformation. Never rewrite the saved document
    // or the author's toggle states in the editor.
    const document = new DOMParser().parseFromString(content, 'text/html');
    document.querySelectorAll('details').forEach(details => details.setAttribute('open', ''));
    return document.body.innerHTML;
  }, [content]);
  return <div className="bex-gutter-full-note" onClickCapture={event => {
    // Keep the whole note visible, including nested sections. Links in their
    // headings still follow the normal library/external-link behavior.
    const target = /** @type {Element} */ (event.target);
    if (target.closest?.('summary') && !target.closest?.('a, button')) event.preventDefault();
  }}><MarkdownRenderer content={expanded} sourcesById={{}} /></div>;
});
const GutterNoteContent = memo(/** @param {{content: string, editor?: React.ReactNode}} props */ function GutterNoteContent({ content, editor }) {
  return editor || <FullGutterNote content={content} />;
});
const GutterCard = memo(/** @param {any} props */ function GutterCard({ annotation, top, x, size, moveProps, resizeProps, register, onEdit, onCopyLink, onCopyContent, hasDrawing, editor, versionLabel }) {
  const body = useRef(null);
  const edition = commentaryVersionLabel(annotation, versionLabel);
  return <article ref={register} className={`bex-gutter-card${size ? ' bex-gutter-card-sized' : ''}`} style={{ top, right: -x, ...(size ? { width: size.width, height: size.height, maxWidth: 'none' } : {}) }} data-testid={`gutter-annotation-${annotation.id}`} data-annotation-card-id={annotation.id}>
    <button type="button" className="bex-gutter-move" {...moveProps} data-testid={`annotation-move-${annotation.id}`}
      aria-label={`Move annotation for ${annotation.book} ${annotation.chapter_number}:${annotation.start_verse}`}
      title="Drag to move this note. Arrow keys move it; Shift moves farther. Double-click to reset."><GripVertical size={18} aria-hidden="true" /></button>
    <header className="bex-gutter-card-head">
      <span>{annotation.book} {annotation.chapter_number}:{annotation.start_verse}{annotation.end_verse !== annotation.start_verse ? `–${annotation.end_verse}` : ''}</span>
      <span className="bex-gutter-card-actions">
        {onCopyLink && <button type="button" onClick={() => onCopyLink(annotation)} aria-label={`Copy link to commentary on ${annotation.book} ${annotation.chapter_number}:${annotation.start_verse}${edition ? ` (${edition})` : ''}`} title={`Copy link to this commentary${edition ? ` (${edition})` : ''}. Opens its Bible edition and note.`}>
          <Link2 size={14} />
        </button>}
        {onCopyContent && <button type="button" onClick={() => onCopyContent(annotation, body.current?.querySelector('.ProseMirror') || body.current)} aria-label={`Copy commentary text for ${annotation.book} ${annotation.chapter_number}:${annotation.start_verse}`} title="Copy this commentary's contents">
          <Copy size={14} />
        </button>}
        {!editor && <button type="button" onClick={() => onEdit(annotation)} aria-label={`Edit annotation for ${annotation.book} ${annotation.chapter_number}:${annotation.start_verse}`} title="Edit annotation">
          {hasDrawing ? <PenLine size={14} /> : <Edit2 size={14} />}
        </button>}
      </span>
    </header>
    <div ref={body} className="bex-gutter-card-content" data-workspace-native-scroll><GutterNoteContent content={annotation.content} editor={editor} /></div>
    {hasDrawing && <button type="button" className="bex-gutter-drawing" onClick={() => onEdit(annotation)}>Open drawing</button>}
    {['nw', 'ne', 'sw', 'se'].map(corner => <button key={corner} type="button" className={`bex-gutter-resize bex-gutter-resize-${corner}`} {...resizeProps(corner)}
      aria-label={`Resize annotation ${annotation.id} from ${corner} corner`} title="Drag to change width and height independently. Double-click to fit the writing."
      data-testid={`annotation-resize-${annotation.id}-${corner}`} />)}
  </article>;
});

export default function AnnotationGutter({ annotations, enabled, onEdit, onCopyLink, onCopyContent, onSaveRoute, onSavePosition, onSaveSize, annotationDrawings = {}, editingId, editor, versionLabel, onActiveChange, children }) {
  const host = useRef(null), reading = useRef(null), cards = useRef(new Map());
  const [layout, setLayout] = useState({ items: [], width: 0, height: 0, railRight: 0, minX: 0, readingHeight: 0 });
  const [routes, setRoutes] = useState({});
  const routesRef = useRef({});
  const [positions, setPositions] = useState({});
  const positionsRef = useRef({}), savedPositions = useRef({}), cardDrag = useRef(null);
  const [sizes, setSizes] = useState({});
  const sizesRef = useRef({}), savedSizes = useRef({}), resizeDrag = useRef(null);
  const drag = useRef(null), frame = useRef(null), pending = useRef(Promise.resolve());
  const mounted = useRef(true);
  const markerId = useId().replace(/:/g, '');
  const cardCallbacks = useRef(new Map());
  const registerCard = id => {
    if (!cardCallbacks.current.has(id)) cardCallbacks.current.set(id, element => {
      if (element) cards.current.set(id, element); else cards.current.delete(id);
    });
    return cardCallbacks.current.get(id);
  };
  const active = enabled && layout.items.length > 0;
  const measure = useCallback(() => {
    if (!host.current || !reading.current) return;
    const bounds = host.current.getBoundingClientRect();
    const zoom = Number(host.current.closest('[data-zoom]')?.dataset.zoom) || 1;
    const rail = host.current.querySelector('.bex-annotation-rail');
    const railBounds = rail?.getBoundingClientRect();
    const spans = [...reading.current.querySelectorAll('[data-annotation-ids]')];
    const items = enabled ? annotations.flatMap(annotation => {
      const selected = spans.filter(span => (span.dataset.annotationIds || '').split(' ').includes(String(annotation.id)));
      const rects = selected
        .flatMap(span => [...span.getClientRects()]).filter(rect => rect.width > 0 && rect.height > 0);
      if (!rects.length) return [];
      const first = rects[0];
      const row = rects.filter(rect => Math.abs(rect.top - first.top) < 3);
      const left = (Math.min(...row.map(rect => rect.left)) - bounds.left) / zoom;
      const right = (Math.max(...row.map(rect => rect.right)) - bounds.left) / zoom;
      const y = (first.bottom - bounds.top) / zoom + 3;
      const verses = [...new Set(selected.map(span => span.closest('[data-verse-id]')).filter(Boolean))];
      const anchors = verses.flatMap(verse => {
        const words = [...verse.querySelectorAll('[data-token-key]')].filter(word => word.textContent.trim());
        const whole = words.length > 0 && words.every(word => (word.dataset.annotationIds || '').split(' ').includes(String(annotation.id)));
        const badge = verse.closest('[data-scripture-verse]')?.querySelector('[data-verse-number]');
        if (!whole || !badge) return [];
        const badgeRect = badge.getBoundingClientRect();
        return [{ x: (badgeRect.left - bounds.left) / zoom - 4, y: (badgeRect.top - bounds.top + badgeRect.height / 2) / zoom,
          verse: verse.dataset.verseId, whole: true }];
      });
      // Fully selected verses get their own badge arrows. For partial verses,
      // retain a precise text anchor without adding a reading-text underline.
      for (const verse of verses) {
        if (anchors.some(anchor => anchor.verse === verse.dataset.verseId)) continue;
        const firstSelected = selected.find(span => span.closest('[data-verse-id]') === verse);
        const rect = firstSelected?.getClientRects()[0];
        if (rect) anchors.push({ x: (rect.left - bounds.left) / zoom, y: (rect.top - bounds.top + rect.height / 2) / zoom,
          verse: verse.dataset.verseId, whole: false });
      }
      if (!anchors.length) anchors.push({ x: left + Math.min(24, (right - left) / 2), y, verse: null, whole: false });
      anchors.sort((a, b) => a.y - b.y);
      const anchor = { x: anchors.reduce((sum, point) => sum + point.x, 0) / anchors.length,
        y: anchors.reduce((sum, point) => sum + point.y, 0) / anchors.length };
      return [{ id: annotation.id, annotation, anchor, anchors, height: cards.current.get(annotation.id)?.offsetHeight || 140,
        cardWidth: cards.current.get(annotation.id)?.offsetWidth || railBounds?.width / zoom || 172 }];
    }) : [];
    const stacked = stackGutterCards(items);
    const height = Math.max(reading.current.offsetHeight, ...stacked.map(item => item.top + item.height));
    const width = Math.max(0, bounds.width / zoom);
    const railRight = railBounds ? (railBounds.right - bounds.left) / zoom : 0;
    const next = { width, height, readingHeight: reading.current.offsetHeight, railRight,
      minX: Math.min(0, ((railBounds?.left || bounds.left) - bounds.left) / zoom), items: stacked };
    setLayout(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
  }, [annotations, enabled]);
  const placed = useMemo(() => {
    const items = layout.items.map(item => {
      const position = normalizeGutterPosition(positions[item.id] || item.annotation.gutter_position);
      const top = position.absolute ? position.y : item.top + position.y, right = layout.railRight + position.x, left = right - item.cardWidth;
      return { ...item, baseTop: item.top, top, x: position.x, left, right,
        start: { x: (left + right) / 2 > item.anchor.x ? left : right, y: top + item.height / 2 } };
    });
    return { ...layout, items, width: Math.max(layout.width, ...items.map(item => item.right + 10)),
      minX: Math.min(layout.minX || 0, ...items.map(item => item.left - 32)),
      height: Math.max(layout.readingHeight || 0, ...items.map(item => item.top + item.height)) };
  }, [layout, positions]);
  useLayoutEffect(() => {
    const schedule = () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(measure);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(reading.current);
    observer?.observe(host.current);
    cards.current.forEach(card => observer?.observe(card));
    const mutations = new MutationObserver(schedule);
    mutations.observe(reading.current, { childList: true, subtree: true, characterData: true });
    window.addEventListener('resize', schedule);
    const viewport = host.current.closest('[data-testid="scripture-workspace"]');
    viewport?.addEventListener('scripture-workspace-pan', schedule);
    return () => { observer?.disconnect(); mutations.disconnect(); window.removeEventListener('resize', schedule); viewport?.removeEventListener('scripture-workspace-pan', schedule); if (frame.current) cancelAnimationFrame(frame.current); };
  }, [measure, active, editingId, sizes]);
  useEffect(() => { onActiveChange?.(active); }, [active, onActiveChange]);
  useLayoutEffect(() => { host.current?.dispatchEvent(new Event('annotation-gutter-layout', { bubbles: true })); }, [layout, positions]);
  useEffect(() => registerPendingEditorSave(async () => { await pending.current; return false; }), []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const updatePosition = (id, position) => {
    positionsRef.current = { ...positionsRef.current, [id]: position };
    setPositions(positionsRef.current);
  };
  const commitPosition = (annotation, position) => {
    let previous;
    const operation = pending.current.catch(() => {}).then(async () => {
      previous = savedPositions.current[annotation.id] || normalizeGutterPosition(annotation.gutter_position);
      await onSavePosition?.(annotation, position);
      savedPositions.current[annotation.id] = position;
    });
    pending.current = operation;
    operation.catch(() => {
      if (mounted.current && positionsRef.current[annotation.id] === position) updatePosition(annotation.id, previous);
    });
  };
  const finishCardDrag = event => {
    const current = cardDrag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    cardDrag.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (event.type !== 'pointerup') updatePosition(current.item.id, current.previous);
    else commitPosition(current.item.annotation, positionsRef.current[current.item.id] || current.previous);
  };
  const moveProps = item => ({
    onPointerDown: event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      window.getSelection()?.removeAllRanges();
      const bounds = host.current.getBoundingClientRect();
      cardDrag.current = { item, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
        hostLeft: bounds.left, hostTop: bounds.top, zoom: Number(host.current.closest('[data-zoom]')?.dataset.zoom) || 1, top: item.top, previous: normalizeGutterPosition(positionsRef.current[item.id] || item.annotation.gutter_position) };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerMove: event => {
      const current = cardDrag.current;
      if (!current || current.pointerId !== event.pointerId || current.item.id !== item.id) return;
      event.preventDefault(); event.stopPropagation();
      const bounds = host.current.getBoundingClientRect();
      updatePosition(item.id, normalizeGutterPosition({
        x: current.previous.x + (event.clientX - current.clientX - (bounds.left - current.hostLeft)) / current.zoom,
        y: current.top + (event.clientY - current.clientY - (bounds.top - current.hostTop)) / current.zoom, absolute: true }));
    },
    onPointerUp: finishCardDrag, onPointerCancel: finishCardDrag, onLostPointerCapture: finishCardDrag,
    onDoubleClick: () => { const position = normalizeGutterPosition(null); updatePosition(item.id, position); commitPosition(item.annotation, position); },
    onKeyDown: event => {
      const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!delta) return;
      event.preventDefault(); event.stopPropagation();
      const current = normalizeGutterPosition(positionsRef.current[item.id] || item.annotation.gutter_position), step = event.shiftKey ? 24 : 8;
      const position = normalizeGutterPosition({ x: current.x + delta[0] * step, y: item.top + delta[1] * step, absolute: true });
      updatePosition(item.id, position); commitPosition(item.annotation, position);
    },
  });

  const updateSize = (id, size) => {
    sizesRef.current = { ...sizesRef.current, [id]: size };
    setSizes(sizesRef.current);
  };
  const commitSize = (annotation, size, position, previousSize, previousPosition) => {
    const operation = pending.current.catch(() => {}).then(async () => {
      await onSaveSize?.(annotation, size, position);
      savedSizes.current[annotation.id] = size;
      savedPositions.current[annotation.id] = position;
    });
    pending.current = operation;
    operation.catch(() => {
      if (mounted.current && sizesRef.current[annotation.id] === size) {
        updateSize(annotation.id, previousSize);
        updatePosition(annotation.id, previousPosition);
      }
    });
  };
  const finishResize = event => {
    const current = resizeDrag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    resizeDrag.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!current.moved) return;
    if (event.type !== 'pointerup') {
      updateSize(current.item.id, current.previousSize);
      updatePosition(current.item.id, current.previous);
    } else commitSize(current.item.annotation, sizesRef.current[current.item.id], positionsRef.current[current.item.id], current.previousSize, current.previous);
  };
  const resizeProps = (item, corner) => ({
    onPointerDown: event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation(); window.getSelection()?.removeAllRanges();
      const bounds = host.current.getBoundingClientRect();
      resizeDrag.current = { item, corner, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
        hostLeft: bounds.left, hostTop: bounds.top, zoom: Number(host.current.closest('[data-zoom]')?.dataset.zoom) || 1,
        width: item.cardWidth, height: item.height,
        previous: normalizeGutterPosition(positionsRef.current[item.id] || item.annotation.gutter_position),
        previousSize: sizesRef.current[item.id] === undefined ? normalizeGutterSize(item.annotation.gutter_size) : sizesRef.current[item.id] };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerMove: event => {
      const current = resizeDrag.current;
      if (!current || current.item.id !== item.id || current.pointerId !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      current.moved = true;
      const bounds = host.current.getBoundingClientRect();
      const dx = (event.clientX - current.clientX - (bounds.left - current.hostLeft)) / current.zoom;
      const dy = (event.clientY - current.clientY - (bounds.top - current.hostTop)) / current.zoom;
      const east = corner.includes('e'), south = corner.includes('s');
      const size = normalizeGutterSize({ width: current.width + (east ? dx : -dx), height: current.height + (south ? dy : -dy) });
      updateSize(item.id, size);
      updatePosition(item.id, { x: current.previous.x + (east ? size.width - current.width : 0),
        y: current.item.top + (south ? 0 : current.height - size.height), absolute: true });
    },
    onPointerUp: finishResize, onPointerCancel: finishResize, onLostPointerCapture: finishResize,
    onDoubleClick: () => {
      const position = normalizeGutterPosition(positionsRef.current[item.id] || item.annotation.gutter_position);
      const previousSize = sizesRef.current[item.id] === undefined ? normalizeGutterSize(item.annotation.gutter_size) : sizesRef.current[item.id];
      updateSize(item.id, null); commitSize(item.annotation, null, position, previousSize, position);
    },
  });

  const updateRoute = (id, route) => {
    routesRef.current = { ...routesRef.current, [id]: route };
    setRoutes(routesRef.current);
  };
  const commit = (annotation, route) => {
    const previous = normalizeGutterRoute(annotation.gutter_route);
    const operation = pending.current.catch(() => {}).then(() => onSaveRoute(annotation, route));
    pending.current = operation;
    operation.catch(() => {
      if (mounted.current && routesRef.current[annotation.id] === route) updateRoute(annotation.id, previous);
    });
  };
  const finish = event => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (event.type !== 'pointerup') updateRoute(current.annotation.id, current.previous);
    else commit(current.annotation, routesRef.current[current.annotation.id] || current.previous);
  };
  return <div ref={host} className={`bex-annotation-layout ${active ? 'bex-annotation-layout-active' : ''}`} data-testid="annotation-gutter-layout">
    <div ref={reading} className="bex-annotation-reading">{children}</div>
    {enabled && <aside className="bex-annotation-rail" aria-label="Scripture annotations" style={{ visibility: active ? 'visible' : 'hidden' }}>
      {placed.items.map(item => <GutterCard key={item.id} annotation={item.annotation} top={item.top} x={item.x} size={sizes[item.id] === undefined ? normalizeGutterSize(item.annotation.gutter_size) : sizes[item.id]} moveProps={moveProps(item)} resizeProps={corner => resizeProps(item, corner)}
        register={registerCard(item.id)}
        editor={item.id === editingId ? editor : null}
        versionLabel={versionLabel}
        onEdit={onEdit} onCopyLink={onCopyLink} onCopyContent={onCopyContent} hasDrawing={Boolean(annotationDrawings[item.id])} />)}
    </aside>}
    {active && <svg className="bex-annotation-cables" width={placed.width} height={placed.height} aria-hidden="true" overflow="visible">
      <defs><marker id={`annotation-arrow-${markerId}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#b197ef" /></marker></defs>
      {placed.items.map(item => {
        const cable = gutterConnector(item.start, item.anchor, routes[item.id] || item.annotation.gutter_route, placed.width, placed.height, placed.minX);
        return <g key={item.id}>
          {item.anchors.map((anchor, index) => {
            const branch = gutterConnector(item.start, anchor, routeFromMidpoint(cable.midpoint, item.start, anchor), placed.width, placed.height, placed.minX);
            return <path key={index} d={branch.path} fill="none" stroke="#b197ef" strokeWidth="2.3" strokeLinecap="round" markerEnd={`url(#annotation-arrow-${markerId})`}
              data-testid={index === 0 ? `annotation-cable-${item.id}` : `annotation-cable-${item.id}-${index}`}
              data-annotation-arrow={item.id} data-target-verse={anchor.verse} data-target-kind={anchor.whole ? 'verse' : 'text'} />;
          })}
        </g>;
      })}
    </svg>}
    {active && placed.items.map(item => {
      const cable = gutterConnector(item.start, item.anchor, routes[item.id] || item.annotation.gutter_route, placed.width, placed.height, placed.minX);
      return <button key={item.id} type="button" className="bex-annotation-route-dot"
        style={{ left: cable.midpoint.x, top: cable.midpoint.y }} data-testid={`annotation-route-${item.id}`}
        aria-label={`Adjust connector for ${item.annotation.book} ${item.annotation.chapter_number}:${item.annotation.start_verse}`}
        title="Drag to bend the connector. Arrow keys adjust it. Double-click to reset."
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault(); event.stopPropagation(); window.getSelection()?.removeAllRanges();
          const previous = normalizeGutterRoute(routesRef.current[item.id] || item.annotation.gutter_route);
          drag.current = { annotation: item.annotation, pointerId: event.pointerId, previous };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={event => {
          if (drag.current?.pointerId !== event.pointerId || drag.current.annotation.id !== item.id) return;
          const bounds = host.current.getBoundingClientRect();
          const zoom = Number(host.current.closest('[data-zoom]')?.dataset.zoom) || 1;
          const point = { x: (event.clientX - bounds.left) / zoom, y: (event.clientY - bounds.top) / zoom };
          updateRoute(item.id, routeFromMidpoint(point, item.start, item.anchor));
        }}
        onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
        onDoubleClick={() => { const route = normalizeGutterRoute(null); updateRoute(item.id, route); commit(item.annotation, route); }}
        onKeyDown={event => {
          const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
          if (!delta) return;
          event.preventDefault(); event.stopPropagation();
          const step = event.shiftKey ? 24 : 8;
          const route = routeFromMidpoint({ x: cable.midpoint.x + delta[0] * step, y: cable.midpoint.y + delta[1] * step }, item.start, item.anchor);
          updateRoute(item.id, route); commit(item.annotation, route);
        }}><span /></button>;
    })}
  </div>;
}
