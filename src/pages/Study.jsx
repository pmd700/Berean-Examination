import React, { useState, useEffect, useRef } from 'react';
import { desktopClient } from '@/api/desktopClient';
import { platformEntities } from '@/lib/platform/entities';
import { platformFunctions } from '@/lib/platform/functions';
import { Button } from "@/components/ui/button";

import RichTextEditor from '../components/editor/RichTextEditor';
import { useAutoSave } from '../components/editor/useAutoSave';
import {
  Edit2, MessageSquare, Pencil, FileText, PenLine, Send, Lock, Sparkles, Loader2
} from 'lucide-react';
import BibleVersionSelector from '../components/study/BibleVersionSelector';
import ScriptureSearch from '../components/scripture/ScriptureSearch';
import { parseScriptureQuery } from '@/lib/scriptureReferences';
import { fetchScriptureBatch } from '@/lib/scriptureClient';
import { buildStudyChapterFromBatch } from '@/lib/apiBibleToStudyBlocks';
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
import ChapterNotesPanel from '../components/notes/ChapterNotesPanel';
import AnnotationWindow from '../components/study/AnnotationWindow';
import { trackActivity } from '../components/utils/activityTracker';
import TextSizeControl, { getScriptureTextClass, getVerseNumberClass, getHeaderClass, useTextSizePreference } from '../components/scripture/TextSizeControl';
import AnnotationsListModal from '../components/study/AnnotationsListModal';
import ContextApplicationModals from '../components/study/ContextApplicationModals';
import InterlinearSettings from '../components/interlinear/InterlinearSettings';
import InterlinearVerse from '../components/interlinear/InterlinearVerse';
import useInterlinearChapter from '../components/interlinear/useInterlinearChapter';
import StudyToolsPanel from '../components/study/StudyToolsPanel';
import VerseBibleHubButton from '../components/study/VerseBibleHubButton';
import { getBibleHubVerseUrl } from '../components/utils/bibleHub';
import RichChapterView from '../components/bible/RichChapterView';
import { useI18n } from '../components/utils/I18nContext';
import { isRemovedTranslation, REMOVED_TRANSLATION_MESSAGE } from '@shared/removedTranslations';
import {
  ESV_STUDY_EXPORT_BLOCK_MESSAGE,
  getStudyExportRightsNotice,
  isStudyMaterialExportAllowed,
} from '@/lib/bibleStudyExportPolicy';
import { readLocalOwner } from '@/lib/localOwner';
import { listAllChapterArt } from '@/lib/chapterArtRegistry';
import { useNavigate } from 'react-router-dom';
import ExternalWebLink from '@/components/navigation/ExternalWebLink';
import { useCurrentWorkspaceTab, useTabTitle } from '@/lib/WorkspaceTabs';

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
  const navigate = useNavigate();
  const currentWorkspaceTab = useCurrentWorkspaceTab();
  const { tr } = useI18n();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [textSize, setTextSize] = useTextSizePreference();
  const isOwnerUser = user?.is_local_owner === true;

  const [stage, setStage] = useState('progress');
  const [interlinearEnabled, setInterlinearEnabled] = useState(false);
  const [interlinearSource, setInterlinearSource] = useState('SBLGNT');
  const [individualWords, setIndividualWords] = useState(false);
  const [pastedText, setPastedText] = useState('');
  const [showChapterText, setShowChapterText] = useState(false);
  const savingChapterText = useRef(false);

  const [currentChapter, setCurrentChapter] = useState(null);
  const [selectedBibleId, setSelectedBibleId] = useState(() => {
    return localStorage.getItem('bex_scripture_selected_bible_id') || '317e03834065a236-01';
  });
  const [redLetters, setRedLetters] = useState(() => {
    const saved = localStorage.getItem('bex_scripture_red_letters');
    return saved !== null ? saved === 'true' : true;
  });
  const [currentSearchQuery, setCurrentSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
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
  const [capturedSelectedText, setCapturedSelectedText] = useState('');

  const [showContextModal, setShowContextModal] = useState(false);
  const [contextContent, setContextContent] = useState('');
  const [showApplicationModal, setShowApplicationModal] = useState(false);
  const [applicationContent, setApplicationContent] = useState('');

  const [showNotesPanel, setShowNotesPanel] = useState(false);
  const [notesContent, setNotesContent] = useState('');

  const [showAnnotationsModal, setShowAnnotationsModal] = useState(false);
  const [showStudyTools, setShowStudyTools] = useState(false);

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

  const { saveStatus: annotationSaveStatus, hasUnsavedChanges: hasUnsavedAnnotation, resetSaveState: resetAnnotationSave } = useAutoSave({
    content: annotationContent,
    initialContent: editingAnnotation?.content || '',
    onSave: async (content) => {
      if (editingAnnotation && selectionStart) {
        await platformEntities.Annotation.update(editingAnnotation.id, {
          content: content.trim()
        });
      }
    },
    delay: 5000,
    enabled: showAnnotationPopup
  });

  const { saveStatus: contextSaveStatus, hasUnsavedChanges: hasUnsavedContext, resetSaveState: resetContextSave } = useAutoSave({
    content: contextContent,
    initialContent: currentChapter?.context || '',
    onSave: async (content) => {
      if (currentChapter) {
        await platformEntities.StudyChapter.update(currentChapter.id, {
          context: content.trim()
        });
      }
    },
    delay: 5000,
    enabled: showContextModal
  });

  const { saveStatus: applicationSaveStatus, hasUnsavedChanges: hasUnsavedApplication, resetSaveState: resetApplicationSave } = useAutoSave({
    content: applicationContent,
    initialContent: currentChapter?.application || '',
    onSave: async (content) => {
      if (currentChapter) {
        await platformEntities.StudyChapter.update(currentChapter.id, {
          application: content.trim()
        });
      }
    },
    delay: 5000,
    enabled: showApplicationModal
  });

  const { saveStatus: notesSaveStatus, hasUnsavedChanges: hasUnsavedNotes, resetSaveState: resetNotesSave } = useAutoSave({
    content: notesContent,
    initialContent: currentChapter?.notes || '',
    onSave: async (content) => {
      if (currentChapter) {
        await platformEntities.StudyChapter.update(currentChapter.id, {
          notes: content.trim(),
          notes_updated_date: new Date().toISOString()
        });
        const updated = await platformEntities.StudyChapter.filter({ id: currentChapter.id });
        setCurrentChapter(updated[0]);
      }
    },
    delay: 800,
    enabled: showNotesPanel
  });

  useEffect(() => {
    let active = true;

    const openForLocalOwner = async () => {
      try {
        const localOwner = await readLocalOwner();
        if (!active) return;

        setUser(localOwner);
        setInterlinearEnabled(localOwner.interlinear_mode === true);
        setInterlinearSource(localOwner.interlinear_source || 'SBLGNT');
        setIndividualWords(localOwner.interlinear_words === true);
        await loadUserChapters();
        // Read this tab's path so saved study deep links still open the right record.
        const queryString = currentWorkspaceTab?.path?.split('?')[1] || window.location.search;
        const query = new URLSearchParams(queryString);
        const chapterId = query.get('chapter_id');
        const q = query.get('q');
        if (chapterId) {
          await loadChapterById(chapterId);
        } else if (q) {
          await loadScriptureQuery(q, selectedBibleId);
        }
      } catch (error) {
        console.error('[Study] local owner check failed:', error);
      } finally {
        if (active) setLoading(false);
      }
    };

    openForLocalOwner();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const queryString = currentWorkspaceTab?.path?.split('?')[1] || window.location.search;
    const query = new URLSearchParams(queryString);
    const q = query.get('q');
    if (q && q !== currentSearchQuery) {
      loadScriptureQuery(q, selectedBibleId);
    }
  }, [currentWorkspaceTab?.path]);

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
    const handleKeyUp = (e) => {
      if (e.key === 'Shift') setIsShiftPressed(false);
    };

    const handlePointerUp = () => {
      setIsDragging(false);
      setTimeout(() => {
        const browserSelection = window.getSelection();
        const selectionText = browserSelection?.toString().trim() || '';

        if (!selectionText || browserSelection.rangeCount === 0) {
          setShowSelectionPopover(false);
          setStoredSelectionText('');
          setStoredSelectionData(null);
          return;
        }

        const scriptureWrapper = document.querySelector('[data-scripture-root="true"]');
        if (!scriptureWrapper) {
          setShowSelectionPopover(false);
          return;
        }

        const anchorNode = browserSelection.anchorNode;
        const focusNode = browserSelection.focusNode;

        let anchorParent = anchorNode?.nodeType === Node.TEXT_NODE ? anchorNode.parentElement : anchorNode;
        let focusParent = focusNode?.nodeType === Node.TEXT_NODE ? focusNode.parentElement : focusNode;

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

        if (showAnnotationPopup || showDrawingEditor || showAnnotationsModal || showNotesPanel) {
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

        const startContainer = range.startContainer;
        const endContainer = range.endContainer;

        let startSpan = startContainer.nodeType === Node.TEXT_NODE ? startContainer.parentElement : startContainer;
        let endSpan = endContainer.nodeType === Node.TEXT_NODE ? endContainer.parentElement : endContainer;

        while (startSpan && !startSpan.hasAttribute('data-token-key')) startSpan = startSpan.parentElement;
        while (endSpan && !endSpan.hasAttribute('data-token-key')) endSpan = endSpan.parentElement;

        let selectionData = null;
        if (startSpan && endSpan) {
          const startKey = startSpan.getAttribute('data-token-key');
          const endKey = endSpan.getAttribute('data-token-key');
          const startMatch = startKey?.match(/token-(\d+)-(\d+)/);
          const endMatch = endKey?.match(/token-(\d+)-(\d+)/);

          if (startMatch && endMatch) {
            selectionData = {
              startVerse: parseInt(startMatch[1]),
              startToken: parseInt(startMatch[2]),
              endVerse: parseInt(endMatch[1]),
              endToken: parseInt(endMatch[2])
            };
          }
        }

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

    const handleScroll = () => {
      setShowSelectionPopover(false);
      setStoredSelectionText('');
      setStoredSelectionData(null);
    };

    const handleClickOutside = (e) => {
      if (e.target.closest('[data-selection-popover]')) return;
      setShowSelectionPopover(false);
      setStoredSelectionText('');
      setStoredSelectionData(null);
    };

    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('touchend', handlePointerUp);
    window.addEventListener('scroll', handleScroll, true);
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchend', handlePointerUp);
      window.removeEventListener('scroll', handleScroll, true);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showAnnotationPopup, showDrawingEditor, showAnnotationsModal, showNotesPanel]);


  const loadUserChapters = async () => {
    const [chapters, chapterArt] = await Promise.all([
      platformEntities.StudyChapter.list('-updated_date'),
      listAllChapterArt(),
    ]);
    const artByChapter = new Map(
      chapterArt.map((entry) => [`${entry.book}:\0${entry.chapter_number}`, entry]),
    );
    setUserChapters(chapters.map((chapter) => ({
      ...chapter,
      ...(artByChapter.get(`${chapter.book}:\0${chapter.chapter_number}`) || {}),
    })));
    const [allAnns, kws] = await Promise.all([
      platformEntities.Annotation.list('-created_date'),
      platformEntities.Keyword.list('-created_date'),
    ]);
    setAllAnnotations(allAnns);
    setKeywords(kws);
  };

  const loadChapterById = async (chapterId) => {
    try {
      const chapters = await platformEntities.StudyChapter.filter({ id: chapterId });
      if (chapters && chapters.length > 0) {
        setCurrentSearchQuery('');
        setCurrentChapter(chapters[0]);
        await loadAnnotations(chapters[0]);
        setStage('view');
      }
    } catch (error) {
      console.error('Failed to load chapter by ID:', error);
    }
  };

  const loadScriptureQuery = async (queryText, bibleId, bibleAbbr) => {
    if (!queryText || !queryText.trim()) return;
    const cleanQuery = queryText.trim();
    setCurrentSearchQuery(cleanQuery);
    setSearchLoading(true);
    try {
      const parsed = parseScriptureQuery(cleanQuery);
      if (!parsed.isReference || parsed.requests.length === 0) {
        toast.error(`Could not parse scripture reference: "${cleanQuery}"`);
        return;
      }
      const bId = bibleId || selectedBibleId;
      const batchId = `study-${Date.now()}`;
      const batchResults = await fetchScriptureBatch(parsed.requests, {
        bibleId: bId,
        batchId,
      });
      const abbr = bibleAbbr || (bId === 'de4e12af7f28f599-02' ? 'KJV' : 'BSB');
      const assembledChapter = buildStudyChapterFromBatch(parsed, batchResults, abbr);
      setCurrentChapter(assembledChapter);
      await loadAnnotations(assembledChapter);
      setStage('view');
    } catch (err) {
      console.error('Failed to load scripture query:', err);
      toast.error(err?.message || 'Failed to retrieve scripture from API.Bible');
    } finally {
      setSearchLoading(false);
    }
  };

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

  const loadAnnotations = async (chapter) => {
    if (!chapter) return;
    const locator = { book: chapter.book, chapter_number: chapter.chapter_number, version: chapter.version };
    const anns = await platformEntities.Annotation.filter(locator);
    setAnnotations(anns);

    const [drawingResults, hls] = await Promise.all([
      Promise.all(anns.map((ann) => platformEntities.Drawing.filter({ annotation_id: ann.id, is_deleted: false }))),
      platformEntities.TextHighlight.filter(locator)
    ]);

    const drawingsMap = {};
    drawingResults.forEach((drawings, index) => {
      if (drawings.length > 0) {
        drawingsMap[anns[index].id] = drawings[0];
      }
    });

    setAnnotationDrawings(drawingsMap);
    setHighlights(hls);
  };

  const handleOpenContextModal = () => {
    setContextContent(currentChapter?.context || '');
    resetContextSave(currentChapter?.context || '');
    setShowContextModal(true);
  };

  const handleCloseContextModal = () => {
    if (hasUnsavedContext || contextSaveStatus === 'saving') {
      setPendingAction(() => () => {
        setShowContextModal(false);
        resetContextSave();
      });
      setPendingSaveFunction(() => handleSaveContext);
      setShowUnsavedWarning(true);
      return;
    }
    setShowContextModal(false);
    resetContextSave();
  };

  const handleSaveContext = async () => {
    if (currentChapter) {
      await platformEntities.StudyChapter.update(currentChapter.id, { context: contextContent.trim() });
      const updated = await platformEntities.StudyChapter.filter({ id: currentChapter.id });
      setCurrentChapter(updated[0]);
      resetContextSave(contextContent.trim());
      setShowContextModal(false);
    }
  };

  const handleOpenApplicationModal = () => {
    setApplicationContent(currentChapter?.application || '');
    resetApplicationSave(currentChapter?.application || '');
    setShowApplicationModal(true);
  };

  const handleCloseApplicationModal = () => {
    if (hasUnsavedApplication || applicationSaveStatus === 'saving') {
      setPendingAction(() => () => {
        setShowApplicationModal(false);
        resetApplicationSave();
      });
      setPendingSaveFunction(() => handleSaveApplication);
      setShowUnsavedWarning(true);
      return;
    }
    setShowApplicationModal(false);
    resetApplicationSave();
  };

  const handleSaveApplication = async () => {
    if (currentChapter) {
      await platformEntities.StudyChapter.update(currentChapter.id, { application: applicationContent.trim() });
      const updated = await platformEntities.StudyChapter.filter({ id: currentChapter.id });
      setCurrentChapter(updated[0]);
      resetApplicationSave(applicationContent.trim());
      setShowApplicationModal(false);
    }
  };

  const handleOpenNotesPanel = () => {
    setNotesContent(currentChapter?.notes || '');
    resetNotesSave(currentChapter?.notes || '');
    setShowNotesPanel(true);
  };

  const handleCloseNotesPanel = () => {
    setShowNotesPanel(false);
    resetNotesSave();
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
    setAnnotationContent(initialContent);
    resetAnnotationSave(initialContent);
    setShowAnnotationPopup(true);
    setShowSelectionPopover(false);
  };

  const handlePopoverAddAnnotation = () => {
    if (!storedSelectionText || !storedSelectionData) return;
    setShowSelectionPopover(false);
    setStoredSelectionText('');
    setStoredSelectionData(null);

    setSelectionStart({ verse: storedSelectionData.startVerse, tokenIndex: storedSelectionData.startToken });
    setSelectionEnd({ verse: storedSelectionData.endVerse, tokenIndex: storedSelectionData.endToken });
    setCapturedSelectedText(storedSelectionText);
    setAnnotationContent('');
    setEditingAnnotation(null);
    resetAnnotationSave('');
    setShowAnnotationPopup(true);
  };

  const handlePopoverCopy = async () => {
    if (!storedSelectionText) return;
    if (!isStudyMaterialExportAllowed(currentChapter)) {
      toast.error(ESV_STUDY_EXPORT_BLOCK_MESSAGE);
      return;
    }
    try {
      await navigator.clipboard.writeText(storedSelectionText);
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

  const handleSaveAnnotation = async () => {
    if (!editingAnnotation && !annotationContent.trim()) {
      toast.error('Must type at least 1 character');
      return;
    }
    if (!annotationContent.trim() && !editingAnnotation) return;

    const endPoint = selectionEnd || selectionStart;
    const payload = {
      book: currentChapter.book,
      chapter_number: currentChapter.chapter_number,
      version: currentChapter.version,
      start_verse: selectionStart.verse,
      start_token_index: selectionStart.tokenIndex,
      end_verse: endPoint.verse,
      end_token_index: endPoint.tokenIndex,
      selected_text: capturedSelectedText,
      content: annotationContent.trim()
    };

    if (editingAnnotation) {
      try {
        await platformEntities.Annotation.update(editingAnnotation.id, { content: annotationContent.trim() });
      } catch (error) {
        if (error.message?.includes('not found')) {
          await platformEntities.Annotation.create(payload);
        } else {
          throw error;
        }
      }
    } else {
      await platformEntities.Annotation.create(payload);
    }

    await loadAnnotations(currentChapter);
    const annotationCount = await platformEntities.Annotation.filter({ book: currentChapter.book, chapter_number: currentChapter.chapter_number, version: currentChapter.version });
    await platformEntities.StudyChapter.update(currentChapter.id, { annotation_count: annotationCount.length });
    await loadUserChapters();
    resetAnnotationSave();
    setShowAnnotationPopup(false);
    setSelectionStart(null);
    setSelectionEnd(null);
    setEditingAnnotation(null);
    setCapturedSelectedText('');
    setAnnotationContent('');
  };

  const getHighlightForToken = (verse, tokenIndex) => {
    for (const hl of highlights) {
      const afterStart = verse > hl.start_verse || verse === hl.start_verse && tokenIndex >= hl.start_token_index;
      const beforeEnd = verse < hl.end_verse || verse === hl.end_verse && tokenIndex <= hl.end_token_index;
      if (afterStart && beforeEnd) return hl;
    }
    return null;
  };

  const handleHighlightText = async (color) => {
    if (!storedSelectionData || !currentChapter) return;
    const { startVerse, startToken, endVerse, endToken } = storedSelectionData;
    const overlapping = highlights.filter((hl) => {
      const hlStart = hl.start_verse * 100000 + hl.start_token_index;
      const hlEnd = hl.end_verse * 100000 + hl.end_token_index;
      const selStart = startVerse * 100000 + startToken;
      const selEnd = endVerse * 100000 + endToken;
      return hlStart <= selEnd && hlEnd >= selStart;
    });

    for (const hl of overlapping) await platformEntities.TextHighlight.delete(hl.id);

    await platformEntities.TextHighlight.create({
      book: currentChapter.book,
      chapter_number: currentChapter.chapter_number,
      version: currentChapter.version,
      start_verse: startVerse,
      start_token_index: startToken,
      end_verse: endVerse,
      end_token_index: endToken,
      color: color
    });

    const hls = await platformEntities.TextHighlight.filter({ book: currentChapter.book, chapter_number: currentChapter.chapter_number, version: currentChapter.version });
    setHighlights(hls);
    setShowSelectionPopover(false);
    setStoredSelectionText('');
    setStoredSelectionData(null);
    window.getSelection()?.removeAllRanges();
  };

  const handleRemoveHighlight = async () => {
    if (!storedSelectionData || !currentChapter) return;
    const { startVerse, startToken, endVerse, endToken } = storedSelectionData;
    const overlapping = highlights.filter((hl) => {
      const hlStart = hl.start_verse * 100000 + hl.start_token_index;
      const hlEnd = hl.end_verse * 100000 + hl.end_token_index;
      const selStart = startVerse * 100000 + startToken;
      const selEnd = endVerse * 100000 + endToken;
      return hlStart <= selEnd && hlEnd >= selStart;
    });

    for (const hl of overlapping) await platformEntities.TextHighlight.delete(hl.id);
    const hls = await platformEntities.TextHighlight.filter({ book: currentChapter.book, chapter_number: currentChapter.chapter_number, version: currentChapter.version });
    setHighlights(hls);
    setShowSelectionPopover(false);
    setStoredSelectionText('');
    setStoredSelectionData(null);
    window.getSelection()?.removeAllRanges();
  };

  const selectionHasHighlight = () => {
    if (!storedSelectionData) return false;
    const { startVerse, startToken, endVerse, endToken } = storedSelectionData;
    return highlights.some((hl) => {
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

  const getAnnotationsForToken = (verse, tokenIndex) =>
    annotations.filter((ann) => annotationCoversToken(ann, verse, tokenIndex));

  const isTokenAnnotated = (verse, tokenIndex) =>
    annotations.some((ann) => annotationCoversToken(ann, verse, tokenIndex));

  const getAnnotationForToken = (verse, tokenIndex) => {
    return annotations.find((ann) => ann.start_verse === verse && ann.start_token_index === tokenIndex);
  };

  // Purple annotation highlight. Overlapping annotations stack toward a more
  // opaque purple. When a token also carries a text highlight, the purple is
  // layered (as a flat gradient) on top of the highlight color so both show.
  const buildTokenStyle = (highlight, annCount) => {
    const purple = annCount > 0
      ? `rgba(107, 76, 154, ${Math.min(0.3 + (annCount - 1) * 0.2, 0.85)})`
      : null;
    if (!highlight && !purple) return undefined;
    const style = { boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone' };
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

  const handleAnnotationIconClick = (annotation) => {
    if (annotationDrawings[annotation.id]) {
      setEditingAnnotation(annotation);
      setCurrentDrawing(annotationDrawings[annotation.id]);
      setShowDrawingEditor(true);
    } else {
      setEditingAnnotation(annotation);
      setAnnotationContent(annotation.content);
      setSelectionStart({ verse: annotation.start_verse, tokenIndex: annotation.start_token_index });
      setSelectionEnd({ verse: annotation.end_verse, tokenIndex: annotation.end_token_index });
      setCapturedSelectedText(annotation.selected_text);
      resetAnnotationSave(annotation.content);
      setShowAnnotationPopup(true);
    }
  };

  // Load rich (segment) verses for NASB 2020 from any entry path (fresh fetch,
  // history open, chapter_id deep-link) and refresh stale raw_text to the
  // canonical complete-EPUB text so highlight/annotation tokens stay aligned.
  useEffect(() => {
    // Removed translations never load rich segments (no endpoint/cache hit).
    if (!currentChapter || currentChapter.version !== 'NASB2020' || isRemovedTranslation(currentChapter.version)) {
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
          if (!cancelled && refreshed[0]) setCurrentChapter(refreshed[0]);
        }
      } catch (err) {
        console.error('Failed to load NASB 2020 rich chapter:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [currentChapter?.id, currentChapter?.version]);

  const isRichView = currentChapter?.version === 'NASB2020' && Array.isArray(richVerses) && richVerses.length > 0;

  const handleDeleteAnnotation = async (ann) => {
    if (annotationDrawings[ann.id]) {
      await platformEntities.Drawing.update(annotationDrawings[ann.id].id, { is_deleted: true });
    }
    await platformEntities.Annotation.delete(ann.id);
    await loadAnnotations(currentChapter);
    const annotationCount = await platformEntities.Annotation.filter({ book: currentChapter.book, chapter_number: currentChapter.chapter_number, version: currentChapter.version });
    await platformEntities.StudyChapter.update(currentChapter.id, { annotation_count: annotationCount.length });
    await loadUserChapters();
    const verseText = ann.selected_text || '(no text)';
    const truncatedText = verseText.length > 50 ? verseText.substring(0, 47) + '...' : verseText;
    toast.success(`Annotation on v${ann.start_verse} deleted`, { description: `"${truncatedText}"` });
  };

  const handleSelectChapter = async (chapter) => {
    setCurrentChapter(chapter);
    await loadAnnotations(chapter);
    setStage('view');
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
    const locator = { book: chapter.book, chapter_number: chapter.chapter_number, version: chapter.version };
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

  const handleToggleIndividualWords = async () => {
    const nextValue = !individualWords;
    setIndividualWords(nextValue);
    await desktopClient.owner.updatePreferences({ interlinear_words: nextValue });
  };

  const handleNewChapter = () => navigate(createPageUrl('LibraryHome'));

  const handleEditChapterText = () => {
    setPastedText(currentChapter.raw_text || '');
    setShowChapterText(true);
  };

  const saveChapterText = async () => {
    if (!currentChapter || savingChapterText.current) return;
    savingChapterText.current = true;
    try {
      const updated = await platformEntities.StudyChapter.update(currentChapter.id, { raw_text: pastedText });
      setCurrentChapter(updated);
      setShowChapterText(false);
    } catch (error) {
      toast.error(error?.message || 'BEX could not save the chapter text.');
    } finally {
      savingChapterText.current = false;
    }
  };

  const closeChapterText = () => {
    if (pastedText !== (currentChapter?.raw_text || '')) {
      setPendingAction(() => () => setShowChapterText(false));
      setPendingSaveFunction(() => saveChapterText);
      setShowUnsavedWarning(true);
    } else setShowChapterText(false);
  };

  if (loading || searchLoading) {
    return <LoadingScreen message={searchLoading ? "Retrieving scripture from API.Bible…" : "Loading your Bible Study..."} />;
  }

  return (
    <div className="min-h-screen bg-app">
      <main className="max-w-7xl mx-auto px-4 py-8">
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
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="ghost" onClick={handleNewChapter} className="text-ink-faint dark:text-ink-faint hover:text-ink dark:hover:text-ink">
                  Search Scripture
                </Button>
                <BibleVersionSelector
                  selectedBibleId={selectedBibleId}
                  onSelectBible={handleSelectBible}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleToggleRedLetters}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
                    redLetters
                      ? 'border-rose-500/30 bg-rose-500/10 text-rose-300 shadow-[0_0_10px_rgba(244,63,94,0.15)] hover:bg-rose-500/20'
                      : 'border-line text-ink-faint hover:text-ink hover:bg-elevated'
                  }`}
                  title="Words of Jesus in red"
                  aria-pressed={redLetters}
                  data-testid="button-red-letters"
                >
                  <Sparkles className={`w-3.5 h-3.5 ${redLetters ? 'text-rose-400' : 'text-ink-faint'}`} />
                  <span>Red letters</span>
                </Button>
              </div>
              <Button variant="outline" onClick={() => setShowAnnotationsModal(true)} className="dark:border-line">
                <MessageSquare className="w-4 h-4 mr-2" />
                Annotations ({annotations.length})
              </Button>
            </div>

            <div className="bg-surface dark:bg-surface rounded-xl border border-line dark:border-line p-6 md:p-8">
              <div className="mb-6 max-w-2xl">
                <ScriptureSearch
                  initialQuery={currentSearchQuery}
                  onSearch={(clean) => loadScriptureQuery(clean, selectedBibleId)}
                />
              </div>

              {isRemovedTranslation(currentChapter.version) &&
            <div className="mb-6 p-6 bg-surface dark:bg-app/20 border border-line dark:border-line rounded-lg" data-testid="banner-removed-translation">
                  <div className="flex items-start gap-4">
                    <div className="p-3 rounded-lg bg-elevated dark:bg-elevated/60">
                      <Lock className="w-6 h-6 text-ink-faint dark:text-ink-faint" />
                    </div>
                    <div className="flex-1">
                      <p className="text-ink-muted dark:text-ink-muted font-semibold mb-1 line-through decoration-ink-faint">{currentChapter.version}</p>
                      <p className="text-sm text-ink-soft dark:text-ink-soft">{REMOVED_TRANSLATION_MESSAGE}</p>
                    </div>
                  </div>
                </div>
            }

              {!isRemovedTranslation(currentChapter.version) && (!currentChapter.raw_text || currentChapter.raw_text.length === 0) &&
            <div className="mb-6 p-6 bg-surface dark:bg-app/20 border-2 border-dashed border-line dark:border-line rounded-lg">
                  <div className="flex items-start gap-4">
                    <div className="p-3 rounded-lg bg-elevated dark:bg-elevated/60">
                      <Pencil className="w-6 h-6 text-ink-faint dark:text-ink-faint" />
                    </div>
                    <div className="flex-1">
                      <p className="text-ink-muted dark:text-ink-muted font-semibold mb-1">No chapter text found</p>
                      <p className="text-sm text-ink-faint dark:text-ink-soft mb-4">This chapter was created but has no text. Add the chapter text to begin studying.</p>
                      <Button onClick={handleEditChapterText} className="bg-brand hover:bg-elevated">
                        <Pencil className="w-4 h-4 mr-2" />
                        Add Chapter Text
                      </Button>
                    </div>
                  </div>
                </div>
            }

              {currentChapter.version === 'LSV' && isLsvSpecialSection(currentChapter.book) &&
            <div className="mb-4 px-4 py-2.5 bg-surface dark:bg-app/20 border border-line dark:border-line rounded-lg text-sm text-ink-faint dark:text-ink-soft italic">
                  This is a read-only section from the Literal Standard Version.
                </div>
            }

              <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <InterlinearSettings
                enabled={interlinearEnabled}
                onToggle={handleToggleInterlinear}
                onSourceChange={handleInterlinearSourceChange}
                effectiveSource={interlinearEffectiveSource}
                isNewTestament={isNewTestamentChapter}
                individualWords={individualWords}
                onToggleWords={handleToggleIndividualWords}
                isLoading={isLoadingInterlinear} />
              
                <div className="shrink-0 rounded-2xl border border-line dark:border-line bg-elevated/80 dark:bg-elevated/80 px-4 py-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-ink-faint dark:text-ink-faint">Display</p>
                  <TextSizeControl value={textSize} onChange={handleTextSizeChange} />
                  <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
                    <label className="flex items-center gap-2 text-xs text-ink-muted cursor-pointer">
                      <input
                        type="checkbox"
                        checked={redLetters}
                        onChange={handleToggleRedLetters}
                        data-testid="toggle-red-letters-display" />
                      Words of Jesus in red
                    </label>
                  </div>
                  {isRichView &&
                    <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
                      <label className="flex items-center gap-2 text-xs text-ink-muted cursor-pointer">
                        <input
                          type="checkbox"
                          checked={showTextualNotes}
                          onChange={(e) => setShowTextualNotes(e.target.checked)}
                          data-testid="toggle-textual-notes" />
                        Show NASB textual notes
                      </label>
                      {isOwnerUser &&
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
                  }
                </div>
              </div>

              {interlinearEnabled && interlinearError &&
            <p className="mb-4 px-1 text-sm text-gold" data-testid="text-interlinear-error">{interlinearError}</p>
            }
              {interlinearEnabled && interlinearEffectiveSource === 'MAM' && interlinearAttribution &&
            <p className="mb-4 px-1 text-[0.7rem] text-ink-faint dark:text-ink-soft" data-testid="text-mam-attribution">
                Source: {interlinearAttribution.source} · License:{' '}
                <a href={interlinearAttribution.licenseUrl} target="_blank" rel="noreferrer" className="underline hover:text-ink-muted">
                  {interlinearAttribution.license}
                </a>
              </p>
            }

              {!(currentChapter.version === 'LSV' && isLsvSpecialSection(currentChapter.book)) &&
            <div className="mb-6 space-y-3">
                  <Button variant="outline" onClick={() => setShowStudyTools(!showStudyTools)} className="dark:border-line">
                    <FileText className="w-4 h-4 mr-2" />
                    {showStudyTools ? 'Hide Bible Study Tools' : 'Bible Study Tools'}
                  </Button>
                  {showStudyTools &&
              <StudyToolsPanel
                currentChapter={currentChapter}
                annotations={annotations}
                hasContext={!!currentChapter.context}
                hasNotes={!!currentChapter.notes}
                hasApplication={!!currentChapter.application}
                onOpenContextModal={handleOpenContextModal}
                onOpenNotesPanel={handleOpenNotesPanel}
                onOpenApplicationModal={handleOpenApplicationModal}
                onEditChapterText={handleEditChapterText}
                onImportComplete={() => {
                  loadAnnotations(currentChapter);
                  platformEntities.StudyChapter.filter({ id: currentChapter.id }).then((c) => c.length && setCurrentChapter(c[0]));
                }} />

              }
                </div>
            }

              <div data-scripture-root="true" className="opacity-100">
                {isRemovedTranslation(currentChapter.version) ? null : isRichView ? (
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
                    }}
                    renderInterlinear={(v) => (interlinearEnabled && interlinearVerses[v])
                      ? (isOldTestament
                          ? <InterlinearVerse verseText={interlinearVerses[v]} isRtl individualWords={individualWords} />
                          : <InterlinearVerse greekText={interlinearVerses[v]} individualWords={individualWords} />)
                      : null}
                  />
                ) : (
                  (currentChapter.blocks || parseChapter(currentChapter.raw_text, currentChapter.version)).map((block, blockIdx) =>
              <div key={blockIdx} className="mb-6">
                    {block.type === 'header' ?
                <h3 className={`${getHeaderClass(textSize)} font-semibold text-ink-muted dark:text-ink-muted mb-4`}>
                        {block.text}
                      </h3> :

                <>
                        <div className="group flex gap-3">
                          <div className="pt-0.5">
                            <VerseBibleHubButton
                              verseNumber={block.verseNumber}
                              href={getBibleHubVerseUrl(currentChapter.book, currentChapter.chapter_number, block.verseNumber)}
                              className={`verse-number-badge min-w-[2.5rem] h-7 px-2 rounded bg-elevated text-brand ${getVerseNumberClass(textSize)} font-bold`}
                            />
                          </div>
                          <div className={`flex-1 font-serif text-[#F5F7FB] dark:text-[#F5F7FB] ${getScriptureTextClass(textSize)} relative verse-content-container`} data-verse-id={block.verseNumber}>
                            {(() => {
                        const tokens = tokenizeText(block.text);
                        return tokens.map((token, tokenIdx) => {
                          const tokenAnns = getAnnotationsForToken(block.verseNumber, tokenIdx);
                          const isAnnotated = tokenAnns.length > 0;
                          const annotation = getAnnotationForToken(block.verseNumber, tokenIdx);
                          const isRed = redLetters && block.wjTokens?.has(tokenIdx);

                          if (/^\s+$/.test(token)) {
                            const wsHighlight = getHighlightForToken(block.verseNumber, tokenIdx);
                            return (
                              <span
                                key={tokenIdx}
                                style={buildTokenStyle(wsHighlight, tokenAnns.length)}
                                className={isRed ? 'text-rose-400 dark:text-rose-400' : ''}
                                onMouseEnter={tokenAnns.length ? (e) => showAnnotationPreview(e, tokenAnns) : undefined}
                                onMouseLeave={tokenAnns.length ? hideAnnotationPreview : undefined}>
                                {token}</span>);

                          }

                          if (!token) return null;
                          const hasDrawing = annotation && annotationDrawings[annotation.id];
                          const highlight = getHighlightForToken(block.verseNumber, tokenIdx);

                          return (
                            <span key={tokenIdx} className="relative inline">
                                    {annotation &&
                              <span
                                className="absolute -left-2 top-0.5 cursor-pointer text-brand hover:text-[#5A3E87] dark:text-brand dark:hover:text-brand-strong z-10"
                                onClick={() => {
                                  if (hasDrawing) {
                                    setEditingAnnotation(annotation);
                                    setCurrentDrawing(annotationDrawings[annotation.id]);
                                    setShowDrawingEditor(true);
                                  } else {
                                    setEditingAnnotation(annotation);
                                    setAnnotationContent(annotation.content);
                                    setSelectionStart({ verse: annotation.start_verse, tokenIndex: annotation.start_token_index });
                                    setSelectionEnd({ verse: annotation.end_verse, tokenIndex: annotation.end_token_index });
                                    setCapturedSelectedText(annotation.selected_text);
                                    resetAnnotationSave(annotation.content);
                                    setShowAnnotationPopup(true);
                                  }
                                }}>
                                
                                        {hasDrawing ? <PenLine className="w-3 h-3" /> : <Edit2 className="w-3 h-3" />}
                                      </span>
                              }
                                    <span
                                data-token-key={`token-${block.verseNumber}-${tokenIdx}`}
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
                        {interlinearEnabled && interlinearVerses[block.verseNumber] &&
                  (isOldTestament
                    ? <InterlinearVerse verseText={interlinearVerses[block.verseNumber]} isRtl individualWords={individualWords} />
                    : <InterlinearVerse greekText={interlinearVerses[block.verseNumber]} individualWords={individualWords} />)
                  }
                      </>
                }
                  </div>
              ))}
              </div>
              <ScriptureAttribution material={currentChapter} />
            </div>
          </div>
        }
      </main>

      <AnnotationWindow
        isOpen={showChapterText}
        onClose={closeChapterText}
        title="Edit Chapter Text"
        onSave={saveChapterText}
      >
        <label className="block text-sm text-ink-muted" htmlFor="saved-chapter-text">Chapter text (### heading, ~1 verse)</label>
        <textarea id="saved-chapter-text" value={pastedText} onChange={(event) => setPastedText(event.target.value)}
          className="mt-3 h-full min-h-64 w-full rounded-md border border-line bg-surface p-3 font-mono text-sm text-ink" />
      </AnnotationWindow>

      <AnnotationWindow
        isOpen={showAnnotationPopup}
        onClose={handleCloseAnnotationPopup}
        title={editingAnnotation ? 'Edit Annotation' : 'Add Annotation'}
        saveStatus={annotationSaveStatus}
        onSave={handleSaveAnnotation}
        onDelete={editingAnnotation ? async () => {
          await handleDeleteAnnotation(editingAnnotation);
          handleCloseAnnotationPopup();
        } : null}
      >
        <RichTextEditor
          key={editingAnnotation?.id || 'new'}
          content={annotationContent}
          onChange={setAnnotationContent}
          placeholder="Write your commentary..."
          fillHeight
          localFindShortcut
        />
      </AnnotationWindow>

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
          setEditingAnnotation(ann);
          setAnnotationContent(ann.content);
          setSelectionStart({ verse: ann.start_verse, tokenIndex: ann.start_token_index });
          setSelectionEnd({ verse: ann.end_verse, tokenIndex: ann.end_token_index });
          setCapturedSelectedText(ann.selected_text);
          resetAnnotationSave(ann.content);
          setShowAnnotationsModal(false);
          setShowAnnotationPopup(true);
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
              book: currentChapter.book,
              chapter_number: currentChapter.chapter_number,
              version: currentChapter.version,
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

      {annotationPreview &&
      <AnnotationPreview
        annotations={annotationPreview.annotations}
        position={annotationPreview.position} />
      }

      <ContextApplicationModals
        showContextModal={showContextModal}
        handleCloseContextModal={handleCloseContextModal}
        contextSaveStatus={contextSaveStatus}
        contextContent={contextContent}
        setContextContent={setContextContent}
        handleSaveContext={handleSaveContext}
        showApplicationModal={showApplicationModal}
        handleCloseApplicationModal={handleCloseApplicationModal}
        applicationSaveStatus={applicationSaveStatus}
        applicationContent={applicationContent}
        setApplicationContent={setApplicationContent}
        handleSaveApplication={handleSaveApplication} />
      

      <ChapterNotesPanel
        isOpen={showNotesPanel}
        onClose={handleCloseNotesPanel}
        content={notesContent}
        onChange={setNotesContent}
        saveStatus={notesSaveStatus}
        lastEditedDate={currentChapter?.notes_updated_date}
        user={user} />
      

      <UnsavedChangesDialog
        open={showUnsavedWarning}
        onStay={() => {
          setShowUnsavedWarning(false);
          setPendingAction(null);
          setPendingSaveFunction(null);
        }}
        onSaveAndLeave={async () => {
          if (pendingSaveFunction) await pendingSaveFunction();
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
        isSaving={annotationSaveStatus === 'saving' || contextSaveStatus === 'saving' || applicationSaveStatus === 'saving'} />
      

      <div className="max-w-7xl mx-auto px-4 pb-24 pt-8 flex items-center justify-center gap-6">
        <a href={createPageUrl('ContactFeedback')} className="flex items-center gap-1.5 text-xs text-ink-faint dark:text-ink-faint hover:text-brand dark:hover:text-brand transition-colors">
          <Send className="w-3 h-3" />
          Feedback & Contact
        </a>
        <a href={createPageUrl('SourcesLicenses')} className="flex items-center gap-1.5 text-xs text-ink-faint dark:text-ink-faint hover:text-brand dark:hover:text-brand transition-colors">
          <FileText className="w-3 h-3" />
          Sources & Licenses
        </a>
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
