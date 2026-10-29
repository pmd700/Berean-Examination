import React, { useState, useEffect, useRef, useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import InterlinearReveal from '../components/interlinear/InterlinearReveal';
import { desktopClient } from '@/api/desktopClient';
import { platformEntities } from '@/lib/platform/entities';
import { platformFunctions } from '@/lib/platform/functions';
import { Button, buttonVariants } from "@/components/ui/button";

import TEXT_EDITOR_MACHINERY from '../components/editor/TEXT_EDITOR_MACHINERY';
import { useAutoSave } from '../components/editor/useAutoSave';
import {
  Edit2, FileText, PenLine, Send, Lock, Copy, ArrowUp, ArrowDown, Trash2, Check, Loader2, AlertCircle
} from 'lucide-react';
import BibleVersionSelector from '../components/study/BibleVersionSelector';
import { readInitialBibleId, useFavoriteBible } from '@/lib/favoriteBible';
import ScriptureSearch from '../components/scripture/ScriptureSearch';
import { writeClipboardText } from '@/lib/writeClipboardText';
import { formatScriptureCopy } from '@/lib/scriptureCopy';
import { selectedScriptureTokens } from '@/lib/scriptureSelection';
import { buildInlineVerseParts } from '@/lib/inlineVerseNotes';
import { useAnnotationDisplayPreference } from '@/lib/annotationDisplayPreference';
import AnnotationGutter from '@/components/study/AnnotationGutter';
import ScriptureWorkspace from '@/components/study/ScriptureWorkspace';
import StudyCanvasTools from '@/components/study/StudyCanvasTools';
import StudyPageFind from '@/components/study/StudyPageFind';
import { studyVerseKey } from '@/lib/studyCanvas';
import useScriptureSearchSession from '@/components/scripture/useScriptureSearchSession';
import ScriptureRequestState from '@/components/scripture/ScriptureRequestState';
import { buildStudyChapterFromBatch } from '@/lib/apiBibleToStudyBlocks';
import { persistApiStudyChapter, studyLocator, studyView, annotationHasContent, isApiStudyRecord } from '@/lib/studyPersistence';
import { LoadingScreen } from '../components/ui/loading-screen';
import { toast } from 'sonner';
import { createPageUrl } from '@/utils';
import { parsePreparedText } from '../components/utils/chapterParser';
import { parseLsvPreparedText, isLsvSpecialSection } from '../components/utils/lsvParser';
import ProgressTracker from '../components/progress/ProgressTracker';
import { Toaster } from '@/components/ui/sonner';
import SelectionPopover from '../components/scripture/SelectionPopover';
import KeywordPreview from '../components/editor/KeywordPreview';
import AnnotationPreview from '../components/editor/AnnotationPreview';
import UnsavedChangesDialog from '../components/editor/UnsavedChangesDialog';
import DrawingEditor from '../components/drawing/DrawingEditor';
import AnnotationWindow from '../components/study/AnnotationWindow';
import { trackActivity } from '../components/utils/activityTracker';
import TextSizeControl, { getScriptureTextClass, getVerseNumberClass, getHeaderClass, useTextSizePreference, useScriptureNotesTextSizePreference } from '../components/scripture/TextSizeControl';
import AnnotationsListModal from '../components/study/AnnotationsListModal';
import InterlinearSettings from '../components/interlinear/InterlinearSettings';
import InterlinearVerse from '../components/interlinear/InterlinearVerse';
import useInterlinearChapter from '../components/interlinear/useInterlinearChapter';
import Card3DTilt from '../components/shaders/Card3DTilt';
import VerseBibleHubButton from '../components/study/VerseBibleHubButton';
import { getBibleHubVerseUrl } from '../components/utils/bibleHub';
import RichChapterView from '../components/bible/RichChapterView';
import FootnotePopover from '../components/bible/FootnotePopover';
import { useI18n } from '../components/utils/I18nContext';
import { isRemovedTranslation, getRemovedTranslationMessage, NASB1995_API_BIBLE_ID, NASB2020_API_BIBLE_ID } from '@shared/removedTranslations';
import {
  ESV_STUDY_EXPORT_BLOCK_MESSAGE,
  getStudyExportRightsNotice,
  isStudyMaterialExportAllowed,
} from '@/lib/bibleStudyExportPolicy';
import { readLocalOwner } from '@/lib/localOwner';
import { listAllChapterArt } from '@/lib/chapterArtRegistry';
import { Link, useNavigate } from 'react-router-dom';
import ExternalWebLink from '@/components/navigation/ExternalWebLink';
import { useCurrentWorkspaceTab, useTabTitle } from '@/lib/WorkspaceTabs';
import { commentaryLinkLabel, commentaryVersionLabel, copyCommentaryContent, copyCommentaryLink, parseCommentaryLinkTarget, revealAnnotation } from '@/lib/commentaryLink';

function GutterSaveStatus({ saving, dirty, error }) {
  const pending = saving || dirty;
  const label = error ? `Save failed: ${error}. Use Done to retry.` : saving ? 'Saving…' : dirty ? 'Waiting to save…' : 'Saved';
  return <span role="status" aria-label={label} title={label} data-save-status={error ? 'error' : pending ? 'pending' : 'saved'}>
    {error ? <AlertCircle size={16} aria-hidden="true" /> : pending ? <Loader2 size={16} className="motion-safe:animate-spin" aria-hidden="true" /> :
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-saved-card-icon>
        <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" />
        <path d="M8 3v5m4-5v5m4-3v3M8 14h8v5H8z" />
      </svg>}
  </span>;
}

function ScriptureAttribution({ material }) {
  const notice = getStudyExportRightsNotice(material);
  if (!notice) return null;
  const lines = notice.split('\n').map((line) => line.trim()).filter(Boolean);
  const textLines = lines.filter((line) => !/^https:\/\//i.test(line));
  const urls = lines.filter((line) => /^https:\/\//i.test(line));

  return (
    <footer
      className="mt-10 border-t border-line pt-4 text-[0.68rem] leading-relaxed text-ink-faint"
      data-testid="text-scripture-attribution"
    >
      <p>{textLines.join(' ')}</p>
      {urls.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {urls.map((url, index) => (
            <ExternalWebLink
              key={url}
              href={url}
              className="underline decoration-ink-faint/50 underline-offset-2 hover:text-ink-muted"
            >
              {index === 0 ? 'Source and rights' : 'Additional license'}
            </ExternalWebLink>
          ))}
        </div>
      )}
    </footer>
  );
}

export default function Study() {
  const studyPageRef = useRef(null);
  const navigate = useNavigate();
  const currentWorkspaceTab = useCurrentWorkspaceTab();
  const { tr } = useI18n();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [textSize, setTextSize] = useTextSizePreference();
  const [notesTextSize, setNotesTextSize] = useScriptureNotesTextSizePreference();
  const { style: annotationDisplay } = useAnnotationDisplayPreference();
  const [hasGutterAnnotations, setHasGutterAnnotations] = useState(false);
  const isOwnerUser = user?.is_local_owner === true;

  const [stage, setStage] = useState('progress');
  const [interlinearEnabled, setInterlinearEnabled] = useState(false);
  const [interlinearSource, setInterlinearSource] = useState('SBLGNT');

  const [currentChapter, setCurrentChapter] = useState(null);
  const commentaryEdition = commentaryVersionLabel({ version: currentChapter?.api_bible_id ? `API:${currentChapter.api_bible_id}` : currentChapter?.version }, currentChapter?.version);
  const [favoriteBible, , favoriteReady] = useFavoriteBible();
  const [selectedBibleId, setSelectedBibleId] = useState(readInitialBibleId);
  useEffect(() => {
    if (localStorage.getItem('bex_scripture_selected_bible_id')?.toLowerCase() === 'nasb2020') {
      localStorage.setItem('bex_scripture_selected_bible_id', NASB2020_API_BIBLE_ID);
    }
  }, []);
  const [redLetters, setRedLetters] = useState(() => {
    const saved = localStorage.getItem('bex_scripture_red_letters');
    return saved !== null ? saved === 'true' : true;
  });
  const [currentSearchQuery, setCurrentSearchQuery] = useState('');
  useEffect(() => {
    if (favoriteReady && favoriteBible?.id && !currentSearchQuery && !currentChapter) setSelectedBibleId(favoriteBible.id);
  }, [favoriteReady, favoriteBible?.id, currentSearchQuery, currentChapter]);
  const { search, start: startSearch, cancel: cancelSearch, retry: retrySearch, clear: clearSearch, isCurrent: isCurrentSearch } = useScriptureSearchSession();
  const [studyReadError, setStudyReadError] = useState('');
  const hydrationRef = useRef(0);
  const viewIntentRef = useRef(0);
  const mountedRef = useRef(true);
  const chapterRef = useRef(null);
  const readerRef = useRef(null);
  const [readerNeedsScroll, setReaderNeedsScroll] = useState(false);
  useEffect(() => {
    const reader = readerRef.current;
    if (!reader || stage !== 'view') return;
    const passage = reader.querySelector('[data-scripture-root]');
    if (!passage) return;
    const pane = reader.closest('.bex-tab-pane') || document.scrollingElement;
    if (!pane) return;
    const canvas = annotationDisplay === 'gutter' ? reader.closest('.bex-scripture-viewport') : null;
    let frame;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // These shortcuts navigate Scripture. Search controls, attribution,
        // the buttons themselves and long gutter notes must not trigger them.
        // Compare heights rather than the passage's current scroll position.
        const availableHeight = canvas ? canvas.clientHeight : pane.clientHeight;
        setReaderNeedsScroll(availableHeight > 0 && passage.getBoundingClientRect().height > availableHeight + 2);
      });
    };
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(passage);
    observer?.observe(pane);
    if (canvas) observer?.observe(canvas);
    canvas?.addEventListener('scripture-workspace-pan', measure);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      canvas?.removeEventListener('scripture-workspace-pan', measure);
      window.removeEventListener('resize', measure);
    };
  }, [stage, currentChapter?.id, annotationDisplay]);
  const scrollReader = (edge) => {
    const reader = readerRef.current;
    if (!reader) return;
    if (annotationDisplay === 'gutter') {
      reader.dispatchEvent(new CustomEvent('scripture-workspace-center', {
        bubbles: true, detail: { target: reader, align: edge, axis: 'vertical' },
      }));
      return;
    }
    const pane = reader.closest('.bex-tab-pane') || document.scrollingElement;
    if (!pane) return;
    const readerBounds = reader.getBoundingClientRect();
    const paneTop = pane === document.scrollingElement ? 0 : pane.getBoundingClientRect().top;
    const top = edge === 'top'
      ? pane.scrollTop + readerBounds.top - paneTop - 16
      : pane.scrollTop + readerBounds.bottom - paneTop - pane.clientHeight + 16;
    pane.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };
  chapterRef.current = currentChapter;
  const annotationChapterRef = useRef(null);
  const [annotations, setAnnotations] = useState([]);

  const [userChapters, setUserChapters] = useState([]);
  const [allAnnotations, setAllAnnotations] = useState([]);
  const [keywords, setKeywords] = useState([]);

  const [selectionStart, setSelectionStart] = useState(null);
  const [selectionEnd, setSelectionEnd] = useState(null);
  const [richVerses, setRichVerses] = useState(null);
  const [showTextualNotes, setShowTextualNotes] = useState(true);
  const [debugSegments, setDebugSegments] = useState(false);
  const richChapterIdRef = useRef(null);
  const [isShiftPressed, setIsShiftPressed] = useState(false);

  const [showAnnotationPopup, setShowAnnotationPopup] = useState(false);
  const [annotationContent, setAnnotationContent] = useState('');
  const [editingAnnotation, setEditingAnnotation] = useState(null);
  const annotationRecordRef = useRef(null);
  const newGutterAnnotationRef = useRef(null);
  const openingAnnotationRef = useRef(false);
  const [savingAnnotation, setSavingAnnotation] = useState(false);
  const [annotationSaveError, setAnnotationSaveError] = useState(null);
  const savingAnnotationRef = useRef(false);
  const [capturedSelectedText, setCapturedSelectedText] = useState('');

  const [showAnnotationsModal, setShowAnnotationsModal] = useState(false);

  const [isDragging, setIsDragging] = useState(false);
  const [activeVerseId, setActiveVerseId] = useState(null);

  const [showSelectionPopover, setShowSelectionPopover] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState({ x: 0, y: 0 });
  const [popoverCopied, setPopoverCopied] = useState(false);
  const [storedSelectionText, setStoredSelectionText] = useState('');
  const [storedSelectionData, setStoredSelectionData] = useState(null);

  const [keywordPreview, setKeywordPreview] = useState(null);
  const [annotationPreview, setAnnotationPreview] = useState(null);
  const annotationPreviewTimer = useRef(null);

  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [pendingSaveFunction, setPendingSaveFunction] = useState(null);

  const [highlights, setHighlights] = useState([]);

  const [showDrawingEditor, setShowDrawingEditor] = useState(false);
  const [currentDrawing, setCurrentDrawing] = useState(null);
  const [annotationDrawings, setAnnotationDrawings] = useState({});

  const {
    interlinearVerses,
    isLoadingInterlinear,
    effectiveSource: interlinearEffectiveSource,
    attribution: interlinearAttribution,
    error: interlinearError,
    isOldTestament,
    isNewTestament: isNewTestamentChapter,
  } = useInterlinearChapter(currentChapter, interlinearEnabled, interlinearSource);

  // Name the tab after the chapter being read, so two open Bible Study tabs are told
  // apart. Follows the loaded chapter rather than the book/chapter pickers —
  // those move while the user is still choosing.
  useTabTitle(
    currentChapter?.book
      ? (currentChapter.title || `${currentChapter.book} ${currentChapter.chapter_number}`)
      : '',
  );

  const { saveStatus: annotationSaveStatus, hasUnsavedChanges: hasUnsavedAnnotation, resetSaveState: resetAnnotationSave, flushSave: flushAnnotationSave } = useAutoSave({
    content: annotationContent,
    initialContent: editingAnnotation?.content || '',
    onSave: async content => {
      setAnnotationSaveError(null);
      try { await persistAnnotationContent(content); }
      catch (error) { setAnnotationSaveError(error.message || 'Could not save the annotation'); throw error; }
    },
    delay: 400,
    maxWait: 1500,
    enabled: showAnnotationPopup
  });

  useEffect(() => {
    let active = true;
    mountedRef.current = true;

    const openForLocalOwner = async () => {
      try {
        const localOwner = await readLocalOwner();
        if (!active) return;

        setUser(localOwner);
        setLoading(false);
        setInterlinearEnabled(localOwner.interlinear_mode === true);
        setInterlinearSource(localOwner.interlinear_source || 'SBLGNT');
        // Routing waits for this owner check, so a commentary's source can be
        // resolved once before any default-edition request is made.
        if (active) await loadUserChapters();
      } catch (error) {
        console.error('[Study] local owner check failed:', error);
      } finally {
        if (active) setLoading(false);
      }
    };

    openForLocalOwner();
    return () => {
      active = false;
      mountedRef.current = false;
      viewIntentRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!user || !favoriteReady) return undefined;
    let active = true;
    const intent = ++viewIntentRef.current;
    const fresh = () => active && mountedRef.current && viewIntentRef.current === intent;
    const queryString = currentWorkspaceTab?.path?.split('?')[1] || window.location.search;
    const query = new URLSearchParams(queryString);
    const open = async () => {
      if (query.get('chapter_id')) { await loadChapterById(query.get('chapter_id')); return; }
      const q = query.get('q');
      if (!q) return;
      const target = parseCommentaryLinkTarget(queryString);
      let version = target?.version || query.get('version');
      let source;
      if (target) {
        // Older copied links omitted the edition. The stored note is the
        // authority when present, even if a URL supplied a different edition.
        const notes = await platformEntities.Annotation.filter({ id: target.annotationId });
        if (!fresh()) return;
        const note = notes[0];
        if (note) {
          version = note.version;
          if (!version.startsWith('API:')) {
            const chapters = await platformEntities.StudyChapter.filter({ book: note.book, chapter_number: note.chapter_number, version });
            if (!fresh()) return;
            source = chapters[0];
          }
        }
      }
      if (!fresh()) return;
      const bibleId = version?.startsWith('API:') ? version.slice(4) : source?.api_bible_id
        || (version === 'NASB1995' ? NASB1995_API_BIBLE_ID : null);
      if (bibleId) {
        setSelectedBibleId(bibleId);
        loadScriptureQuery(q, bibleId, source?.display_version);
      } else if (source) {
        const chapter = studyView(source);
        clearSearch();
        await loadAnnotations(chapter, fresh);
        if (!fresh()) return;
        setCurrentSearchQuery(q);
        setCurrentChapter(chapter);
        setStage('view');
      } else {
        if (version && !version.startsWith('API:')) throw new Error('This commentary’s saved Bible edition could not be found.');
        const defaultBibleId = currentSearchQuery ? selectedBibleId : favoriteBible?.id || selectedBibleId;
        setSelectedBibleId(defaultBibleId);
        loadScriptureQuery(q, defaultBibleId);
      }
    };
    void open().catch(error => { if (fresh()) toast.error(error.message || 'Could not open the commentary’s Bible edition.'); });
    return () => { active = false; };
  }, [currentWorkspaceTab?.path, user, favoriteReady]);

  // A commentary link (/Study?q=...&annotation_id=...) names the card to bring
  // into view once the passage and its annotations have loaded.
  const [commentaryFocus, setCommentaryFocus] = useState(null);
  useEffect(() => {
    const queryString = currentWorkspaceTab?.path?.split('?')[1] || window.location.search;
    setCommentaryFocus(parseCommentaryLinkTarget(queryString));
  }, [currentWorkspaceTab?.path]);

  useEffect(() => {
    if (!commentaryFocus || stage !== 'view') return undefined;
    // Wait for this link's own passage; an earlier query's cards don't count.
    if (commentaryFocus.query && currentSearchQuery !== commentaryFocus.query) return undefined;
    if (!annotations.some(annotation => String(annotation.id) === commentaryFocus.annotationId)) return undefined;
    return revealAnnotation(readerRef.current, commentaryFocus.annotationId, {
      preferCard: annotationDisplay === 'gutter',
      onDone: () => setCommentaryFocus(null),
    });
  }, [commentaryFocus, stage, currentSearchQuery, annotations, annotationDisplay]);

  const handleCopyCommentaryContent = (annotation, element) => {
    try {
      if (!copyCommentaryContent(element)) throw new Error('Copy was blocked.');
      toast.success('Commentary copied', { description: commentaryLinkLabel(annotation) });
    } catch {
      toast.error('BEX could not copy the commentary. Please try again.');
    }
  };

  const handleCopyCommentaryLink = (annotation) => {
    try {
      if (!copyCommentaryLink(annotation, commentaryEdition, currentChapter?.api_bible_id)) throw new Error('Copy was blocked.');
      toast.success('Commentary link copied', { description: commentaryLinkLabel(annotation, commentaryEdition) });
    } catch {
      toast.error('BEX could not copy the link. Please try again.');
    }
  };

  useEffect(() => {
    const handleKeywordClick = (e) => {
      const keywordLink = e.target.closest('[data-keyword-id]');
      if (keywordLink) {
        e.preventDefault();
        const keywordId = keywordLink.getAttribute('data-keyword-id');
        if (keywordId) {
          navigate('/Keywords');
        }
      }
    };

    const handleKeywordHover = (e) => {
      const keywordLink = e.target.closest('[data-keyword-id]');
      if (keywordLink) {
        const keywordId = keywordLink.getAttribute('data-keyword-id');
        const rect = keywordLink.getBoundingClientRect();
        setKeywordPreview({
          keywordId,
          position: {
            x: rect.left + rect.width / 2 - 150,
            y: rect.bottom + 10
          }
        });
      } else if (!e.target.closest('[data-keyword-preview]')) {
        setKeywordPreview(null);
      }
    };

    const handleOpenDrawing = async (e) => {
      const drawingId = e.detail?.drawingId;
      if (drawingId) {
        const drawings = await platformEntities.Drawing.filter({ id: drawingId });
        if (drawings.length > 0) {
          setCurrentDrawing(drawings[0]);
          setShowDrawingEditor(true);
        }
      }
    };

    document.addEventListener('click', handleKeywordClick);
    document.addEventListener('mouseover', handleKeywordHover);
    window.addEventListener('openDrawingEditor', handleOpenDrawing);

    return () => {
      document.removeEventListener('click', handleKeywordClick);
      document.removeEventListener('mouseover', handleKeywordHover);
      window.removeEventListener('openDrawingEditor', handleOpenDrawing);
    };
  }, []);

  useEffect(() => {
    let selectionTimer;
    const handleKeyUp = (e) => {
      if (e.key === 'Shift') setIsShiftPressed(false);
      if (e.key === 'Shift' || e.key.startsWith('Arrow')) handlePointerUp(e);
    };

    const handlePointerUp = (event) => {
      if (event?.target instanceof Element && event.target.closest('[data-selection-popover]')) return;
      setIsDragging(false);
      clearTimeout(selectionTimer);
      selectionTimer = setTimeout(() => {
        const browserSelection = window.getSelection();
        const selectionText = browserSelection?.toString().trim() || '';

        if (!selectionText || browserSelection.rangeCount === 0) {
          setShowSelectionPopover(false);
          setStoredSelectionText('');
          setStoredSelectionData(null);
          return;
        }

        const scriptureWrapper = readerRef.current?.querySelector('[data-scripture-root="true"]');
        if (!scriptureWrapper) {
          setShowSelectionPopover(false);
          return;
        }

        const anchorNode = browserSelection.anchorNode;
        const focusNode = browserSelection.focusNode;

        let anchorParent = anchorNode?.nodeType === Node.TEXT_NODE ? anchorNode.parentElement : anchorNode instanceof Element ? anchorNode : null;
        let focusParent = focusNode?.nodeType === Node.TEXT_NODE ? focusNode.parentElement : focusNode instanceof Element ? focusNode : null;

        while (anchorParent && !anchorParent.hasAttribute('data-scripture-root')) {
          if (anchorParent.classList?.contains('verse-number-badge')) {
            setShowSelectionPopover(false);
            return;
          }
          anchorParent = anchorParent.parentElement;
        }

        while (focusParent && !focusParent.hasAttribute('data-scripture-root')) {
          if (focusParent.classList?.contains('verse-number-badge')) {
            setShowSelectionPopover(false);
            return;
          }
          focusParent = focusParent.parentElement;
        }

        const isInsideScripture = scriptureWrapper.contains(anchorNode) && scriptureWrapper.contains(focusNode);
        if (!isInsideScripture) {
          setShowSelectionPopover(false);
          return;
        }

        if ((showAnnotationPopup && annotationDisplay === 'hover') || showDrawingEditor || showAnnotationsModal) {
          setShowSelectionPopover(false);
          return;
        }

        const range = browserSelection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          const rects = range.getClientRects();
          if (!rects.length) {
            setShowSelectionPopover(false);
            return;
          }
        }

        const selected = selectedScriptureTokens(range, scriptureWrapper);
        if (!selected || selected.crossChapter) {
          if (selected?.crossChapter) toast.error('Select text within one chapter for an annotation or highlight.');
          setStoredSelectionData(null);
          setShowSelectionPopover(false);
          return;
        }
        const { chapterId, ...tokenRange } = selected;
        const source = (currentChapter?.study_chapters || [currentChapter]).find(chapter => String(chapter?.id) === chapterId) || currentChapter;
        const selectionData = { chapter: source, ...tokenRange };

        setStoredSelectionText(selectionText);
        setStoredSelectionData(selectionData);

        const targetRect = rect.width > 0 ? rect : range.getClientRects()[0];
        let x = targetRect.left + targetRect.width / 2 - 60;
        let y = targetRect.top - 60;

        const padding = 10;
        x = Math.max(padding, Math.min(x, window.innerWidth - 120 - padding));
        y = Math.max(padding, y);
        if (y < 70) y = targetRect.bottom + 10;

        setPopoverPosition({ x, y });
        setShowSelectionPopover(true);
        setPopoverCopied(false);
      }, 50);
    };

    const handleScroll = (event) => {
      if (event?.target instanceof Element && event.target.closest('[data-selection-popover]')) return;
      clearTimeout(selectionTimer);
      setShowSelectionPopover(false);
      setStoredSelectionText('');
      setStoredSelectionData(null);
    };

    const handleClickOutside = (e) => {
      if (e.target instanceof Element && e.target.closest('[data-selection-popover]')) return;
      clearTimeout(selectionTimer);
      setShowSelectionPopover(false);
      setStoredSelectionText('');
      setStoredSelectionData(null);
    };

    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('touchend', handlePointerUp);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('scripture-workspace-pan', handleScroll);
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      clearTimeout(selectionTimer);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchend', handlePointerUp);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('scripture-workspace-pan', handleScroll);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showAnnotationPopup, annotationDisplay, showDrawingEditor, showAnnotationsModal, currentChapter]);


  const loadUserChapters = async () => {
    const [chapters, chapterArt] = await Promise.all([
      platformEntities.StudyChapter.list('-updated_date'),
      listAllChapterArt(),
    ]);
    const artByChapter = new Map(
      chapterArt.map((entry) => [`${entry.book}:\0${entry.chapter_number}`, entry]),
    );
    if (!mountedRef.current) return;
    setUserChapters(chapters.map((chapter) => ({
      ...studyView(chapter),
      ...(artByChapter.get(`${chapter.book}:\0${chapter.chapter_number}`) || {}),
    })));
    const [allAnns, kws] = await Promise.all([
      platformEntities.Annotation.list('-created_date'),
      platformEntities.Keyword.list('-created_date'),
    ]);
    if (!mountedRef.current) return;
    setAllAnnotations(allAnns);
    setKeywords(kws);
  };

  const loadChapterById = async (chapterId) => {
    const intent = ++viewIntentRef.current;
    const fresh = () => mountedRef.current && viewIntentRef.current === intent;
    clearSearch();
    try {
      const chapters = await platformEntities.StudyChapter.filter({ id: chapterId });
      if (!fresh()) return;
      if (chapters && chapters.length > 0) {
        const chapter = studyView(chapters[0]);
        if (isApiStudyRecord(chapter) || chapter.version === 'NASB1995') {
          const bibleId = chapter.version === 'NASB1995' ? NASB1995_API_BIBLE_ID : chapter.api_bible_id;
          setSelectedBibleId(bibleId);
          loadScriptureQuery(`${chapter.book} ${chapter.chapter_number}`, bibleId, chapter.version);
          return;
        }
        setCurrentSearchQuery('');
        await loadAnnotations(chapter, fresh);
        if (!fresh()) return;
        setCurrentChapter(chapter);
        setStage('view');
      }
    } catch (error) {
      console.error('Failed to load chapter by ID:', error);
    }
  };

  const loadScriptureQuery = (queryText, bibleId, bibleAbbr) => {
    if (!queryText?.trim()) return;
    try {
      const session = startSearch(queryText, bibleId || selectedBibleId, bibleAbbr);
      viewIntentRef.current += 1;
      // Mount the reader shell immediately; fetched bodies live only in this view.
      setCurrentSearchQuery(session.query);
      setCurrentChapter({ ...buildStudyChapterFromBatch(session.parsed, session.results, session.abbreviation),
        api_bible_id: session.bibleId, storage_version: `API:${session.bibleId}` });
      setStage('view');
      setStudyReadError('');
      setAnnotations([]);
      setHighlights([]);
      setAnnotationDrawings({});
      setShowSelectionPopover(false);
      if (!showAnnotationPopup) { setSelectionStart(null); setSelectionEnd(null); }
    } catch (error) {
      toast.error(error.message);
    }
  };

  useEffect(() => {
    if (!search) return undefined;
    const revision = ++hydrationRef.current;
    let active = true;
    const fresh = () => active && hydrationRef.current === revision && isCurrentSearch(search.id);
    const assembled = buildStudyChapterFromBatch(search.parsed, search.results, search.abbreviation);
    const hydrate = async () => {
      try {
        const hasVerses = assembled.blocks.some(block => block.type === 'verse');
        const chapter = hasVerses
          ? await persistApiStudyChapter(assembled, search.bibleId, platformEntities)
          : { ...assembled, api_bible_id: search.bibleId, storage_version: `API:${search.bibleId}` };
        if (!fresh()) return;
        // Annotation reads finish before publishing selectable verses, so a new
        // result can never briefly expose the previous query's annotation data.
        if (hasVerses) await loadAnnotations(chapter, fresh);
        if (!fresh()) return;
        setCurrentChapter(chapter);
        setStudyReadError('');
        if (!search.loading && hasVerses) await loadUserChapters();
      } catch (error) {
        if (fresh()) setStudyReadError(error.message || 'Your study data could not be opened. Please retry.');
      }
    };
    void hydrate();
    return () => { active = false; };
  }, [search, isCurrentSearch]);

  const handleSelectBible = async (bible) => {
    setSelectedBibleId(bible.id);
    localStorage.setItem('bex_scripture_selected_bible_id', bible.id);
    if (currentSearchQuery) {
      await loadScriptureQuery(currentSearchQuery, bible.id, bible.abbreviation);
    } else if (currentChapter?.book && currentChapter?.chapter_number) {
      const chapterRef = `${currentChapter.book} ${currentChapter.chapter_number}`;
      await loadScriptureQuery(chapterRef, bible.id, bible.abbreviation);
    }
  };

  const handleToggleRedLetters = () => {
    setRedLetters((prev) => {
      const next = !prev;
      localStorage.setItem('bex_scripture_red_letters', String(next));
      return next;
    });
  };


  // Theme lives in ThemeProvider now, so this button retones the whole app
  // rather than just this page.

  const loadAnnotations = async (chapter, fresh = () => chapterRef.current?.id === chapter.id) => {
    if (!chapter) return;
    const chapters = chapter.study_chapters || [chapter];
    const anns = (await Promise.all(chapters.map(source => platformEntities.Annotation.filter(studyLocator(source))))).flat();
    const [drawingResults, hls] = await Promise.all([
      Promise.all(anns.map((ann) => platformEntities.Drawing.filter({ annotation_id: ann.id, is_deleted: false }))),
      Promise.all(chapters.map(source => platformEntities.TextHighlight.filter(studyLocator(source)))).then(results => results.flat())
    ]);

    const drawingsMap = {};
    drawingResults.forEach((drawings, index) => {
      if (drawings.length > 0) {
        drawingsMap[anns[index].id] = drawings[0];
      }
    });

    if (!fresh()) return;
    setAnnotations(anns);
    setAnnotationDrawings(drawingsMap);
    setHighlights(hls);
  };

  const parseChapter = (rawText, version) => {
    if (version === 'LSV') return parseLsvPreparedText(rawText);
    return parsePreparedText(rawText);
  };

  const tokenizeText = (text) => text.split(/(\s+)/);

  const handleOpenAnnotationPopup = () => {
    if (!selectionStart) return;
    const endPoint = selectionEnd || selectionStart;
    const blocks = currentChapter?.blocks || parseChapter(currentChapter?.raw_text);

    let selectedText = '';
    let capturing = false;
    for (let block of blocks) {
      if (block.type !== 'verse') continue;
      const tokens = tokenizeText(block.text);
      for (let i = 0; i < tokens.length; i++) {
        const isStart = block.verseNumber === selectionStart.verse && i === selectionStart.tokenIndex;
        const isEnd = block.verseNumber === endPoint.verse && i === endPoint.tokenIndex;
        if (isStart) capturing = true;
        if (capturing) selectedText += tokens[i];
        if (isEnd) break;
      }
      if (capturing && block.verseNumber === endPoint.verse) break;
    }

    const trimmedText = selectedText.trim();
    setCapturedSelectedText(trimmedText);
    const initialContent = editingAnnotation ? editingAnnotation.content : '';
    annotationRecordRef.current = editingAnnotation;
    setAnnotationContent(initialContent);
    resetAnnotationSave(initialContent);
    annotationChapterRef.current = currentChapter;
    setShowAnnotationPopup(true);
    setShowSelectionPopover(false);
  };

  const handlePopoverAddAnnotation = async () => {
    if (!storedSelectionText || !storedSelectionData || openingAnnotationRef.current) return;
    const selected = storedSelectionData, text = storedSelectionText, chapter = currentChapter;
    openingAnnotationRef.current = true;
    try {
      if (!await finishAnnotationSession()) return;
      const source = selected.chapter || chapter;
      // A stable record anchors the new gutter editor before the first keystroke.
      // It remains the same card/editor throughout autosave; empty drafts can be dismissed.
      if (annotationDisplay === 'gutter') {
        const record = await platformEntities.Annotation.create({ ...studyLocator(source),
          start_verse: selected.startVerse, start_token_index: selected.startToken,
          end_verse: selected.endVerse, end_token_index: selected.endToken,
          selected_text: text, content: '' });
        newGutterAnnotationRef.current = record.id;
        setAnnotations(previous => [...previous, record]);
        beginAnnotationSession(record, chapter, source);
      } else {
        setSelectionStart({ verse: selected.startVerse, tokenIndex: selected.startToken, chapter: source });
        setSelectionEnd({ verse: selected.endVerse, tokenIndex: selected.endToken });
        setCapturedSelectedText(text);
        annotationRecordRef.current = null;
        setAnnotationContent('');
        setEditingAnnotation(null);
        resetAnnotationSave('');
        annotationChapterRef.current = chapter;
        setShowAnnotationPopup(true);
      }
      setShowSelectionPopover(false);
      setStoredSelectionText('');
      setStoredSelectionData(null);
    } catch (error) {
      toast.error(error?.message || 'BEX could not open the annotation. Please try again.');
    } finally { openingAnnotationRef.current = false; }
  };

  const handleCopyScripture = async () => {
    // This is the same payload that determines whether Copy is visible.
    // Retired or empty reading data must never reach the clipboard.
    if (!scriptureCopyText) return;
    if ((currentChapter.study_chapters || [currentChapter]).some(chapter => !isStudyMaterialExportAllowed(chapter))) {
      toast.error(ESV_STUDY_EXPORT_BLOCK_MESSAGE);
      return;
    }
    try {
      await writeClipboardText(scriptureCopyText);
      toast.success('Scripture copied');
    } catch {
      toast.error('Could not copy scripture. Please try again.');
    }
  };

  const handlePopoverCopy = async () => {
    if (!storedSelectionText) return;
    if (!isStudyMaterialExportAllowed(currentChapter)) {
      toast.error(ESV_STUDY_EXPORT_BLOCK_MESSAGE);
      return;
    }
    try {
      await writeClipboardText(storedSelectionText);
      setPopoverCopied(true);
      setTimeout(() => {
        setShowSelectionPopover(false);
        setPopoverCopied(false);
        setStoredSelectionText('');
        setStoredSelectionData(null);
      }, 800);
    } catch (err) {
      console.error('Failed to copy:', err);
      setShowSelectionPopover(false);
      setStoredSelectionText('');
      setStoredSelectionData(null);
    }
  };

  const handleCloseAnnotationPopup = () => {
    if (hasUnsavedAnnotation || annotationSaveStatus === 'saving') {
      setPendingAction(() => () => {
        setShowAnnotationPopup(false);
        setAnnotationContent('');
        setEditingAnnotation(null);
        setCapturedSelectedText('');
        resetAnnotationSave();
      });
      setPendingSaveFunction(() => handleSaveAnnotation);
      setShowUnsavedWarning(true);
      return;
    }
    setShowAnnotationPopup(false);
    setAnnotationContent('');
    setEditingAnnotation(null);
    setCapturedSelectedText('');
    resetAnnotationSave();
  };

  async function persistAnnotationContent(content) {
    const annotationChapter = annotationChapterRef.current || currentChapter;
    if (!annotationChapter || !selectionStart) throw new Error('Select scripture before saving an annotation.');
    if (!annotationHasContent(content) && !annotationRecordRef.current) throw new Error('Must type at least 1 character');
    const source = selectionStart.chapter || (editingAnnotation && (annotationChapter.study_chapters || [annotationChapter]).find(chapter =>
      chapter.book === editingAnnotation.book && chapter.chapter_number === editingAnnotation.chapter_number && studyLocator(chapter).version === editingAnnotation.version)) || annotationChapter;
    const endPoint = selectionEnd || selectionStart;
    const payload = {
      ...studyLocator(source), start_verse: selectionStart.verse, start_token_index: selectionStart.tokenIndex,
      end_verse: endPoint.verse, end_token_index: endPoint.tokenIndex,
      selected_text: capturedSelectedText, content: content.trim(),
    };
    const record = annotationRecordRef.current || editingAnnotation;
    // Retain a successful create even if a subsequent read/count update fails.
    // Retrying the save then updates that record rather than creating a duplicate.
    annotationRecordRef.current = record
      ? await platformEntities.Annotation.update(record.id, { content: content.trim() })
      : await platformEntities.Annotation.create(payload);
    const saved = await platformEntities.Annotation.filter(studyLocator(source));
    await platformEntities.StudyChapter.update(source.id, { annotation_count: saved.length });
    await loadAnnotations(chapterRef.current);
    await loadUserChapters();
  }

  const handleSaveAnnotation = async () => {
    if (savingAnnotationRef.current) return false;
    if (!annotationHasContent(annotationContent) && !annotationRecordRef.current) { toast.error('Must type at least 1 character'); return false; }
    savingAnnotationRef.current = true;
    setSavingAnnotation(true);
    try {
      // Manual Save and the debounce share one serialized write, including any
      // text entered while a previous save is still in flight.
      await flushAnnotationSave();
      resetAnnotationSave('');
      setShowAnnotationPopup(false);
      setSelectionStart(null);
      setSelectionEnd(null);
      setEditingAnnotation(null);
      annotationRecordRef.current = null;
      newGutterAnnotationRef.current = null;
      setCapturedSelectedText('');
      setAnnotationContent('');
      return true;
    } catch (error) {
      toast.error(error?.message || 'BEX could not save your annotation. Your writing is still here.');
      return false;
    } finally {
      savingAnnotationRef.current = false;
      setSavingAnnotation(false);
    }
  };

  const matchesSource = (record, source) => {
    const locator = studyLocator(source);
    return record.book === locator.book && record.chapter_number === locator.chapter_number && record.version === locator.version;
  };
  const getHighlightForToken = (verse, tokenIndex, source = currentChapter) => {
    for (const hl of highlights) {
      if (!matchesSource(hl, source)) continue;
      const afterStart = verse > hl.start_verse || verse === hl.start_verse && tokenIndex >= hl.start_token_index;
      const beforeEnd = verse < hl.end_verse || verse === hl.end_verse && tokenIndex <= hl.end_token_index;
      if (afterStart && beforeEnd) return hl;
    }
    return null;
  };

  const handleHighlightText = async (color) => {
    if (!storedSelectionData || !currentChapter) return;
    const { startVerse, startToken, endVerse, endToken } = storedSelectionData;
    const source = storedSelectionData.chapter || currentChapter;
    const overlapping = highlights.filter((hl) => {
      if (!matchesSource(hl, source)) return false;
      const hlStart = hl.start_verse * 100000 + hl.start_token_index;
      const hlEnd = hl.end_verse * 100000 + hl.end_token_index;
      const selStart = startVerse * 100000 + startToken;
      const selEnd = endVerse * 100000 + endToken;
      return hlStart <= selEnd && hlEnd >= selStart;
    });

    for (const hl of overlapping) await platformEntities.TextHighlight.delete(hl.id);

    await platformEntities.TextHighlight.create({
      ...studyLocator(source),
      start_verse: startVerse,
      start_token_index: startToken,
      end_verse: endVerse,
      end_token_index: endToken,
      color: color
    });

    await loadAnnotations(currentChapter);
    setShowSelectionPopover(false);
    setStoredSelectionText('');
    setStoredSelectionData(null);
    window.getSelection()?.removeAllRanges();
  };

  const handleRemoveHighlight = async () => {
    if (!storedSelectionData || !currentChapter) return;
    const { startVerse, startToken, endVerse, endToken } = storedSelectionData;
    const source = storedSelectionData.chapter || currentChapter;
    const overlapping = highlights.filter((hl) => {
      if (!matchesSource(hl, source)) return false;
      const hlStart = hl.start_verse * 100000 + hl.start_token_index;
      const hlEnd = hl.end_verse * 100000 + hl.end_token_index;
      const selStart = startVerse * 100000 + startToken;
      const selEnd = endVerse * 100000 + endToken;
      return hlStart <= selEnd && hlEnd >= selStart;
    });

    for (const hl of overlapping) await platformEntities.TextHighlight.delete(hl.id);
    await loadAnnotations(currentChapter);
    setShowSelectionPopover(false);
    setStoredSelectionText('');
    setStoredSelectionData(null);
    window.getSelection()?.removeAllRanges();
  };

  const selectionHasHighlight = () => {
    if (!storedSelectionData) return false;
    const { startVerse, startToken, endVerse, endToken } = storedSelectionData;
    const source = storedSelectionData.chapter || currentChapter;
    return highlights.some((hl) => {
      if (!matchesSource(hl, source)) return false;
      const hlStart = hl.start_verse * 100000 + hl.start_token_index;
      const hlEnd = hl.end_verse * 100000 + hl.end_token_index;
      const selStart = startVerse * 100000 + startToken;
      const selEnd = endVerse * 100000 + endToken;
      return hlStart <= selEnd && hlEnd >= selStart;
    });
  };

  const annotationCoversToken = (ann, verse, tokenIndex) => {
    const pos = verse * 100000 + tokenIndex;
    const start = ann.start_verse * 100000 + ann.start_token_index;
    const end = ann.end_verse * 100000 + ann.end_token_index;
    return pos >= start && pos <= end;
  };

  const getAnnotationsForToken = (verse, tokenIndex, source = currentChapter) =>
    annotations.filter((ann) => matchesSource(ann, source) && annotationCoversToken(ann, verse, tokenIndex));

  const isTokenAnnotated = (verse, tokenIndex, source = currentChapter) =>
    annotations.some((ann) => matchesSource(ann, source) && annotationCoversToken(ann, verse, tokenIndex));

  const getAnnotationForToken = (verse, tokenIndex, source = currentChapter) => {
    return annotations.find((ann) => matchesSource(ann, source) && ann.start_verse === verse && ann.start_token_index === tokenIndex);
  };

  // Purple annotation highlight. Overlapping annotations stack toward a more
  // opaque purple. When a token also carries a text highlight, the purple is
  // layered (as a flat gradient) on top of the highlight color so both show.
  const buildTokenStyle = (highlight, annCount) => {
    const purple = annCount > 0 && annotationDisplay === 'hover'
      ? `rgba(107, 76, 154, ${Math.min(0.3 + (annCount - 1) * 0.2, 0.85)})`
      : null;
    if (!highlight && !purple) return undefined;
    const style = { boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone' };
    if (annCount > 0 && annotationDisplay === 'hover') {
      style.textDecoration = 'underline';
      style.textDecorationColor = '#b197ef';
      style.textUnderlineOffset = '3px';
    }
    if (highlight && purple) {
      style.backgroundColor = highlight.color + '50';
      style.backgroundImage = `linear-gradient(${purple}, ${purple})`;
    } else if (highlight) {
      style.backgroundColor = highlight.color + '50';
    } else {
      style.backgroundColor = purple;
    }
    return style;
  };

  const showAnnotationPreview = (e, anns) => {
    if (annotationDisplay !== 'hover') return;
    if (!anns || anns.length === 0) return;
    if (annotationPreviewTimer.current) {
      clearTimeout(annotationPreviewTimer.current);
      annotationPreviewTimer.current = null;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setAnnotationPreview({
      annotations: anns,
      position: { x: rect.left + rect.width / 2, y: rect.top },
    });
  };

  const hideAnnotationPreview = () => {
    if (annotationPreviewTimer.current) clearTimeout(annotationPreviewTimer.current);
    annotationPreviewTimer.current = setTimeout(() => setAnnotationPreview(null), 90);
  };

  useEffect(() => () => {
    if (annotationPreviewTimer.current) clearTimeout(annotationPreviewTimer.current);
  }, []);

  function beginAnnotationSession(annotation, chapter, source = null) {
    setAnnotationSaveError(null);
    setEditingAnnotation(annotation);
    annotationRecordRef.current = annotation;
    setAnnotationContent(annotation.content || '');
    setSelectionStart({ verse: annotation.start_verse, tokenIndex: annotation.start_token_index, chapter: source });
    setSelectionEnd({ verse: annotation.end_verse, tokenIndex: annotation.end_token_index });
    setCapturedSelectedText(annotation.selected_text);
    resetAnnotationSave(annotation.content || '');
    annotationChapterRef.current = chapter;
    setShowAnnotationPopup(true);
  }

  async function finishAnnotationSession() {
    if (!showAnnotationPopup) return true;
    if (newGutterAnnotationRef.current === editingAnnotation?.id && !annotationHasContent(annotationContent)) {
      if (savingAnnotationRef.current) return false;
      savingAnnotationRef.current = true;
      setSavingAnnotation(true);
      try {
        // Drain any outstanding write before deleting the intentionally empty draft.
        await flushAnnotationSave();
        await handleDeleteAnnotation(editingAnnotation);
        clearAnnotationSession();
        return true;
      } catch (error) { toast.error(error.message || 'Could not dismiss the draft.'); return false; }
      finally { savingAnnotationRef.current = false; setSavingAnnotation(false); }
    }
    return handleSaveAnnotation();
  }

  function clearAnnotationSession() {
    resetAnnotationSave('');
    setShowAnnotationPopup(false);
    setEditingAnnotation(null);
    annotationRecordRef.current = null;
    newGutterAnnotationRef.current = null;
    setAnnotationContent('');
    setCapturedSelectedText('');
    setSelectionStart(null);
    setSelectionEnd(null);
  }

  async function deleteEditingAnnotation() {
    if (savingAnnotationRef.current) return;
    savingAnnotationRef.current = true;
    setSavingAnnotation(true);
    try {
      await flushAnnotationSave();
      await handleDeleteAnnotation(editingAnnotation);
      clearAnnotationSession();
    } catch (error) { toast.error(error.message || 'Could not delete the annotation. Your writing is still here.'); }
    finally { savingAnnotationRef.current = false; setSavingAnnotation(false); }
  }

  const handleAnnotationIconClick = async (annotation) => {
    if (openingAnnotationRef.current || savingAnnotationRef.current) return;
    if (showAnnotationPopup && editingAnnotation?.id === annotation.id) return;
    const chapter = currentChapter;
    openingAnnotationRef.current = true;
    try {
      if (!await finishAnnotationSession()) return;
      if (annotationDrawings[annotation.id]) {
        setEditingAnnotation(annotation);
        setCurrentDrawing(annotationDrawings[annotation.id]);
        setShowDrawingEditor(true);
      } else {
        beginAnnotationSession(annotation, chapter);
      }
    } finally { openingAnnotationRef.current = false; }
  };

  const saveAnnotationRoute = async (annotation, route) => {
    try {
      await platformEntities.Annotation.update(annotation.id, { gutter_route: route });
      setAnnotations(previous => previous.map(item => item.id === annotation.id ? { ...item, gutter_route: route } : item));
    } catch (error) {
      toast.error(error.message || 'BEX could not save the connector position. Please try again.');
      throw error;
    }
  };

  const saveAnnotationPosition = async (annotation, position) => {
    try {
      await platformEntities.Annotation.update(annotation.id, { gutter_position: position });
      setAnnotations(previous => previous.map(item => item.id === annotation.id ? { ...item, gutter_position: position } : item));
    } catch (error) {
      toast.error(error.message || 'BEX could not save the note position. Please try again.');
      throw error;
    }
  };

  const saveAnnotationSize = async (annotation, size, position) => {
    try {
      const patch = { gutter_size: size, gutter_position: position };
      await platformEntities.Annotation.update(annotation.id, patch);
      setAnnotations(previous => previous.map(item => item.id === annotation.id ? { ...item, ...patch } : item));
    } catch (error) {
      toast.error(error.message || 'BEX could not save the note size. Please try again.');
      throw error;
    }
  };

  // Load rich (segment) verses for NASB 2020 from any entry path (fresh fetch,
  // history open, chapter_id deep-link) and refresh stale raw_text to the
  // canonical complete-EPUB text so highlight/annotation tokens stay aligned.
  useEffect(() => {
    // Removed translations never load rich segments (no endpoint/cache hit).
    if (!currentChapter || currentChapter.version !== 'NASB2020' || isRemovedTranslation(currentChapter.version, currentChapter)) {
      setRichVerses(null);
      richChapterIdRef.current = null;
      return undefined;
    }
    if (richChapterIdRef.current === currentChapter.id) return undefined;
    // Different chapter than what's currently in richVerses: clear it so the UI
    // falls back to parseChapter(raw_text) during the fetch instead of rendering
    // the previous chapter's verses against the new chapter's metadata.
    setRichVerses(null);
    let cancelled = false;
    (async () => {
      try {
        const resp = await platformFunctions.invoke('fetchNasb2020RichChapter', {
          book: currentChapter.book,
          chapter: currentChapter.chapter_number
        });
        if (cancelled || !resp.data?.ok) return;
        richChapterIdRef.current = currentChapter.id;
        setRichVerses(resp.data.verses);
        if (resp.data.text && resp.data.text !== currentChapter.raw_text) {
          await platformEntities.StudyChapter.update(currentChapter.id, { raw_text: resp.data.text });
          const refreshed = await platformEntities.StudyChapter.filter({ id: currentChapter.id });
          if (!cancelled && refreshed[0]) setCurrentChapter(prev => ({ ...prev, ...studyView(refreshed[0]), blocks: prev.blocks, study_chapters: prev.study_chapters }));
        }
      } catch (err) {
        console.error('Failed to load NASB 2020 rich chapter:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [currentChapter?.id, currentChapter?.version]);

  const isRichView = currentChapter?.version === 'NASB2020' && Array.isArray(richVerses) && richVerses.length > 0;
  const scriptureCopyText = useMemo(() => {
    if (!currentChapter || isRemovedTranslation(currentChapter.version, currentChapter)) return '';
    return formatScriptureCopy(currentChapter, {
      blocks: currentChapter.blocks || parseChapter(currentChapter.raw_text, currentChapter.version),
      richVerses: isRichView ? richVerses : null,
    });
  }, [currentChapter, isRichView, richVerses]);

  const handleDeleteAnnotation = async (ann) => {
    if (annotationDrawings[ann.id]) {
      await platformEntities.Drawing.update(annotationDrawings[ann.id].id, { is_deleted: true });
    }
    await platformEntities.Annotation.delete(ann.id);
    await loadAnnotations(currentChapter);
    const original = annotationChapterRef.current;
    const source = [...(currentChapter?.study_chapters || [currentChapter]), ...(original?.study_chapters || [original])].filter(Boolean).find(chapter => matchesSource(ann, chapter));
    const annotationCount = await platformEntities.Annotation.filter(studyLocator(source));
    await platformEntities.StudyChapter.update(source.id, { annotation_count: annotationCount.length });
    await loadUserChapters();
    const verseText = ann.selected_text || '(no text)';
    const truncatedText = verseText.length > 50 ? verseText.substring(0, 47) + '...' : verseText;
    toast.success(`Annotation on v${ann.start_verse} deleted`, { description: `"${truncatedText}"` });
  };

  const handleSelectChapter = async (chapter) => {
    if (isApiStudyRecord(chapter)) {
      setSelectedBibleId(chapter.api_bible_id);
      loadScriptureQuery(`${chapter.book} ${chapter.chapter_number}`, chapter.api_bible_id, chapter.version);
    } else {
      const intent = ++viewIntentRef.current;
      const fresh = () => mountedRef.current && viewIntentRef.current === intent;
      clearSearch();
      setCurrentSearchQuery('');
      await loadAnnotations(chapter, fresh);
      if (!fresh()) return;
      setCurrentChapter(chapter);
      setStage('view');
    }
    trackActivity({
      type: 'study_chapter',
      page: 'Study',
      title: 'Continue studying?',
      subtitle: `${chapter.book} ${chapter.chapter_number}`,
      icon: 'study',
      url_params: `chapter_id=${chapter.id}`
    });
  };

  const handleDeleteChapter = async (chapter) => {
    const locator = studyLocator(chapter);
    const chapterAnnotations = await platformEntities.Annotation.filter(locator);
    for (const ann of chapterAnnotations) await platformEntities.Annotation.delete(ann.id);
    const chapterHighlights = await platformEntities.TextHighlight.filter(locator);
    for (const hl of chapterHighlights) await platformEntities.TextHighlight.delete(hl.id);
    await platformEntities.StudyChapter.delete(chapter.id);
    await loadUserChapters();
    if (currentChapter?.id === chapter.id) {
      setCurrentChapter(null);
      setStage('progress');
    }
  };

  const handleTextSizeChange = (size) => {
    setTextSize(size);
  };

  const handleToggleInterlinear = async () => {
    const nextValue = !interlinearEnabled;
    setInterlinearEnabled(nextValue);
    await desktopClient.owner.updatePreferences({ interlinear_mode: nextValue });
  };

  const handleInterlinearSourceChange = async (value) => {
    setInterlinearSource(value);
    await desktopClient.owner.updatePreferences({ interlinear_source: value });
  };

  if (loading && stage !== 'view') {
    return <LoadingScreen message="Loading your Bible Study..." />;
  }

  const spatialWorkspace = stage === 'view' && annotationDisplay === 'gutter';

  return (
    <div ref={studyPageRef} className={`bex-study min-h-screen bg-app ${spatialWorkspace ? 'bex-study-spatial' : ''}`}>
      <StudyPageFind rootRef={studyPageRef} />
      <ScriptureWorkspace enabled={spatialWorkspace}>
      <main className={`max-w-7xl mx-auto px-4 py-8 ${annotationDisplay === 'gutter' && hasGutterAnnotations ? 'bex-study-main-gutter' : ''}`}>
        {stage === 'progress' && (
          <div className="max-w-6xl mx-auto space-y-6">
            <div className="max-w-2xl mx-auto mb-6">
              <ScriptureSearch
                initialQuery={currentSearchQuery}
                onSearch={(clean) => loadScriptureQuery(clean, selectedBibleId)}
              />
            </div>
            <h2 className="text-xl font-bold text-ink dark:text-ink">{tr('Chapter History')}</h2>
            <ProgressTracker
              chapters={userChapters}
              onSelectChapter={handleSelectChapter}
              onDeleteChapter={handleDeleteChapter}
              user={user}
            />
          </div>
        )}

        {stage === 'view' && currentChapter &&
          <div className="space-y-4">
            <div ref={readerRef} className="bex-study-page bg-surface dark:bg-surface rounded-xl border border-line dark:border-line p-6 md:p-8">
              <div className="mb-6 flex min-w-0 items-center gap-3" data-testid="study-search-controls">
                <div className="min-w-0 flex-1">
                  <ScriptureSearch
                    initialQuery={currentSearchQuery}
                    showSearchIcon={false}
                    onSearch={(clean) => loadScriptureQuery(clean, selectedBibleId)}
                  />
                </div>
                <BibleVersionSelector
                  selectedBibleId={selectedBibleId}
                  onSelectBible={handleSelectBible}
                  className="h-10 shrink-0"
                />
              </div>

              {isRemovedTranslation(currentChapter.version, currentChapter) &&
            <div className="mb-6 p-6 bg-surface dark:bg-app/20 border border-line dark:border-line rounded-lg" data-testid="banner-removed-translation">
                  <div className="flex items-start gap-4">
                    <div className="p-3 rounded-lg bg-elevated dark:bg-elevated/60">
                      <Lock className="w-6 h-6 text-ink-faint dark:text-ink-faint" />
                    </div>
                    <div className="flex-1">
                      <p className="text-ink-muted dark:text-ink-muted font-semibold mb-1 line-through decoration-ink-faint">{currentChapter.version}</p>
                      <p className="text-sm text-ink-soft dark:text-ink-soft">{getRemovedTranslationMessage(currentChapter.version)}</p>
                    </div>
                  </div>
                </div>
            }

              {!search && !isRemovedTranslation(currentChapter.version, currentChapter) && (!currentChapter.raw_text || currentChapter.raw_text.length === 0) &&
            <div className="mb-6 p-6 bg-surface dark:bg-app/20 border-2 border-dashed border-line dark:border-line rounded-lg">
                  <div className="flex items-start gap-4">
                    <div className="p-3 rounded-lg bg-elevated dark:bg-elevated/60">
                      <FileText className="w-6 h-6 text-ink-faint dark:text-ink-faint" />
                    </div>
                    <div className="flex-1">
                      <p className="text-ink-muted dark:text-ink-muted font-semibold mb-1">No chapter text found</p>
                      <p className="text-sm text-ink-faint dark:text-ink-soft">No scripture text is available for this chapter. Try another search.</p>
                    </div>
                  </div>
                </div>
            }

              {currentChapter.version === 'LSV' && isLsvSpecialSection(currentChapter.book) &&
            <div className="mb-4 px-4 py-2.5 bg-surface dark:bg-app/20 border border-line dark:border-line rounded-lg text-sm text-ink-faint dark:text-ink-soft italic">
                  This is a read-only section from the Literal Standard Version.
                </div>
            }

              <Card3DTilt
                className="mb-2 w-full min-w-0 max-w-full lg:w-fit"
                innerClassName="p-4"
                shaderIntensity={0.35}
                shaderHueShift={0.6}
                data-testid="reading-controls-panel"
              >
                <section aria-label="Reading Controls">
                  <h2 className="sr-only">Reading Controls</h2>
                  <div className="grid min-w-0 grid-cols-1 items-center gap-4 lg:grid-cols-[auto_auto]">
                    <div className="flex min-w-0 flex-wrap items-center gap-4">
                      <div className="shrink-0">
                        <InterlinearSettings
                          enabled={interlinearEnabled}
                          onToggle={handleToggleInterlinear}
                          onSourceChange={handleInterlinearSourceChange}
                          effectiveSource={interlinearEffectiveSource}
                          isNewTestament={isNewTestamentChapter}
                          isLoading={isLoadingInterlinear} />
                      </div>
                    </div>
                    <div className="min-w-0 border-t border-line/60 pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
                      <div className="grid items-start gap-3 sm:grid-cols-[auto_auto]">
                        <div className="grid grid-cols-2 items-start gap-x-6 gap-y-3" data-testid="reading-text-size-controls">
                          <div>
                            <p className="mb-2 text-xs font-medium text-ink-faint">Scripture text size</p>
                            <TextSizeControl value={textSize} onChange={handleTextSizeChange} ariaLabel="Scripture text size" />
                          </div>
                          <div>
                            <p className="mb-2 text-xs font-medium text-ink-faint">Notes text size</p>
                            <TextSizeControl value={notesTextSize} onChange={setNotesTextSize} ariaLabel="Notes text size" testId="notes-text-size-control" />
                          </div>
                        </div>
                        <div className="space-y-2.5 sm:pt-0.5">
                  <div className="flex flex-col gap-2">
                    <label className="flex items-center gap-2 text-xs text-ink-muted cursor-pointer">
                      <input
                        type="checkbox"
                        className="accent-brand"
                        checked={redLetters}
                        onChange={handleToggleRedLetters}
                        data-testid="toggle-red-letters-display" />
                      Words of Jesus in red
                    </label>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="flex items-center gap-2 text-xs text-ink-muted cursor-pointer">
                      <input
                        type="checkbox"
                        className="accent-brand"
                        checked={showTextualNotes}
                        onChange={(e) => setShowTextualNotes(e.target.checked)}
                        data-testid="toggle-textual-notes" />
                      Show textual notes & commentary
                    </label>
                    {isOwnerUser && isRichView &&
                      <label className="flex items-center gap-2 text-xs text-ink-faint cursor-pointer">
                        <input
                          type="checkbox"
                          checked={debugSegments}
                          onChange={(e) => setDebugSegments(e.target.checked)}
                          data-testid="toggle-debug-segments" />
                        Debug segments
                      </label>
                    }
                  </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <AnimatePresence initial={false}>
                  {interlinearEnabled &&
                    <InterlinearReveal key="source-footer" testId="animated-interlinear-footer">
                    <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-line/50 pt-2" data-testid="interlinear-source-footer">
                      <div className="min-w-0 space-y-2">
              {interlinearEnabled && interlinearError &&
            <p className="text-xs text-gold" data-testid="text-interlinear-error">{interlinearError}</p>
            }
              {interlinearEnabled && interlinearEffectiveSource === 'MAM' && interlinearAttribution &&
            <p className="text-[0.65rem] text-ink-faint" data-testid="text-mam-attribution">
                Source: {interlinearAttribution.source} · License:{' '}
                <a href={interlinearAttribution.licenseUrl} target="_blank" rel="noreferrer" className="underline hover:text-ink-muted">
                  {interlinearAttribution.license}
                </a>
              </p>
            }

                      </div>
                      <div className="min-w-0 max-w-full">
                        <InterlinearSettings
                          sourceOnly
                          enabled={interlinearEnabled}
                          onSourceChange={handleInterlinearSourceChange}
                          effectiveSource={interlinearEffectiveSource}
                          isNewTestament={isNewTestamentChapter}
                          isLoading={isLoadingInterlinear} />
                      </div>
                    </div>
                    </InterlinearReveal>
                  }
                  </AnimatePresence>

                </section>
              </Card3DTilt>

              {scriptureCopyText && <div className="mb-4 flex justify-end">
                <Button type="button" variant="ghost" size="icon"
                  onClick={handleCopyScripture}
                  title="Copy scripture" aria-label="Copy scripture"
                  data-testid="button-copy-scripture"
                  className="h-8 w-8 shrink-0 text-ink-muted hover:text-brand">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>}

              {search && (search.loading || search.results.some(result => result.status !== 'success') || studyReadError) && (
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-sm text-ink-muted" data-testid="scripture-loading-status">
                  <p role="status" aria-live="polite">
                    {studyReadError || (search.loading
                      ? `${search.results.filter(result => result.status === 'success' || result.status === 'error').length} of ${search.results.length} requests finished${search.slow ? ' · API.Bible is taking longer than usual.' : '…'}`
                      : `${search.cancelled ? 'Loading stopped' : 'Some passages could not be loaded'} · ${search.results.filter(result => result.status === 'success').length} of ${search.results.length} passages loaded`)}
                  </p>
                  {search.loading
                    ? <button type="button" className={buttonVariants({ variant: 'outline', size: 'sm' })} onClick={cancelSearch}>Cancel</button>
                    : <button type="button" className={buttonVariants({ variant: 'outline', size: 'sm' })} onClick={() => retrySearch()}>{studyReadError ? 'Retry study data' : 'Retry unfinished'}</button>}
                </div>
              )}

              <AnnotationGutter annotations={annotations} enabled={annotationDisplay === 'gutter'}
                versionLabel={commentaryEdition}
                editingId={showAnnotationPopup ? editingAnnotation?.id : null}
                editor={showAnnotationPopup && editingAnnotation && <div className="bex-gutter-editor" data-testid="gutter-annotation-editor">
                  <TEXT_EDITOR_MACHINERY
                    key={editingAnnotation.id}
                    content={annotationContent}
                    onChange={content => { setAnnotationSaveError(null); setAnnotationContent(content); }}
                    placeholder="Write your annotation…"
                    bare
                    localFindShortcut
                    footnotes
                    onEditorReady={editor => editor.commands.focus('end', { scrollIntoView: false })}
                  />
                  <div className="bex-gutter-editor-actions">
                    <GutterSaveStatus saving={annotationSaveStatus === 'saving'} dirty={hasUnsavedAnnotation} error={annotationSaveError} />
                    <button type="button" onClick={deleteEditingAnnotation} disabled={savingAnnotation} aria-label="Delete annotation" title="Delete annotation" className="bex-gutter-delete"><Trash2 size={16} aria-hidden="true" /></button>
                    <button type="button" onClick={finishAnnotationSession} disabled={savingAnnotation} data-testid="button-gutter-done" aria-label="Done editing annotation" title="Done" className="bex-gutter-done"><Check size={18} aria-hidden="true" /></button>
                  </div>
                </div>}
                onEdit={handleAnnotationIconClick} onCopyLink={handleCopyCommentaryLink} onCopyContent={handleCopyCommentaryContent} onSaveRoute={saveAnnotationRoute} onSavePosition={saveAnnotationPosition} onSaveSize={saveAnnotationSize} annotationDrawings={annotationDrawings}
                onActiveChange={setHasGutterAnnotations}>
              <div className="relative">
                {readerNeedsScroll && <button type="button" aria-label="Scroll to bottom" title="Scroll to bottom"
                  onClick={() => scrollReader('bottom')}
                  className="bex-reader-scroll mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface/80 text-ink-muted backdrop-blur-sm transition-colors hover:border-brand/50 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand min-[1400px]:absolute min-[1400px]:-left-[5.5rem] min-[1400px]:top-0 min-[1400px]:mb-0">
                  <ArrowDown className="h-5 w-5" />
                </button>}
              <div data-scripture-root="true" className="opacity-100">
                {isRemovedTranslation(currentChapter.version, currentChapter) ? null : isRichView ? (
                  <RichChapterView
                    verses={richVerses}
                    book={currentChapter.book}
                    chapter={currentChapter.chapter_number}
                    showNotes={showTextualNotes}
                    debug={debugSegments}
                    paragraphClass={`font-serif text-[#F5F7FB] dark:text-[#F5F7FB] ${getScriptureTextClass(textSize)}`}
                    headerClass={getHeaderClass(textSize)}
                    buildVerseHref={(v) => getBibleHubVerseUrl(currentChapter.book, currentChapter.chapter_number, v)}
                    helpers={{
                      getHighlightForToken,
                      getAnnotationsForToken,
                      getAnnotationForToken,
                      annotationDrawings,
                      buildTokenStyle,
                      showAnnotationPreview,
                      hideAnnotationPreview,
                      onAnnotationIconClick: handleAnnotationIconClick,
                      showAnnotationIcons: annotationDisplay === 'hover',
                    }}
                    renderInterlinear={(v) => (interlinearEnabled && interlinearVerses[v])
                      ? (isOldTestament
                          ? <InterlinearVerse verseText={interlinearVerses[v]} isRtl individualWords />
                          : <InterlinearVerse greekText={interlinearVerses[v]} individualWords />)
                      : null}
                  />
                ) : (
                  (currentChapter.blocks || parseChapter(currentChapter.raw_text, currentChapter.version)).map((block, blockIdx, blocks) =>
              <div key={blockIdx} className={block.type === 'header' && blocks[blockIdx + 1]?.type === 'header' ? 'mb-3' : 'mb-4'}>
                    {block.type === 'header' ?
                <h3 className={`${getHeaderClass(textSize)} font-semibold text-ink-muted dark:text-ink-muted mb-3`}>
                        {block.text}
                      </h3> : block.type === 'request' ? (
                        <ScriptureRequestState block={block} busy={search?.loading} onRetry={() => retrySearch(block.requestIndex)} />
                      ) :

                <>
                        <div className="group flex gap-3" data-scripture-verse data-study-verse-key={studyVerseKey(block.studyLocator?.book || currentChapter.book, block.studyLocator?.chapter_number || currentChapter.chapter_number, block.verseNumber)}>
                          <div className={`flex h-[1lh] shrink-0 items-center ${getScriptureTextClass(textSize)}`}>
                            <VerseBibleHubButton
                              verseNumber={block.verseNumber}
                              href={getBibleHubVerseUrl(block.studyLocator?.book || currentChapter.book, block.studyLocator?.chapter_number || currentChapter.chapter_number, block.verseNumber)}
                              className={`verse-number-badge min-w-[2rem] h-6 rounded bg-elevated text-brand ${getVerseNumberClass(textSize)} font-bold`}
                            />
                          </div>
                          <div className={`flex-1 font-serif text-[#F5F7FB] dark:text-[#F5F7FB] ${getScriptureTextClass(textSize)} relative verse-content-container`} data-verse-id={block.verseNumber} data-study-chapter-id={block.studyChapterId || currentChapter.id}>
                            {(() => {
                        const source = (currentChapter.study_chapters || [currentChapter]).find(chapter => chapter.id === block.studyChapterId) || currentChapter;
                        const parts = buildInlineVerseParts(block.text, showTextualNotes ? block.notes : []);
                        return parts.map(part => {
                          if (part.type === 'note') return <FootnotePopover key={part.key}
                            segment={{ text: part.note.caller || '*', noteBody: part.note.text,
                              noteSegments: part.note.noteSegments, markerId: part.note.markerId,
                              noteType: part.note.type === 'cross-reference' ? 'Cross-Reference' : 'Footnote' }}
                            book={block.studyLocator?.book || source.book}
                            chapter={block.studyLocator?.chapter_number || source.chapter_number}
                            verse={block.verseNumber} />;
                          const { text: token, tokenIndex: tokenIdx } = part;
                          const tokenAnns = getAnnotationsForToken(block.verseNumber, tokenIdx, source);
                          const isAnnotated = tokenAnns.length > 0;
                          const annotation = getAnnotationForToken(block.verseNumber, tokenIdx, source);
                          const isRed = redLetters && block.wjTokens?.has(tokenIdx);

                          if (/^\s+$/.test(token)) {
                            const wsHighlight = getHighlightForToken(block.verseNumber, tokenIdx, source);
                            return (
                              <span
                                key={part.key}
                                data-annotation-ids={tokenAnns.map(ann => ann.id).join(' ') || undefined}
                                style={buildTokenStyle(wsHighlight, tokenAnns.length)}
                                className={isRed ? 'text-rose-400 dark:text-rose-400' : ''}
                                onMouseEnter={tokenAnns.length ? (e) => showAnnotationPreview(e, tokenAnns) : undefined}
                                onMouseLeave={tokenAnns.length ? hideAnnotationPreview : undefined}>
                                {token}</span>);

                          }

                          if (!token) return null;
                          const hasDrawing = annotation && annotationDrawings[annotation.id];
                          const highlight = getHighlightForToken(block.verseNumber, tokenIdx, source);

                          return (
                            <span key={part.key} className="relative inline">
                                    {annotationDisplay === 'hover' && annotation && part.firstPiece &&
                              <span
                                className="absolute -left-2 top-0.5 cursor-pointer text-brand hover:text-[#5A3E87] dark:text-brand dark:hover:text-brand-strong z-10"
                                onClick={() => {
                                  handleAnnotationIconClick(annotation);
                                }}>
                                
                                        {hasDrawing ? <PenLine className="w-3 h-3" /> : <Edit2 className="w-3 h-3" />}
                                      </span>
                              }
                                    <span
                                data-token-key={`token-${block.verseNumber}-${tokenIdx}-${blockIdx}`}
                                data-annotation-ids={tokenAnns.map(ann => ann.id).join(' ') || undefined}
                                style={buildTokenStyle(highlight, tokenAnns.length)}
                                className={isRed ? 'text-rose-400 dark:text-rose-400 font-medium' : ''}
                                onMouseEnter={isAnnotated ? (e) => showAnnotationPreview(e, tokenAnns) : undefined}
                                onMouseLeave={isAnnotated ? hideAnnotationPreview : undefined}>
                                
                                      {token}
                                    </span>
                                  </span>);

                        });
                      })()}
                          </div>
                        </div>
                        <AnimatePresence initial={false}>
                        {interlinearEnabled && interlinearVerses[block.verseNumber] &&
                          <InterlinearReveal key={`interlinear-${block.studyChapterId || currentChapter.id}-${block.verseNumber}`} testId="animated-interlinear-verse">
                            {isOldTestament
                              ? <InterlinearVerse verseText={interlinearVerses[block.verseNumber]} isRtl individualWords />
                              : <InterlinearVerse greekText={interlinearVerses[block.verseNumber]} individualWords />}
                          </InterlinearReveal>
                        }
                        </AnimatePresence>
                      </>
                }
                  </div>
              ))}
              </div>
                {readerNeedsScroll && <button type="button" aria-label="Scroll to top" title="Scroll to top"
                  onClick={() => scrollReader('top')}
                  className="bex-reader-scroll mt-3 flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface/80 text-ink-muted backdrop-blur-sm transition-colors hover:border-brand/50 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand min-[1400px]:absolute min-[1400px]:-left-[5.5rem] min-[1400px]:bottom-0 min-[1400px]:mt-0">
                  <ArrowUp className="h-5 w-5" />
                </button>}
              </div>
              </AnnotationGutter>
              <ScriptureAttribution material={currentChapter} />
            </div>
          </div>
        }
      </main>
      {spatialWorkspace && <StudyCanvasTools />}
      </ScriptureWorkspace>

      {annotationDisplay === 'hover' && <AnnotationWindow
        isOpen={showAnnotationPopup}
        onClose={handleCloseAnnotationPopup}
        title={editingAnnotation ? 'Edit Annotation' : 'Add Annotation'}
        autoExpandContent={annotationContent}
        bodyClassName="bex-scripture-note-editor p-0 [&>[data-bex-global-editor]]:rounded-none [&>[data-bex-global-editor]]:border-0 [&_.ProseMirror]:!px-3 [&_.ProseMirror]:!py-2"
        saveStatus={annotationSaveStatus}
        onSave={handleSaveAnnotation}
        saving={savingAnnotation}
        onDelete={editingAnnotation ? deleteEditingAnnotation : null}
      >
        <TEXT_EDITOR_MACHINERY
          key={editingAnnotation?.id || 'new'}
          content={annotationContent}
          onChange={setAnnotationContent}
          placeholder=""
          fillHeight
          localFindShortcut
          footnotes
        />
      </AnnotationWindow>}

      <AnnotationsListModal
        open={showAnnotationsModal}
        onOpenChange={setShowAnnotationsModal}
        annotations={annotations}
        annotationDrawings={annotationDrawings}
        onEditDrawing={(ann) => {
          setEditingAnnotation(ann);
          setCurrentDrawing(annotationDrawings[ann.id]);
          setShowAnnotationsModal(false);
          setShowDrawingEditor(true);
        }}
        onEditAnnotation={(ann) => {
          setShowAnnotationsModal(false);
          handleAnnotationIconClick(ann);
        }}
        onDeleteAnnotation={handleDeleteAnnotation} />
      

      <SelectionPopover
        visible={showSelectionPopover && stage === 'view'}
        position={popoverPosition}
        onAddAnnotation={handlePopoverAddAnnotation}
        onCopy={handlePopoverCopy}
        onHighlight={handleHighlightText}
        onRemoveHighlight={handleRemoveHighlight}
        hasExistingHighlight={selectionHasHighlight()}
        onCreateDrawing={async () => {
          if (!storedSelectionText || !storedSelectionData) return;
          const selectionText = storedSelectionText;
          const selectionData = storedSelectionData;
          setShowSelectionPopover(false);
          setStoredSelectionText('');
          setStoredSelectionData(null);

          setSelectionStart({ verse: selectionData.startVerse, tokenIndex: selectionData.startToken });
          setSelectionEnd({ verse: selectionData.endVerse, tokenIndex: selectionData.endToken });
          setCapturedSelectedText(selectionText);

          const existingAnnotation = annotations.find((ann) =>
          matchesSource(ann, selectionData.chapter || currentChapter) &&
          ann.start_verse === selectionData.startVerse &&
          ann.start_token_index === selectionData.startToken &&
          ann.end_verse === selectionData.endVerse &&
          ann.end_token_index === selectionData.endToken
          );

          if (existingAnnotation) {
            const drawing = annotationDrawings[existingAnnotation.id] || null;
            setEditingAnnotation(existingAnnotation);
            setCurrentDrawing(drawing);
            setShowDrawingEditor(true);
          } else {
            const payload = {
              ...studyLocator(selectionData.chapter || currentChapter),
              start_verse: selectionData.startVerse,
              start_token_index: selectionData.startToken,
              end_verse: selectionData.endVerse,
              end_token_index: selectionData.endToken,
              selected_text: selectionText,
              content: ''
            };
            const created = await platformEntities.Annotation.create(payload);
            setEditingAnnotation(created);
            await loadAnnotations(currentChapter);
            setShowDrawingEditor(true);
          }
        }}
        copied={popoverCopied} />
      

      {keywordPreview &&
      <KeywordPreview
        keywordId={keywordPreview.keywordId}
        position={keywordPreview.position}
        onClose={() => setKeywordPreview(null)} />

      }

      {annotationDisplay === 'hover' && annotationPreview &&
      <AnnotationPreview
        annotations={annotationPreview.annotations}
        position={annotationPreview.position} />
      }

      <UnsavedChangesDialog
        open={showUnsavedWarning}
        onStay={() => {
          setShowUnsavedWarning(false);
          setPendingAction(null);
          setPendingSaveFunction(null);
        }}
        onSaveAndLeave={async () => {
          if (pendingSaveFunction && await pendingSaveFunction() === false) return;
          setShowUnsavedWarning(false);
          if (pendingAction) {
            pendingAction();
            setPendingAction(null);
            setPendingSaveFunction(null);
          }
        }}
        onLeave={() => {
          setShowUnsavedWarning(false);
          if (pendingAction) {
            pendingAction();
            setPendingAction(null);
            setPendingSaveFunction(null);
          }
        }}
        isSaving={annotationSaveStatus === 'saving'} />
      

      <div className="bex-study-footer max-w-7xl mx-auto px-4 pb-24 pt-8 flex items-center justify-center gap-6">
        <Link to={createPageUrl('ContactFeedback')} className="flex items-center gap-1.5 text-xs text-ink-faint dark:text-ink-faint hover:text-brand dark:hover:text-brand transition-colors">
          <Send className="w-3 h-3" />
          Feedback & Contact
        </Link>
        <Link to={createPageUrl('SourcesLicenses')} className="flex items-center gap-1.5 text-xs text-ink-faint dark:text-ink-faint hover:text-brand dark:hover:text-brand transition-colors">
          <FileText className="w-3 h-3" />
          Sources & Licenses
        </Link>
      </div>

      <DrawingEditor
        open={showDrawingEditor}
        onClose={() => {
          setShowDrawingEditor(false);
          setCurrentDrawing(null);
        }}
        drawingId={currentDrawing?.id}
        annotationId={editingAnnotation?.id}
        studyVersion={currentChapter?.version}
        onSave={async (savedDrawing) => {
          setAnnotationDrawings((prev) => ({
            ...prev,
            [savedDrawing.annotation_id]: savedDrawing
          }));
          await loadAnnotations(currentChapter);
          setShowDrawingEditor(false);
          setCurrentDrawing(null);
          toast.success('Drawing saved');
        }} />
      


      
      <Toaster />
    </div>);

}
