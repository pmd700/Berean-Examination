import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { desktopClient } from '@/api/desktopClient';
import { Button, buttonVariants } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, LayoutGrid, ListTree, NotebookPen, Trash2, Save, Check, Copy, Download, Link2 } from 'lucide-react';
import { buildCurrentNoteExport, waitForNoteExportSaves } from '@/lib/exportNote';
import { saveExportFile } from '@/lib/saveExportFile';
import { subscribeToNoteChanges } from '@/lib/noteChanges';
import { registerPendingEditorSave } from '@/lib/pendingEditorSaves';
import BookSurface from '../notes/BookSurface';
import useNoteZoom from '../notes/useNoteZoom';
import { copyNotePage } from '../notes/copyNotePage';
import { announceCopy, announceCopyFailed } from '@/lib/copyFeedback';
import { copyNoteLink } from '@/lib/noteLink';
import BookOverview from '../notes/BookOverview';
import BookIndex from '../notes/BookIndex';
import { remapIndexEntries } from '../notes/bookIndexModel';
import PageWheelPicker from '../notes/PageWheelPicker';
import { useTabBookStatus } from '@/lib/WorkspaceTabs';
import TextSizeControl, { useTextSizePreference } from '../scripture/TextSizeControl';
import { exportPagesToMarkdown } from '../notes/bookExport';
import {
  MAX_PAGES,
  footnoteOffsets,
  getPageTitle,
  hasPageTitle,
  insertPageAfter,
  joinBookPages,
  movePage,
  pageIndexAfterMove,
  removePages,
  setPageTitle,
  splitBookPages,
} from '../notes/bookModel';
import { toast } from 'sonner';
import { confirmDialog } from '@/components/ui/confirm-dialog';
import { startFieldSpotlight } from '@/lib/spotlightMotion';
import { toPlainSearchText } from '@/lib/localBrainSearch';
import { useIsActiveTab } from '@/lib/WorkspaceTabs';

/**
 * Inline single-note editor embedded in the Knowledge Web page main pane.
 * Self-contained: it seeds its editable state from the `notes` list, autosaves
 * with a debounce. Committed edits notify mounted lists and duplicate editors.
 */
export default function NoteEditorPanel({
  noteId,
  notes = [],
  onNoteSaved = null,
  onNoteDeleted,
  spotlightQuery = '',
  spotlightField = '',
  spotlightToken = '',
  spotlightPage = null,
  onSpotlightComplete,
  requestedPage = null,
  onPageChange = null,
}) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [loadedNoteId, setLoadedNoteId] = useState(null);
  const [isTurning, setIsTurning] = useState(false);
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | saving | saved
  const [pageIndex, setPageIndex] = useState(0);
  const rememberedPage = useRef(null);
  const onPageChangeRef = useRef(onPageChange);
  onPageChangeRef.current = onPageChange;
  const [showPages, setShowPages] = useState(false);
  const [showBookIndex, setShowBookIndex] = useState(false);
  const [indexNavigation, setIndexNavigation] = useState(null);
  const [indexEntries, setIndexEntries] = useState([]);
  const [textSize, setTextSize] = useTextSizePreference();

  const saveTimer = useRef(null);
  const pendingSave = useRef(new Map()); // note id → unsaved field patches
  const inFlightSave = useRef(null);
  const activeSave = useRef(null);
  const latestSaveRecord = useRef(null);
  const deferredChange = useRef(null);
  const onNoteSavedRef = useRef(onNoteSaved);
  onNoteSavedRef.current = onNoteSaved;
  const exportingRef = useRef(false);
  const [exporting, setExporting] = useState(false);
  const lastLoadedId = useRef(null);
  const titleRef = useRef(null);
  const bodyEditorRef = useRef(null);
  const bookSurfaceRef = useRef(null);
  const documentScrollRef = useRef(null);
  const documentPageRef = useRef(null);
  const isActiveTab = useIsActiveTab();
  const [spotlightLanding, setSpotlightLanding] = useState(null);
  const spotlightCompleteRef = useRef(onSpotlightComplete);
  spotlightCompleteRef.current = onSpotlightComplete;

  /**
   * Enter in the title moves into the note, it does not grow the title.
   *
   * The title is a textarea so it can wrap onto a second line, which means Enter
   * would otherwise insert a literal newline into the note's name — the heading
   * kept getting taller instead of the caret moving on to the writing.
   *
   * Shift+Enter is left alone for anyone who genuinely wants a two-line title.
   */
  const handleTitleKeyDown = useCallback((event) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();

    const editor = bodyEditorRef.current;
    if (!editor) return;

    // An empty note has nothing to land on, so give it a first line rather than
    // moving the caret into a body it cannot sit in.
    if (editor.isEmpty) {
      editor.chain().focus().clearContent().insertContent('<p></p>').run();
    } else {
      editor.commands.focus('start');
    }

    // Move DOM focus explicitly. The focus command sets the editor's selection
    // but its own focusing is deferred, so on its own the caret ended up at the
    // body's start while the keyboard still went to the title — the next
    // keystroke landed back in the heading.
    titleRef.current?.blur();
    editor.view.dom.focus();
  }, []);

  const note = useMemo(() => notes.find(n => n.id === noteId) || null, [notes, noteId]);

  useNoteZoom(documentScrollRef, documentPageRef, noteId, Boolean(note));

  const adoptCommittedFields = useCallback((record, fields) => {
    if (fields.includes('title')) setTitle(record.title || '');
    if (fields.includes('content')) setContent(record.content || '');
    if (fields.includes('book_index_entries')) {
      setIndexEntries(Array.isArray(record.book_index_entries) ? record.book_index_entries : []);
    }
  }, []);

  // Persist whatever edit is pending right now (cancels the debounce timer).
  const flushSave = useCallback(() => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    if (inFlightSave.current) return inFlightSave.current;
    const operation = Promise.resolve().then(async () => {
      let didSave = false;
      while (pendingSave.current.size) {
        const [id, updates] = pendingSave.current.entries().next().value;
        pendingSave.current.delete(id);
        activeSave.current = { id, updates };
        try {
          const saved = await desktopClient.entities.MindNote.update(id, updates);
          didSave = true;
          const latest = latestSaveRecord.current?.id === id ? latestSaveRecord.current.record : saved;
          onNoteSavedRef.current?.({ id, ...latest });
        } catch (error) {
          // Retain failed fields for a real retry; never silently discard them.
          pendingSave.current.set(id, { ...updates, ...pendingSave.current.get(id) });
          setSaveStatus('unsaved');
          toast.error('Could not save note. Your edits are kept open for retry.');
          throw error;
        } finally { activeSave.current = null; latestSaveRecord.current = null; }
      }
      // Two duplicate tabs can commit in the same turn while both protect
      // their drafts. Once this draft is saved, adopt the last committed fields
      // observed during it so neither tab stays on an older version.
      const deferred = deferredChange.current;
      if (deferred?.id === lastLoadedId.current) {
        adoptCommittedFields(deferred.record, [...deferred.fields]);
      }
      deferredChange.current = null;
      if (didSave) {
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus(s => (s === 'saved' ? 'idle' : s)), 1500);
      }
      return didSave;
    }).finally(() => { inFlightSave.current = null; });
    inFlightSave.current = operation;
    return operation;
  }, [adoptCommittedFields]);

  useEffect(() => registerPendingEditorSave(flushSave), [flushSave]);
  useEffect(() => subscribeToNoteChanges(({ operation, id, record, fields = [] }) => {
    // Keep callbacks current even if the user changed notes during this write.
    if (operation === 'update' && record && activeSave.current?.id === id) {
      latestSaveRecord.current = { id, record };
    }
    if (id !== lastLoadedId.current || operation !== 'update' || !record) return;
    // A clean duplicate tab adopts committed fields. Protect its own pending
    // and in-flight edits until those are saved, rather than clobbering typing.
    const dirty = { ...(activeSave.current?.id === id ? activeSave.current.updates : {}), ...pendingSave.current.get(id) };
    const blocked = fields.filter(field => Object.hasOwn(dirty, field));
    const previous = deferredChange.current?.id === id ? deferredChange.current : null;
    if (previous || blocked.length) {
      deferredChange.current = { id, record, fields: new Set([...(previous?.fields || []), ...blocked]) };
    }
    adoptCommittedFields(record, fields.filter(field => !Object.hasOwn(dirty, field)));
  }), [adoptCommittedFields]);

  // Seed editable state when the selected note changes (not on every notes
  // mutation — guarded by lastLoadedId so autosave round-trips don't clobber
  // in-progress edits).
  useEffect(() => {
    if (noteId == null) { lastLoadedId.current = null; return; }
    if (lastLoadedId.current === noteId) return;
    void flushSave().catch(() => {});
    const n = notes.find(x => x.id === noteId);
    if (!n) return;
    lastLoadedId.current = noteId;
    deferredChange.current = null;
    setTitle(n.title || '');
    setContent(n.content || '');
    setIndexNavigation(null);
    setIndexEntries(Array.isArray(n.book_index_entries) ? n.book_index_entries : []);
    setLoadedNoteId(noteId);
    setSaveStatus('idle');
    const count = splitBookPages(n.content || '').length;
    const savedIndex = Number.isInteger(n.last_page_index) && n.last_page_index >= 0 ? n.last_page_index : 0;
    rememberedPage.current = { id: noteId, index: Math.min(savedIndex, count - 1) };
    setPageIndex(Math.min(Number.isInteger(requestedPage) && requestedPage >= 0 ? requestedPage : savedIndex, count - 1));
    setShowPages(false);
    setShowBookIndex(false);
  }, [noteId, notes, flushSave, requestedPage]);

  // Flush any pending save on unmount.
  useEffect(() => () => { void flushSave().catch(() => {}); }, [flushSave]);

  const scheduleSave = useCallback((updates) => {
    const id = noteId;
    if (!id) return;
    setSaveStatus('saving');
    pendingSave.current.set(id, { ...pendingSave.current.get(id), ...updates });
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void flushSave().catch(() => {}); }, 600);
  }, [noteId, flushSave]);

  const handleIndexEntriesChange = useCallback((entries) => {
    setIndexEntries(entries);
    scheduleSave({ book_index_entries: entries });
  }, [scheduleSave]);

  // ── Book ──
  // Pages are not a separate record. They are this note's own content split on
  // its page-break sentinels, so every page edit saves through the same field a
  // one-page note has always used.
  const pages = useMemo(() => {
    const next = splitBookPages(content);
    // Legacy books predate per-page titles. Treat the existing note title as
    // page one's title in memory; the metadata is persisted with the next edit.
    if (!hasPageTitle(next[0])) {
      next[0] = setPageTitle(next[0], title.trim() === 'Untitled Note' ? '' : title);
    }
    return next;
  }, [content, title]);
  const safePageIndex = Math.max(0, Math.min(pageIndex, pages.length - 1));
  const pageCountRef = useRef(pages.length);
  pageCountRef.current = pages.length;
  // A resume/deep link can target another page of the already mounted book.
  useEffect(() => {
    if (loadedNoteId !== noteId || !Number.isInteger(requestedPage) || requestedPage < 0) return;
    setPageIndex(Math.min(requestedPage, pageCountRef.current - 1));
  }, [requestedPage, noteId, loadedNoteId]);
  useEffect(() => {
    if (!isActiveTab || loadedNoteId !== noteId || rememberedPage.current?.id !== noteId) return;
    onPageChangeRef.current?.({ noteId, index: safePageIndex });
    if (rememberedPage.current.index === safePageIndex) return;
    rememberedPage.current.index = safePageIndex;
    // Position shares the note's existing serialized save queue, so refreshing
    // flushes it together with any writing instead of resetting to page one.
    scheduleSave({ last_page_index: safePageIndex });
  }, [isActiveTab, loadedNoteId, noteId, safePageIndex, scheduleSave]);
  const isBookNote = pages.length > 1;
  const isLastBookPage = safePageIndex === pages.length - 1;
  const canAddBookPage = pages.length < MAX_PAGES;
  const pageTitle = getPageTitle(pages[safePageIndex]);
  const isPageUntitled = !pageTitle.trim() || pageTitle.trim() === 'Untitled Note';

  // Background tabs use display:none, so scrollHeight there is zero. Measure
  // after activation, before paint, and never persist a zero-height heading.
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el || !isActiveTab) return;
    let alive = true;
    const measure = () => {
      if (!alive) return;
      el.style.height = 'auto';
      if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    document.fonts?.addEventListener('loadingdone', measure);
    document.fonts?.ready.then(measure);
    return () => {
      alive = false;
      observer.disconnect();
      document.fonts?.removeEventListener('loadingdone', measure);
    };
  }, [isActiveTab, noteId, loadedNoteId, pageTitle, textSize]);

  // Search the whole book, but mount only the destination's editor. This also
  // handles older search links that did not carry a page number.
  useEffect(() => {
    if (!isActiveTab || !spotlightToken || !spotlightQuery || loadedNoteId !== noteId) return;
    if (spotlightLanding?.token === spotlightToken && spotlightLanding.noteId === noteId) return;
    const query = spotlightQuery.toLocaleLowerCase();
    const fallback = spotlightField === 'title' ? 0
      : pages.findIndex(page => toPlainSearchText(page).toLocaleLowerCase().includes(query));
    const target = Number.isInteger(spotlightPage) && spotlightPage >= 0 && spotlightPage < pages.length
      ? spotlightPage : Math.max(0, fallback);
    setShowPages(false);
    setShowBookIndex(false);
    setIndexNavigation(null);
    setSpotlightLanding({ token: spotlightToken, noteId, page: target, done: false });
  }, [isActiveTab, loadedNoteId, noteId, pages, spotlightField, spotlightLanding, spotlightPage, spotlightQuery, spotlightToken]);

  const completeSpotlight = useCallback((token) => {
    setSpotlightLanding(current => current?.token === token ? { ...current, done: true } : current);
    spotlightCompleteRef.current?.(token);
  }, []);
  const isSpotlightPage = spotlightLanding?.token === spotlightToken
    && spotlightLanding.noteId === noteId && spotlightLanding.page === safePageIndex && !spotlightLanding.done;

  useEffect(() => {
    if (!isActiveTab || !isSpotlightPage || isTurning || spotlightField !== 'title') return undefined;
    let trip;
    let disposed = false;
    const timer = window.setTimeout(() => {
      trip = startFieldSpotlight(titleRef.current, spotlightQuery);
      trip.finished.finally(() => { if (!disposed) completeSpotlight(spotlightToken); });
    }, 32);
    return () => { disposed = true; window.clearTimeout(timer); trip?.cancel(); };
  }, [completeSpotlight, isActiveTab, isSpotlightPage, isTurning, spotlightField, spotlightQuery, spotlightToken]);

  // Page breaks are the source of truth. Adding the first break turns the tab's
  // notepad into a book immediately; removing back to one page reverses it.
  useTabBookStatus(isBookNote, { enabled: Boolean(note) });

  // The index belongs to the opening leaf only. Leaving page one closes it,
  // so returning to the front never exposes a stale open panel by surprise.
  useEffect(() => {
    if (safePageIndex !== 0) setShowBookIndex(false);
  }, [safePageIndex]);

  const handlePagesChange = useCallback((nextPages, nextIndex) => {
    const joined = joinBookPages(nextPages);
    const nextBookTitle = getPageTitle(nextPages[0], 'Untitled Note').trim() || 'Untitled Note';
    const currentBookTitle = title.trim() || 'Untitled Note';
    const updates = { content: joined };
    setContent(joined);
    // The note record is the book's sidebar/search identity. It follows page
    // one only — editing page two or three can never rename the whole book.
    if (nextBookTitle !== currentBookTitle) {
      setTitle(nextBookTitle);
      updates.title = nextBookTitle;
    }
    scheduleSave(updates);
    if (Number.isInteger(nextIndex)) setPageIndex(nextIndex);
  }, [scheduleSave, title]);

  const handlePageTitleChange = useCallback((value) => {
    const nextPages = [...pages];
    nextPages[safePageIndex] = setPageTitle(nextPages[safePageIndex], value);
    handlePagesChange(nextPages, safePageIndex);
  }, [handlePagesChange, pages, safePageIndex]);

  const completeIndexNavigation = useCallback(token => {
    setIndexNavigation(current => current?.token === token ? null : current);
  }, []);
  const handleIndexNavigate = useCallback((index, destination = { kind: 'title' }) => {
    if (!Number.isInteger(index) || index < 0 || index >= pages.length) return;
    setIndexNavigation({ ...destination, page: index, token: crypto.randomUUID() });
    setSpotlightLanding(current => current ? { ...current, done: true } : current);
    setShowBookIndex(false);
    window.requestAnimationFrame(() => {
      const canvas = documentScrollRef.current;
      if (!canvas) return;
      if (typeof canvas.scrollTo === 'function') canvas.scrollTo({ top: 0, behavior: 'smooth' });
      else canvas.scrollTop = 0;
    });
    const navigator = bookSurfaceRef.current;
    if (navigator?.goToPage) navigator.goToPage(index, { multi: true });
    else setPageIndex(index);
  }, [pages.length]);

  const handleDeletePages = useCallback(async (indices) => {
    if (!indices?.length) return;
    const ok = await confirmDialog({
      title: indices.length === 1
        ? `Delete page ${indices[0] + 1}?`
        : `Delete ${indices.length} pages?`,
      description: 'The writing on these pages, and their footnotes, are removed from the book. This cannot be undone.',
      confirmText: indices.length === 1 ? 'Delete page' : `Delete ${indices.length} pages`,
      cancelText: 'Keep',
      tone: 'danger',
    });
    if (!ok) return;
    const { pages: nextPages, index, removed } = removePages(pages, indices, safePageIndex);
    const removedIndices = new Set(indices);
    const remainingOrder = pages.map((_, i) => i).filter(i => !removedIndices.has(i));
    handleIndexEntriesChange(remapIndexEntries(indexEntries, remainingOrder));
    handlePagesChange(nextPages, index);
    setShowPages(false);
    toast.success(removed === 1 ? 'Page deleted' : `${removed} pages deleted`);
  }, [handlePagesChange, handleIndexEntriesChange, indexEntries, pages, safePageIndex]);

  const handleAddPageFromOverview = useCallback(() => {
    if (pages.length >= MAX_PAGES) {
      toast.info(`Books can hold up to ${MAX_PAGES} pages.`);
      return;
    }
    // The overview is a book-organising surface, so append the new leaf and
    // leave the overview open instead of interrupting the job by entering it.
    const { pages: nextPages } = insertPageAfter(pages, pages.length - 1);
    handlePagesChange(nextPages, safePageIndex);
    toast.success('Page added');
  }, [handlePagesChange, pages, safePageIndex]);

  const handleMovePage = useCallback((from, to) => {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return;
    const nextPages = movePage(pages, from, to);
    const order = pages.map((_, i) => i);
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    handleIndexEntriesChange(remapIndexEntries(indexEntries, order));
    const nextIndex = pageIndexAfterMove(safePageIndex, from, to, pages.length);
    handlePagesChange(nextPages, nextIndex);
  }, [handlePagesChange, handleIndexEntriesChange, indexEntries, pages, safePageIndex]);

  const handlePreviousPage = useCallback(() => {
    if (safePageIndex <= 0) return;
    // Keep the familiar arrows immediate. The wheel and index own animated
    // jumps; an arrow must never be swallowed because a prior turn is settling.
    setPageIndex(safePageIndex - 1);
  }, [safePageIndex]);

  const handleNextPage = useCallback(() => {
    if (isLastBookPage && !canAddBookPage) return;
    if (!isLastBookPage) {
      setPageIndex(safePageIndex + 1);
      return;
    }
    const navigator = bookSurfaceRef.current;
    if (navigator?.advancePage) {
      navigator.advancePage();
      return;
    }
    const { pages: nextPages, index } = insertPageAfter(pages, safePageIndex);
    handlePagesChange(nextPages, index);
  }, [canAddBookPage, handlePagesChange, isLastBookPage, pages, safePageIndex]);

  const handleWheelPageSelect = useCallback((index) => {
    if (!Number.isInteger(index) || index < 0 || index >= pages.length) return;
    const navigator = bookSurfaceRef.current;
    if (navigator?.goToPage) {
      navigator.goToPage(index, { multi: Math.abs(index - safePageIndex) > 1 });
    } else {
      setPageIndex(index);
    }
  }, [pages.length, safePageIndex]);

  const handleExportPages = useCallback((indices) => {
    if (!indices?.length) return;
    try {
      exportPagesToMarkdown({ title: title || 'Untitled Note', pages, indices });
      toast.success(indices.length === 1 ? 'Page exported' : `${indices.length} pages exported`);
    } catch {
      toast.error('Could not export those pages.');
    }
  }, [pages, title]);

  const handleExportNote = async () => {
    if (exportingRef.current || !note || loadedNoteId !== noteId) return;
    const targetId = noteId;
    exportingRef.current = true;
    setExporting(true);
    try {
      await waitForNoteExportSaves();
      const artifact = await buildCurrentNoteExport(targetId);
      const result = await saveExportFile(new Blob([artifact.content], { type: artifact.type }), artifact.fileName);
      if (result.status === 'saved') toast.success('Note exported');
    } catch (error) {
      toast.error(error?.message || 'Could not export the current note.');
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    if (!note) return;
    const ok = await confirmDialog({
      title: `Delete "${note.title || 'Untitled Note'}"?`,
      description: 'This permanently deletes the note and removes all of its links. This cannot be undone.',
      confirmText: 'Delete note',
      confirmDelaySeconds: 5,
      cancelText: 'Keep',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await desktopClient.entities.MindNote.delete(note.id);
      onNoteDeleted?.(note.id);
      toast.success('Note deleted');
    } catch {
      toast.error('Could not delete note.');
    }
  };

  const handleCopyPage = () => {
    try {
      const heading = isPageUntitled ? (safePageIndex === 0 ? 'Untitled Note' : 'Untitled Page') : pageTitle;
      const copied = copyNotePage(pages[safePageIndex], heading, footnoteOffsets(pages)[safePageIndex] || 0, bodyEditorRef.current);
      if (copied) announceCopy('Page and title copied');
      else announceCopyFailed('Could not copy page');
    } catch {
      announceCopyFailed('Could not copy page');
    }
  };

  const handleCopyLink = () => {
    if (isTurning || loadedNoteId !== noteId) return;
    try {
      const copied = copyNoteLink({ id: noteId, title }, safePageIndex, isPageUntitled ? '' : pageTitle);
      if (copied) announceCopy('Note link copied');
      else announceCopyFailed('Could not copy note link');
    } catch { announceCopyFailed('Could not copy note link'); }
  };

  if (!note) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 bg-[#0f111a]">
        <div className="text-center">
          <NotebookPen className="w-12 h-12 text-gray-700 mx-auto mb-3" />
          <p className="text-sm">This note could not be found.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 min-w-0 bg-[#0f111a] flex flex-col min-h-0"
      data-bex-local-find-shortcut="true"
    >
      {/* Quiet top bar — save status, page controls, delete */}
      <div className="bex-note-toolbar flex items-center justify-between gap-2 px-4 py-2.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopyPage}
          disabled={isTurning}
          className="h-8 gap-1.5 px-2 text-gray-400 hover:text-white"
          title="Copy page and title"
          aria-label="Copy page and title"
          data-testid="button-copy-note-page"
        >
          <Copy className="h-4 w-4" />
          Copy
        </Button>
        <button
          type="button"
          onClick={handleExportNote}
          disabled={exporting || loadedNoteId !== noteId}
          aria-busy={exporting}
          aria-label="Export note"
          title="Export the current note as Markdown"
          className={`${buttonVariants({ variant: 'ghost', size: 'sm' })} h-8 gap-1.5 px-2 text-gray-400 hover:text-white`}
          data-testid="button-export-note"
        >
          <Download className="h-4 w-4" />
          {exporting ? 'Exporting…' : 'Export'}
        </button>
        <button
          type="button"
          onClick={handleCopyLink}
          disabled={isTurning || loadedNoteId !== noteId}
          aria-label="Copy link to note"
          title="Copy a hyperlink to this note and current page"
          className={`${buttonVariants({ variant: 'ghost', size: 'sm' })} h-8 gap-1.5 px-2 text-gray-400 hover:text-white`}
          data-testid="button-copy-note-link"
        >
          <Link2 className="h-4 w-4" aria-hidden="true" />
          Link
        </button>
        <SaveBadge status={saveStatus} />

        {/* Paging appears only once a note has actually become a book. A
            one-page note has nothing to page through and shows nothing. */}
        {isBookNote && (
          <div className="ml-auto flex items-center gap-0.5" data-testid="book-page-controls">
            {safePageIndex === 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowBookIndex(current => !current)}
                aria-pressed={showBookIndex}
                className={`mr-1 h-8 gap-1.5 px-2.5 text-xs ${
                  showBookIndex
                    ? 'bg-violet-400/10 text-violet-200 hover:bg-violet-400/15 hover:text-violet-100'
                    : 'text-gray-500 hover:text-white'
                }`}
                title="Index"
                data-testid="button-book-index"
              >
                <ListTree className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Index</span>
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              disabled={safePageIndex === 0}
              onClick={handlePreviousPage}
              className="h-8 w-8 text-gray-500 hover:text-white disabled:opacity-30"
              title="Previous page"
              data-testid="button-page-previous"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <PageWheelPicker
              pages={pages}
              pageIndex={safePageIndex}
              onSelect={handleWheelPageSelect}
            />
            <Button
              variant="ghost"
              size="icon"
              disabled={isLastBookPage && !canAddBookPage}
              onClick={handleNextPage}
              className={`h-8 w-8 transition-all disabled:opacity-30 ${
                isLastBookPage && canAddBookPage
                  ? 'bg-violet-500/15 text-violet-300 ring-1 ring-violet-400/30 shadow-[0_0_18px_rgba(139,92,246,0.16)] hover:bg-violet-500/25 hover:text-violet-100'
                  : 'text-gray-500 hover:text-white'
              }`}
              title={isLastBookPage && canAddBookPage ? 'Create the next page' : 'Next page'}
              aria-label={isLastBookPage && canAddBookPage ? 'Create the next page' : 'Next page'}
              data-creates-page={isLastBookPage && canAddBookPage ? 'true' : 'false'}
              data-testid="button-page-next"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowPages(true)}
              className="h-8 w-8 text-gray-500 hover:text-white"
              title="All pages"
              data-testid="button-page-overview"
            >
              <LayoutGrid className="w-4 h-4" />
            </Button>
          </div>
        )}

        <div
          className={`${isBookNote ? '' : 'ml-auto '}rounded-lg border border-gray-800/80 bg-gray-900/45 px-2 py-1`}
          title="Text size"
        >
          <TextSizeControl
            value={textSize}
            onChange={setTextSize}
            ariaLabel="Note text size"
            testId="note-text-size"
          />
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={handleDelete}
          // ml-auto, not just justify-between: the save badge renders nothing
          // when idle, and a lone child under justify-between sits at the START
          // — which parked delete on the left, where the sidebar toggle now
          // floats. This keeps it on the right whether or not the badge shows.
          className="h-8 w-8 text-gray-500 hover:text-red-500 hover:bg-red-900/20"
          data-testid="button-delete-note"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>

      {/* Document canvas — centered, borderless, lots of breathing room */}
      <div ref={documentScrollRef} className="flex-1 min-h-0 overflow-auto" style={{ touchAction: 'pan-x pan-y' }} data-testid="note-zoom-viewport" data-bex-marquee-surface>
        <div ref={documentPageRef} className="mx-auto px-6 sm:px-9 py-12 sm:py-16" data-testid="note-zoom-page">
          {/* Title — reads like page text, not an input. An untitled note
              shows its name as ghost text rather than as real content, so the
              page doesn't open with a heading you never wrote. */}
          <textarea
            ref={titleRef}
            value={isPageUntitled ? '' : pageTitle}
            onChange={(e) => handlePageTitleChange(e.target.value)}
            onKeyDown={handleTitleKeyDown}
            placeholder={safePageIndex === 0 ? 'Untitled Note' : 'Untitled Page'}
            rows={1}
            className="bex-spotlight-field w-full resize-none overflow-hidden bg-transparent border-0 p-0 text-4xl font-bold leading-tight tracking-tight text-white placeholder:text-gray-600/70 focus:outline-none focus:ring-0"
            style={{ fontSize: 'var(--bex-note-title-size, 36px)', minHeight: '1.25em' }}
            data-testid="input-note-title"
          />

          <BookIndex
            key={noteId}
            entries={indexEntries}
            onEntriesChange={handleIndexEntriesChange}
            open={isBookNote && safePageIndex === 0 && showBookIndex}
            pages={pages}
            onGoToPage={handleIndexNavigate}
          />

          {/* Body — the page itself. Every note is page one of a book it has
              not been split into yet, which is why the cut line is always
              there: pressing it is what turns the note into a book. */}
          <div className="mt-6 kw-note-body" data-testid="textarea-note-content">
            <BookSurface
              key={noteId}
              ref={bookSurfaceRef}
              noteId={noteId}
              pages={pages}
              pageIndex={safePageIndex}
              onPagesChange={handlePagesChange}
              onPageIndexChange={setPageIndex}
              indexNavigation={isActiveTab ? indexNavigation : null}
              onIndexNavigationComplete={completeIndexNavigation}
              onEditorReady={(instance) => { bodyEditorRef.current = instance; }}
              spotlightQuery={isSpotlightPage && spotlightField === 'body' ? spotlightQuery : ''}
              spotlightToken={spotlightToken}
              onSpotlightComplete={completeSpotlight}
              spotlightPage={isActiveTab && spotlightLanding?.token === spotlightToken && !spotlightLanding.done ? spotlightLanding.page : null}
              onTurnStateChange={setIsTurning}
            />
          </div>

        </div>
      </div>

      <BookOverview
        open={showPages}
        title={title}
        pages={pages}
        pageIndex={safePageIndex}
        onClose={() => setShowPages(false)}
        onGoToPage={(index) => { setPageIndex(index); setShowPages(false); }}
        onAddPage={handleAddPageFromOverview}
        onMovePage={handleMovePage}
        onDeletePages={handleDeletePages}
        onExportPages={handleExportPages}
      />
    </div>
  );
}

function SaveBadge({ status }) {
  if (status === 'unsaved') return <span className="text-xs text-amber-400">Unsaved changes</span>;
  if (status === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
        <Save className="w-3.5 h-3.5 animate-pulse" /> Saving…
      </span>
    );
  }
  if (status === 'saved') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-green-400">
        <Check className="w-3.5 h-3.5" /> Saved
      </span>
    );
  }
  // Idle has nothing worth saying — the word "Note" was just noise.
  return null;
}
