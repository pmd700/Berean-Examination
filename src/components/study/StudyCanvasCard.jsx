import React, { useEffect, useRef, useState } from 'react';
import { Check, GripVertical, Pencil, Save, Trash2 } from 'lucide-react';
import TEXT_EDITOR_MACHINERY from '@/components/editor/TEXT_EDITOR_MACHINERY';
import MarkdownRenderer from '@/components/editor/MarkdownRenderer';
import { registerPendingEditorSave } from '@/lib/pendingEditorSaves';

export default function StudyCanvasCard({ object, zoom, selected, onSelect, onUpdate, onPreview, onDelete }) {
  const [draft, setDraft] = useState({ title: object.title || '', content: object.content || '' });
  const [editing, setEditing] = useState(selected);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const latest = useRef(draft), timer = useRef(null), dirtyRef = useRef(false), saveRef = useRef(null), gesture = useRef(null);
  const save = async () => {
    clearTimeout(timer.current);
    if (!dirtyRef.current) return;
    const value = latest.current;
    setSaving(true);
    try {
      await onUpdate(object.id, value);
      if (latest.current === value) { dirtyRef.current = false; setDirty(false); }
      setError('');
    } catch (failure) { setError(failure.message); throw failure; }
    finally { setSaving(false); }
  };
  saveRef.current = save;
  useEffect(() => registerPendingEditorSave(async () => { await saveRef.current(); return false; }), []);
  useEffect(() => () => { clearTimeout(timer.current); gesture.current?.(); if (dirtyRef.current) saveRef.current().catch(() => {}); }, []);
  useEffect(() => {
    if (!dirtyRef.current && !editing) { const value = { title: object.title || '', content: object.content || '' }; latest.current = value; setDraft(value); }
  }, [object.title, object.content, editing]);
  const change = patch => {
    latest.current = { ...latest.current, ...patch }; setDraft(latest.current); dirtyRef.current = true; setDirty(true);
    clearTimeout(timer.current); timer.current = setTimeout(() => saveRef.current().catch(() => {}), 450);
  };
  const drag = (event, corner = null) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); onSelect(object.id);
    const start = { x: event.clientX, y: event.clientY }, original = { x: object.x, y: object.y, width: object.width || 400, height: object.height || event.currentTarget.closest('article').getBoundingClientRect().height / zoom };
    let patch = null;
    const move = next => {
      const dx = (next.clientX - start.x) / zoom, dy = (next.clientY - start.y) / zoom;
      if (!corner) patch = { x: original.x + dx, y: original.y + dy };
      else {
        const west = corner.includes('w'), north = corner.includes('n');
        const width = Math.max(220, original.width + (west ? -dx : dx)), height = Math.max(100, original.height + (north ? -dy : dy));
        patch = { width, height, x: west ? original.x + original.width - width : original.x, y: north ? original.y + original.height - height : original.y };
      }
      onPreview(object.id, patch);
    };
    const cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', cancel); gesture.current = null; };
    const end = () => { cleanup(); if (patch) onUpdate(object.id, patch).catch(() => onPreview(object.id, original)); };
    const cancel = () => { cleanup(); onPreview(object.id, original); };
    gesture.current = cancel;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', cancel);
  };
  return <article data-study-object-id={object.id} className={`bex-study-free-card ${selected ? 'is-selected' : ''}`} style={{ left: object.x, top: object.y, width: object.width || 400, ...(object.height ? { height: object.height } : {}) }} onClick={() => onSelect(object.id)}>
    <button type="button" className="bex-gutter-move" aria-label="Move study card" onPointerDown={event => drag(event)}><GripVertical size={18} /></button>
    <header>{editing ? <input aria-label="Study card title" value={draft.title} placeholder="Untitled card" onChange={event => change({ title: event.target.value })} /> : <strong>{object.title || 'Untitled card'}</strong>}
      <button type="button" aria-label={editing ? 'Done editing study card' : 'Edit study card'} onClick={async event => {
        event.stopPropagation(); if (editing) { try { await save(); setEditing(false); } catch { /* Keep the unsaved draft open. */ } } else setEditing(true);
      }}>{editing ? <Check size={16} /> : <Pencil size={16} />}</button>
      <button type="button" aria-label="Delete study card" onClick={event => { event.stopPropagation(); clearTimeout(timer.current); dirtyRef.current = false; onDelete(object.id); }}><Trash2 size={15} /></button>
    </header>
    <div className="bex-study-free-card-body" data-workspace-native-scroll>{editing ? <TEXT_EDITOR_MACHINERY bare footnotes content={draft.content} onChange={content => change({ content })} placeholder="Write your idea…" /> : <MarkdownRenderer content={object.content || ''} sourcesById={{}} />}</div>
    {(dirty || saving || error) && <button type="button" className="bex-study-card-save" title={error || (saving ? 'Saving…' : 'Save changes')} aria-label={error ? 'Retry saving study card' : saving ? 'Saving study card' : 'Save study card'} onClick={() => save().catch(() => {})}><Save size={14} />{error && 'Retry save'}</button>}
    {['nw', 'ne', 'sw', 'se'].map(corner => <button key={corner} type="button" className={`bex-gutter-resize bex-gutter-resize-${corner}`} aria-label={`Resize study card from ${corner}`} onPointerDown={event => drag(event, corner)} />)}
  </article>;
}
