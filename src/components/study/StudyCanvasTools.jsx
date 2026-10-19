import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { desktopClient } from '@/api/desktopClient';
import { useIsActiveTab } from '@/lib/WorkspaceTabs';
import { usePersistentPreference } from '@/lib/usePersistentPreference';
import { listAllEntityRecords } from '@/lib/allLocalEntityRecords';
import { studyConnectionPath, studyEndpointFromElement, studyEndpointKey } from '@/lib/studyCanvas';
import { webDeepLink, timegraphDeepLink } from '@/utils';
import FloatingToolbar, { KW_TOOLS, KW_DEFAULT_KEYS } from '@/components/knowledgeweb/FloatingToolbar';
import FloatingZoomControls from '@/components/knowledgeweb/FloatingZoomControls';
import KeybindRemapModal from '@/components/knowledgeweb/KeybindRemapModal';
import CanvasDrawing, { pointsToSmoothPath } from '@/components/knowledgeweb/CanvasDrawing';
import CanvasSection from '@/components/knowledgeweb/CanvasSection';
import CanvasImage from '@/components/knowledgeweb/CanvasImage';
import CanvasPoint from '@/components/knowledgeweb/CanvasPoint';
import CanvasTimegraph from '@/components/knowledgeweb/CanvasTimegraph';
import CanvasWebLink from '@/components/knowledgeweb/CanvasWebLink';
import WebLinkPicker from '@/components/knowledgeweb/WebLinkPicker';
import TimegraphPicker from '@/components/timegraph/TimegraphPicker';
import { useScriptureCanvas } from './scriptureCanvasContext';
import useStudyCanvasRecords from './useStudyCanvasRecords';
import StudyCanvasCard from './StudyCanvasCard';
import './studyCanvasTools.css';

const INPUTS = 'input, textarea, select, [contenteditable="true"], [role="textbox"]';
const HELP = { card: 'Click empty canvas to place an editable card.', connection: 'Click a verse, commentary card or canvas item, then click the item to connect it to. Connections are saved even when verses leave the view.', draw: 'Drag on empty canvas to draw.', section: 'Drag a rectangle on empty canvas to create a section.', image: 'Click empty canvas, then choose an image.', timegraph: 'Click empty canvas to place a live timeline.', point: 'Click empty canvas to place a routing point.', erase: 'Click a canvas item or connection to erase it. Scripture stays intact.', web_link: 'Click empty canvas to link a knowledge web.' };

export default function StudyCanvasTools() {
  const canvas = useScriptureCanvas();
  const { viewport, surface, camera, pan, zoomAt } = canvas;
  const records = useStudyCanvasRecords();
  const { run, preview } = records;
  const [mode, setMode] = useState('hand'), [zoom, setZoom] = useState(1), [portal, setPortal] = useState(null);
  const [source, setSource] = useState(null), [selected, setSelected] = useState(null), [selectedLink, setSelectedLink] = useState(null);
  const [anchors, setAnchors] = useState({}), [draftStroke, setDraftStroke] = useState(null), [sectionBox, setSectionBox] = useState(null);
  const [viewSize, setViewSize] = useState({ width: 1, height: 1 });
  const [picker, setPicker] = useState(null), [webs, setWebs] = useState([]), [remap, setRemap] = useState(false);
  const [color, setColor] = useState('#C9A94E'), [thickness, setThickness] = useState(3), [style, setStyle] = useState('curvy');
  const [binds, setBinds] = usePersistentPreference('study_canvas_keybinds', KW_DEFAULT_KEYS);
  const isActive = useIsActiveTab(), navigate = useNavigate();
  const file = useRef(null), imagePoint = useRef(null), cleanupGesture = useRef(null), frame = useRef(null), latest = useRef(null);
  latest.current = { mode, source, color, thickness, style, isActive, ready: records.ready, objects: records.objects, connections: records.connections };
  const safe = useCallback(promise => promise.catch(error => { toast.error(error.message || 'Could not save the study canvas.'); }), []);
  const update = useCallback((id, patch) => run('objects', 'update', id, patch), [run]);
  const remove = useCallback(id => safe(run('objects', 'delete', id)), [run, safe]);
  const worldPoint = useCallback(event => {
    const box = viewport.current.getBoundingClientRect(), current = camera.current;
    return { x: (event.clientX - box.left + current.x) / current.zoom, y: (event.clientY - box.top + current.y) / current.zoom };
  }, [viewport, camera]);
  const create = useCallback(async (object_type, point, data = {}) => {
    const result = await run('objects', 'create', null, { object_type, x: point.x, y: point.y, ...data });
    setSelected(result.id); return result;
  }, [run]);
  const hasWebLinks = records.objects.some(item => item.object_type === 'web_link');
  useEffect(() => {
    if (hasWebLinks) safe(listAllEntityRecords(desktopClient.entities.KnowledgeWeb).then(items => setWebs(items.map(web => web.is_private ? { ...web, title: 'Private knowledge web' } : web))));
  }, [hasWebLinks, safe]);
  useEffect(() => { setPortal(viewport.current?.parentElement || null); }, [viewport]);
  const measure = useCallback(() => {
    if (!surface.current) return;
    const currentZoom = camera.current.zoom, origin = surface.current.getBoundingClientRect(), next = {};
    surface.current.querySelectorAll('[data-study-verse-key], [data-annotation-card-id], [data-study-object-id]').forEach(element => {
      const endpoint = studyEndpointFromElement(element);
      if (!endpoint) return;
      const key = studyEndpointKey(endpoint);
      if (next[key]) return;
      let target = element;
      if (endpoint.kind === 'verse') target = element.querySelector('[data-verse-number]') || element.closest('[data-scripture-verse]')?.querySelector('[data-verse-number]') || element;
      if (endpoint.kind === 'object' && element.style.display === 'contents') target = element.firstElementChild;
      const rect = target?.getBoundingClientRect();
      if (!rect || !rect.width || !rect.height || !target.getClientRects().length) return;
      next[key] = { x: (rect.left + rect.width / 2 - origin.left) / currentZoom, y: (rect.top + rect.height / 2 - origin.top) / currentZoom, width: rect.width / currentZoom, height: rect.height / currentZoom };
    });
    setAnchors(next); setZoom(currentZoom);
    const width = viewport.current.clientWidth || 1, height = viewport.current.clientHeight || 1;
    setViewSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
  }, [camera, surface, viewport]);
  useEffect(() => {
    const element = viewport.current;
    const schedule = () => { cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(measure); };
    element.addEventListener('scripture-workspace-pan', schedule); element.addEventListener('annotation-gutter-layout', schedule); window.addEventListener('resize', schedule);
    const observer = new MutationObserver(changes => { if (changes.some(change => !change.target.parentElement?.closest('.bex-study-free-layer'))) schedule(); });
    observer.observe(surface.current, { childList: true, subtree: true, characterData: true });
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule); resize?.observe(surface.current);
    schedule();
    return () => { cancelAnimationFrame(frame.current); observer.disconnect(); resize?.disconnect(); element.removeEventListener('scripture-workspace-pan', schedule); element.removeEventListener('annotation-gutter-layout', schedule); window.removeEventListener('resize', schedule); cleanupGesture.current?.(); };
  }, [measure, surface, viewport]);
  useEffect(() => { frame.current = requestAnimationFrame(measure); return () => cancelAnimationFrame(frame.current); }, [records.objects, records.connections, measure]);
  useEffect(() => {
    surface.current.querySelectorAll('.bex-study-link-source').forEach(element => element.classList.remove('bex-study-link-source'));
    if (!source) return;
    surface.current.querySelectorAll('[data-study-verse-key], [data-annotation-card-id], [data-study-object-id]').forEach(element => { if (studyEndpointKey(studyEndpointFromElement(element)) === studyEndpointKey(source)) element.classList.add('bex-study-link-source'); });
  }, [source, surface]);
  useEffect(() => {
    const keydown = event => {
      if (!latest.current.isActive || event.target.closest?.(INPUTS) || picker || remap) return;
      if (event.key === 'Escape') { cleanupGesture.current?.(); setMode('hand'); setSource(null); setSelected(null); setSelectedLink(null); return; }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if ((event.key === 'Backspace' || event.key === 'Delete') && selected) { event.preventDefault(); remove(selected); setSelected(null); return; }
      const key = event.key === ' ' ? 'space' : event.key.toLowerCase();
      const tool = Object.keys(KW_DEFAULT_KEYS).find(id => ((binds || {})[id] || KW_DEFAULT_KEYS[id]) === key);
      if (tool) { event.preventDefault(); setMode(tool); setSource(null); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [binds, picker, remap, remove, selected]);
  useEffect(() => {
    const element = viewport.current;
    const pointerdown = event => {
      const state = latest.current;
      if (event.button !== 0 || !state.isActive || !state.ready || picker || remap) return;
      const endpoint = studyEndpointFromElement(event.target);
      if (event.target.closest?.('.bex-study-edge-hit')) return;
      if (state.mode === 'connection' && endpoint) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!state.source) setSource(endpoint);
        else if (studyEndpointKey(state.source) !== studyEndpointKey(endpoint)) {
          const duplicate = state.connections.some(link => [link.from, link.to].map(studyEndpointKey).sort().join('~') === [state.source, endpoint].map(studyEndpointKey).sort().join('~'));
          if (!duplicate) safe(run('connections', 'create', null, { from: state.source, to: endpoint, style: state.style, label: '' }));
          setSource(null);
        }
        return;
      }
      if (state.mode === 'erase' && endpoint?.kind === 'object') { event.preventDefault(); event.stopImmediatePropagation(); remove(endpoint.id); return; }
      if (event.target.closest?.(`${INPUTS}, button, a, .bex-study-page`)) return;
      const sectionBackground = state.mode !== 'hand' && endpoint?.kind === 'object'
        && state.objects.some(item => item.id === endpoint.id && item.object_type === 'section');
      if (endpoint && !sectionBackground) return;
      if (state.mode === 'connection' || state.mode === 'erase') return;
      if (state.mode === 'hand' && event.pointerType === 'touch') return;
      event.preventDefault(); event.stopImmediatePropagation();
      setSelected(null); setSelectedLink(null);
      const start = worldPoint(event);
      if (state.mode === 'card') { safe(create('card', start, { title: '', content: '', width: 400 })); setMode('hand'); return; }
      if (state.mode === 'point') { safe(create('point', start, { width: 12, height: 12 })); return; }
      if (state.mode === 'image') { imagePoint.current = start; file.current.click(); return; }
      if (state.mode === 'web_link') { setPicker({ kind: 'web_link', point: start }); safe(listAllEntityRecords(desktopClient.entities.KnowledgeWeb).then(items => setWebs(items.map(web => web.is_private ? { ...web, title: 'Private knowledge web' } : web)))); return; }
      if (state.mode === 'timegraph') { setPicker({ kind: 'timegraph', point: start }); return; }
      let points = [[start.x, start.y]], last = { x: event.clientX, y: event.clientY }, box = null;
      const move = next => {
        const point = worldPoint(next);
        if (state.mode === 'hand') { pan(last.x - next.clientX, last.y - next.clientY); last = { x: next.clientX, y: next.clientY }; }
        if (state.mode === 'draw' && points.length < 20000) { points.push([point.x, point.y]); setDraftStroke({ points: [...points], color: state.color, thickness: state.thickness }); }
        if (state.mode === 'section') { box = { x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.max(40, Math.abs(point.x - start.x)), height: Math.max(40, Math.abs(point.y - start.y)) }; setSectionBox(box); }
      };
      const cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', cancel); setDraftStroke(null); setSectionBox(null); cleanupGesture.current = null; };
      const end = () => {
        cleanup();
        if (state.mode === 'section' && box) safe(create('section', box, { ...box, title: 'Section', color: '#7C5CB7' }));
        if (state.mode === 'draw' && points.length > 1) {
          const minX = Math.min(...points.map(p => p[0])) - 8, minY = Math.min(...points.map(p => p[1])) - 8;
          const width = Math.max(16, Math.max(...points.map(p => p[0])) - minX + 8), height = Math.max(16, Math.max(...points.map(p => p[1])) - minY + 8);
          safe(create('drawing', { x: minX, y: minY }, { width, height, strokes_data: JSON.stringify({ points: points.map(([x, y]) => [x - minX, y - minY]), color: state.color, thickness: state.thickness, rotation: 0 }) }));
        }
      };
      const cancel = () => cleanup(); cleanupGesture.current = cancel;
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', cancel);
    };
    element.addEventListener('pointerdown', pointerdown, true);
    return () => element.removeEventListener('pointerdown', pointerdown, true);
  }, [viewport, worldPoint, pan, create, picker, remap, remove, run, safe]);
  const updatePosition = (id, x, y) => preview(id, { x, y });
  const dragEnd = (id, x, y) => safe(update(id, { x, y }));
  const resize = (id, width, height, persist = true) => persist ? safe(update(id, { width, height })) : preview(id, { width, height });
  const select = id => { setSelected(id); setSelectedLink(null); };
  const link = records.connections.find(item => item.id === selectedLink);
  const object = records.objects.find(item => item.id === selected);
  const choose = async value => {
    await safe(create(picker.kind, picker.point, picker.kind === 'timegraph' ? { timegraph_id: value.id, width: 520, height: 280 } : { link_web_id: value.id, width: 180, height: 140 }));
    setPicker(null); setMode('hand');
  };
  const ui = <div className="bex-study-tool-ui" data-study-ui>
    <input ref={file} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={async event => {
      const image = event.target.files?.[0]; event.target.value = '';
      if (!image) return;
      if (image.size > 10 * 1024 * 1024) { toast.error('Image too large. Maximum size is 10 MB.'); return; }
      await safe(desktopClient.media.uploadFile({ file: image }).then(result => create('image', imagePoint.current, { image_url: result.file_url, width: 320, height: 240 })));
      setMode('hand');
    }} />
    <FloatingToolbar label="Chapter Study tools" mode={mode} connectorStyle={style} onToggleConnectorStyle={() => setStyle(value => value === 'curvy' ? 'straight' : 'curvy')} onModeChange={next => { if (!records.ready) { toast.error(records.error || 'Chapter Study canvas is loading.'); return; } setMode(next); setSource(null); }} drawColor={color} onDrawColorChange={setColor} drawThickness={thickness} onDrawThicknessChange={setThickness} keybinds={binds || KW_DEFAULT_KEYS} onOpenRemap={() => setRemap(true)} />
    <FloatingZoomControls zoom={zoom} containerRef={viewport} multiplyZoom={(factor, x, y) => { const rect = viewport.current.getBoundingClientRect(); zoomAt(factor, x + rect.left, y + rect.top); }} smoothZoomTo={(value, x, y) => { const rect = viewport.current.getBoundingClientRect(); zoomAt(value / camera.current.zoom, x + rect.left, y + rect.top); }} />
    {(HELP[mode] || records.error) && <div className="bex-study-tool-help" role="status">{records.error ? <>Canvas could not be saved or loaded. <button type="button" onClick={records.refresh}>Retry</button></> : source ? 'Now click the other verse or card. Escape cancels.' : HELP[mode]}</div>}
    {(link || (object && object.object_type !== 'card')) && <aside className="bex-study-tool-inspector" aria-label="Study canvas item">
      <button type="button" aria-label="Close study item controls" onClick={() => { setSelected(null); setSelectedLink(null); }}><X size={16} /></button>
      {link ? <><label>Connection label<input key={`link-${link.id}`} aria-label="Study connection label" defaultValue={link.label || ''} onChange={event => safe(run('connections', 'update', link.id, { label: event.target.value }))} /></label><button type="button" onClick={() => safe(run('connections', 'update', link.id, { style: link.style === 'straight' ? 'curvy' : 'straight' }))}>Use {link.style === 'straight' ? 'curved' : 'straight'} line</button></> : <>
        <label>Title<input key={`title-${object.id}`} aria-label="Study canvas item title" defaultValue={object.title || ''} onChange={event => { preview(object.id, { title: event.target.value }); safe(update(object.id, { title: event.target.value })); }} /></label>
        {['image', 'web_link', 'timegraph'].includes(object.object_type) && <><label>Width<input key={`width-${object.id}`} type="number" aria-label="Study item width" min="40" defaultValue={object.width || 320} onChange={event => { if (Number(event.target.value) > 0) safe(update(object.id, { width: Number(event.target.value) })); }} /></label><label>Height<input key={`height-${object.id}`} type="number" aria-label="Study item height" min="40" defaultValue={object.height || 240} onChange={event => { if (Number(event.target.value) > 0) safe(update(object.id, { height: Number(event.target.value) })); }} /></label></>}
      </>}
      <button type="button" aria-label="Delete study canvas item" onClick={() => { if (link) safe(run('connections', 'delete', link.id)); else remove(object.id); setSelected(null); setSelectedLink(null); }}><Trash2 size={16} /> Delete</button>
    </aside>}
    <KeybindRemapModal open={remap} onClose={() => setRemap(false)} title="Chapter Study shortcuts" tools={KW_TOOLS} binds={binds || KW_DEFAULT_KEYS} onSetBind={(id, key) => { const next = { ...KW_DEFAULT_KEYS, ...binds }; const previous = next[id]; const other = Object.keys(next).find(otherId => otherId !== id && next[otherId] === key); if (other) next[other] = previous; next[id] = key; setBinds(next); }} onReset={() => setBinds(KW_DEFAULT_KEYS)} />
    {picker?.kind === 'web_link' && <WebLinkPicker webs={webs} activeWebId={null} onPick={choose} onCancel={() => setPicker(null)} />}
    {picker?.kind === 'timegraph' && <TimegraphPicker onPick={choose} onClose={() => setPicker(null)} />}
  </div>;
  return <><div className="bex-study-free-layer" data-testid="study-canvas-objects">
    {records.objects.map(item => {
      const props = { obj: item, zoom, isSelected: item.id === selected, onSelect: select, onPositionUpdate: updatePosition, onDragEnd: dragEnd, onUpdate: (id, patch) => safe(update(id, patch)), onResize: resize };
      if (item.object_type === 'card') return <StudyCanvasCard key={item.id} object={item} zoom={zoom} selected={item.id === selected} onSelect={select} onUpdate={update} onPreview={preview} onDelete={remove} />;
      const render = { drawing: () => <CanvasDrawing {...props} />, section: () => <CanvasSection {...props} />, image: () => <CanvasImage {...props} />,
        point: () => <CanvasPoint {...props} isConnectionSource={source?.kind === 'object' && source.id === item.id} />,
        timegraph: () => <CanvasTimegraph {...props} isInteractive={mode === 'hand'} onOpen={graph => navigate(timegraphDeepLink(graph.id))} />,
        web_link: () => <CanvasWebLink {...props} webs={webs} isInteractive={mode === 'hand'} onJump={item => navigate(webDeepLink(item.link_web_id))} /> }[item.object_type];
      return render ? <div key={item.id} data-study-object-id={item.id} style={{ display: 'contents' }}>{render()}</div> : null;
    })}
  </div>{portal && createPortal(<svg className="bex-study-canvas-connections" aria-label="Saved study connections"
      viewBox={`${camera.current.x / zoom} ${camera.current.y / zoom} ${viewSize.width / zoom} ${viewSize.height / zoom}`} preserveAspectRatio="none">
      {records.connections.map(item => {
        const from = anchors[studyEndpointKey(item.from)], to = anchors[studyEndpointKey(item.to)];
        if (!from || !to) return null;
        const d = studyConnectionPath(from, to, item.style);
        return <g key={item.id} data-study-connection-id={item.id}><path d={d} fill="none" stroke={selectedLink === item.id ? '#dab8ff' : '#a88cdb'} strokeWidth="2" vectorEffect="non-scaling-stroke" /><path className="bex-study-edge-hit" d={d} fill="none" stroke="transparent" strokeWidth="16" vectorEffect="non-scaling-stroke" onClick={event => { event.stopPropagation(); if (mode === 'erase') safe(run('connections', 'delete', item.id)); else { setSelectedLink(item.id); setSelected(null); } }} /><title>{item.label || 'Saved verse connection'}</title>{item.label && <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 8} fill="#ddd" fontSize="13">{item.label}</text>}</g>;
      })}
      {draftStroke && <path d={pointsToSmoothPath(draftStroke.points)} fill="none" stroke={draftStroke.color} strokeWidth={draftStroke.thickness} />}
      {sectionBox && <rect {...sectionBox} fill="#7c5cb722" stroke="#b197ef" />}
    </svg>, viewport.current)}{portal && createPortal(ui, portal)}</>;
}
