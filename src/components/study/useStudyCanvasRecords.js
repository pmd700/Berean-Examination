import { useCallback, useEffect, useRef, useState } from 'react';
import { desktopClient } from '@/api/desktopClient';
import { listAllEntityRecords } from '@/lib/allLocalEntityRecords';
import { registerPendingEditorSave } from '@/lib/pendingEditorSaves';

const CHANGED = 'bex:study-canvas-changed';
const TYPES = { objects: 'StudyCanvasObject', connections: 'StudyConnection' };

/** Each item is an encrypted SQLite record, independent of the current query. */
export default function useStudyCanvasRecords() {
  const [records, setRecords] = useState({ objects: [], connections: [] });
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const pending = useRef(Promise.resolve()), live = useRef(true), source = useRef({}), revision = useRef(0);
  const refresh = useCallback(async () => {
    const started = ++revision.current;
    try {
      const [objects, connections] = await Promise.all(Object.values(TYPES).map(type => listAllEntityRecords(desktopClient.entities[type])));
      if (live.current && revision.current === started) { setRecords({ objects, connections }); setError(''); setReady(true); }
    } catch (failure) { if (live.current) { setError(failure.message); setReady(false); } }
  }, []);
  useEffect(() => {
    live.current = true;
    refresh();
    const changed = event => { if (event.detail !== source.current) pending.current.catch(() => {}).then(refresh); };
    window.addEventListener(CHANGED, changed);
    const unregister = registerPendingEditorSave(async () => { await pending.current; return false; });
    return () => { live.current = false; revision.current++; unregister(); window.removeEventListener(CHANGED, changed); };
  }, [refresh]);
  const run = useCallback((collection, action, id, patch) => {
    revision.current++;
    const operation = pending.current.catch(() => {}).then(async () => {
      const api = desktopClient.entities[TYPES[collection]];
      const result = action === 'create' ? await api.create(patch) : action === 'update' ? await api.update(id, patch) : await api.delete(id);
      if (live.current) {
        setRecords(previous => ({ ...previous, [collection]: action === 'create' ? [...previous[collection], result]
          : action === 'update' ? previous[collection].map(item => item.id === id ? result : item)
            : previous[collection].filter(item => item.id !== id),
        ...(collection === 'objects' && action === 'delete' ? { connections: previous.connections.filter(link => ![link.from, link.to].some(endpoint => endpoint.kind === 'object' && endpoint.id === id)) } : {}) }));
        setError('');
      }
      window.dispatchEvent(new CustomEvent(CHANGED, { detail: source.current }));
      return result;
    });
    pending.current = operation;
    operation.catch(failure => { if (live.current) setError(failure.message); });
    return operation;
  }, []);
  const preview = useCallback((id, patch) => setRecords(previous => ({ ...previous, objects: previous.objects.map(item => item.id === id ? { ...item, ...patch } : item) })), []);
  return { ...records, ready, error, refresh, run, preview };
}
