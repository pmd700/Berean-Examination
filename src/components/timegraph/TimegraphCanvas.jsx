import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  axisTicks,
  createViewport,
  cursorReadout,
  focusedAxisTicks,
  panByPixels,
  visibleRange,
  xToYear,
  yearToX,
  zoomAt,
  zoomFactorFromWheel,
} from '@/lib/timegraph/timegraphScale';
import {
  cardTagFontSize,
  cardTagText,
  layoutEvents,
  placementAt,
  requiredHeight,
} from '@/lib/timegraph/timegraphLayout';
import { formatDateRange } from '@/lib/timegraph/timegraphDate';
import { resolveColor } from '@/lib/timegraph/timegraphModel';
import { APP_FONT_FAMILY } from '@/styles/typography';
import { getTextSizeScale, useTextSizePreference } from '@/components/scripture/TextSizeControl';

/**
 * The Timegraph surface.
 *
 * SVG rather than a raster canvas for three reasons: the SVG export is then the
 * very same markup rather than a second renderer that can drift, text stays crisp
 * at any zoom, and cards can be real focusable elements so the graph is reachable
 * from the keyboard.
 *
 * `interactive={false}` renders the identical picture with no handlers, which is
 * what an embed uses in preview mode and what the exporter serializes.
 */

const DRAG_THRESHOLD_PX = 4;

/** Real text metrics, so what the layout packs is what actually gets painted. */
function createMeasurer(font) {
  if (typeof document === 'undefined') return null;
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return null;
  context.font = font;
  const cache = new Map();
  return (text) => {
    const key = String(text ?? '');
    if (!cache.has(key)) cache.set(key, context.measureText(key || 'Untitled').width);
    return cache.get(key);
  };
}

const CARD_PADDING_X = 13;
const MIN_CARD_WIDTH = 54;
const MAX_CARD_WIDTH = 320;
const CARD_SETTLE_TRANSITION = Object.freeze({
  type: 'spring', stiffness: 520, damping: 38, mass: 0.55,
});
const CARD_VISIBILITY_TRANSITION = Object.freeze({
  duration: 0.17, ease: [0.2, 0.8, 0.2, 1],
});
const AXIS_DETAIL_FADE_TRANSITION = Object.freeze({
  duration: 0.65, ease: [0.22, 1, 0.36, 1],
});

export default function TimegraphCanvas({
  timegraph,
  viewport,
  onViewportChange,
  selectedIds = [],
  onSelect,
  onMoveEvent,
  onOpenEvent,
  interactive = true,
  referenceYear = new Date().getFullYear(),
  className = '',
  showCursorGuide = true,
  onHeightNeeded,
}) {
  const [textSize] = useTextSizePreference();
  const textScale = getTextSizeScale(textSize);
  const hostRef = React.useRef(null);
  const [hover, setHover] = React.useState(null);
  const [hoverId, setHoverId] = React.useState(null);
  const [detailFocusX, setDetailFocusX] = React.useState(null);
  const detailFocusActiveRef = React.useRef(false);
  const gestureRef = React.useRef(null);
  const reducedMotion = useReducedMotion();

  const measureText = React.useMemo(
    () => createMeasurer(`600 ${12.5 * textScale}px ${APP_FONT_FAMILY}`),
    [textScale],
  );
  const measureWidth = React.useCallback((title, event = {}) => {
    const text = String(title || 'Untitled').trim() || 'Untitled';
    const scale = event.scale || 1;
    const titleWidth = (
      measureText ? measureText(text) : text.length * 7.1 * textScale
    ) * scale;
    const tagText = cardTagText(event.tags);
    const tagWidth = tagText
      ? (measureText ? measureText(tagText) : tagText.length * 7.1 * textScale)
        * (cardTagFontSize(scale) / 12.5)
      : 0;
    return Math.min(
      MAX_CARD_WIDTH * scale * textScale,
      Math.max(
        MIN_CARD_WIDTH * scale * textScale,
        Math.max(titleWidth, tagWidth) + CARD_PADDING_X * 2 * scale * textScale,
      ),
    );
  }, [measureText, textScale]);

  const events = timegraph?.events || [];
  const layout = React.useMemo(
    () => layoutEvents(events, viewport, { measureWidth, textScale }),
    [events, viewport, measureWidth, textScale],
  );
  const ticks = React.useMemo(() => axisTicks(viewport), [viewport]);
  const detailTicks = React.useMemo(
    () => detailFocusX == null ? [] : focusedAxisTicks(viewport, detailFocusX),
    [viewport, detailFocusX],
  );
  const selected = React.useMemo(() => new Set(selectedIds), [selectedIds]);

  // Tell the host how tall the deepest stack needs the surface to be. Reported
  // rather than self-applied so the host stays the single owner of layout, and
  // reported from an effect so it never sets state during render.
  const neededHeight = layout.neededHeight;
  React.useEffect(() => {
    onHeightNeeded?.(neededHeight);
  }, [neededHeight, onHeightNeeded]);

  // ── Pointer gestures ──────────────────────────────────────────────────────
  // One pointerdown decides between three intents: press a card (select, then
  // possibly drag it along the axis) or press the background (pan). The choice is
  // made from what is under the pointer, and dragging only begins past a small
  // threshold so an ordinary click is never swallowed.

  const localPoint = (event) => {
    const rect = hostRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const handlePointerDown = (event) => {
    if (!interactive || event.button !== 0) return;
    const point = localPoint(event);
    const hit = placementAt(layout.placements, point.x, point.y);

    hostRef.current?.setPointerCapture?.(event.pointerId);
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startViewport: viewport,
      placement: hit,
      grabOffsetYears: hit ? xToYear(viewport, point.x) - hit.span.start : 0,
      moved: false,
    };

    if (hit) onSelect?.(hit.id, { additive: event.shiftKey || event.metaKey });
    else if (!event.shiftKey) onSelect?.(null);
  };

  const handlePointerMove = (event) => {
    const point = localPoint(event);
    if (showCursorGuide) {
      setHover({ x: point.x, y: point.y, year: xToYear(viewport, point.x) });
    }
    if (detailFocusActiveRef.current) setDetailFocusX(point.x);

    const gesture = gestureRef.current;
    if (!gesture) {
      const hit = placementAt(layout.placements, point.x, point.y);
      setHoverId(hit?.id ?? null);
      return;
    }

    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (!gesture.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    gesture.moved = true;
    event.preventDefault();

    if (gesture.placement) {
      // Dragging a card retimes the event; the year under the grab point is kept
      // under the pointer so the card doesn't jump to the cursor on first move.
      const targetYear = xToYear(viewport, point.x) - gesture.grabOffsetYears;
      onMoveEvent?.(gesture.placement.id, targetYear, { committed: false });
      return;
    }
    onViewportChange?.(panByPixels(gesture.startViewport, dx));
  };

  const endGesture = (event) => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture) return;
    try { hostRef.current?.releasePointerCapture?.(gesture.pointerId); } catch { /* gone */ }
    if (gesture.placement && gesture.moved) {
      const point = localPoint(event);
      const targetYear = xToYear(viewport, point.x) - gesture.grabOffsetYears;
      // One committed move at the end is what lands on the undo stack, so a drag
      // is a single undo step rather than one per frame.
      onMoveEvent?.(gesture.placement.id, targetYear, { committed: true });
    }
  };

  // Wheel zoom has to be a native non-passive listener: React's onWheel is
  // registered passively, so preventDefault there is ignored and the page scrolls
  // behind the graph instead of zooming it.
  React.useEffect(() => {
    const host = hostRef.current;
    if (!host || !interactive) return undefined;
    const onWheel = (event) => {
      event.preventDefault();
      const rect = host.getBoundingClientRect();
      const anchorX = event.clientX - rect.left;
      if (event.shiftKey) {
        onViewportChange?.(panByPixels(viewport, -event.deltaY));
        return;
      }
      const factor = zoomFactorFromWheel(event.deltaY, { pinch: event.ctrlKey });
      // Local semantic detail begins only after an intentional zoom-in. Once it
      // is active it follows the pointer, so moving across the axis moves the
      // detail lens without changing the dates beneath it.
      if (factor < 1) {
        detailFocusActiveRef.current = true;
        setDetailFocusX(anchorX);
      }
      onViewportChange?.(zoomAt(viewport, anchorX, factor));
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, [viewport, interactive, onViewportChange]);

  const axisY = layout.axisY;
  const readout = hover ? cursorReadout(hover.year, referenceYear) : null;
  const range = visibleRange(viewport);

  return (
    <div
      ref={hostRef}
      className={`bex-timegraph ${interactive ? 'is-interactive' : ''} ${className}`}
      style={{ width: '100%', height: viewport.height, position: 'relative', touchAction: 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={interactive ? handlePointerMove : undefined}
      onPointerUp={interactive ? endGesture : undefined}
      onPointerCancel={interactive ? endGesture : undefined}
      onPointerLeave={() => {
        setHover(null);
        setHoverId(null);
        setDetailFocusX(null);
        detailFocusActiveRef.current = false;
      }}
      data-testid="timegraph-canvas"
    >
      {/* Cursor readout, pinned above the graph like the reference UI. */}
      {readout && (
        <div className="bex-timegraph__readout" data-testid="timegraph-readout">
          <span className={readout.isPast ? 'is-past' : 'is-future'}>{readout.relative}</span>
          <span className="bex-timegraph__readout-dot" />
          <span className="bex-timegraph__readout-year">{readout.label}</span>
        </div>
      )}

      <svg
        width="100%"
        height={viewport.height}
        viewBox={`0 0 ${viewport.width} ${viewport.height}`}
        preserveAspectRatio="none"
        role="group"
        aria-label={`Timegraph ${timegraph?.title || ''}, showing years ${Math.round(range.from)} to ${Math.round(range.to)}`}
        style={{ fontFamily: APP_FONT_FAMILY }}
      >
        {/* Faint vertical gridlines on major ticks. */}
        {ticks.filter((tick) => tick.isMajor).map((tick) => (
          <line
            key={`grid-${tick.year}`}
            x1={tick.x} x2={tick.x} y1={0} y2={viewport.height}
            className="bex-timegraph__grid"
          />
        ))}

        {/* The cursor guide: a crosshair at the pointer with a dashed line
            dropping to the axis, so you can see exactly which year you are over
            before you click. The crosshair itself is the native `crosshair`
            cursor (see CSS) — drawing it in React would trail the pointer by a
            frame — and this is the mark plus leader line that goes with it. */}
        {hover && showCursorGuide && (
          <g className="bex-timegraph__cursor" pointerEvents="none">
            <line
              x1={hover.x} x2={hover.x}
              y1={Math.min(hover.y, axisY)} y2={Math.max(hover.y, axisY)}
            />
            <path
              d={`M ${hover.x - 5} ${hover.y} H ${hover.x + 5} M ${hover.x} ${hover.y - 5} V ${hover.y + 5}`}
              className="bex-timegraph__cursor-cross"
            />
          </g>
        )}

        {/* Axis */}
        <line
          x1={0} x2={viewport.width} y1={axisY} y2={axisY}
          className="bex-timegraph__axis"
        />
        {/* A local semantic-zoom layer. These marks use the exact same linear
            year-to-x mapping as the main axis; they merely reveal the next
            subdivision sooner near the zoom cursor. */}
        <AnimatePresence initial={false}>
          {detailTicks.map((tick) => {
            const visibleOpacity = 0.38 + tick.focusWeight * 0.62;
            return (
              <motion.g
                key={`focus-tick-${tick.year}`}
                className="bex-timegraph__focus-detail"
                initial={{ opacity: reducedMotion ? visibleOpacity : 0 }}
                animate={{ opacity: visibleOpacity }}
                exit={{ opacity: 0 }}
                transition={reducedMotion ? { duration: 0 } : AXIS_DETAIL_FADE_TRANSITION}
                pointerEvents="none"
              >
                <circle
                  cx={tick.x} cy={axisY} r={2.15}
                  className="bex-timegraph__focus-tick"
                />
                <text
                  x={tick.x} y={axisY - 10}
                  textAnchor="middle"
                  className={`bex-timegraph__focus-tick-label ${tick.unit === 'hour' || tick.unit === 'minute' ? 'is-clock-detail' : ''}`}
                >
                  {tick.label}
                </text>
              </motion.g>
            );
          })}
        </AnimatePresence>
        <AnimatePresence initial={false}>
          {ticks.map((tick) => (
            <motion.g
              key={`tick-${tick.year}`}
              className={tick.isZero ? 'is-zero' : ''}
              initial={{ opacity: reducedMotion ? 1 : 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={reducedMotion ? { duration: 0 } : AXIS_DETAIL_FADE_TRANSITION}
            >
              <circle
                cx={tick.x} cy={axisY} r={tick.isZero ? 5 : 3.5}
                className={`bex-timegraph__tick ${tick.isZero ? 'is-zero' : ''}`}
              />
              <text
                x={tick.x} y={axisY + 22}
                textAnchor="middle"
                className={`bex-timegraph__tick-label ${tick.isMajor ? 'is-major' : ''} ${tick.isZero ? 'is-zero' : ''}`}
              >
                {tick.label}
              </text>
            </motion.g>
          ))}
        </AnimatePresence>

        {/* Events leave quickly, then neighbouring cards spring into the open
            lane. This makes tag filtering read like physical blocks settling
            instead of a collection abruptly blinking in and out. */}
        <AnimatePresence initial={false}>
          {layout.placements.map((placement) => (
            <AnimatedTimegraphEvent
              key={placement.id}
              placement={placement}
              axisY={axisY}
              interactive={interactive}
              isSelected={selected.has(placement.id)}
              isHovered={hoverId === placement.id}
              reducedMotion={Boolean(reducedMotion)}
              onSelect={onSelect}
              onOpenEvent={onOpenEvent}
              textScale={textScale}
            />
          ))}
        </AnimatePresence>
      </svg>

      {events.length === 0 && (
        <div className="bex-timegraph__empty" data-testid="timegraph-empty">
          No events yet — add one to begin.
        </div>
      )}
    </div>
  );
}

function AnimatedTimegraphEvent({
  placement,
  axisY,
  interactive,
  isSelected,
  isHovered,
  reducedMotion,
  onSelect,
  onOpenEvent,
  textScale,
}) {
  const { event } = placement;
  const color = resolveColor(event.color);
  const scale = event.scale || 1;
  const height = placement.cardHeight;
  const cardY = placement.cardTop;
  const tagBandHeight = placement.tagBandHeight || 0;
  const tagText = cardTagText(event.tags);
  const titleAreaHeight = height - tagBandHeight;
  const scaledPaddingX = CARD_PADDING_X * scale * textScale;
  const textX = event.align === 'left'
    ? placement.left + scaledPaddingX
    : event.align === 'right'
      ? placement.left + placement.width - scaledPaddingX
      : placement.left + placement.width / 2;
  const textAnchor = event.align === 'left'
    ? 'start' : event.align === 'right' ? 'end' : 'middle';
  const towardAxis = placement.position === 'above' ? 10 : -10;
  const awayFromAxis = -towardAxis;
  const settleTransition = reducedMotion ? { duration: 0 } : CARD_SETTLE_TRANSITION;
  const visibilityTransition = reducedMotion ? { duration: 0 } : CARD_VISIBILITY_TRANSITION;

  return (
    <motion.g
      className={`bex-timegraph__event ${isSelected ? 'is-selected' : ''} ${isHovered ? 'is-hovered' : ''}`}
      data-event-id={placement.id}
      tabIndex={interactive ? 0 : -1}
      role={interactive ? 'button' : undefined}
      aria-label={`${event.title}, ${formatDateRange(event.start, event.end)}${tagText ? `, tagged ${event.tags.join(', ')}` : ''}`}
      initial={reducedMotion ? false : { opacity: 0, scale: 0.84, y: towardAxis }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.72, y: awayFromAxis }}
      transition={visibilityTransition}
      style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
      onKeyDown={interactive ? (keyEvent) => {
        if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
          keyEvent.preventDefault();
          onSelect?.(placement.id, { additive: false });
          onOpenEvent?.(placement.id);
        }
      } : undefined}
      onFocus={interactive ? () => onSelect?.(placement.id, { additive: false }) : undefined}
      onDoubleClick={interactive ? () => onOpenEvent?.(placement.id) : undefined}
    >
      {placement.isRange && (
        <rect
          x={placement.startX}
          y={axisY - 4}
          width={Math.max(2, placement.endX - placement.startX)}
          height={8}
          rx={4}
          fill={color.fill}
          opacity={0.55}
        />
      )}

      <motion.line
        x1={placement.anchorX}
        x2={placement.anchorX}
        initial={false}
        animate={{ y1: placement.position === 'above' ? cardY + height : cardY }}
        transition={settleTransition}
        y2={axisY}
        stroke={color.fill}
        strokeWidth={1.5}
        strokeDasharray="3 3"
        opacity={0.75}
      />

      <EventMarker
        style={event.marker}
        x={placement.anchorX}
        y={axisY}
        fill={color.fill}
      />

      <motion.g
        initial={false}
        animate={{ y: cardY }}
        transition={settleTransition}
      >
        <rect
          x={placement.left}
          y={0}
          width={placement.width}
          height={height}
          rx={7}
          fill={color.fill}
          className="bex-timegraph__card"
        />
        <path
          d={placement.position === 'above'
            ? `M ${placement.anchorX - 6} ${height} L ${placement.anchorX} ${height + 6} L ${placement.anchorX + 6} ${height} Z`
            : `M ${placement.anchorX - 6} 0 L ${placement.anchorX} -6 L ${placement.anchorX + 6} 0 Z`}
          fill={color.fill}
        />
        <text
          x={textX}
          y={titleAreaHeight / 2 + 4.5 * scale * textScale}
          textAnchor={textAnchor}
          fill={color.ink}
          className="bex-timegraph__card-label"
          style={{ fontSize: `${12.5 * scale * textScale}px` }}
        >
          {event.title}
        </text>
        {tagText && (
          <text
            x={placement.left + Math.max(7, 8 * scale)}
            y={height - Math.max(6, tagBandHeight * 0.6)}
            textAnchor="start"
            fill={color.ink}
            className="bex-timegraph__card-tags"
            style={{ fontSize: `${cardTagFontSize(scale) * textScale}px` }}
          >
            {tagText}
          </text>
        )}
      </motion.g>
    </motion.g>
  );
}

/** The shapes offered by the event panel's marker row. */
function EventMarker({ style, x, y, fill }) {
  if (style === 'none') return null;
  if (style === 'ring') {
    return <circle cx={x} cy={y} r={5} fill="none" stroke={fill} strokeWidth={2.5} />;
  }
  if (style === 'diamond') {
    return <path d={`M ${x} ${y - 6} L ${x + 6} ${y} L ${x} ${y + 6} L ${x - 6} ${y} Z`} fill={fill} />;
  }
  if (style === 'square') {
    return <rect x={x - 4.5} y={y - 4.5} width={9} height={9} rx={1.5} fill={fill} />;
  }
  if (style === 'pin') {
    return (
      <path
        d={`M ${x} ${y + 7} C ${x - 6} ${y - 1} ${x - 5} ${y - 8} ${x} ${y - 8} C ${x + 5} ${y - 8} ${x + 6} ${y - 1} ${x} ${y + 7} Z`}
        fill={fill}
      />
    );
  }
  return <circle cx={x} cy={y} r={5} fill={fill} />;
}

export { createMeasurer, requiredHeight, createViewport, yearToX };
