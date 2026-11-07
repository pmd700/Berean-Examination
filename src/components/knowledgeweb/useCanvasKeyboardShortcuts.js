import { useEffect } from 'react';
import { canvasDeleteSelection } from './canvasDeleteSelection';

// Keep-alive tabs retain their selections. Only the active workspace may own
// window shortcuts; hidden graphs must never intercept typing or delete data.
export default function useCanvasKeyboardShortcuts({
  isActive, activeNoteIdRef, selectedConnectionId, selectedCardIds,
  selectedPointIds, selectedCardId, selectedObjectId, undoRef, redoRef,
  copyCardsRef, cutCardsRef, pasteCardsRef, canPasteCardsRef, kwKeyToToolRef,
  deleteCardRef, deleteCanvasObjectRef, deleteConnectionRef, setMode,
  setConnectionSource, setTempLine, setPendingBulkDelete, bulkDeleteThreshold,
}) {
  // Keyboard shortcuts for delete + undo/redo
  useEffect(() => {
    if (!isActive) return;
    const handleKeyDown = (e) => {
      const target = e.target instanceof Element ? e.target : null;
      const isEditingText = !!target?.closest?.(
        'input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"], [contenteditable=""], .logic-renderer__source-editor',
      );
      // A purple whole-block selection deliberately hides its caret, so the
      // event target can be document.body even though the user is still
      // interacting with text. Treat a visible shared editor carrying that
      // selection as the keyboard owner; its BlockDrag extension handles the
      // command and the canvas must stay out of it.
      const hasActiveTextBlocks = Array.from(
        document.querySelectorAll('.ProseMirror.bex-block-selection-active'),
      ).some((element) => element instanceof HTMLElement && element.isConnected && element.offsetParent !== null);
      if (isEditingText || hasActiveTextBlocks) return;

      /**
       * A note is not a canvas.
       *
       * Every command below acts on cards, connections or canvas tools, none of
       * which exist while a note is open — the canvas is not even on screen. The
       * guard above only catches the caret being *literally inside* the editor,
       * and focus sits on the body far more often than that: a whole-block
       * selection deliberately releases the caret, a popover button takes the
       * press, a page turn builds a fresh editor nobody has clicked into yet.
       *
       * In every one of those moments this handler used to win the key. Cmd+V
       * pasted cards into a web nobody could see instead of pasting into the
       * note; Cmd+C copied cards left selected in some other web instead of the
       * blocks in front of the reader; Delete removed cards while someone was
       * reading. Undo already carved out this exact exception for itself — the
       * rest of the handler needed it just as much.
       */
      if (activeNoteIdRef.current) return;

      const isMod = e.metaKey || e.ctrlKey;

      // Undo: Cmd/Ctrl+Z (no shift, no alt)
      // Redo: Cmd/Ctrl+Shift+Z (standard) OR Cmd/Ctrl+Alt+Z (user request)
      if (isMod && (e.key === 'z' || e.key === 'Z')) {
        // A fullscreen card is a text workspace of its own. Its ProseMirror
        // history owns undo even when a recent block drag has temporarily
        // released the caret and made the key event look as though it came from
        // the page. Never run a second canvas undo underneath that editor.
        // (Notes are already excluded for every command, further up.)
        const hasFullscreenCardEditor = !!document.querySelector('.kw-card-editor-fullscreen');
        if (hasFullscreenCardEditor) return;
        e.preventDefault();
        if (e.shiftKey || e.altKey) {
          redoRef.current?.();
        } else {
          undoRef.current?.();
        }
        return;
      }

      // Cmd/Ctrl+C — copy the currently marquee-selected cards. We
      // only intercept when (a) there is an actual card selection and
      // (b) the user does NOT have a real text selection (so normal
      // browser text-copy still works inside tooltips, etc.).
      if (isMod && (e.key === 'c' || e.key === 'C') && !e.shiftKey && !e.altKey) {
        const hasTextSelection =
          typeof window !== 'undefined' &&
          window.getSelection &&
          window.getSelection().toString().length > 0;
        if (!hasTextSelection && selectedCardIds && selectedCardIds.length > 0) {
          e.preventDefault();
          copyCardsRef.current?.();
          return;
        }
      }

      // Cmd/Ctrl+X — cut the currently marquee-selected cards: copy them
      // to the in-app clipboard, then delete them. Same guards as Cmd+C
      // so we don't clobber the browser's native cut inside text fields.
      if (isMod && (e.key === 'x' || e.key === 'X') && !e.shiftKey && !e.altKey) {
        const hasTextSelection =
          typeof window !== 'undefined' &&
          window.getSelection &&
          window.getSelection().toString().length > 0;
        if (!hasTextSelection && selectedCardIds && selectedCardIds.length > 0) {
          e.preventDefault();
          cutCardsRef.current?.();
          return;
        }
      }

      // Cmd/Ctrl+V — paste the most-recently-copied cards into the
      // currently active web. We only swallow the event when there's
      // actually something to paste (an in-app clipboard buffer +
      // active web). Otherwise let the browser's normal paste run.
      if (isMod && (e.key === 'v' || e.key === 'V') && !e.shiftKey && !e.altKey) {
        if (canPasteCardsRef.current?.()) {
          e.preventDefault();
          pasteCardsRef.current?.();
          return;
        }
      }

      // Tool shortcuts come from the remappable keymap (kwKeyToTool). `~` is
      // kept as a permanent alias for Hand so Shift+` still resets to default.
      if (!isMod) {
        const k = e.key === ' ' ? 'space' : e.key.toLowerCase();
        const tool = (k === '~') ? 'hand' : kwKeyToToolRef.current[k];
        if (tool) {
          setMode(tool);
          setConnectionSource(null);
          setTempLine(null);
          return;
        }
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Delete the entire marquee group, including routing points.
        // Otherwise retain single card > object > connection priority.
        // Backspace inside form fields is already filtered above.
        const selection = canvasDeleteSelection({
          cardIds: selectedCardIds, pointIds: selectedPointIds,
          cardId: selectedCardId, objectId: selectedObjectId,
          connectionId: selectedConnectionId,
        });
        if (!selection) return;
        e.preventDefault();
        if (selection.connectionId != null) {
          deleteConnectionRef.current?.(selection.connectionId);
        } else if (selection.cardIds.length > bulkDeleteThreshold) {
          setPendingBulkDelete({ ids: selection.cardIds, pointIds: selection.objectIds });
        } else {
          selection.cardIds.forEach(id => deleteCardRef.current?.(id));
          selection.objectIds.forEach(id => deleteCanvasObjectRef.current?.(id));
        }
        return;
      }
      if (e.key === 'Escape') {
        setMode('hand');
        setConnectionSource(null);
        setTempLine(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, selectedConnectionId, selectedCardIds, selectedPointIds, selectedCardId, selectedObjectId, activeNoteIdRef, undoRef, redoRef, copyCardsRef, cutCardsRef, pasteCardsRef, canPasteCardsRef, kwKeyToToolRef, deleteCardRef, deleteCanvasObjectRef, deleteConnectionRef, setMode, setConnectionSource, setTempLine, setPendingBulkDelete, bulkDeleteThreshold]);

}
