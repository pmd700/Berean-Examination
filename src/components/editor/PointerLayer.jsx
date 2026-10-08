import React from 'react';
import { createPortal } from 'react-dom';
import { ArrowDownRight, ArrowUpLeft, Check, Trash2, X } from 'lucide-react';
import { getPointerState } from './PointerExtension';
import { collectPointers, pointerGutterSide, pointerPath } from './pointerModel';
import { startEditorRangeSpotlight } from './spotlightJourney';
import './pointers.css';

/** Attach dropdown endpoints to the disclosure triangle, not below its title. */
function disclosureRect(section) {
  const caret = section.querySelector(':scope > .toggle-block__chevron svg path');
  if (caret) return { ...rectValues(caret.getBoundingClientRect()), caret: true, section };
  const summary = section.querySelector('summary') || section;
  return { ...rectValues(summary.getBoundingClientRect()), section };
}

/** Hidden anchors point at their outermost collapsed disclosure until followed. */
export function pointerEndpointRect(editor, endpoint) {
  const first = endpoint.ranges[0];
  if (!first) return null;
  try {
    const $pos = editor.state.doc.resolve(first.from);
    for (let depth = 1; depth < $pos.depth; depth += 1) {
      if ($pos.node(depth).type.name !== 'details' || $pos.node(depth + 1).type.name !== 'detailsContent') continue;
      const section = editor.view.nodeDOM($pos.before(depth));
      if (section && !section.classList.contains('is-open')) {
        return { ...disclosureRect(section), hidden: true };
      }
    }
    // A pointer attached to the title itself uses that same disclosure anchor.
    for (let depth = 1; depth < $pos.depth; depth += 1) {
      if ($pos.node(depth).type.name === 'details'
        && $pos.node(depth + 1).type.name === 'detailsSummary') {
        const section = editor.view.nodeDOM($pos.before(depth));
        if (section) return disclosureRect(section);
      }
    }
    const from = editor.view.domAtPos(first.from);
    const to = editor.view.domAtPos(first.to);
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    const rect = [...range.getClientRects()].find(box => box.width > 0 && box.height > 0);
    return rect ? rectValues(rect) : null;
  } catch { return null; }
}
const rectValues = rect => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });

/** Convert viewport measurements into the SVG's own scrolling coordinate system. */
function localRect(svg, surface, rect) {
  const inverse = svg?.getScreenCTM?.()?.inverse();
  if (inverse) {
    const point = (x, y) => ({
      x: inverse.a * x + inverse.c * y + inverse.e,
      y: inverse.b * x + inverse.d * y + inverse.f,
    });
    const start = point(rect.left, rect.top);
    const end = point(rect.right, rect.bottom);
    return { ...rect, left: start.x, right: end.x, top: start.y, bottom: end.y };
  }
  // Layout-free test environments do not implement SVG matrices.
  const box = surface.getBoundingClientRect();
  const scale = box.width / (surface.offsetWidth || box.width) || 1;
  return { ...rect, left: (rect.left - box.left) / scale, right: (rect.right - box.left) / scale,
    top: (rect.top - box.top) / scale, bottom: (rect.bottom - box.top) / scale };
}

export default function PointerLayer({ editor }) {
  const [layout, setLayout] = React.useState({ lines: [], visible: false });
  const [, refresh] = React.useReducer(value => value + 1, 0);
  const trip = React.useRef(null);
  const svgRef = React.useRef(null);
  const uid = React.useId().replace(/:/g, '');

  React.useEffect(() => {
    const surface = svgRef.current?.parentElement;
    if (!editor || !surface) return undefined;
    // This sibling of ProseMirror shares its scroll/zoom ancestors. Browser
    // compositing moves both together, even before any JS scroll event runs.
    let frame;
    const measure = () => {
      frame = null;
      if (editor.isDestroyed) return;
      refresh();
      const dom = editor.view.dom;
      const box = dom.getBoundingClientRect();
      if (!box.width) {
        setLayout({ lines: [], visible: false });
        return;
      }
      const localBox = localRect(svgRef.current, surface, box);
      const style = getComputedStyle(dom);
      const textBounds = {
        left: localBox.left + (parseFloat(style.paddingLeft) || 0),
        right: localBox.right - (parseFloat(style.paddingRight) || 0),
      };
      const lanes = { left: [], right: [] };
      const lines = [];
      for (const pointer of getPointerState(editor.state).pointers) {
        const sourceBox = pointerEndpointRect(editor, pointer.source);
        const targetBox = pointerEndpointRect(editor, pointer.target);
        if (!sourceBox || !targetBox || (sourceBox.hidden && targetBox.hidden && sourceBox.section === targetBox.section)) continue;
        const source = localRect(svgRef.current, surface, sourceBox);
        const target = localRect(svgRef.current, surface, targetBox);
        const top = Math.min(source.top, target.top);
        const bottom = Math.max(source.bottom, target.bottom);
        // Keep offscreen paths mounted; native scrolling clips them. Culling
        // here would require scroll-driven redraws and would reshuffle lanes.
        const side = pointerGutterSide(source, target, textBounds);
        const gutter = side === 'right' ? textBounds.right + 56 : textBounds.left - 56;
        const laneEnds = lanes[side];
        let lane = laneEnds.findIndex(end => end < top - 10);
        if (lane < 0) lane = laneEnds.length;
        laneEnds[lane] = bottom;
        const path = pointerPath(source, target, { gutter, side, lane, forceGutter: source.hidden || target.hidden || source.caret || target.caret });
        lines.push({ ...pointer, ...path });
      }
      setLayout({ lines, visible: true });
    };
    const schedule = () => { if (frame == null) frame = requestAnimationFrame(measure); };
    editor.on('transaction', schedule);
    window.addEventListener('resize', schedule);
    editor.view.dom.addEventListener('load', schedule, true);
    editor.view.dom.addEventListener('transitionend', schedule);
    // Collapse completion can reposition later carets without changing the
    // editor's overall height (e.g. a short note with a minimum height).
    const visibilityObserver = new MutationObserver(schedule);
    visibilityObserver.observe(editor.view.dom, { attributes: true, subtree: true, attributeFilter: ['hidden'] });
    document.fonts?.addEventListener('loadingdone', schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(editor.view.dom);
    observer.observe(editor.view.dom.parentElement);
    schedule();
    return () => {
      if (frame != null) cancelAnimationFrame(frame);
      editor.off('transaction', schedule);
      window.removeEventListener('resize', schedule);
      editor.view.dom.removeEventListener('load', schedule, true);
      editor.view.dom.removeEventListener('transitionend', schedule);
      visibilityObserver.disconnect();
      document.fonts?.removeEventListener('loadingdone', schedule);
      observer.disconnect();
      trip.current?.cancel();
    };
  }, [editor]);

  React.useEffect(() => {
    const onEscape = event => {
      if (event.key !== 'Escape' || !editor || editor.isDestroyed) return;
      const state = getPointerState(editor.state);
      if (!state.pending.find().length && !state.activeId && !state.notice) return;
      editor.commands.cancelPointer();
      trip.current?.cancel();
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [editor]);

  if (!editor || editor.isDestroyed) return null;
  const state = getPointerState(editor.state);
  const pending = state.pending.find().length > 0;
  const active = state.pointers.find(pointer => pointer.id === state.activeId);
  const follow = (id, role = 'target') => {
    trip.current?.cancel();
    editor.commands.selectPointer(id);
    trip.current = startEditorRangeSpotlight(editor, doc => {
      const endpoint = collectPointers(doc).find(pointer => pointer.id === id)?.[role];
      if (!endpoint?.ranges.length) return null;
      // Measure the first line for arrival; highlight the whole chosen passage.
      return { ...endpoint.ranges[0], ranges: endpoint.ranges };
    });
    trip.current.finished.catch(error => console.error('Pointer navigation failed:', error));
  };
  return <>
    <svg ref={svgRef} className="bex-pointer-lines" aria-label="Note pointers">
      <defs>
        <marker id={`${uid}-arrow`} markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M1 1 L5.5 3.5 L1 6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </marker>
      </defs>
      <g>
        {layout.lines.map(line => <g key={line.id} className={`bex-pointer-line ${active?.id === line.id ? 'is-active' : ''}`} data-pointer-kind={line.kind} data-pointer-side={line.side} data-pointer-line-id={line.id}>
          <path d={line.d} className="bex-pointer-line-ink" markerEnd={`url(#${uid}-arrow)`} />
          <circle cx={line.start.x} cy={line.start.y} r="2.5" className="bex-pointer-origin" />
          <path d={line.d} className="bex-pointer-line-hit" role="button" tabIndex="0"
            aria-label={`Follow pointer from ${line.source.text.slice(0, 70)} to ${line.target.text.slice(0, 70)}`}
            onPointerDown={event => { event.preventDefault(); event.stopPropagation(); }}
            onClick={event => {
              event.currentTarget.focus({ preventScroll: true });
              follow(line.id);
            }}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); follow(line.id); }
              if (event.key === 'Backspace' && !event.nativeEvent.isComposing
                && !event.metaKey && !event.ctrlKey && !event.altKey && editor.isEditable) {
                event.preventDefault();
                event.stopPropagation();
                if (event.repeat) return;
                trip.current?.cancel();
                editor.commands.removePointer(line.id);
              }
            }}>
            <title>{`${line.source.text.slice(0, 80)} → ${line.target.text.slice(0, 80)}`}</title>
          </path>
        </g>)}
      </g>
    </svg>
    {layout.visible && (pending || state.notice || active) && createPortal(<div className="bex-pointer-status" data-testid="pointer-status">
      <span role="status" aria-live="polite" className="bex-pointer-status-text">
        {pending ? <><strong>Pointer mode enabled</strong><span>{state.notice || 'Select target text or a block on this page, then press ⌘P.'}</span></>
          : state.notice || <><strong>Pointer connected</strong><span>{active.source.text.slice(0, 45)} → {active.target.text.slice(0, 45)}</span></>}
      </span>
      {!pending && active && <>
        <button type="button" className="bex-pointer-echo" aria-label="Echo Copy" aria-pressed={Boolean(active.echoCopy)}
          title="Echo Copy: replace this placeholder with its linked passage when copying"
          onClick={() => editor.commands.togglePointerEcho(active.id)}><Check size={17} /></button>
        <button type="button" title="Go to source" aria-label="Go to pointer source" onClick={() => follow(active.id, 'source')}><ArrowUpLeft size={17} /></button>
        <button type="button" title="Go to target" aria-label="Go to pointer target" onClick={() => follow(active.id)}><ArrowDownRight size={17} /></button>
        <button type="button" title="Remove pointer" aria-label="Remove pointer" onClick={() => { trip.current?.cancel(); editor.commands.removePointer(active.id); }}><Trash2 size={16} /></button>
      </>}
      <button type="button" title={pending ? 'Cancel pointer (Esc)' : 'Close (Esc)'} aria-label={pending ? 'Cancel pointer' : 'Close pointer controls'}
        onClick={() => { trip.current?.cancel(); editor.commands.cancelPointer(); }}><X size={17} /></button>
    </div>, document.body)}
  </>;
}
