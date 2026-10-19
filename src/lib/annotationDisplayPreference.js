import { useCallback, useEffect, useRef, useState } from 'react';
import { readLocalOwner, saveLocalOwnerPreferences } from '@/lib/localOwner';

export const ANNOTATION_DISPLAY_KEY = 'scripture_annotation_display';
const EVENT = 'bex:annotation-display-changed';
let revision = 0;
export const normalizeAnnotationDisplay = value => value === 'hover' ? 'hover' : 'gutter';
function cached() {
  try { return normalizeAnnotationDisplay(JSON.parse(localStorage.getItem(ANNOTATION_DISPLAY_KEY))); }
  catch { return 'gutter'; }
}
function publish(style) {
  revision++;
  try { localStorage.setItem(ANNOTATION_DISPLAY_KEY, JSON.stringify(style)); } catch { /* Owner is authoritative. */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: style }));
}

// SQLite owner preferences survive the desktop's changing localhost port.
// Only a successful local write is published to other mounted reader tabs.
export function useAnnotationDisplayPreference() {
  const [style, setStyle] = useState(cached);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const startedAt = revision;
    const changed = event => { setStyle(normalizeAnnotationDisplay(event.detail)); setError(''); };
    window.addEventListener(EVENT, changed);
    readLocalOwner().then(owner => {
      if (mounted.current && revision === startedAt) {
        const next = normalizeAnnotationDisplay(owner[ANNOTATION_DISPLAY_KEY]);
        setStyle(next);
        try { localStorage.setItem(ANNOTATION_DISPLAY_KEY, JSON.stringify(next)); } catch { /* Optional cache. */ }
      }
    }).catch(err => { if (mounted.current) setError(err.message); })
      .finally(() => { if (mounted.current) setLoading(false); });
    return () => { mounted.current = false; window.removeEventListener(EVENT, changed); };
  }, []);
  const saveStyle = useCallback(async next => {
    const value = normalizeAnnotationDisplay(next);
    await saveLocalOwnerPreferences({ [ANNOTATION_DISPLAY_KEY]: value });
    publish(value);
  }, []);
  return { style, saveStyle, loading, error };
}
