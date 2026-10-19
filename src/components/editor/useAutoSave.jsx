import { useState, useEffect, useRef, useCallback } from 'react';
import { registerPendingEditorSave } from '@/lib/pendingEditorSaves';

export function useAutoSave({
  content,
  onSave,
  delay = 5000,
  maxWait = null,
  enabled = true,
  initialContent = ''
}) {
  const [saveStatus, setSaveStatus] = useState(null); // null (neutral), 'saving', 'saved', 'unsaved'
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const timeoutRef = useRef(null);
  const dirtySinceRef = useRef(null);
  const initialContentRef = useRef(initialContent);
  const lastSavedContentRef = useRef(initialContent);
  const isSavingRef = useRef(false);
  const isInitializedRef = useRef(false);
  const inFlightRef = useRef(null);
  const currentRef = useRef({ content, onSave, enabled });
  currentRef.current = { content, onSave, enabled };

  const flushSave = useCallback(() => {
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    // Concurrent refresh/timer calls share the entire drain, including any edit
    // made while a previous value is being written.
    if (inFlightRef.current) return inFlightRef.current;
    dirtySinceRef.current = null;
    const operation = Promise.resolve().then(async () => {
      let saved = false;
      while (currentRef.current.enabled && isInitializedRef.current
        && currentRef.current.content !== lastSavedContentRef.current) {
        const { content: value, onSave: save } = currentRef.current;
        setSaveStatus('saving');
        isSavingRef.current = true;
        try {
          await save(value);
          saved = true;
          lastSavedContentRef.current = value;
          const stillDirty = currentRef.current.content !== value;
          setHasUnsavedChanges(stillDirty);
          setSaveStatus(stillDirty ? 'unsaved' : 'saved');
        } catch (error) {
          setSaveStatus('unsaved');
          setHasUnsavedChanges(true);
          throw error;
        }
      }
      return saved;
    }).finally(() => {
      inFlightRef.current = null;
      isSavingRef.current = false;
    });
    inFlightRef.current = operation;
    return operation;
  }, []);

  useEffect(() => registerPendingEditorSave(flushSave), [flushSave]);

  // Initialize with the initial content on first render
  useEffect(() => {
    if (!isInitializedRef.current) {
      initialContentRef.current = initialContent;
      lastSavedContentRef.current = initialContent;
      isInitializedRef.current = true;
    }
  }, [initialContent]);

  useEffect(() => {
    if (!enabled || !isInitializedRef.current) {
      dirtySinceRef.current = null;
      return;
    }

    // Single source of truth: compare current content to last saved content
    const hasChanges = content !== lastSavedContentRef.current;
    setHasUnsavedChanges(hasChanges);
    
    // If content matches last saved, show neutral or saved
    if (!hasChanges) {
      dirtySinceRef.current = null;
      // Only show "saved" if we were dirty before
      setSaveStatus(isDirty ? 'saved' : null);
      return;
    }

    // Content differs from last saved - mark as dirty and show unsaved
    if (!isDirty) {
      setIsDirty(true);
    }
    
    // Only show unsaved if not currently saving
    if (!isSavingRef.current) {
      setSaveStatus('unsaved');
    }

    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Set new timeout for auto-save
    // A bounded wait also saves during continuous typing, instead of postponing
    // indefinitely whenever another keystroke resets the idle timer.
    if (dirtySinceRef.current === null) dirtySinceRef.current = Date.now();
    const wait = maxWait == null ? delay : Math.min(delay, Math.max(0, maxWait - (Date.now() - dirtySinceRef.current)));
    timeoutRef.current = setTimeout(() => {
      flushSave().catch(error => console.error('Auto-save failed:', error));
    }, wait);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [content, delay, maxWait, enabled, isDirty, flushSave]);

  const resetSaveState = (newContent = content) => {
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    dirtySinceRef.current = null;
    initialContentRef.current = newContent;
    lastSavedContentRef.current = newContent;
    setHasUnsavedChanges(false);
    setSaveStatus(null);
    setIsDirty(false);
    isInitializedRef.current = true;
  };

  return { saveStatus, hasUnsavedChanges, isDirty, resetSaveState, flushSave };
}
