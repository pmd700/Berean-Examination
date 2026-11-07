import BackToMenu from '@/components/navigation/BackToMenu';
import { canvasDeleteSelection } from '@/components/knowledgeweb/canvasDeleteSelection';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { desktopClient } from '@/api/desktopClient';
import { applyNoteChange, readCurrentNoteList, subscribeToNoteChanges } from '@/lib/noteChanges';
import {
  commitLocalKnowledgeWebImport,
  previewLocalKnowledgeWebImport,
  replaceLocalKnowledgeWebGraph,
} from '@/lib/localEntities';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { createPageUrl, webDeepLink, noteDeepLink, timegraphDeepLink, parseIdFromParam } from '@/utils';
import { LoadingScreen } from '../components/ui/loading-screen';
import NoteEditorPanel from '../components/knowledgeweb/NoteEditorPanel';
import CanvasCard from '../components/knowledgeweb/CanvasCard';
import ConnectionLines, { getPorts } from '../components/knowledgeweb/ConnectionLines';
import FloatingToolbar, { KW_TOOLS, KW_DEFAULT_KEYS } from '../components/knowledgeweb/FloatingToolbar';
import useKeybinds from '../components/knowledgeweb/useKeybinds';
import KeybindRemapModal from '../components/knowledgeweb/KeybindRemapModal';
import FloatingZoomControls from '../components/knowledgeweb/FloatingZoomControls';
import CardEditor from '../components/knowledgeweb/CardEditor';
import useCardWorkspaceSession from '../components/knowledgeweb/useCardWorkspaceSession';
import { normalizeCardTitle } from '../components/knowledgeweb/cardTitle';
import {
  estimateSmartCardGeometry,
  getClosestGeometryAnchor,
  getCardGeometrySignature,
  pointInCardGeometry,
  rectIntersectsCardGeometry,
} from '../components/knowledgeweb/smartCardGeometry';
import ConnectionEditor from '../components/knowledgeweb/ConnectionEditor';
import SaveIndicator from '../components/knowledgeweb/SaveIndicator';
import SearchBar from '../components/knowledgeweb/SearchBar';
import InlineWebTitle from '../components/knowledgeweb/InlineWebTitle';
import FocusMode from '../components/knowledgeweb/FocusMode';
import FilterPanel from '../components/knowledgeweb/FilterPanel';
import CanvasDrawing from '../components/knowledgeweb/CanvasDrawing';
import CanvasSection from '../components/knowledgeweb/CanvasSection';
import CanvasImage from '../components/knowledgeweb/CanvasImage';
import CanvasPoint, { POINT_SIZE } from '../components/knowledgeweb/CanvasPoint';
import CanvasWebLink from '../components/knowledgeweb/CanvasWebLink';
import CanvasTimegraph from '../components/knowledgeweb/CanvasTimegraph';
import WebLinkPicker from '../components/knowledgeweb/WebLinkPicker';
import TimegraphPicker from '../components/timegraph/TimegraphPicker';
import WebTransitionOverlay from '../components/knowledgeweb/WebTransitionOverlay';
import ObjectInspector from '../components/knowledgeweb/ObjectInspector';
import CardLibraryPicker from '../components/knowledgeweb/CardLibraryPicker';
import ShareWebDialog from '../components/knowledgeweb/ShareWebDialog';
import SelectionMarquee from '../components/knowledgeweb/SelectionMarquee';
import TagColorPanel from '../components/knowledgeweb/TagColorPanel';
import VersionHistoryPanel from '../components/knowledgeweb/VersionHistoryPanel';
import VersionHistoryIntroDialog from '../components/knowledgeweb/VersionHistoryIntroDialog';
import ExportMenu from '../components/knowledgeweb/ExportMenu';
import CreatePrivateWebModal from '../components/knowledgeweb/CreatePrivateWebModal';
import UnlockWebModal from '../components/knowledgeweb/UnlockWebModal';
import { usePrivateWeb } from '@/lib/PrivateWebContext';
import { useDecryptedWebName } from '@/lib/useDecryptedWebName';
import { setActiveEncryption, clearActiveEncryption, encryptString, decryptString, decryptIncomingWithKey } from '@/lib/webCrypto';

import useCanvasState from '../components/knowledgeweb/useCanvasState';
import useFilteredGraph from '../components/knowledgeweb/useFilteredGraph';
import { trackActivity } from '../components/utils/activityTracker';
import { Share2, BookCopy, Grid3X3, Magnet, Crosshair, Undo2, Redo2, Settings, Focus, Spline, Tag, History, ChevronRight, StickyNote, Image as ImageIcon, Globe, CircleDot, ArrowDownUp } from 'lucide-react';
import exportKnowledgeWebToPdf, { exportKnowledgeWebToJpeg, exportKnowledgeWebToPng } from '../components/knowledgeweb/exportKnowledgeWebToPdf';
import { exportKnowledgeWebToBerean, exportKnowledgeWebToKumuJson, importKnowledgeWebFromBerean } from '../components/knowledgeweb/bereanFileFormat';
import { exportKnowledgeWebToMarkdown, importKnowledgeWebFromMarkdown } from '../components/knowledgeweb/markdownFileFormat';
import { exportAllKnowledgeWebsToZip } from '../components/knowledgeweb/fullBackup';
import { importJsonGraph } from '../components/knowledgeweb/jsonGraphImporter';
import { importKnowledgeFiles, markdownToNoteHtml } from '../components/knowledgeweb/massKnowledgeImport';
import { getExportBounds } from '../components/knowledgeweb/exportBounds';
import { canFrameOpenedWeb } from '../components/knowledgeweb/knowledgeWebOpeningFrame';
import {
  TAB_KINDS,
  useCurrentWorkspaceTab,
  useIsActiveTab,
  useTabTitle,
  useWorkspaceTabs,
} from '@/lib/WorkspaceTabs';
import { clearSpotlightPath } from '@/lib/spotlightNavigation';
import { usePersistentPreference } from '@/lib/usePersistentPreference';
import TextSizeControl, { getTextSizeScale, useTextSizePreference } from '@/components/scripture/TextSizeControl';
import { toast } from 'sonner';

// In-memory clipboard buffer for the Cmd+C / Cmd+V copy-paste flow.
// Module-scoped (not React state) so it survives re-renders without
// triggering them, but lives only as long as the page does — which is
// the right lifetime: copied private-web cards are decrypted plaintext
// and we don't want them sitting on disk in localStorage outliving the
// session. See `handleCopyCards` / `handlePasteCards` for the shape.
let kwClipboard = null;

// Connection-midpoint insert menu. Opened by clicking the little dot in
// the middle of a connection; picking an option splits the connection
// into A→new→B. Kept module-scoped so the array identity is stable and
// the entrance animation doesn't restart on unrelated re-renders.
const MIDPOINT_MENU_W = 178;
const MIDPOINT_MENU_H = 156;
const MIDPOINT_MENU_OPTIONS = [
  { kind: 'card',     label: 'Card',    hint: 'Note or verse',   Icon: StickyNote },
  { kind: 'image',    label: 'Image',   hint: 'Upload a file',   Icon: ImageIcon },
  { kind: 'web_link', label: 'Weblink', hint: 'Link a web',      Icon: Globe },
  { kind: 'point',    label: 'Point',   hint: 'Bare route node', Icon: CircleDot },
];

function SpotlightLabel({ text, query }) {
  const value = String(text || '');
  const phrase = String(query || '').trim();
  const index = value.toLocaleLowerCase().indexOf(phrase.toLocaleLowerCase());
  if (!phrase || index < 0) return value;
  return (
    <>
      {value.slice(0, index)}
      <mark className="rounded-sm bg-brand/45 px-0.5 text-inherit">{value.slice(index, index + phrase.length)}</mark>
      {value.slice(index + phrase.length)}
    </>
  );
}

export default function KnowledgeWeb() {
  // False when this workspace is open in a background tab: still mounted and
  // holding its state, but it must not answer global shortcuts.
  const isActiveTab = useIsActiveTab();
  const [textSize, setTextSize] = useTextSizePreference();
  const contentTextScale = getTextSizeScale(textSize);
  const navigate = useNavigate();
  const { tabs, activeId, openTab, closeTab, selectTab, updateTab } = useWorkspaceTabs();
  const routeParams = useParams();
  const routeLocation = useLocation();
  // Routes gives every mounted pane its own location. The browser URL belongs
  // only to the foreground tab, so async loads must never use it to identify
  // the note/web owned by this pane. Keep the latest scoped route available if
  // it changes while the library read is still in flight.
  const routeLocationRef = useRef(routeLocation);
  routeLocationRef.current = routeLocation;
  const currentWorkspaceTab = useCurrentWorkspaceTab();
  const spotlightTarget = React.useMemo(() => {
    const params = new URLSearchParams(routeLocation.search);
    return {
      query: params.get('spotlight') || '',
      field: params.get('spotlightField') || '',
      token: params.get('spotlightJump') || '',
      page: params.has('spotlightPage') ? Number(params.get('spotlightPage')) : null,
      cardId: params.get('card'),
    };
  }, [routeLocation.search]);
  const spotlightHandledRef = useRef('');
  const [activeSpotlight, setActiveSpotlight] = useState(null);
  const { isAuthenticated, isLoadingAuth, user: authUser } = useAuth();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const privateWeb = usePrivateWeb();
  const [showCreatePrivateModal, setShowCreatePrivateModal] = useState(false);
  const [createPrivateInitialName, setCreatePrivateInitialName] = useState('');
  // When set, the user clicked a locked private web and we're prompting
  // for the passphrase. Holds the full web row plus a callback to fire
  // after a successful unlock so we can resume the action that was
  // interrupted (typically: load the web).
  const [unlockTarget, setUnlockTarget] = useState(null); // { web, onUnlocked }
  const [createPrivateBusy, setCreatePrivateBusy] = useState(false);

  const [webs, setWebs] = useState([]);
  // Mirror of `webs` that any closure (e.g., the unlock-modal callback)
  // can read to get the latest list without depending on stale state
  // captured at render time. Kept in sync by the effect just below.
  const websRef = useRef([]);
  const [folders, setFolders] = useState([]);
  useEffect(() => { websRef.current = webs; }, [webs]);
  // Individual Mind Notes live in the same sidebar as webs and open inline in
  // the main pane (a unified workspace — no separate notes page).
  const [notes, setNotes] = useState([]);
  useEffect(() => subscribeToNoteChanges(change => setNotes(current => applyNoteChange(current, change))), []);
  const [activeNoteId, setActiveNoteId] = useState(null);
  const [noteReadingPage, setNoteReadingPage] = useState(null);
  const [activeWebId, setActiveWebId] = useState(null);
  // Mirror of `activeWebId` so async flows (paste, in particular) can
  // detect whether the user switched webs mid-flight. Reading the
  // state value directly inside an async callback only sees the value
  // captured when the callback was built — useless for race checks.
  const activeWebIdRef = useRef(null);
  useEffect(() => { activeWebIdRef.current = activeWebId; }, [activeWebId]);
  // Monotonic token stamped at the start of every loadWeb. Async fetches
  // that resolve after a newer load began are dropped instead of painting
  // a stale web's cards over the current one — this is what fixes the
  // "two webs flicker violently on startup" race (a slow cold-start load
  // for web A finishing after the user already switched to web B).
  const loadSeqRef = useRef(0);
  const [cards, setCards] = useState([]);
  // Smart card outlines are measured from the live title fragments, but those
  // DOM measurements must never be persisted on a WebCard. Keeping them in a
  // separate map also lets the card renderer, noodle renderer, marquee, and
  // hit-testing all consume the exact same shape in the same render.
  const [measuredCardGeometryById, setMeasuredCardGeometryById] = useState({});
  useEffect(() => {
    // Card IDs may be reused across different local webs. Discard measurements
    // when switching boards so a matching legacy title can never inherit a
    // silhouette measured in a different canvas/font-layout lifecycle.
    setMeasuredCardGeometryById({});
  }, [activeWebId]);
  const cardGeometries = React.useMemo(() => {
    const next = {};
    cards.forEach((card) => {
      const signature = getCardGeometrySignature(card);
      const measured = measuredCardGeometryById[card.id];
      next[card.id] = measured?.signature === signature
        ? measured
        : estimateSmartCardGeometry(card);
    });
    return next;
  }, [cards, measuredCardGeometryById]);
  const geometryForCard = useCallback((card) => (
    (card && cardGeometries[card.id]) || estimateSmartCardGeometry(card || {})
  ), [cardGeometries]);
  const handleCardGeometryChange = useCallback((cardId, geometry) => {
    if (cardId == null || !geometry) return;
    setMeasuredCardGeometryById((current) => {
      const previous = current[cardId];
      if (
        previous
        && previous.signature === geometry.signature
        && previous.path === geometry.path
        && previous.width === geometry.width
        && previous.height === geometry.height
      ) {
        return current;
      }
      return { ...current, [cardId]: geometry };
    });
  }, []);
  const [connections, setConnections] = useState([]);
  const [canvasObjects, setCanvasObjects] = useState([]);
  // Identifies which web the three canvas arrays currently belong to.
  // activeWebId changes before its async rows arrive, so using activeWebId
  // alone can briefly mistake the previous web's cards for the new web's.
  const [loadedCanvasWebId, setLoadedCanvasWebId] = useState(null);
  // Live mirrors of the three core arrays. Updated synchronously by
  // applySnapshot (so a rapid undo→undo correctly diffs against the
  // *just-applied* snapshot rather than the React-render-stale closure
  // value), and by an effect for everything else. Read by replaceWebData
  // when computing what to send to the server.
  const cardsRef = useRef([]);
  const connectionsRef = useRef([]);
  const canvasObjectsRef = useRef([]);
  useEffect(() => { cardsRef.current = cards; }, [cards]);
  useEffect(() => { connectionsRef.current = connections; }, [connections]);
  useEffect(() => { canvasObjectsRef.current = canvasObjects; }, [canvasObjects]);
  const [selectedCardId, setSelectedCardId] = useState(null);
  const [selectedCardIds, setSelectedCardIds] = useState([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState(null);
  const [selectedObjectId, setSelectedObjectId] = useState(null);
  // Point canvas-objects that are part of the current multi-select group.
  // Parallel to selectedCardIds — both are populated by the marquee and
  // both are cleared together. A point in this array moves with the card
  // group when any card (or any grouped point) in the selection is dragged.
  const [selectedPointIds, setSelectedPointIds] = useState([]);
  const selectedPointIdsRef = useRef([]);
  useEffect(() => { selectedPointIdsRef.current = selectedPointIds; }, [selectedPointIds]);
  const [marqueeSelection, setMarqueeSelection] = useState(null);
  const [mode, setMode] = useState('hand');
  // Remappable, persisted keybinds for the Knowledge Web canvas scope.
  const { binds: kwKeybinds, setBind: setKwBind, resetBinds: resetKwBinds, keyToTool: kwKeyToTool } = useKeybinds('kw', KW_DEFAULT_KEYS);
  const kwKeyToToolRef = useRef(kwKeyToTool);
  useEffect(() => { kwKeyToToolRef.current = kwKeyToTool; }, [kwKeyToTool]);
  const [showKwRemap, setShowKwRemap] = useState(false);
  // Draw-tool settings. Persisted to localStorage so the user's last
  // color + thickness survives reloads. The live stroke (in-progress
  // freehand) is rendered as a preview SVG and committed to a
  // canvas_objects row with object_type='drawing' on mouseup.
  const [drawColor, setDrawColor] = useState(() => {
    try { return localStorage.getItem('kw_draw_color') || '#C9A94E'; } catch { return '#C9A94E'; }
  });
  const [drawThickness, setDrawThickness] = useState(() => {
    try { return Number(localStorage.getItem('kw_draw_thickness')) || 3; } catch { return 3; }
  });
  const [liveStroke, setLiveStroke] = useState(null);
  const liveStrokeRef = useRef(null);
  const [connectionSource, setConnectionSource] = useState(null);
  const [tempLine, setTempLine] = useState(null);
  const [saveStatus, setSaveStatus] = useState('idle');
  const [showLibrary, setShowLibrary] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [hoveredConnectionId, setHoveredConnectionId] = useState(null);
  // Right-click on the midpoint dot of a connection opens this menu —
  // lets the user pick an object kind (card / image / weblink / point)
  // to insert at the midpoint, splitting the connection into A→new→B.
  // `{ connId, screenX, screenY, midX, midY }` when open.
  const [midpointMenu, setMidpointMenu] = useState(null);
  // When set, the user clicked the canvas in 'web_link' mode and we're
  // showing the picker so they can choose which knowledge web to link.
  // Holds the canvas-space coordinates where the new node should be
  // dropped after they pick.
  const [webLinkPickerPos, setWebLinkPickerPos] = useState(null);
  // Shortcut 6 places a live, compressed reference to one shared Timeline.
  const [timegraphPickerPos, setTimegraphPickerPos] = useState(null);
  // When set, a web-link node was clicked and we're playing the
  // full-screen "wow" transition to the destination web. The overlay
  // calls back at its midpoint to swap activeWebId so the new content
  // is fully ready by the time the wipe clears, and again at the end
  // to dismiss itself.
  const [webTransition, setWebTransition] = useState(null); // { webId, title, isPrivate, origin }
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingJpeg, setIsExportingJpeg] = useState(false);
  const [isExportingPng, setIsExportingPng] = useState(false);
  const [isExportingBerean, setIsExportingBerean] = useState(false);
  const [isExportingJson, setIsExportingJson] = useState(false);
  const [isExportingMarkdown, setIsExportingMarkdown] = useState(false);
  const [isMassImporting, setIsMassImporting] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backupProgress, setBackupProgress] = useState('');
  const [exportRegion, setExportRegion] = useState('whole');
  const [isImportingBerean, setIsImportingBerean] = useState(false);

  // Grid & snap state (persisted per user)
  const [showGrid, setShowGrid] = useState(() => localStorage.getItem('kw_grid') === 'true');
  const [snapToGrid, setSnapToGrid] = useState(() => localStorage.getItem('kw_snap') === 'true');
  const [connectorStyle, setConnectorStyle] = useState(() => localStorage.getItem('kw_connector_style') || 'curvy');
  // Global default color for all connections that don't override
  // their own `color` field. Persisted per-browser via localStorage
  // and overridable per-connection via the Connection Inspector.
  const [globalConnectionColor, setGlobalConnectionColor] = useState(
    // Default matches the legacy translucent slate stroke so users
    // who never touch this setting see no visual change.
    () => localStorage.getItem('kw_connection_color') || '#4b556399'
  );
  // Stored in the local owner record, not just localStorage — the desktop app
  // serves from a new origin each launch, so a localStorage-only preference is
  // wiped every time the app starts. Same key as before, and the old
  // 'true'/'false' values parse as valid JSON, so an existing choice carries
  // over rather than resetting.
  const [autoFocus, setAutoFocus] = usePersistentPreference('kw_autofocus', true);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showImportExportMenu, setShowImportExportMenu] = useState(false);
  const [showTagColorPanel, setShowTagColorPanel] = useState(false);
  const [tagColors, setTagColors] = useState({});
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showVersionIntro, setShowVersionIntro] = useState(false);
  const [versionRefreshKey, setVersionRefreshKey] = useState(0);
  const GRID_SIZE = 20;

  const [filters, setFilters] = useState({ types: [], tags: [] });
  const [focusState, setFocusState] = useState({ active: false, cardId: null, depth: 1 });
  const historyRef = useRef([]);
  const futureRef = useRef([]);
  const isRestoringHistoryRef = useRef(false);
  const pendingConnectionDeletesRef = useRef(new Set());
  const pendingConnectionUpdatesRef = useRef(new Set());

  const containerRef = useRef(null);
  const canvasContentRef = useRef(null);
  const saveTimeout = useRef(null);
  const multiDragOriginRef = useRef(null);
  // Parallel to multiDragOriginRef but for point canvas-objects that are
  // part of the same group drag. Keyed by canvasObject id → {x,y} origin.
  const multiDragPointOriginsRef = useRef(null);
  const newlyMaterializedAnchorsRef = useRef({});
  const suppressCanvasClickRef = useRef(false);
  const canvas = useCanvasState();

  // Attach the wheel handler natively (non-passive) so calling
  // preventDefault() inside the handler actually stops the browser's
  // page-level pinch-to-zoom. React's synthetic onWheel is registered
  // as a passive listener, where preventDefault() is a silent no-op,
  // which is why a fast trackpad pinch was zooming the whole page
  // instead of the canvas. We also block macOS Safari's gesture*
  // events for the same reason on touchpad pinches inside Safari.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e) => canvas.handleWheel(e);
    const blockGesture = (e) => e.preventDefault();
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', blockGesture, { passive: false });
    el.addEventListener('gesturechange', blockGesture, { passive: false });
    el.addEventListener('gestureend', blockGesture, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', blockGesture);
      el.removeEventListener('gesturechange', blockGesture);
      el.removeEventListener('gestureend', blockGesture);
    };
  }, [canvas.handleWheel, activeWebId]);

  // Threshold above which a multi-card delete demands explicit confirmation.
  const BULK_DELETE_CONFIRM_THRESHOLD = 7;
  const [pendingBulkDelete, setPendingBulkDelete] = useState(null); // { ids: number[] } | null

  // Refs let the keyboard handler (declared early) call undo/redo/deleteCard
  // which are defined later in the component without tripping the const TDZ.
  const undoRef = useRef(null);
  const redoRef = useRef(null);
  // Read inside the window keydown handler, which is registered once. A ref keeps
  // it current without re-binding the listener every time a note opens.
  const activeNoteIdRef = useRef(null);
  const deleteCardRef = useRef(null);
  const deleteConnectionRef = useRef(null);
  const deleteCanvasObjectRef = useRef(null);
  // Copy/paste lets the user duplicate selected cards (and any
  // connections that fall entirely within the selection) into the same
  // web or — more importantly — into a different web after switching.
  // Stored as refs so the keydown handler always calls the latest
  // closure without needing to rebind on every state change.
  const copyCardsRef = useRef(null);
  const cutCardsRef = useRef(null);
  const pasteCardsRef = useRef(null);

  // Keyboard shortcuts for delete + undo/redo
  useEffect(() => {
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
      ).some((element) => element.isConnected && element.offsetParent !== null);
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
        } else if (selection.cardIds.length > BULK_DELETE_CONFIRM_THRESHOLD) {
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
  }, [selectedConnectionId, selectedCardIds, selectedPointIds, selectedCardId, selectedObjectId]);

  const { filteredCards, filteredConnections } = useFilteredGraph(cards, connections, filters, focusState);

  // ── Auth & load ──
  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated) { if (isActiveTab) navigate('/'); return; }
    let cancelled = false;
    (async () => {
      const u = authUser || (await desktopClient.owner.read());
      if (cancelled) return;
      setUser(u);
      // Load webs and folders in parallel — folders are tiny but knowing
      // them up-front lets the sidebar group webs on the very first paint
      // instead of flickering "ungrouped" then re-arranging.
      const [allWebs, allFolders, allNotes] = await Promise.all([
        desktopClient.entities.KnowledgeWeb.list('sort_order', 100),
        desktopClient.entities.WebFolder.list('sort_order').catch(() => []),
        readCurrentNoteList(() => desktopClient.entities.MindNote.list('sort_order')).catch(() => []),
      ]);
      if (cancelled) return;
      setWebs(allWebs);
      setFolders(allFolders);
      setNotes(allNotes);
      // Deep-link resolution. The local SQLite record id is the source of truth and
      // is taken from the path first: `/notes/<slug>-<id>` and
      // `/knowledge-webs/<slug>-<id>`. We fall back to the legacy
      // `?note=` / `?web=` query params for older bookmarks/links.
      // A note target takes precedence over a web so links from Mind
      // View land on the note.
      const pathName = routeLocationRef.current.pathname;
      const search = new URLSearchParams(routeLocationRef.current.search);
      const noteMatch = pathName.match(/^\/notes\/(.+)$/);
      const webMatch = pathName.match(/^\/knowledge-webs\/(.+)$/);
      let noteTargetId = noteMatch ? parseIdFromParam(noteMatch[1]) : null;
      let webTargetId = webMatch ? parseIdFromParam(webMatch[1]) : null;
      if (noteTargetId == null && webTargetId == null) {
        const noteQ = search.get('note');
        const webQ = search.get('web');
        if (noteQ != null) noteTargetId = parseIdFromParam(noteQ);
        if (webQ != null) webTargetId = parseIdFromParam(webQ);
      }
      const noteTarget = noteTargetId != null
        ? allNotes.find(n => n.id === noteTargetId)
        : null;
      if (noteTarget) {
        setActiveNoteId(noteTarget.id);
        setLoading(false);
        return;
      }
      if (allWebs.length > 0) {
        // `web` IDs are `serial` (numeric) in the DB. parseIdFromParam
        // already coerced the URL string to a number; a mismatch here
        // (or a missing param) falls back to the first web — but if the
        // URL named a specific web we must honour it so the user isn't
        // dropped onto allWebs[0] (which may be private and trigger an
        // unexpected passphrase prompt).
        const fromUrl = webTargetId != null
          ? allWebs.find(w => w.id === webTargetId)
          : null;
        const target = fromUrl ? fromUrl.id : allWebs[0].id;
        // Pass the freshly-fetched list directly. Reading from `webs`
        // state inside loadWeb here would still see [] because
        // setWebs(allWebs) hasn't committed yet — that race used to
        // skip the private-web unlock check and fetch un-decrypted
        // rows on first page load.
        await loadWeb(target, null, allWebs);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [isLoadingAuth, isAuthenticated]);

  // Debounced DB write for tag colors. Coalesces rapid edits (e.g.
  // dragging the opacity slider) into a single PUT and refreshes the
  // local `webs` cache on success so subsequent loads see the new value.
  const tagColorsSaveTimerRef = useRef(null);
  const tagColorsLatestRef = useRef(null);
  const saveTagColorsToDb = useCallback((webId, next) => {
    tagColorsLatestRef.current = next;
    if (tagColorsSaveTimerRef.current) clearTimeout(tagColorsSaveTimerRef.current);
    tagColorsSaveTimerRef.current = setTimeout(async () => {
      const payload = tagColorsLatestRef.current;
      try {
        const updated = await desktopClient.entities.KnowledgeWeb.update(webId, { tag_colors: payload });
        setWebs(prev => prev.map(w => w.id === webId ? { ...w, tag_colors: (updated && updated.tag_colors) || payload } : w));
      } catch (e) {
        console.error('[tagColors] Save failed', e);
        toast.error('Could not save tag colors. Your changes are cached locally and will retry on the next edit.');
      }
    }, 600);
  }, []);

  // Per-web tag color palette. Source of truth is the `tag_colors` JSONB
  // column on the `knowledge_webs` row in the DB — that way the palette
  // follows the user across browsers, devices and cache clears (the old
  // localStorage-only path lost the palette every time storage was
  // evicted, which the user rightly complained about). localStorage is
  // kept ONLY as:
  //   1. an offline fallback while the API request is in flight, and
  //   2. a one-shot migration source when the DB still has an empty
  //      palette but the user has a previously-saved local one.
  useEffect(() => {
    if (!activeWebId) { setTagColors({}); return; }
    let cancelled = false;
    (async () => {
      // Optimistic paint from local cache so the UI doesn't flash.
      try {
        const perWeb = localStorage.getItem(`kw_tag_colors:${activeWebId}`);
        if (perWeb) setTagColors(JSON.parse(perWeb));
      } catch {}

      // Authoritative load from the DB.
      const web = webs.find(w => w.id === activeWebId);
      const dbColors = web?.tag_colors && typeof web.tag_colors === 'object' ? web.tag_colors : null;

      if (dbColors && Object.keys(dbColors).length > 0) {
        if (!cancelled) {
          setTagColors(dbColors);
          try { localStorage.setItem(`kw_tag_colors:${activeWebId}`, JSON.stringify(dbColors)); } catch {}
        }
        return;
      }

      // DB has nothing yet — try a one-shot migration of any local data
      // (per-web first, then the legacy global palette).
      let migrated = null;
      try {
        const perWeb = localStorage.getItem(`kw_tag_colors:${activeWebId}`);
        if (perWeb) migrated = JSON.parse(perWeb);
        if (!migrated || Object.keys(migrated).length === 0) {
          const legacy = localStorage.getItem('kw_tag_colors');
          if (legacy) migrated = JSON.parse(legacy);
        }
      } catch {}

      if (migrated && Object.keys(migrated).length > 0) {
        if (!cancelled) setTagColors(migrated);
        try {
          await desktopClient.entities.KnowledgeWeb.update(activeWebId, { tag_colors: migrated });
          setWebs(prev => prev.map(w => w.id === activeWebId ? { ...w, tag_colors: migrated } : w));
        } catch (e) {
          console.warn('[tagColors] Migration to DB failed; will retry on next change.', e);
        }
      } else if (!cancelled) {
        setTagColors({});
      }
    })();
    return () => { cancelled = true; };
  }, [activeWebId, webs]);

  // Track the active web and optional card for the Resume card. Camera
  // coordinates are deliberately not persisted: every open now frames the
  // complete web so a stale pan/zoom can never reopen on empty space.
  useEffect(() => {
    if (!isActiveTab || !activeWebId) return;
    const web = webs.find(w => w.id === activeWebId);
    const params = new URLSearchParams();
    params.set('web', activeWebId);
    if (selectedCardId) params.set('card', String(selectedCardId));
    // Private webs must NEVER leak their (decrypted) name into the resume
    // popup — that popup is shown before the user has unlocked anything,
    // and `web.title` for a private row is just the literal placeholder
    // "Private Web". Use a distinct activity type with a generic prompt
    // and no subtitle.
    const isPrivateWeb = !!web?.is_private;
    // The deep link carries the stable local record id in the path (the source of
    // truth) plus the stable web id and optional selected card.
    const deepLink = webDeepLink(activeWebId, isPrivateWeb ? null : web?.title)
      + '?' + params.toString();
    trackActivity({
      type: isPrivateWeb ? 'knowledge_web_private' : 'knowledge_web',
      icon: 'knowledge_web',
      page: 'KnowledgeWeb',
      title: isPrivateWeb ? 'Want to get back to working on your encrypted web?' : 'Continue on Knowledge Web?',
      subtitle: isPrivateWeb ? null : (web?.title || 'Knowledge Web'),
      url_params: params.toString(),
      deep_link: deepLink,
    });
  }, [isActiveTab, activeWebId, webs, selectedCardId]);

  // Track note activity so the Resume card can deep-link back to a
  // standalone Mind Note (same mechanism as webs — the local record id is the
  // source of truth, carried in the `/notes/<slug>-<id>` path).
  useEffect(() => {
    if (!isActiveTab || !activeNoteId || noteReadingPage?.noteId !== activeNoteId) return;
    const note = notes.find(n => n.id === activeNoteId);
    trackActivity({
      type: 'mind_note',
      icon: 'mind_note',
      page: 'KnowledgeWeb',
      title: 'Continue on your note?',
      subtitle: note?.title || 'Mind Note',
      deep_link: `${noteDeepLink(activeNoteId, note?.title)}?page=${noteReadingPage.index + 1}`,
    });
  }, [isActiveTab, activeNoteId, notes, noteReadingPage]);

  // A Resume link may still identify one card, but never restores its old
  // camera coordinates. Opening a web always frames all visible work.
  const pendingSelectionRef = useRef(null);
  // Stores the specific web waiting to be framed. A web id (rather than a
  // boolean) prevents a slow earlier load from consuming a newer fit.
  const pendingFitRef = useRef(null);
  useEffect(() => {
    try {
      const p = new URLSearchParams(routeLocationRef.current.search);
      const urlWeb = p.get('web');
      const card = p.get('card');
      if (card !== null) {
        pendingSelectionRef.current = {
          webId: urlWeb != null && urlWeb !== '' ? Number(urlWeb) : null,
          card,
        };
      }
    } catch {}
  }, []);
  useEffect(() => {
    const r = pendingSelectionRef.current;
    if (!r || !activeWebId || loadedCanvasWebId !== activeWebId) return;
    if (r.webId != null && r.webId !== activeWebId) {
      pendingSelectionRef.current = null;
      return;
    }
    const restoredCard = cards.find(c => String(c.id) === String(r.card));
    if (restoredCard) {
      setSelectedCardId(restoredCard.id);
    }
    pendingSelectionRef.current = null;
  }, [activeWebId, loadedCanvasWebId, cards]);

  useCardWorkspaceSession({ tab: currentWorkspaceTab, updateTab,
    webId: activeNoteId ? null : activeWebId, loadedWebId: loadedCanvasWebId,
    cards, selectedCardId, setSelectedCardId,
    explicitCard: new URLSearchParams(routeLocation.search).has('card'),
  });

  // An already-open Knowledge Web tab stays mounted. Consume each Spotlight
  // instruction exactly once, keep a short-lived copy solely for the purple
  // highlight, then remove the instruction from the tab path. Without this,
  // any card update made the old search target select itself again.
  useEffect(() => {
    if (!spotlightTarget.token || spotlightHandledRef.current === spotlightTarget.token) return;

    if (activeNoteId) {
      if (!notes.some((note) => String(note.id) === String(activeNoteId))) return;
    } else {
      if (!activeWebId || loadedCanvasWebId !== activeWebId) return;
      if (spotlightTarget.cardId != null) {
        const target = cards.find((card) => String(card.id) === String(spotlightTarget.cardId));
        if (!target) return;
        setActiveNoteId(null);
        setSelectedCardIds([]);
        setSelectedConnectionId(null);
        setSelectedObjectId(null);
        setSelectedCardId(target.id);
      }
    }

    spotlightHandledRef.current = spotlightTarget.token;
    setActiveSpotlight(spotlightTarget);

    const sourcePath = currentWorkspaceTab?.path
      || `${routeLocation.pathname}${routeLocation.search}`;
    const cleanPath = clearSpotlightPath(
      sourcePath,
      spotlightTarget.cardId != null ? ['card'] : [],
    );
    if (currentWorkspaceTab && cleanPath !== currentWorkspaceTab.path) {
      updateTab(currentWorkspaceTab.id, { path: cleanPath });
    } else if (!currentWorkspaceTab && cleanPath !== sourcePath) {
      navigate(cleanPath, { replace: true });
    }
  }, [
    activeNoteId,
    activeWebId,
    cards,
    currentWorkspaceTab,
    loadedCanvasWebId,
    navigate,
    notes,
    routeLocation.pathname,
    routeLocation.search,
    spotlightTarget,
    updateTab,
  ]);

  // The purple destination marker is helpful briefly, but it is not a mode.
  useEffect(() => {
    if (!activeSpotlight?.token) return undefined;
    const token = activeSpotlight.token;
    const timer = window.setTimeout(() => {
      setActiveSpotlight((current) => current?.token === token ? null : current);
    }, activeNoteId || activeSpotlight.cardId != null ? 30000 : 8000);
    return () => window.clearTimeout(timer);
  }, [activeNoteId, activeSpotlight?.token, activeSpotlight?.cardId]);

  const completeSpotlight = useCallback((token) => {
    setActiveSpotlight(current => current?.token === token ? null : current);
  }, []);

  // Leaving the searched card ends the search interaction immediately. This
  // also protects drag, multi-select and ordinary card clicks from inheriting
  // the old target's highlight behavior.
  useEffect(() => {
    if (activeSpotlight?.cardId == null) return;
    if (String(selectedCardId) !== String(activeSpotlight.cardId)) {
      setActiveSpotlight(null);
    }
  }, [activeSpotlight?.cardId, selectedCardId]);

  // Auto-fit on every web open. Crucially, this waits for loadedCanvasWebId
  // to match activeWebId, so it can never frame the previous web's cards
  // while the newly selected web is still loading.
  useEffect(() => {
    const fitWebId = pendingFitRef.current;
    if (loading || !canFrameOpenedWeb(fitWebId, activeWebId, loadedCanvasWebId)) return;
    if (!containerRef.current) return;

    const hasVisibleWork = cards.length > 0 || canvasObjects.length > 0;
    const bounds = hasVisibleWork
      ? getExportBounds(cards, canvasObjects, connections, cardGeometries)
      : null;
    pendingFitRef.current = null;

    // Wait for both the web rows and the final canvas dimensions to paint.
    const firstFrame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (activeWebIdRef.current !== fitWebId || !containerRef.current) return;
        const width = containerRef.current.clientWidth;
        const height = containerRef.current.clientHeight;
        if (width <= 0 || height <= 0) return;

        if (!bounds) {
          canvas.setZoom(1);
          canvas.setPan({ x: width / 2, y: height / 2 });
          return;
        }
        canvas.fitToBounds(bounds, width, height, 64);
      });
    });
    return () => cancelAnimationFrame(firstFrame);
  }, [loading, activeWebId, loadedCanvasWebId, cards, connections, canvasObjects, cardGeometries, canvas.fitToBounds]);

  const loadWeb = async (webId, justUnlockedKey = null, webListOverride = null) => {
    // Private webs require an unlock step before we'll fetch their rows.
    // If the user hasn't unlocked this web in the current session, queue
    // the load behind the unlock modal — the modal's success callback
    // will resume by calling loadWeb again with the freshly-derived key
    // passed in, so we don't have to rely on React state having flushed
    // (which can leave isUnlocked stale and cause the modal to re-open
    // and get stuck on "Verifying…").
    //
    // Web lookup falls back through three sources, each more authoritative
    // than the next: explicit override (used by the auth-load effect when
    // setWebs hasn't committed yet) → ref (always points at the latest
    // webs, so deferred callbacks like the unlock modal don't see a stale
    // empty list) → React state. If we still can't find the row but the
    // caller already handed us a freshly-derived key, we trust the key
    // and treat the web as private — better than silently falling through
    // to clearActiveEncryption() and fetching blanks.
    const list = webListOverride || (websRef.current && websRef.current.length ? websRef.current : webs);
    const targetWeb = list.find(w => w.id === webId);
    if (targetWeb?.is_private && !justUnlockedKey && !privateWeb.isUnlocked(webId)) {
      setUnlockTarget({
        web: targetWeb,
        // Pass the row through so the resumed call has it even if `webs`
        // is still stale in this closure.
        onUnlocked: async (key) => { await loadWeb(webId, key, [targetWeb]); },
      });
      return;
    }
    // Every open gets a fresh frame after this exact web's rows finish
    // loading. Saved camera coordinates are intentionally ignored.
    if (
      pendingSelectionRef.current?.webId != null
      && pendingSelectionRef.current.webId !== webId
    ) {
      pendingSelectionRef.current = null;
    }
    pendingFitRef.current = webId;
    setLoadedCanvasWebId(null);
    // Claim this load as the latest. We stamp a monotonically-increasing
    // token and mirror activeWebId synchronously (the ref effect runs a
    // tick later, too late for the post-await guard below) so any older
    // in-flight loadWeb can detect it has been superseded.
    const loadSeq = ++loadSeqRef.current;
    activeWebIdRef.current = webId;
    setActiveWebId(webId);
    clearSelection();
    setMode('hand');
    setConnectionSource(null);
    setTempLine(null);
    setFocusState({ active: false, cardId: null, depth: 1 });
    setFilters({ types: [], tags: [] });
    historyRef.current = [];
    futureRef.current = [];
    // Activate per-web encryption BEFORE fetching so the entity wrapper
    // decrypts each row on the way in. For non-private webs this is a
    // no-op (clears any stale context from the previous selection).
    const isPrivate = targetWeb?.is_private || !!justUnlockedKey;
    if (isPrivate) {
      const key = justUnlockedKey || privateWeb.getKey(webId);
      if (key) setActiveEncryption({ webId, key });
      else clearActiveEncryption();
    } else {
      clearActiveEncryption();
    }
    let c, conn, objs;
    try {
      [c, conn, objs] = await Promise.all([
        desktopClient.entities.WebCard.filter({ web_id: webId }),
        desktopClient.entities.WebConnection.filter({ web_id: webId }),
        desktopClient.entities.CanvasObject.filter({ web_id: webId }),
      ]);
    } catch (err) {
      // A superseded load failing is expected during fast web switches —
      // swallow it so it can't surface as an unhandled rejection or abort
      // the awaiting startup auth-load effect (which would leave the app
      // stuck on the loading screen). Only surface errors for the load
      // that still owns the canvas.
      if (loadSeq === loadSeqRef.current && activeWebIdRef.current === webId) {
        console.error('[KnowledgeWeb] loadWeb failed:', err);
      }
      return;
    }
    // Stale-load guard: a newer loadWeb started (or the user switched
    // webs) while our three fetches were in flight. Applying these rows
    // now would paint the wrong web over the current one — the root cause
    // of the startup flicker. Drop this result; the latest load owns the
    // canvas.
    if (loadSeq !== loadSeqRef.current || activeWebIdRef.current !== webId) return;
    const normalizedCards = c.map(card => ({
      ...card,
      title: normalizeCardTitle(card.title),
    }));
    setCards(normalizedCards);

    // Older builds stored "New Card" as a real title. It was only ever meant
    // to be a prompt, so remove that legacy value from public cards as they are
    // encountered. Private cards are normalized in memory here and will be
    // persisted the next time the user edits them, avoiding an encryption-
    // context race during rapid web switching.
    if (!isPrivate) {
      const legacyCards = c.filter(card => normalizeCardTitle(card.title) !== (card.title || ''));
      if (legacyCards.length > 0) {
        void Promise.allSettled(
          legacyCards.map(card => desktopClient.entities.WebCard.update(card.id, { title: '' }))
        );
      }
    }
    setConnections(conn);
    // Filter out legacy 'text' canvas_objects rows — the Text Block
    // tool was removed in favor of the Draw tool. Rows are left in
    // the DB (no destructive deletion) but never re-enter live state,
    // so they can't render, inflate export bounds, populate the
    // inspector, or otherwise leak into UI behavior.
    setCanvasObjects(objs.filter(o => o.object_type !== 'text'));
    setLoadedCanvasWebId(webId);
  };

  const clearSelection = () => {
    setSelectedCardId(null);
    setSelectedCardIds([]);
    setSelectedConnectionId(null);
    setSelectedObjectId(null);
    setSelectedPointIds([]);
  };

  const flashSave = useCallback(() => {
    setSaveStatus('saving');
    clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 1200);
    }, 300);
  }, []);

  const buildSnapshot = useCallback(() => ({
    cards,
    connections,
    canvasObjects,
  }), [cards, connections, canvasObjects]);

  const applySnapshot = useCallback((snapshot) => {
    isRestoringHistoryRef.current = true;
    const nextCards = snapshot.cards || [];
    const nextConnections = snapshot.connections || [];
    // Filter out legacy 'text' canvas_objects rows (Text Block tool
    // was removed) — see the comment in the initial loader for why.
    const nextObjects = (snapshot.canvasObjects || []).filter(o => o.object_type !== 'text');
    // Update refs synchronously so a follow-up undo/redo issued before
    // React re-renders still sees the just-applied state when computing
    // its server diff.
    cardsRef.current = nextCards;
    connectionsRef.current = nextConnections;
    canvasObjectsRef.current = nextObjects;
    setCards(nextCards);
    setConnections(nextConnections);
    setCanvasObjects(nextObjects);
    // Undo restores the web's data, not the user's viewing state. Keep the
    // open card/inspector selected when that item still exists in the restored
    // snapshot; clearing it here used to unmount CardEditor and unexpectedly
    // throw fullscreen readers back onto the canvas after every canvas undo.
    const nextCardIds = new Set(nextCards.map((card) => String(card.id)));
    const nextConnectionIds = new Set(nextConnections.map((connection) => String(connection.id)));
    const nextObjectIds = new Set(nextObjects.map((object) => String(object.id)));
    setSelectedCardId((current) => (
      current != null && nextCardIds.has(String(current)) ? current : null
    ));
    setSelectedCardIds((current) => current.filter((id) => nextCardIds.has(String(id))));
    setSelectedConnectionId((current) => (
      current != null && nextConnectionIds.has(String(current)) ? current : null
    ));
    setSelectedObjectId((current) => (
      current != null && nextObjectIds.has(String(current)) ? current : null
    ));
    setSelectedPointIds((current) => current.filter((id) => nextObjectIds.has(String(id))));
    setConnectionSource(null);
    setTempLine(null);
    setTimeout(() => {
      isRestoringHistoryRef.current = false;
    }, 0);
  }, []);

  // Serialize graph replacements so rapid undo/redo commands cannot
  // interleave. Each snapshot is committed as one encrypted transaction.
  const replaceQueueRef = useRef(Promise.resolve());

  const replaceWebData = useCallback(async (snapshot) => {
    if (!activeWebId) return;
    const myTurn = replaceQueueRef.current.then(() => (
      replaceLocalKnowledgeWebGraph(activeWebId, snapshot)
    ));
    replaceQueueRef.current = myTurn.catch(() => {});
    try {
      const restoredSnapshot = await myTurn;
      applySnapshot(restoredSnapshot);
      flashSave();
    } catch (error) {
      console.error('[KnowledgeWeb] local snapshot restore failed', error);
      toast.error(error?.message || 'Could not restore this version');
    }
  }, [activeWebId, applySnapshot, flashSave]);

  const pushHistorySnapshot = useCallback(() => {
    if (!activeWebId || isRestoringHistoryRef.current) return;
    historyRef.current = [...historyRef.current, buildSnapshot()];
    if (historyRef.current.length > 100) historyRef.current = historyRef.current.slice(-100);
    futureRef.current = [];
  }, [activeWebId, buildSnapshot]);

  // Leading-edge gesture-aware snapshot push. Use this from handlers that
  // fire many times during a single user gesture (live drag, resize,
  // routing-point drag). The first call inside a gesture pushes a
  // snapshot; subsequent calls within `quietMs` of the last call do not.
  // Each `key` (e.g. `card-resize-${id}`) tracks its own gesture so two
  // simultaneous gestures don't suppress each other.
  const gestureSnapshotTimersRef = useRef({});
  const pushHistorySnapshotForGesture = useCallback((key, quietMs = 600) => {
    const timers = gestureSnapshotTimersRef.current;
    if (!timers[key]) {
      pushHistorySnapshot();
    }
    clearTimeout(timers[key]);
    timers[key] = setTimeout(() => {
      delete timers[key];
    }, quietMs);
  }, [pushHistorySnapshot]);
  // Ref mirror so handlers with empty useCallback deps can still reach
  // the latest version without being recreated on every render.
  const pushHistorySnapshotForGestureRef = useRef(pushHistorySnapshotForGesture);
  useEffect(() => {
    pushHistorySnapshotForGestureRef.current = pushHistorySnapshotForGesture;
  }, [pushHistorySnapshotForGesture]);
  const pushHistorySnapshotRef = useRef(pushHistorySnapshot);
  useEffect(() => {
    pushHistorySnapshotRef.current = pushHistorySnapshot;
  }, [pushHistorySnapshot]);

  const undo = useCallback(async () => {
    const previous = historyRef.current[historyRef.current.length - 1];
    if (!previous) return;
    historyRef.current = historyRef.current.slice(0, -1);
    futureRef.current = [...futureRef.current, buildSnapshot()];
    await replaceWebData(previous);
  }, [buildSnapshot, replaceWebData]);

  const redo = useCallback(async () => {
    const next = futureRef.current[futureRef.current.length - 1];
    if (!next) return;
    futureRef.current = futureRef.current.slice(0, -1);
    historyRef.current = [...historyRef.current, buildSnapshot()];
    await replaceWebData(next);
  }, [buildSnapshot, replaceWebData]);

  // ── Manual version-history snapshots ──
  // Distinct from autosave (live, automatic) and the in-memory undo/redo
  // history. These are persisted in encrypted SQLite so the user can return
  // days later and restore. Each click costs local space, hence the one-time intro
  // explainer warning the user not to spam it.
  const persistVersionSnapshot = useCallback(async () => {
    if (!activeWebId) return;
    const snap = buildSnapshot();
    const label = new Date().toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
    try {
      await desktopClient.entities.WebVersion.create({
        web_id: activeWebId,
        label: `Saved ${label}`,
        snapshot: JSON.stringify(snap),
      });
      setVersionRefreshKey((k) => k + 1);
      toast.success('Snapshot added to version history');
    } catch (err) {
      toast.error(err?.message || 'Could not save snapshot');
    }
  }, [activeWebId, buildSnapshot]);

  const handleAddToVersionHistory = useCallback(() => {
    if (!activeWebId) return;
    const seen = localStorage.getItem('kw_version_intro_seen') === 'true';
    if (!seen) {
      setShowVersionIntro(true);
      return;
    }
    persistVersionSnapshot();
  }, [activeWebId, persistVersionSnapshot]);

  const handleVersionIntroConfirm = useCallback(() => {
    localStorage.setItem('kw_version_intro_seen', 'true');
    setShowVersionIntro(false);
    persistVersionSnapshot();
  }, [persistVersionSnapshot]);

  const handleVersionRestore = useCallback(async (snapshot) => {
    if (!snapshot) return;
    pushHistorySnapshot();
    await replaceWebData(snapshot);
    setShowVersionHistory(false);
    toast.success('Version restored');
  }, [pushHistorySnapshot, replaceWebData]);

  // ── Web CRUD ──
  const handleCreateWeb = async (title) => {
    const w = await desktopClient.entities.KnowledgeWeb.create({ title });
    setWebs(prev => [w, ...prev]);
    setActiveNoteId(null);
    await loadWeb(w.id);
  };

  // ── Notes (inline editor) ──
  // Selecting a note clears the active web (and vice versa) so the main pane
  // shows exactly one thing — the unified workspace the user asked for.
  const handleSelectWeb = useCallback((webId, ...rest) => {
    setActiveNoteId(null);
    return loadWeb(webId, ...rest);
  }, [loadWeb]);

  const handleSelectNote = useCallback((noteId) => {
    setActiveWebId(null);
    setActiveNoteId(noteId);
  }, []);

  const handleCreateNote = useCallback(async () => {
    try {
      const created = await desktopClient.entities.MindNote.create({
        title: 'Untitled Note',
        content: '',
        tags: [],
      });
      setNotes(prev => [created, ...prev]);
      setActiveWebId(null);
      setActiveNoteId(created.id);
    } catch (e) {
      toast.error('Could not create note.');
    }
  }, []);

  const handleNoteSaved = useCallback((saved) => {
    setNotes(prev => prev.map(n => (n.id === saved.id ? { ...n, ...saved } : n)));
  }, []);

  const handleNoteDeleted = useCallback((id) => {
    setNotes(prev => prev.filter(n => n.id !== id));
    setActiveNoteId(curr => (curr === id ? null : curr));
  }, []);

  const [noteReorderResetSignal, setNoteReorderResetSignal] = useState(0);

  const handleReorderNotes = useCallback(async (folderId, orderedNoteIds) => {
    try {
      const reordered = await desktopClient.entities.MindNote.reorder(orderedNoteIds, folderId);
      const recordsById = new Map(reordered.map(record => [record.id, record]));
      setNotes(prev => prev.map(note => recordsById.get(note.id) || note));
    } catch (err) {
      console.error('[handleReorderNotes] rollback', err);
      toast.error('Could not save note order: ' + (err?.message || 'unknown error'));
      try {
        const fresh = await desktopClient.entities.MindNote.list('sort_order');
        setNotes(Array.isArray(fresh) ? fresh : []);
      } catch (refetchErr) {
        console.error('[handleReorderNotes] refetch failed', refetchErr);
      }
      setNoteReorderResetSignal(s => s + 1);
    }
  }, []);

  const handleMoveNoteToFolder = useCallback(async (noteId, folderId) => {
    try {
      const updated = await desktopClient.entities.MindNote.update(noteId, {
        folder_id: folderId,
        sort_order: -Date.now(),
      });
      setNotes(prev => prev.map(n => n.id === noteId ? { ...n, ...updated } : n));
    } catch (err) {
      console.error('[handleMoveNoteToFolder]', err);
      toast.error('Could not move note: ' + (err?.message || 'unknown error'));
    }
  }, []);

  const handleDeleteNoteFromSidebar = useCallback(async (noteId) => {
    try {
      await desktopClient.entities.MindNote.delete(noteId);
      handleNoteDeleted(noteId);
    } catch (err) {
      console.error('[handleDeleteNoteFromSidebar]', err);
      toast.error('Could not delete note: ' + (err?.message || 'unknown error'));
    }
  }, [handleNoteDeleted]);

  const handleViewBrain = useCallback(() => {
    navigate(createPageUrl('MindView'));
  }, [navigate]);

  // ── Deep-link URL <-> selection sync ──
  // The browser URL is the persistent record of what's open. These two
  // effects keep it in lockstep with `activeWebId` / `activeNoteId` so a
  // refresh, new tab, bookmark or share always reopens the same item.
  //
  // (1) selection -> URL. After the initial load resolves the selection
  // from the URL, mirror any subsequent selection back into the address
  // bar. The first sync `replace`s (normalising e.g. `/knowledge-webs/12`
  // to `/knowledge-webs/title-12`); selecting a *different* item pushes a
  // new history entry so the back button works; a same-item change (a
  // rename re-slugging the path) replaces so it doesn't spam history.
  const lastUrlSyncRef = useRef({ type: undefined, id: undefined });
  useEffect(() => {
    if (loading) return;
    // The URL belongs to whichever tab is on screen. A background workspace
    // writing to it would drag the visible tab somewhere the user never asked
    // to go.
    if (!isActiveTab) return;
    let type = null, id = null, target, legacyNotePath = false;
    if (activeNoteId) {
      if (noteReadingPage?.noteId !== activeNoteId) return;
      type = 'note'; id = activeNoteId;
      const n = notes.find(x => x.id === activeNoteId);
      const location = routeLocationRef.current;
      const routeParams = new URLSearchParams(location.search);
      legacyNotePath = location.pathname === '/KnowledgeWeb'
        && parseIdFromParam(routeParams.get('note')) === activeNoteId
        && (lastUrlSyncRef.current.type === undefined || lastUrlSyncRef.current.id === activeNoteId);
      const params = new URLSearchParams(legacyNotePath || (location.pathname.startsWith('/notes/')
        && parseIdFromParam(location.pathname.split('/').at(-1)) === activeNoteId) ? location.search : '');
      params.set('page', String(noteReadingPage.index + 1));
      target = `${legacyNotePath ? location.pathname : noteDeepLink(activeNoteId, n?.title)}?${params}`;
    } else if (activeWebId) {
      type = 'web'; id = activeWebId;
      const w = webs.find(x => x.id === activeWebId);
      target = webDeepLink(activeWebId, w?.is_private ? null : w?.title);
    } else {
      target = createPageUrl('KnowledgeWeb');
    }
    const prev = lastUrlSyncRef.current;
    const selectionChanged = prev.type !== type || prev.id !== id;
    const isFirst = prev.type === undefined;
    lastUrlSyncRef.current = { type, id };
    // Preserve any viewport query already on the URL (deep links from the
    // Resume card carry px/py/z) — only compare/replace the path.
    if ((type === 'note' ? `${routeLocationRef.current.pathname}${routeLocationRef.current.search}` : window.location.pathname) === target) return;
    // On the very first render, only normalise the URL if we're already on
    // a deep-link path (e.g. `/knowledge-webs/12` -> `/knowledge-webs/title-12`,
    // which stays on the same route component). Don't auto-upgrade the
    // legacy `/KnowledgeWeb` (or `/`) entry to a deep link, since that
    // swaps route elements and would needlessly remount the page on the
    // default auto-selected web. Real user selections (handled below)
    // still update the URL.
    const onDeepLinkPath = window.location.pathname.startsWith('/knowledge-webs/')
      || window.location.pathname.startsWith('/notes/');
    if (isFirst && !onDeepLinkPath && !legacyNotePath) return;
    navigate(target, { replace: isFirst || !selectionChanged });
  }, [loading, activeWebId, activeNoteId, webs, notes, navigate, noteReadingPage]);

  // (2) URL -> selection. Catches param changes that happen *without* a
  // remount: browser back/forward between two deep links, or a Resume
  // card click while this page is already mounted. A fresh page load is
  // handled by the auth/load effect instead, so we wait for `loading`.
  // NB: key this effect on the full `pathname`, not just `slugId`. Both
  // tables can share an id (e.g. note 1 and web 1), so navigating between
  // `/notes/1` and `/knowledge-webs/1` via back/forward leaves `slugId`
  // unchanged — only the pathname flips. Watching pathname catches it.
  useEffect(() => {
    if (loading) return;
    // Route params reflect the tab on screen. Without this, a Knowledge Web
    // sitting in a background tab would follow the *visible* tab's deep link
    // and quietly swap out the web the user left open here.
    if (!isActiveTab) return;
    const path = routeLocation.pathname;
    if (path.startsWith('/notes/')) {
      const id = parseIdFromParam(routeParams.slugId);
      if (id != null && id !== activeNoteId && notes.some(n => n.id === id)) {
        handleSelectNote(id);
      }
    } else if (path.startsWith('/knowledge-webs/')) {
      const id = parseIdFromParam(routeParams.slugId);
      // Compare against the LIVE refs, not the closure's `activeWebId` /
      // `webs` (this effect intentionally omits them from its deps, so the
      // closure can be stale). A stale comparison here re-issues
      // handleSelectWeb for a web that is already active/loading, which
      // feeds the startup flicker loop.
      if (id != null && id !== activeWebIdRef.current && websRef.current.some(w => w.id === id)) {
        handleSelectWeb(id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeLocation.pathname, routeParams.slugId, loading, isActiveTab]);

  // Called by CreatePrivateWebModal once the user has chosen a name and
  // passphrase. The modal already derived the AES key, generated the salt,
  // and produced the ciphertexts. Save them locally, register the key, and
  // load the new web.
  const handleCreatePrivateWeb = async (payload) => {
    setCreatePrivateBusy(true);
    try {
      const { is_private, enc_salt, enc_verifier, enc_name, cryptoKey } = payload;
      // Deliberately do NOT include the user's chosen name here — only the
      // ciphertext (enc_name) is saved. The plaintext name lives only in
      // the user's session memory, not in the local database or logs.
      const w = await desktopClient.entities.KnowledgeWeb.create({
        is_private,
        enc_salt,
        enc_verifier,
        enc_name,
      });
      await privateWeb.registerNewWeb(w.id, cryptoKey);
      setWebs(prev => [w, ...prev]);
      setShowCreatePrivateModal(false);
      // Activate encryption synchronously then load — loadWeb will see
      // the web is unlocked and proceed normally.
      setActiveEncryption({ webId: w.id, key: cryptoKey });
      // The previous setWebs is async; loadWeb consults the local `webs`
      // state to look up is_private, so we briefly cheat by calling its
      // body directly with the just-created web.
      setActiveWebId(w.id);
      clearSelection();
      setMode('hand');
      setConnectionSource(null);
      setTempLine(null);
      setFocusState({ active: false, cardId: null, depth: 1 });
      setFilters({ types: [], tags: [] });
      historyRef.current = [];
      futureRef.current = [];
      setCards([]); setConnections([]); setCanvasObjects([]);
      pendingFitRef.current = w.id;
      setLoadedCanvasWebId(w.id);
      toast.success('Private web created. Only you can read its contents.');
    } catch (err) {
      console.error('[handleCreatePrivateWeb] failed', err);
      toast.error('Could not create private web: ' + (err?.message || 'unknown error'));
      throw err;
    } finally {
      setCreatePrivateBusy(false);
    }
  };

  const handleUnlockWeb = async (passphrase) => {
    if (!unlockTarget?.web) return;
    const target = unlockTarget.web;
    // Verification is entirely local. A wrong passphrase throws without
    // writing, locking, counting attempts, or deleting any library data.
    const key = await privateWeb.unlock(target, passphrase);
    const cb = unlockTarget.onUnlocked;
    setUnlockTarget(null);
    if (cb) await cb(key);
  };

  // Lock a private web. If the web being locked is the one currently
  // loaded on screen, immediately purge its decrypted state from memory
  // so no further edits can be saved as plaintext (which would otherwise
  // bypass the encryption layer once the active key is gone).
  const handleLockWeb = useCallback((id) => {
    privateWeb.lock(id);
    if (activeWebId === id) {
      clearActiveEncryption();
      setActiveWebId(null);
      setCards([]);
      setConnections([]);
      setCanvasObjects([]);
      clearSelection();
      setMode('hand');
      setConnectionSource(null);
      setTempLine(null);
      setFocusState({ active: false, cardId: null, depth: 1 });
      setFilters({ types: [], tags: [] });
      historyRef.current = [];
      futureRef.current = [];
      toast.success('Web locked. Reopen it to view.');
    }
  }, [privateWeb, activeWebId]);

  const handleRenameWeb = async (id, newTitle) => {
    if (!newTitle.trim()) return;
    const target = webs.find(w => w.id === id);
    if (target?.is_private) {
      // Encrypt the new name with the web's key (must be unlocked) and
      // send only the ciphertext. Server keeps `title` as the placeholder.
      const key = privateWeb.getKey(id);
      if (!key) {
        toast.error('Unlock this web before renaming it.');
        return;
      }
      const enc_name = await encryptString(key, newTitle.trim());
      await desktopClient.entities.KnowledgeWeb.update(id, { enc_name });
      setWebs(prev => prev.map(w => w.id === id ? { ...w, enc_name } : w));
      return;
    }
    await desktopClient.entities.KnowledgeWeb.update(id, { title: newTitle.trim() });
    setWebs(prev => prev.map(w => w.id === id ? { ...w, title: newTitle.trim() } : w));
  };

  const handleDuplicateWeb = async (id) => {
    const original = webs.find(w => w.id === id);
    if (!original) return;
    const newWeb = await desktopClient.entities.KnowledgeWeb.create({ title: `${original.title} (copy)`, graph_data: original.graph_data || '{}' });
    const [srcCards, srcConns, srcObjs] = await Promise.all([
      desktopClient.entities.WebCard.filter({ web_id: id }),
      desktopClient.entities.WebConnection.filter({ web_id: id }),
      desktopClient.entities.CanvasObject.filter({ web_id: id }),
    ]);
    await Promise.all([
      ...srcCards.map(c => desktopClient.entities.WebCard.create({ ...c, id: undefined, web_id: newWeb.id })),
      ...srcConns.map(c => desktopClient.entities.WebConnection.create({ ...c, id: undefined, web_id: newWeb.id })),
      ...srcObjs.map(o => desktopClient.entities.CanvasObject.create({ ...o, id: undefined, web_id: newWeb.id })),
    ]);
    setWebs(prev => [...prev, newWeb]);
    await loadWeb(newWeb.id);
  };

  const handleDeleteWeb = async (id) => {
    await desktopClient.entities.KnowledgeWeb.delete(id);
    const cs = await desktopClient.entities.WebCard.filter({ web_id: id });
    const conns = await desktopClient.entities.WebConnection.filter({ web_id: id });
    const objs = await desktopClient.entities.CanvasObject.filter({ web_id: id });
    await Promise.all([
      ...cs.map(c => desktopClient.entities.WebCard.delete(c.id)),
      ...conns.map(c => desktopClient.entities.WebConnection.delete(c.id)),
      ...objs.map(o => desktopClient.entities.CanvasObject.delete(o.id)),
    ]);
    setWebs(prev => prev.filter(w => w.id !== id));
    if (activeWebId === id) {
      const remaining = webs.filter(w => w.id !== id);
      if (remaining.length > 0) await loadWeb(remaining[0].id);
      else { setActiveWebId(null); setCards([]); setConnections([]); setCanvasObjects([]); setMode('hand'); }
    }
  };

  // ── Folder CRUD (sidebar grouping) ──
  // Folders are flat per-user labels — no hierarchy, no access control. A
  // private web placed inside a folder is still protected by its own
  // passphrase; folders just keep them tucked out of sight in the sidebar.
  const handleCreateFolder = async (name) => {
    const f = await desktopClient.entities.WebFolder.create({
      name: (name || '').trim() || 'Folder',
      category: 'web',
    });
    setFolders(prev => [f, ...prev]);
    return f;
  };

  const handleRenameFolder = async (id, name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    const f = await desktopClient.entities.WebFolder.update(id, { name: trimmed });
    setFolders(prev => prev.map(x => x.id === id ? { ...x, ...f } : x));
  };

  const handleDeleteFolder = async (id) => {
    await desktopClient.entities.WebFolder.delete(id);
    // Detach any webs the user had filed inside this folder so they
    // re-appear at the top level immediately, matching what the server
    // already did transactionally.
    setFolders(prev => prev.filter(f => f.id !== id));
    setWebs(prev => prev.map(w => w.folder_id === id ? { ...w, folder_id: null } : w));
    setNotes(prev => prev.map(n => n.folder_id === id ? { ...n, folder_id: null } : n));
  };

  const handleMoveWebToFolder = async (webId, folderId) => {
    // folderId === null moves the web back to the top level.
    const updated = await desktopClient.entities.KnowledgeWeb.update(webId, {
      folder_id: folderId,
      sort_order: -Date.now(),
    });
    setWebs(prev => prev.map(w => w.id === webId ? { ...w, ...updated } : w));
  };

  // Bumped on every reorder failure so the sidebar can throw away its
  // optimistic local state and resync from props. Without this, a 409
  // "stale order" rejection leaves the sidebar showing the rejected
  // arrangement (its own local mirror is untouched, and parent state
  // never changed because we don't optimistically mutate it here).
  const [reorderResetSignal, setReorderResetSignal] = useState(0);

  // Persist a drag-and-drop reorder for the webs inside one container
  // (top level when folderId is null, or a specific folder otherwise).
  // The sidebar has already shifted its own local state so the user sees
  // the new arrangement instantly; on error we re-fetch from the server
  // and tell the sidebar to discard its mirror.
  const handleReorderWebs = useCallback(async (folderId, orderedWebIds) => {
    try {
      const reordered = await desktopClient.entities.KnowledgeWeb.reorder(orderedWebIds, folderId);
      const recordsById = new Map(reordered.map(record => [record.id, record]));
      // Mirror saved folder/order values while the sidebar keeps showing
      // its already-applied optimistic arrangement.
      setWebs(prev => prev.map(w => recordsById.get(w.id) || w));
    } catch (err) {
      console.error('[handleReorderWebs] rollback', err);
      toast.error('Could not save the new order: ' + (err?.message || 'unknown error'));
      // Authoritative refetch + discard the sidebar's optimistic mirror.
      try {
        const fresh = await desktopClient.entities.KnowledgeWeb.list('sort_order', 100);
        setWebs(Array.isArray(fresh) ? fresh : []);
      } catch (refetchErr) {
        console.error('[handleReorderWebs] refetch failed', refetchErr);
      }
      setReorderResetSignal(s => s + 1);
    }
  }, []);

  const handleReorderFolders = useCallback(async (orderedFolderIds) => {
    try {
      const reordered = await desktopClient.entities.WebFolder.reorder(orderedFolderIds);
      const recordsById = new Map(reordered.map(record => [record.id, record]));
      setFolders(prev => prev.map(folder => recordsById.get(folder.id) || folder));
    } catch (err) {
      console.error('[handleReorderFolders] rollback', err);
      toast.error('Could not save the new folder order: ' + (err?.message || 'unknown error'));
      try {
        const fresh = await desktopClient.entities.WebFolder.list('sort_order');
        setFolders(Array.isArray(fresh) ? fresh : []);
      } catch (refetchErr) {
        console.error('[handleReorderFolders] refetch failed', refetchErr);
      }
      setReorderResetSignal(s => s + 1);
    }
  }, []);

  // ── Card CRUD ──
  const createCard = async (x, y) => {
    if (!activeWebId) return null;
    pushHistorySnapshot();
    const card = await desktopClient.entities.WebCard.create({
      web_id: activeWebId, title: '',
      x: Math.round(x), y: Math.round(y), width: 200, height: 120,
      layout_mode: 'smart',
    });
    setCards(prev => [...prev, card]);
    setSelectedCardId(card.id);
    setSelectedCardIds([card.id]);
    setSelectedConnectionId(null);
    setSelectedObjectId(null);
    flashSave();
    return card;
  };

  const updateCard = async (cardId, data) => {
    const exists = cards.some(c => c.id === cardId);
    if (!exists) return;
    pushHistorySnapshot();
    setCards(prev => prev.map(c => c.id === cardId ? { ...c, ...data } : c));
    await desktopClient.entities.WebCard.update(cardId, data);
    flashSave();
  };

  const deletingCardIdsRef = useRef(new Set());

  const deleteCard = async (cardId) => {
    // Re-entrancy guard: the swipe-away await below keeps the card in state +
    // selected for ~200ms, during which a held Delete key (key-repeat) or
    // erase-mode click can re-fire deleteCard for the same id — that would
    // push duplicate history snapshots and issue a second WebCard.delete that
    // rejects (already gone). Skip while a delete for this id is in flight.
    if (deletingCardIdsRef.current.has(cardId)) return;
    deletingCardIdsRef.current.add(cardId);
    try {
      pushHistorySnapshot();
      // Swipe-away: slide the live card up-and-left + fade before it leaves the
      // DOM. Best-effort (Web Animations API) — never block the delete on it.
      try {
        const node = document.querySelector(`[data-card-id="${CSS.escape(String(cardId))}"]`);
        if (node && typeof node.animate === 'function') {
          await new Promise((resolve) => {
            const anim = node.animate(
              [
                { transform: 'translate(0px, 0px) scale(1)', opacity: 1 },
                { transform: 'translate(-32px, -40px) scale(0.82)', opacity: 0 },
              ],
              { duration: 200, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' }
            );
            let settled = false;
            const done = () => { if (!settled) { settled = true; resolve(); } };
            anim.onfinish = done;
            anim.oncancel = done;
            setTimeout(done, 260);
          });
        }
      } catch { /* animation is best-effort */ }
      // Connection cleanup must check kind: card and point ids live in
      // separate sequences and can collide numerically.
      const matchesCardEndpoint = (c) =>
        ((c.from_kind || 'card') === 'card' && c.from_card_id === cardId) ||
        ((c.to_kind || 'card') === 'card' && c.to_card_id === cardId);
      setCards(prev => prev.filter(c => c.id !== cardId));
      setConnections(prev => prev.filter(c => !matchesCardEndpoint(c)));
      setSelectedCardId(null);
      setSelectedCardIds(prev => prev.filter(id => id !== cardId));
      if (focusState.active && focusState.cardId === cardId) setFocusState({ active: false, cardId: null, depth: 1 });
      await desktopClient.entities.WebCard.delete(cardId);
      const related = connections.filter(matchesCardEndpoint);
      await Promise.all(related.map(c => desktopClient.entities.WebConnection.delete(c.id)));
      flashSave();
    } finally {
      deletingCardIdsRef.current.delete(cardId);
    }
  };

  const cardDragFrameRef = useRef(null);
  const pendingCardPositionsRef = useRef(null);

  const handlePositionUpdate = useCallback((cardId, x, y) => {
    // Snapshot at the start of the *actual* drag (first live position
    // update), not on plain mousedown — otherwise simple selection
    // clicks would pollute history and clobber the redo stack.
    pushHistorySnapshotForGestureRef.current?.(`card-drag-${cardId}`);
    pendingCardPositionsRef.current = { cardId, x, y };
    if (cardDragFrameRef.current) return;

    cardDragFrameRef.current = requestAnimationFrame(() => {
      const latest = pendingCardPositionsRef.current;
      cardDragFrameRef.current = null;
      if (!latest) return;

      const originMap = multiDragOriginRef.current;
      if (originMap?.[latest.cardId]) {
        const dx = latest.x - originMap[latest.cardId].x;
        const dy = latest.y - originMap[latest.cardId].y;
        setCards(prev => prev.map(c => originMap[c.id] ? {
          ...c,
          x: originMap[c.id].x + dx,
          y: originMap[c.id].y + dy,
        } : c));
        // Move any grouped routing-points by the same delta.
        const ptOriginMap = multiDragPointOriginsRef.current;
        if (ptOriginMap) {
          setCanvasObjects(prev => prev.map(o => ptOriginMap[o.id] ? {
            ...o,
            x: ptOriginMap[o.id].x + dx,
            y: ptOriginMap[o.id].y + dy,
          } : o));
        }
        return;
      }

      setCards(prev => prev.map(c => c.id === latest.cardId ? { ...c, x: latest.x, y: latest.y } : c));
    });
  }, []);

  const snapValue = useCallback((v) => {
    return snapToGrid ? Math.round(v / GRID_SIZE) * GRID_SIZE : Math.round(v);
  }, [snapToGrid]);

  const handleCardDragEnd = async (cardId, x, y) => {
    // Note: snapshot is pushed in handleCardDragStart so undo restores
    // the pre-drag position, not the dropped position.
    const originMap = multiDragOriginRef.current;

    // Helper: persist any anchor offsets that were locked at drag-start
    const saveNewAnchors = async () => {
      const toSave = newlyMaterializedAnchorsRef.current;
      const entries = Object.entries(toSave || {});
      if (entries.length > 0) {
        await Promise.all(entries.map(([connId, anchors]) =>
          desktopClient.entities.WebConnection.update(connId, anchors)
        ));
      }
      newlyMaterializedAnchorsRef.current = {};
    };

    if (originMap?.[cardId]) {
      const dx = snapValue(x) - originMap[cardId].x;
      const dy = snapValue(y) - originMap[cardId].y;
      const updatedPositions = Object.fromEntries(
        Object.entries(originMap).map(([id, pos]) => [id, {
          x: Math.round(pos.x + dx),
          y: Math.round(pos.y + dy),
        }])
      );

      setCards(prev => prev.map(c => updatedPositions[c.id] ? { ...c, ...updatedPositions[c.id] } : c));

      // Persist grouped routing-points with the same delta.
      const ptOriginMap = multiDragPointOriginsRef.current;
      if (ptOriginMap && Object.keys(ptOriginMap).length > 0) {
        const updatedPoints = Object.fromEntries(
          Object.entries(ptOriginMap).map(([id, pos]) => [id, {
            x: Math.round(pos.x + dx),
            y: Math.round(pos.y + dy),
          }])
        );
        setCanvasObjects(prev => prev.map(o => updatedPoints[o.id] ? { ...o, ...updatedPoints[o.id] } : o));
        await Promise.all(
          Object.entries(updatedPoints).map(([id, pos]) => desktopClient.entities.CanvasObject.update(id, pos))
        );
      }
      multiDragPointOriginsRef.current = null;

      await Promise.all(
        Object.entries(updatedPositions).map(([id, pos]) => desktopClient.entities.WebCard.update(id, pos))
      );
      multiDragOriginRef.current = null;
      await saveNewAnchors();
      flashSave();
      return;
    }

    const rx = snapValue(x); const ry = snapValue(y);
    setCards(prev => prev.map(c => c.id === cardId ? { ...c, x: rx, y: ry } : c));
    await desktopClient.entities.WebCard.update(cardId, { x: rx, y: ry });
    await saveNewAnchors();
    flashSave();
  };

  const handleQuickRename = async (cardId, newTitle) => { await updateCard(cardId, { title: newTitle }); };

  const cardResizeTimers = useRef({});
  const handleCardResize = useCallback((cardId, width, height, options = {}) => {
    // Push a single history snapshot at the START of the resize gesture
    // so undo restores the pre-resize size. The leading-edge gesture
    // helper makes sure we don't flood history during the drag.
    pushHistorySnapshotForGestureRef.current?.(`card-resize-${cardId}`);
    const rw = Math.round(width);
    const rh = Math.round(height);
    const layoutMode = options.layoutMode || 'manual';

    setCards(prev => prev.map(c => c.id === cardId
      ? { ...c, width: rw, height: rh, layout_mode: layoutMode }
      : c));

    clearTimeout(cardResizeTimers.current[cardId]);
    cardResizeTimers.current[cardId] = setTimeout(async () => {
      await desktopClient.entities.WebCard.update(cardId, {
        width: rw,
        height: rh,
        layout_mode: layoutMode,
      });
      if (!options.silent) flashSave();
    }, 200);
  }, [flashSave]);
  const handleImageDrop = async (cardId, file) => {
    pushHistorySnapshot();
    const { file_url } = await desktopClient.media.uploadFile({ file });
    await updateCard(cardId, { image_url: file_url });
  };

  // ── Canvas object CRUD ──
  const createCanvasObject = async (type, x, y, extra = {}) => {
    if (!activeWebId) return;
    pushHistorySnapshot();
    const defaults = {
      section: { width: 400, height: 300, title: 'Section', color: 'default' },
      image: { width: 240, height: 160 },
      // Drawings carry their bbox in width/height and their geometry
      // in strokes_data — defaults are placeholders the caller always
      // overrides.
      drawing: { width: 1, height: 1 },
      // Points are visually a fixed-size dot — width/height here are just the
      // logical bounds the schema requires. Renderer treats POINT_SIZE as truth.
      point: { width: 12, height: 12 },
      timegraph: { width: 240, height: 150 },
    };
    const obj = await desktopClient.entities.CanvasObject.create({
      web_id: activeWebId,
      object_type: type,
      x: Math.round(x), y: Math.round(y),
      ...defaults[type],
      ...extra,
    });
    setCanvasObjects(prev => [...prev, obj]);
    setSelectedObjectId(obj.id);
    setSelectedCardId(null);
    setSelectedCardIds([]);
    setSelectedConnectionId(null);
    flashSave();
    return obj;
  };

  const updateCanvasObject = async (objId, data) => {
    pushHistorySnapshot();
    // Snapshot the row before mutating so we can either (a) re-create
    // it server-side if the server has no record of it (e.g. after a
    // partially-failed undo/redo left a "ghost" section in local
    // state), or (b) revert local state on an irrecoverable failure.
    const prevObj = canvasObjectsRef.current.find(o => o.id === objId);
    // Optimistic local update — without this the user's rename/move
    // appears to silently revert whenever the server call rejects.
    setCanvasObjects(prev => prev.map(o => o.id === objId ? { ...o, ...data } : o));
    try {
      await desktopClient.entities.CanvasObject.update(objId, data);
      flashSave();
    } catch (err) {
      // 404 = the row is missing server-side. Recover by re-creating
      // it from the merged local state so the user's edit persists.
      // We skip this for `point` objects because connections reference
      // a point by id; recreating would orphan those connections.
      const recreatable = err?.status === 404
        && prevObj && activeWebId
        && prevObj.object_type !== 'point';
      if (recreatable) {
        try {
          const { id: _drop, ...payload } = { ...prevObj, ...data };
          const recreated = await desktopClient.entities.CanvasObject.create({
            ...payload,
            web_id: activeWebId,
          });
          setCanvasObjects(prev => prev.map(o => o.id === objId ? recreated : o));
          setSelectedObjectId(curr => (curr === objId ? recreated.id : curr));
          flashSave();
          return;
        } catch (recreateErr) {
          console.error('[KnowledgeWeb] updateCanvasObject: recreate after 404 failed', recreateErr);
        }
      }
      // Irrecoverable — revert the optimistic change and surface the
      // error. We intentionally do NOT rethrow: most callers invoke
      // this from blur/autosave handlers without awaiting, so a throw
      // here would surface as an unhandled promise rejection.
      if (prevObj) {
        setCanvasObjects(prev => prev.map(o => o.id === objId ? prevObj : o));
      }
      console.error('[KnowledgeWeb] updateCanvasObject failed', err);
      try { toast.error('Failed to save change.'); } catch (_) {}
    }
  };

  const deleteCanvasObject = async (objId) => {
    pushHistorySnapshot();
    // If the object being removed is a routing point, deal with any
    // connections that reference it. The naive behavior is to also
    // delete those connections — but a routing point is almost always
    // used as a "via" between two cards (Yes → point → Same), and
    // deleting it should obviously splice the two halves into one
    // direct connection (Yes → Same), not nuke both. We do that for
    // any point with exactly two connections; for points with one or
    // three+ connections we fall back to the simple delete-and-orphan
    // because there's no single intuitive merged shape to produce.
    const obj = canvasObjects.find(o => o.id === objId);
    let orphanedConnIds = [];
    let mergedConn = null;
    if (obj?.object_type === 'point') {
      const matchesPoint = (c) =>
        ((c.from_kind || 'card') === 'point' && c.from_card_id === objId) ||
        ((c.to_kind || 'card') === 'point' && c.to_card_id === objId);
      const touching = connections.filter(matchesPoint);
      orphanedConnIds = touching.map(c => c.id);

      if (touching.length === 2) {
        // Pull the "other" endpoint of each connection (the side not
        // pinned to this point) so we can wire them together.
        const otherEnd = (c) => {
          const fromIsPoint = (c.from_kind || 'card') === 'point' && c.from_card_id === objId;
          return fromIsPoint
            ? { id: c.to_card_id,   kind: c.to_kind   || 'card', anchor: c.to_anchor_offset }
            : { id: c.from_card_id, kind: c.from_kind || 'card', anchor: c.from_anchor_offset };
        };
        const [a, b] = touching;
        const aEnd = otherEnd(a);
        const bEnd = otherEnd(b);
        // Skip the splice for a self-loop (same card on both sides) — a
        // direct conn between the same endpoint is just visual noise.
        const isSelfLoop = aEnd.id === bEnd.id && aEnd.kind === bEnd.kind;
        if (!isSelfLoop) {
          // Pick a direction that flows naturally: if exactly one of the
          // two had the point as its TO-side, that one's "from" becomes
          // the new from. (Yes→point + point→Same  ⇒  Yes→Same.)
          // Otherwise just go a → b.
          const aPointIsTo = (a.to_kind || 'card') === 'point' && a.to_card_id === objId;
          const bPointIsTo = (b.to_kind || 'card') === 'point' && b.to_card_id === objId;
          let fromSide, toSide, donor;
          if (aPointIsTo && !bPointIsTo) { fromSide = aEnd; toSide = bEnd; donor = a; }
          else if (bPointIsTo && !aPointIsTo) { fromSide = bEnd; toSide = aEnd; donor = b; }
          else { fromSide = aEnd; toSide = bEnd; donor = a; }
          mergedConn = {
            web_id: donor.web_id,
            from_card_id: fromSide.id,
            to_card_id: toSide.id,
            from_kind: fromSide.kind,
            to_kind: toSide.kind,
            from_anchor_offset: fromSide.anchor || null,
            to_anchor_offset: toSide.anchor || null,
            has_arrow: donor.has_arrow,
            label: donor.label || null,
            color: donor.color || null,
            style: donor.style || null,
            thickness: donor.thickness || 2,
          };
        }
      }

      if (orphanedConnIds.length) {
        setConnections(prev => prev.filter(c => !orphanedConnIds.includes(c.id)));
      }
    } else if (obj?.object_type === 'image' || obj?.object_type === 'web_link' || obj?.object_type === 'timegraph') {
      // Images and web-links can be connection endpoints too (via the
      // midpoint-insert flow). Drop any connections that touch them so
      // we don't leave dangling arrows pointing at nothing.
      const matchesObj = (c) =>
        ((c.from_kind || 'card') === obj.object_type && c.from_card_id === objId) ||
        ((c.to_kind || 'card') === obj.object_type && c.to_card_id === objId);
      const touching = connections.filter(matchesObj);
      orphanedConnIds = touching.map(c => c.id);
      if (orphanedConnIds.length) {
        setConnections(prev => prev.filter(c => !orphanedConnIds.includes(c.id)));
      }
    }
    await desktopClient.entities.CanvasObject.delete(objId);
    if (orphanedConnIds.length) {
      await Promise.all(orphanedConnIds.map(id => desktopClient.entities.WebConnection.delete(id)));
    }
    if (mergedConn) {
      const created = await desktopClient.entities.WebConnection.create(mergedConn);
      setConnections(prev => [...prev, created]);
    }
    setCanvasObjects(prev => prev.filter(o => o.id !== objId));
    setSelectedPointIds(prev => prev.filter(id => id !== objId));
    setSelectedObjectId(null);
    flashSave();
  };

  const handleObjPositionUpdate = useCallback((objId, x, y) => {
    // Push snapshot at the start of the live drag so undo restores the
    // pre-drag position. Canvas objects don't have a separate dragStart
    // hook, so we detect "first frame" via the gesture helper.
    pushHistorySnapshotForGestureRef.current?.(`obj-drag-${objId}`);

    // If this object is part of a multi-select group (point-initiated drag),
    // propagate the delta to all grouped cards and points.
    const ptOriginMap = multiDragPointOriginsRef.current;
    if (ptOriginMap?.[objId]) {
      const dx = x - ptOriginMap[objId].x;
      const dy = y - ptOriginMap[objId].y;
      setCanvasObjects(prev => prev.map(o => ptOriginMap[o.id]
        ? { ...o, x: ptOriginMap[o.id].x + dx, y: ptOriginMap[o.id].y + dy }
        : o
      ));
      const cardOriginMap = multiDragOriginRef.current;
      if (cardOriginMap) {
        setCards(prev => prev.map(c => cardOriginMap[c.id]
          ? { ...c, x: cardOriginMap[c.id].x + dx, y: cardOriginMap[c.id].y + dy }
          : c
        ));
      }
      return;
    }

    setCanvasObjects(prev => prev.map(o => o.id === objId ? { ...o, x, y } : o));
  }, []);

  const handleObjDragEnd = async (objId, x, y) => {
    // Snapshot already pushed by handleObjPositionUpdate at gesture start.
    const rx = snapValue(x); const ry = snapValue(y);

    // If this point was driving a group drag, persist all grouped items.
    const ptOriginMap = multiDragPointOriginsRef.current;
    if (ptOriginMap?.[objId]) {
      const dx = rx - ptOriginMap[objId].x;
      const dy = ry - ptOriginMap[objId].y;

      const updatedPoints = Object.fromEntries(
        Object.entries(ptOriginMap).map(([id, pos]) => [id, {
          x: Math.round(pos.x + dx), y: Math.round(pos.y + dy),
        }])
      );
      setCanvasObjects(prev => prev.map(o => updatedPoints[o.id] ? { ...o, ...updatedPoints[o.id] } : o));
      await Promise.all(
        Object.entries(updatedPoints).map(([id, pos]) => desktopClient.entities.CanvasObject.update(id, pos))
      );

      const cardOriginMap = multiDragOriginRef.current;
      if (cardOriginMap) {
        const updatedCards = Object.fromEntries(
          Object.entries(cardOriginMap).map(([id, pos]) => [id, {
            x: Math.round(pos.x + dx), y: Math.round(pos.y + dy),
          }])
        );
        setCards(prev => prev.map(c => updatedCards[c.id] ? { ...c, ...updatedCards[c.id] } : c));
        await Promise.all(
          Object.entries(updatedCards).map(([id, pos]) => desktopClient.entities.WebCard.update(id, pos))
        );
        multiDragOriginRef.current = null;
      }
      multiDragPointOriginsRef.current = null;
      flashSave();
      return;
    }

    setCanvasObjects(prev => prev.map(o => o.id === objId ? { ...o, x: rx, y: ry } : o));
    await desktopClient.entities.CanvasObject.update(objId, { x: rx, y: ry });
    flashSave();
  };

  const handleObjResize = useCallback((objId, w, h) => {
    pushHistorySnapshotForGestureRef.current?.(`obj-resize-${objId}`);
    const rw = Math.round(w); const rh = Math.round(h);
    setCanvasObjects(prev => prev.map(o => o.id === objId ? { ...o, width: rw, height: rh } : o));
    clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      desktopClient.entities.CanvasObject.update(objId, { width: rw, height: rh });
      flashSave();
    }, 300);
  }, []);

  // ── Connection CRUD ──
  const createConnection = async (from, to) => {
    if (!activeWebId) return;
    // Endpoints are {id, kind, anchor?}. Plain numbers are accepted for
    // back-compat (older call sites just passed card ids directly).
    // `anchor` is an optional { side } picked from the click location so
    // the noodle latches near the user's mouse instead of falling back to
    // the center-to-center heuristic in ConnectionLines.
    const f = typeof from === 'object' ? from : { id: from, kind: 'card' };
    const t = typeof to === 'object' ? to : { id: to, kind: 'card' };
    if (f.id === t.id && f.kind === t.kind) return;
    pushHistorySnapshot();
    const exists = connections.find(c => {
      const fk = c.from_kind || 'card';
      const tk = c.to_kind || 'card';
      return (
        (c.from_card_id === f.id && fk === f.kind && c.to_card_id === t.id && tk === t.kind) ||
        (c.from_card_id === t.id && fk === t.kind && c.to_card_id === f.id && tk === f.kind)
      );
    });
    if (exists) return;
    const payload = {
      web_id: activeWebId,
      from_card_id: f.id, to_card_id: t.id,
      from_kind: f.kind, to_kind: t.kind,
      has_arrow: false,
    };
    // Only persist anchors for card endpoints — points have a single
    // attachment point so a side enum is meaningless for them.
    if (f.kind === 'card' && f.anchor && f.anchor.side) {
      payload.from_anchor_offset = { side: f.anchor.side };
    }
    if (t.kind === 'card' && t.anchor && t.anchor.side) {
      payload.to_anchor_offset = { side: t.anchor.side };
    }
    const conn = await desktopClient.entities.WebConnection.create(payload);
    setConnections(prev => [...prev, conn]);
    // Don't auto-select the new connection — opening the editor on every
    // create was disruptive while the user is still wiring things up.
    // The user can click the connection later to edit it.
    flashSave();
  };

  const updateConnection = async (connId, data, options = {}) => {
    const exists = connections.some(c => c.id === connId);
    // Don't write to a connection we just deleted — the row is gone server-side.
    // We deliberately do NOT short-circuit on a pending UPDATE here: if the
    // user moves an endpoint from one side of a card to another while a
    // prior in-flight save (e.g. from the inspector or a card drag) hasn't
    // returned yet, dropping the second update silently was leaving the
    // anchor change un-persisted — the UI showed the new side but the next
    // page load reverted to the old one. Concurrent PUTs are idempotent on
    // the field set we send, and the optimistic state below already holds
    // the latest values, so racing them is safe and "last write wins" lands
    // on the correct final state.
    if (!exists || pendingConnectionDeletesRef.current.has(connId)) return;
    if (!options.skipHistory) pushHistorySnapshot();
    pendingConnectionUpdatesRef.current.add(connId);
    setConnections(prev => prev.map(c => c.id === connId ? { ...c, ...data } : c));
    try {
      await desktopClient.entities.WebConnection.update(connId, data);
      flashSave();
    } finally {
      pendingConnectionUpdatesRef.current.delete(connId);
    }
  };

  const deleteConnection = async (connId, options = {}) => {
    const exists = connections.some(c => c.id === connId);
    if (!exists || pendingConnectionDeletesRef.current.has(connId)) return;
    if (!options.skipHistory) pushHistorySnapshot();
    pendingConnectionDeletesRef.current.add(connId);
    setConnections(prev => prev.filter(c => c.id !== connId));
    setSelectedConnectionId(current => current === connId ? null : current);
    try {
      await desktopClient.entities.WebConnection.delete(connId);
      flashSave();
    } finally {
      pendingConnectionDeletesRef.current.delete(connId);
    }
  };

  // ── Copy / paste ──
  // Cmd/Ctrl+C snapshots the currently selected cards plus any
  // connections that link two selected cards into an in-memory buffer
  // (kwClipboard, declared at module scope at the bottom of this file).
  // Cmd/Ctrl+V re-creates them in whatever web is active right now —
  // typically a *different* one — so the user can ferry a chunk of
  // one network across to another.
  //
  // Why an in-memory buffer instead of localStorage: copied private-web
  // cards are decrypted plaintext at the moment of copy. Persisting
  // that to localStorage would leave readable copies on disk that
  // outlive the session and bypass the private-web at-rest model. The
  // buffer dies with the page, which is the right tradeoff. The
  // KnowledgeWeb page stays mounted as the user switches webs, so
  // cross-web paste still works fine within a session.
  //
  // Routing-point endpoints are skipped (they live in canvas_objects,
  // not cards) and restoring them on paste would require copying that
  // whole secondary structure too.

  const handleCopyCards = useCallback((opts = {}) => {
    if (!selectedCardIds || selectedCardIds.length === 0) return;
    const selected = new Set(selectedCardIds);
    const cardsToCopy = cards.filter(c => selected.has(c.id));
    if (cardsToCopy.length === 0) return;

    // Only carry connections whose BOTH endpoints are in the selection
    // and are real card endpoints. Half-attached connections can't be
    // remapped in the new web, and routing-point connections need
    // canvas_objects we don't copy.
    const connsToCopy = connections.filter(c => {
      const fk = c.from_kind || 'card';
      const tk = c.to_kind || 'card';
      return fk === 'card' && tk === 'card'
        && selected.has(c.from_card_id)
        && selected.has(c.to_card_id);
    });

    kwClipboard = {
      version: 1,
      copiedAt: Date.now(),
      sourceWebId: activeWebId,
      cards: cardsToCopy.map(c => ({
        _origId: c.id,
        title: c.title,
        description: c.description,
        tags: c.tags,
        image_url: c.image_url,
        scripture_refs: c.scripture_refs,
        color: c.color,
        link_url: c.link_url,
        x: Number(c.x) || 0,
        y: Number(c.y) || 0,
        width: Number(c.width) || 200,
        height: Number(c.height) || 120,
        layout_mode: c.layout_mode || 'smart',
        is_collapsed: !!c.is_collapsed,
        is_transparent: !!c.is_transparent,
      })),
      connections: connsToCopy.map(c => ({
        from_orig_id: c.from_card_id,
        to_orig_id: c.to_card_id,
        has_arrow: c.has_arrow,
        label: c.label,
        color: c.color,
        style: c.style,
        thickness: c.thickness,
        from_anchor_offset: c.from_anchor_offset,
        to_anchor_offset: c.to_anchor_offset,
      })),
    };

    if (!opts.isCut) {
      const cardWord = cardsToCopy.length === 1 ? 'card' : 'cards';
      const note = connsToCopy.length > 0
        ? ` and ${connsToCopy.length} connection${connsToCopy.length === 1 ? '' : 's'}`
        : '';
      toast.success(`Copied ${cardsToCopy.length} ${cardWord}${note}`);
    }
    return true;
  }, [selectedCardIds, cards, connections, activeWebId]);

  // Cmd/Ctrl+X — cut = copy the selection to the in-app clipboard, then
  // remove the originals so a subsequent Cmd+V "moves" them (typically
  // into another web). Reuses handleCopyCards for the clipboard snapshot
  // (suppressing its toast) so cut and copy stay in lockstep.
  const handleCutCards = useCallback(() => {
    if (!selectedCardIds || selectedCardIds.length === 0) return;
    const ids = [...selectedCardIds];
    const copied = handleCopyCards({ isCut: true });
    if (!copied) return;
    ids.forEach((id) => deleteCardRef.current?.(id));
    const cardWord = ids.length === 1 ? 'card' : 'cards';
    toast.success(`Cut ${ids.length} ${cardWord}`);
  }, [selectedCardIds, handleCopyCards]);

  // Validates a clipboard buffer — used both to decide whether to
  // intercept Cmd+V (so we don't swallow the user's normal browser
  // paste when our buffer is empty/stale) and as the safety check at
  // the start of the actual paste.
  const isValidClipboard = useCallback((buf) => {
    return !!(
      buf &&
      buf.version === 1 &&
      Array.isArray(buf.cards) &&
      buf.cards.length > 0 &&
      buf.cards.every(c => c && typeof c._origId !== 'undefined')
    );
  }, []);

  const handlePasteCards = useCallback(async () => {
    if (!activeWebId) return;
    const buf = kwClipboard;
    if (!isValidClipboard(buf)) return;

    // Snapshot the web id we're pasting INTO. If the user switches
    // webs while our async creates are in flight, we abandon applying
    // state mutations — the rows will still exist server-side and show
    // up on next refresh of the original target web, but we won't
    // shove them into the wrong web's local state.
    const targetWebId = activeWebId;

    // Translate so the centroid of the copied cards lands at (or near)
    // the user's current viewport center. A small +20/+20 nudge keeps
    // a same-web paste from landing exactly on top of the originals.
    let dx = 20, dy = 20;
    const safeCards = buf.cards.map(c => ({
      _origId: c._origId,
      title: normalizeCardTitle(c.title),
      description: c.description ?? null,
      tags: c.tags ?? null,
      image_url: c.image_url ?? null,
      scripture_refs: c.scripture_refs ?? null,
      color: c.color ?? null,
      link_url: c.link_url ?? null,
      x: Number(c.x) || 0,
      y: Number(c.y) || 0,
      width: Number(c.width) || 200,
      height: Number(c.height) || 120,
      layout_mode: c.layout_mode || 'smart',
      is_collapsed: !!c.is_collapsed,
      is_transparent: !!c.is_transparent,
    }));
    const pastedGeometries = safeCards.map((card) => estimateSmartCardGeometry(card));
    const centroidX = safeCards.reduce(
      (sum, card, index) => sum + card.x + pastedGeometries[index].center.x,
      0,
    ) / safeCards.length;
    const centroidY = safeCards.reduce(
      (sum, card, index) => sum + card.y + pastedGeometries[index].center.y,
      0,
    ) / safeCards.length;
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const center = canvas.screenToCanvas(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        rect,
      );
      dx = center.x - centroidX;
      dy = center.y - centroidY;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
        dx = 20;
        dy = 20;
      }
    }

    pushHistorySnapshot();

    // allSettled rather than all: if some creates fail we still want
    // to apply the ones that succeeded so the UI matches the DB. We
    // surface partial failure as a separate toast.
    const cardResults = await Promise.allSettled(safeCards.map(c =>
      desktopClient.entities.WebCard.create({
        web_id: targetWebId,
        title: c.title,
        description: c.description,
        tags: c.tags,
        image_url: c.image_url,
        scripture_refs: c.scripture_refs,
        color: c.color,
        link_url: c.link_url,
        x: Math.round(c.x + dx),
        y: Math.round(c.y + dy),
        width: c.width,
        height: c.height,
        layout_mode: c.layout_mode || 'smart',
        is_collapsed: c.is_collapsed,
        is_transparent: c.is_transparent,
      })
    ));

    // If the user has switched webs since paste began, don't apply
    // local state — the cards still exist server-side under
    // targetWebId and will reappear when that web is loaded. Read
    // through the live ref; the captured `activeWebId` is frozen at
    // callback-build time and would never trip this check.
    if (activeWebIdRef.current !== targetWebId) {
      console.warn('[paste] active web changed during paste; skipping local apply');
      return;
    }

    const createdCards = [];
    const idMap = {};
    let cardFailures = 0;
    cardResults.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value && r.value.id != null) {
        createdCards.push(r.value);
        idMap[safeCards[i]._origId] = r.value.id;
      } else {
        cardFailures += 1;
        if (r.status === 'rejected') console.error('[paste] card create failed', r.reason);
      }
    });

    if (createdCards.length === 0) {
      toast.error('Paste failed — could not create any cards.');
      return;
    }
    setCards(prev => [...prev, ...createdCards]);

    // Connections: only those whose endpoints both made it through.
    const connSpecs = (Array.isArray(buf.connections) ? buf.connections : [])
      .map(c => {
        const newFrom = idMap[c.from_orig_id];
        const newTo = idMap[c.to_orig_id];
        if (!newFrom || !newTo) return null;
        return {
          web_id: targetWebId,
          from_card_id: newFrom,
          to_card_id: newTo,
          from_kind: 'card',
          to_kind: 'card',
          has_arrow: !!c.has_arrow,
          label: c.label ?? null,
          color: c.color ?? null,
          style: c.style ?? null,
          thickness: Number(c.thickness) || 2,
          from_anchor_offset: c.from_anchor_offset ?? null,
          to_anchor_offset: c.to_anchor_offset ?? null,
        };
      })
      .filter(Boolean);

    let connFailures = 0;
    const createdConns = [];
    if (connSpecs.length > 0) {
      const connResults = await Promise.allSettled(
        connSpecs.map(spec => desktopClient.entities.WebConnection.create(spec))
      );
      // Same guard: bail on apply if the user moved to another web.
      if (activeWebIdRef.current !== targetWebId) {
        console.warn('[paste] active web changed before connections applied');
        return;
      }
      connResults.forEach(r => {
        if (r.status === 'fulfilled' && r.value && r.value.id != null) {
          createdConns.push(r.value);
        } else {
          connFailures += 1;
          if (r.status === 'rejected') console.error('[paste] connection create failed', r.reason);
        }
      });
      if (createdConns.length > 0) {
        setConnections(prev => [...prev, ...createdConns]);
      }
    }

    // Select the newly pasted cards so the user can immediately drag
    // them as a group into final position.
    const newIds = createdCards.map(c => c.id);
    setSelectedCardIds(newIds);
    setSelectedCardId(newIds.length === 1 ? newIds[0] : null);
    setSelectedConnectionId(null);
    setSelectedObjectId(null);

    flashSave();
    const word = createdCards.length === 1 ? 'card' : 'cards';
    const note = createdConns.length > 0
      ? ` and ${createdConns.length} connection${createdConns.length === 1 ? '' : 's'}`
      : '';
    toast.success(`Pasted ${createdCards.length} ${word}${note}`);
    if (cardFailures > 0 || connFailures > 0) {
      const parts = [];
      if (cardFailures > 0) parts.push(`${cardFailures} card${cardFailures === 1 ? '' : 's'}`);
      if (connFailures > 0) parts.push(`${connFailures} connection${connFailures === 1 ? '' : 's'}`);
      toast.error(`Some items failed to paste: ${parts.join(' and ')}.`);
    }
  }, [activeWebId, canvas, pushHistorySnapshot, flashSave, isValidClipboard]);

  // Light predicate the keydown handler can call before swallowing
  // Cmd+V — when our app clipboard is empty we want the browser's
  // normal paste to fall through.
  const canPasteCardsRef = useRef(null);
  useEffect(() => {
    canPasteCardsRef.current = () => !!activeWebId && isValidClipboard(kwClipboard);
  });

  // Keep the keyboard-handler refs pointed at the latest closures.
  useEffect(() => {
    undoRef.current = undo;
    redoRef.current = redo;
    activeNoteIdRef.current = activeNoteId;
    deleteCardRef.current = deleteCard;
    deleteConnectionRef.current = deleteConnection;
    deleteCanvasObjectRef.current = deleteCanvasObject;
    copyCardsRef.current = handleCopyCards;
    cutCardsRef.current = handleCutCards;
    pasteCardsRef.current = handlePasteCards;
  });

  // ── Reroute point CRUD ──
  const handleAddReroutePoint = useCallback((connId, x, y) => {
    pushHistorySnapshot();
    setConnections(prev => prev.map(c => {
      if (c.id !== connId) return c;
      const pts = [...(c.reroute_points || []), { x: Math.round(x), y: Math.round(y) }];
      updateConnection(connId, { reroute_points: pts }, { skipHistory: true });
      return { ...c, reroute_points: pts };
    }));
  }, [flashSave, updateConnection]);
  const rerouteSaveRef = useRef(null);
  const handleDragReroutePoint = useCallback((connId, pointIndex, x, y) => {
    pushHistorySnapshotForGestureRef.current?.(`reroute-${connId}-${pointIndex}`);
    const rx = Math.round(x);
    const ry = Math.round(y);
    setConnections(prev => {
      const updated = prev.map(c => {
        if (c.id !== connId) return c;
        const pts = [...(c.reroute_points || [])];
        if (pts[pointIndex]) pts[pointIndex] = { x: rx, y: ry };
        return { ...c, reroute_points: pts };
      });
      // Schedule debounced save using latest state
      clearTimeout(rerouteSaveRef.current);
      rerouteSaveRef.current = setTimeout(() => {
        const conn = updated.find(c => c.id === connId);
        if (conn) {
          updateConnection(connId, { reroute_points: conn.reroute_points }, { skipHistory: true });
        }
      }, 300);
      return updated;
    });
  }, [flashSave, updateConnection]);
  const handleRemoveReroutePoint = useCallback((connId, pointIndex) => {
    pushHistorySnapshot();
    setConnections(prev => prev.map(c => {
      if (c.id !== connId) return c;
      const pts = [...(c.reroute_points || [])];
      pts.splice(pointIndex, 1);
      updateConnection(connId, { reroute_points: pts }, { skipHistory: true });
      return { ...c, reroute_points: pts };
    }));
  }, [flashSave, updateConnection]);
  // ── Insert object at midpoint of a connection ──
  // Creates a new card / point / image / web_link centered on (x, y),
  // deletes the old connection, and stitches in two new connections so
  // the flow stays continuous: A → new → B. For image/web_link the
  // caller is responsible for resolving the underlying content (file
  // picker / URL picker) and passing the resulting `extra` props.
  const handleInsertObjectAtMidpoint = useCallback(async (connId, kind, x, y, extra = {}) => {
    if (!activeWebId) return;
    const conn = connections.find(c => c.id === connId);
    if (!conn) return;
    pushHistorySnapshot();

    // Create the new object centered on (x, y). Anchor offsets shift
    // each kind by half its default size so the visual center lands
    // on the midpoint.
    let newEndpoint;
    if (kind === 'card') {
      const smartCardDraft = {
        title: '',
        width: 200,
        height: 120,
        layout_mode: 'smart',
      };
      const smartGeometry = estimateSmartCardGeometry(smartCardDraft);
      const card = await desktopClient.entities.WebCard.create({
        web_id: activeWebId,
        ...smartCardDraft,
        x: Math.round(x - smartGeometry.center.x),
        y: Math.round(y - smartGeometry.center.y),
      });
      setCards(prev => [...prev, card]);
      newEndpoint = { id: card.id, kind: 'card' };
      setSelectedCardId(card.id);
      setSelectedCardIds([card.id]);
      setSelectedObjectId(null);
    } else {
      // Routing-point / image / web_link all live in canvas_objects.
      const defaults = {
        point: { w: 12, h: 12 },
        image: { w: 240, h: 160 },
        web_link: { w: 180, h: 140 },
      }[kind] || { w: 120, h: 80 };
      const obj = await desktopClient.entities.CanvasObject.create({
        web_id: activeWebId,
        object_type: kind,
        x: Math.round(x - defaults.w / 2),
        y: Math.round(y - defaults.h / 2),
        width: defaults.w,
        height: defaults.h,
        ...extra,
      });
      setCanvasObjects(prev => [...prev, obj]);
      newEndpoint = { id: obj.id, kind };
      setSelectedObjectId(obj.id);
      setSelectedCardId(null);
      setSelectedCardIds([]);
    }

    // Tear down the old conn and replace with two halves.
    await deleteConnection(connId, { skipHistory: true });
    setConnections(prev => prev.filter(c => c.id !== connId));

    const conn1 = await desktopClient.entities.WebConnection.create({
      web_id: activeWebId,
      from_card_id: conn.from_card_id,
      to_card_id: newEndpoint.id,
      from_kind: conn.from_kind || 'card',
      to_kind: newEndpoint.kind,
    });
    const conn2 = await desktopClient.entities.WebConnection.create({
      web_id: activeWebId,
      from_card_id: newEndpoint.id,
      to_card_id: conn.to_card_id,
      from_kind: newEndpoint.kind,
      to_kind: conn.to_kind || 'card',
    });
    setConnections(prev => [...prev, conn1, conn2]);
    setSelectedConnectionId(null);
    flashSave();
  }, [connections, activeWebId, flashSave, deleteConnection]);

  // ── Midpoint context-menu actions ──
  // Each handler closes the menu, then dispatches to
  // handleInsertObjectAtMidpoint with the right kind + any prompted
  // content (image file, weblink target web).
  const closeMidpointMenu = useCallback(() => {
    // Also drop any pending web-link insert intent so a later free
    // web_link placement doesn't accidentally fire the split-connection
    // flow against a stale connId.
    pendingWebLinkInsertRef.current = null;
    setMidpointMenu(null);
  }, []);
  const handleMidpointInsert = useCallback(async (kind) => {
    if (!midpointMenu) return;
    const { connId, midX, midY } = midpointMenu;
    setMidpointMenu(null);
    if (kind === 'card' || kind === 'point') {
      await handleInsertObjectAtMidpoint(connId, kind, midX, midY);
      return;
    }
    if (kind === 'image') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async (ev) => {
        const file = ev.target.files?.[0];
        if (!file) return;
        const { file_url } = await desktopClient.media.uploadFile({ file });
        await handleInsertObjectAtMidpoint(connId, 'image', midX, midY, { image_url: file_url });
      };
      input.click();
      return;
    }
    if (kind === 'web_link') {
      // Reuse the existing web-link picker by stashing the pending
      // insert intent; the picker callback (see render) calls back
      // into handleInsertObjectAtMidpoint once the user picks a web.
      pendingWebLinkInsertRef.current = { connId, midX, midY };
      setWebLinkPickerPos({ x: midX, y: midY });
    }
  }, [midpointMenu, handleInsertObjectAtMidpoint]);

  const getEdgeAnchorOffset = useCallback((card, x, y) => {
    const left = card.x || 0;
    const top = card.y || 0;
    const geometry = geometryForCard(card);
    return getClosestGeometryAnchor(geometry, x - left, y - top);
  }, [geometryForCard]);

  const connectionEndpointDraftRef = useRef({});
  const connectionEndpointSaveRef = useRef({});
  const endpointDragStateRef = useRef(null);
  // When the user right-clicks the midpoint dot and picks "Weblink",
  // we open the existing WebLinkPicker. This ref carries the pending
  // connId + midpoint coords through the picker so the callback can
  // call back into handleInsertObjectAtMidpoint with the chosen web.
  const pendingWebLinkInsertRef = useRef(null);

  // Hit-test the cursor against routing points first (small, on top),
  // then cards, then images, web-link nodes, and timeline overviews. Returns
  // { kind: 'point'|'card'|'image'|'web_link'|'timegraph', id, entity } or null.
  // Images and web_links became connection endpoints in the new
  // "insert object at midpoint" flow, so endpoint-detach drag also
  // needs to recognize them as valid drop targets.
  const hitTestEndpointTarget = useCallback((x, y) => {
    const points = canvasObjects.filter(o => o.object_type === 'point');
    const PT_HIT_R = 14;
    for (const p of points) {
      const cx = (p.x || 0) + 6;
      const cy = (p.y || 0) + 6;
      if ((x - cx) ** 2 + (y - cy) ** 2 <= PT_HIT_R * PT_HIT_R) {
        return { kind: 'point', id: p.id, entity: p };
      }
    }
    const hitRect = (obj, defW, defH) => {
      const left = obj.x || 0;
      const top = obj.y || 0;
      const right = left + (obj.width || defW);
      const bottom = top + (obj.height || defH);
      return x >= left && x <= right && y >= top && y <= bottom;
    };
    for (const c of cards) {
      const geometry = geometryForCard(c);
      if (pointInCardGeometry(geometry, x - (c.x || 0), y - (c.y || 0))) {
        return { kind: 'card', id: c.id, entity: c };
      }
    }
    for (const o of canvasObjects) {
      if (o.object_type === 'image' && hitRect(o, 240, 160)) {
        return { kind: 'image', id: o.id, entity: o };
      }
      if (o.object_type === 'web_link' && hitRect(o, 180, 140)) {
        return { kind: 'web_link', id: o.id, entity: o };
      }
      if (o.object_type === 'timegraph' && hitRect(o, 240, 150)) {
        return { kind: 'timegraph', id: o.id, entity: o };
      }
    }
    return null;
  }, [cards, canvasObjects, geometryForCard]);

  const handleDragConnectionEndpoint = useCallback((connId, endpoint, originalCard, x, y, phase, anchor) => {
    const conn = connections.find(c => c.id === connId);
    if (!conn) return;

    const idField = endpoint === 'from' ? 'from_card_id' : 'to_card_id';
    const kindField = endpoint === 'from' ? 'from_kind' : 'to_kind';
    const anchorField = endpoint === 'from' ? 'from_anchor_offset' : 'to_anchor_offset';

    if (phase === 'start') {
      endpointDragStateRef.current = {
        connId, endpoint, anchor,
        originalId: conn[idField],
        originalKind: conn[kindField] || 'card',
        originalAnchor: conn[anchorField] || null,
      };
      // Initial rubber band collapses to the anchor point itself.
      setTempLine({ x1: anchor.x, y1: anchor.y, x2: anchor.x, y2: anchor.y });
      return;
    }

    if (phase === 'move') {
      const hit = hitTestEndpointTarget(x, y);
      const overOriginalCard = hit && hit.kind === 'card' && hit.id === originalCard.id;

      if (overOriginalCard) {
        // Sliding around the same card → live-update the edge offset and
        // hide the rubber band. Same behavior as before, just optimistic.
        const anchorOffset = getEdgeAnchorOffset(originalCard, x, y);
        connectionEndpointDraftRef.current[connId] = {
          ...(connectionEndpointDraftRef.current[connId] || {}),
          [anchorField]: anchorOffset,
        };
        setConnections(prev => prev.map(c => c.id === connId ? { ...c, [anchorField]: anchorOffset } : c));
        setTempLine(null);
      } else {
        // Cursor has left the original card → show a rubber-band line from
        // the anchor (the OTHER endpoint, since we're "lifting" this side)
        // back to the cursor for visual feedback.
        const otherIdField = endpoint === 'from' ? 'to_card_id' : 'from_card_id';
        const otherKindField = endpoint === 'from' ? 'to_kind' : 'from_kind';
        const otherKind = conn[otherKindField] || 'card';
        const otherEntity = otherKind === 'card'
          ? cards.find(c => c.id === conn[otherIdField])
          : canvasObjects.find(o => o.id === conn[otherIdField] && o.object_type === otherKind);
        let originX = anchor.x, originY = anchor.y;
        if (otherEntity) {
          if (otherKind === 'point') {
            originX = (otherEntity.x || 0) + 6;
            originY = (otherEntity.y || 0) + 6;
          } else {
            // card / image / web_link / timegraph — use rect center with sensible
            // default dimensions per kind.
            const defW = otherKind === 'image' ? 240 : otherKind === 'web_link' ? 180 : otherKind === 'timegraph' ? 240 : 200;
            const defH = otherKind === 'image' ? 160 : otherKind === 'web_link' ? 140 : otherKind === 'timegraph' ? 150 : 120;
            originX = (otherEntity.x || 0) + (otherEntity.width || defW) / 2;
            originY = (otherEntity.y || 0) + (otherEntity.height || defH) / 2;
          }
        }
        setTempLine({ x1: originX, y1: originY, x2: x, y2: y });
      }
      return;
    }

    if (phase === 'end') {
      setTempLine(null);
      const dragState = endpointDragStateRef.current;
      endpointDragStateRef.current = null;

      const hit = hitTestEndpointTarget(x, y);

      // Drop on empty space → revert any live edge-offset preview to the
      // original anchor. The endpoint stays put.
      if (!hit) {
        if (dragState) {
          setConnections(prev => prev.map(c => c.id === connId
            ? { ...c, [anchorField]: dragState.originalAnchor }
            : c));
        }
        return;
      }

      // Don't allow dropping onto the OTHER endpoint of this same connection
      // (would create a degenerate self-loop on a single endpoint).
      const otherIdField = endpoint === 'from' ? 'to_card_id' : 'from_card_id';
      const otherKindField = endpoint === 'from' ? 'to_kind' : 'from_kind';
      const otherKind = conn[otherKindField] || 'card';
      if (hit.id === conn[otherIdField] && hit.kind === otherKind) {
        if (dragState) {
          setConnections(prev => prev.map(c => c.id === connId
            ? { ...c, [anchorField]: dragState.originalAnchor }
            : c));
        }
        return;
      }

      // Same card as before → commit the edge-offset slide.
      if (hit.kind === 'card' && hit.id === originalCard.id && (conn[kindField] || 'card') === 'card') {
        const anchorOffset = getEdgeAnchorOffset(originalCard, x, y);
        const draft = connectionEndpointDraftRef.current[connId] || {};
        delete connectionEndpointDraftRef.current[connId];
        updateConnection(connId, { ...draft, [anchorField]: anchorOffset });
        return;
      }

      // Reassign endpoint to a different card or routing point.
      pushHistorySnapshot();
      const updates = {
        [idField]: hit.id,
        [kindField]: hit.kind,
        [anchorField]: hit.kind === 'card' ? getEdgeAnchorOffset(hit.entity, x, y) : null,
      };
      setConnections(prev => prev.map(c => c.id === connId ? { ...c, ...updates } : c));
      delete connectionEndpointDraftRef.current[connId];
      updateConnection(connId, updates, { skipHistory: true });
    }
  }, [connections, cards, canvasObjects, getEdgeAnchorOffset, updateConnection, hitTestEndpointTarget, pushHistorySnapshot]);

  // ── Canvas click ──
  // Single click: only clears selection / cancels in-progress connections.
  // It deliberately does NOT create cards or other objects — creation
  // requires a double click (see handleCanvasDoubleClick). This prevents
  // accidental card creation when the user is, e.g., clicking out of a
  // card description text box while still in "card" mode.
  const handleCanvasClick = (e) => {
    if (suppressCanvasClickRef.current) {
      suppressCanvasClickRef.current = false;
      return;
    }
    if (e.target.dataset.canvas !== 'true') return;
    if (!containerRef.current || !activeWebId) return;

    clearSelection();
    setConnectionSource(null);
    setTempLine(null);
  };

  // Double click on empty canvas creates a new object based on the current
  // mode. This is the deliberate "I want to make something here" action.
  const handleCanvasDoubleClick = async (e) => {
    if (e.target.dataset.canvas !== 'true') return;
    if (!containerRef.current || !activeWebId) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pos = canvas.screenToCanvas(e.clientX, e.clientY, rect);

    if (mode === 'card') {
      await createCard(pos.x - 100, pos.y - 60);
    } else if (mode === 'point') {
      // Drop a routing dot centered on the click.
      await createCanvasObject('point', pos.x - 6, pos.y - 6);
    } else if (mode === 'image') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async (ev) => {
        const file = ev.target.files?.[0];
        if (!file) return;
        const { file_url } = await desktopClient.media.uploadFile({ file });
        await createCanvasObject('image', pos.x - 120, pos.y - 80, { image_url: file_url });
      };
      input.click();
    } else if (mode === 'web_link') {
      // Stash the click position and open the picker modal — the user
      // chooses which web to link, then we create the canvas object and
      // drop them back into hand mode (so a single 9-press places one
      // node, not a stream of them). Offset by half the new default
      // size (180×140) so the click point lands at the node's center.
      setWebLinkPickerPos({ x: pos.x - 90, y: pos.y - 70 });
    } else if (mode === 'timegraph') {
      // The picker resolves a real shared Timeline; the canvas object stores
      // only its id, so the miniature stays live as events change.
      setTimegraphPickerPos({ x: pos.x - 120, y: pos.y - 75 });
    }
  };

  // Canvas-level drag & drop for images
  const handleCanvasDrop = async (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith('image/') || !containerRef.current || !activeWebId) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pos = canvas.screenToCanvas(e.clientX, e.clientY, rect);
    const { file_url } = await desktopClient.media.uploadFile({ file });
    await createCanvasObject('image', pos.x - 120, pos.y - 80, { image_url: file_url });
  };

  // Drag-to-create a section. Triggered by a plain mousedown on empty
  // canvas while in section mode — feels like the cmd+marquee gesture but
  // produces a section sized to the dragged rectangle on mouseup. A tiny
  // drag (< 6px) falls back to a default-sized section so a quick click
  // still works.
  const startSectionDragCreate = useCallback((e) => {
    if (!containerRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    suppressCanvasClickRef.current = true;

    const rect = containerRef.current.getBoundingClientRect();
    const startCanvas = canvas.screenToCanvas(e.clientX, e.clientY, rect);
    const startScreenX = e.clientX - rect.left;
    const startScreenY = e.clientY - rect.top;

    setMarqueeSelection({
      startCanvasX: startCanvas.x,
      startCanvasY: startCanvas.y,
      endCanvasX: startCanvas.x,
      endCanvasY: startCanvas.y,
      startScreenX,
      startScreenY,
      endScreenX: startScreenX,
      endScreenY: startScreenY,
    });

    const onMove = (ev) => {
      const cur = canvas.screenToCanvas(ev.clientX, ev.clientY, rect);
      setMarqueeSelection(prev => prev ? {
        ...prev,
        endCanvasX: cur.x,
        endCanvasY: cur.y,
        endScreenX: ev.clientX - rect.left,
        endScreenY: ev.clientY - rect.top,
      } : prev);
    };

    const onUp = async (ev) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const end = canvas.screenToCanvas(ev.clientX, ev.clientY, rect);
      setMarqueeSelection(null);
      setTimeout(() => { suppressCanvasClickRef.current = false; }, 0);

      const minX = Math.min(startCanvas.x, end.x);
      const minY = Math.min(startCanvas.y, end.y);
      const w = Math.abs(end.x - startCanvas.x);
      const h = Math.abs(end.y - startCanvas.y);

      // Tiny drag → treat as a click, drop a default section centered.
      if (w < 6 && h < 6) {
        await createCanvasObject('section', startCanvas.x - 200, startCanvas.y - 150);
        return;
      }
      // Enforce a sensible minimum so accidental tiny drags don't make
      // unusable sections.
      const finalW = Math.max(w, 80);
      const finalH = Math.max(h, 60);
      await createCanvasObject('section', minX, minY, { width: Math.round(finalW), height: Math.round(finalH) });
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [canvas]);

  // Draw-tool stroke capture. Plain mousedown on empty canvas while
  // in 'draw' mode starts collecting canvas-space points. We render a
  // live SVG preview during the gesture and commit a `drawing`
  // canvas_objects row on mouseup. Tiny strokes (< 4px total drag) are
  // discarded so accidental clicks don't litter the canvas with dots.
  const startDrawStroke = useCallback((e) => {
    if (!containerRef.current || !activeWebId) return;
    e.preventDefault();
    e.stopPropagation();
    suppressCanvasClickRef.current = true;

    const rect = containerRef.current.getBoundingClientRect();
    const startCanvas = canvas.screenToCanvas(e.clientX, e.clientY, rect);
    const color = drawColor;
    const thickness = drawThickness;

    const points = [[startCanvas.x, startCanvas.y]];
    liveStrokeRef.current = points;

    const pointsToD = (pts) => {
      if (pts.length === 0) return '';
      if (pts.length === 1) return `M ${pts[0][0]} ${pts[0][1]} L ${pts[0][0] + 0.01} ${pts[0][1] + 0.01}`;
      let d = `M ${pts[0][0]} ${pts[0][1]}`;
      for (let i = 1; i < pts.length - 1; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[i + 1];
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        d += ` Q ${x1} ${y1} ${midX} ${midY}`;
      }
      const last = pts[pts.length - 1];
      d += ` L ${last[0]} ${last[1]}`;
      return d;
    };

    setLiveStroke({ d: pointsToD(points), color, thickness });

    const onMove = (ev) => {
      const cur = canvas.screenToCanvas(ev.clientX, ev.clientY, rect);
      const prevPts = liveStrokeRef.current;
      const last = prevPts[prevPts.length - 1];
      // Sub-pixel cull — avoid flooding the stroke with near-identical
      // samples on high-DPI displays.
      if (Math.abs(cur.x - last[0]) < 0.5 && Math.abs(cur.y - last[1]) < 0.5) return;
      prevPts.push([cur.x, cur.y]);
      setLiveStroke({ d: pointsToD(prevPts), color, thickness });
    };

    const onUp = async () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setTimeout(() => { suppressCanvasClickRef.current = false; }, 0);
      const pts = liveStrokeRef.current || [];
      liveStrokeRef.current = null;
      setLiveStroke(null);
      if (pts.length < 2) return;

      // Total drag distance check — a near-stationary click should not
      // create a dot/drawing object.
      let total = 0;
      for (let i = 1; i < pts.length; i++) {
        total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      }
      if (total < 4) return;

      // Compute bbox, then shift points to be relative to bbox origin
      // (with PAD baked in so thick strokes don't clip the SVG edge).
      const PAD = 8;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x, y] of pts) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      const originX = minX - PAD;
      const originY = minY - PAD;
      const width = Math.max(1, Math.round((maxX - minX) + PAD * 2));
      const height = Math.max(1, Math.round((maxY - minY) + PAD * 2));
      const rel = pts.map(([x, y]) => [
        Math.round((x - originX) * 100) / 100,
        Math.round((y - originY) * 100) / 100,
      ]);

      const strokes_data = JSON.stringify({
        points: rel,
        color,
        thickness,
        rotation: 0,
      });

      await createCanvasObject('drawing', Math.round(originX), Math.round(originY), {
        width,
        height,
        strokes_data,
      });
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [canvas, activeWebId, drawColor, drawThickness]);

  const startMarqueeSelection = useCallback((e) => {
    if (!containerRef.current) return;

    e.preventDefault();
    e.stopPropagation();
    suppressCanvasClickRef.current = true;
    multiDragOriginRef.current = null;

    const rect = containerRef.current.getBoundingClientRect();
    const startCanvas = canvas.screenToCanvas(e.clientX, e.clientY, rect);
    const startScreenX = e.clientX - rect.left;
    const startScreenY = e.clientY - rect.top;

    setSelectedCardId(null);
    setSelectedCardIds([]);
    setSelectedConnectionId(null);
    setSelectedObjectId(null);
    setConnectionSource(null);
    setTempLine(null);
    setMarqueeSelection({
      startCanvasX: startCanvas.x,
      startCanvasY: startCanvas.y,
      endCanvasX: startCanvas.x,
      endCanvasY: startCanvas.y,
      startScreenX,
      startScreenY,
      endScreenX: startScreenX,
      endScreenY: startScreenY,
    });

    const getMarqueeSelected = (endCanvas) => {
      const minX = Math.min(startCanvas.x, endCanvas.x);
      const maxX = Math.max(startCanvas.x, endCanvas.x);
      const minY = Math.min(startCanvas.y, endCanvas.y);
      const maxY = Math.max(startCanvas.y, endCanvas.y);

      const cardIds = filteredCards.filter((card) => {
        const cardX = card.x || 0;
        const cardY = card.y || 0;
        const geometry = geometryForCard(card);
        return rectIntersectsCardGeometry(geometry, {
          x: minX - cardX,
          y: minY - cardY,
          width: maxX - minX,
          height: maxY - minY,
        });
      }).map(card => card.id);

      // Routing points are tiny — use their centre (x,y) + POINT_SIZE as bounds.
      const pointIds = canvasObjectsRef.current
        .filter(o => o.object_type === 'point')
        .filter(o => {
          const px = o.x || 0;
          const py = o.y || 0;
          return px < maxX && px + POINT_SIZE > minX && py < maxY && py + POINT_SIZE > minY;
        })
        .map(o => o.id);

      return { cardIds, pointIds };
    };

    const onMove = (ev) => {
      const currentCanvas = canvas.screenToCanvas(ev.clientX, ev.clientY, rect);
      const { cardIds, pointIds } = getMarqueeSelected(currentCanvas);

      setSelectedCardIds(cardIds);
      setSelectedPointIds(pointIds);
      setMarqueeSelection(prev => prev ? {
        ...prev,
        endCanvasX: currentCanvas.x,
        endCanvasY: currentCanvas.y,
        endScreenX: ev.clientX - rect.left,
        endScreenY: ev.clientY - rect.top,
      } : prev);
    };

    const onUp = (ev) => {
      const endCanvas = canvas.screenToCanvas(ev.clientX, ev.clientY, rect);
      const { cardIds, pointIds } = getMarqueeSelected(endCanvas);

      setSelectedCardIds(cardIds);
      setSelectedCardId(cardIds.length === 1 ? cardIds[0] : null);
      setSelectedPointIds(pointIds);
      setMarqueeSelection(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setTimeout(() => {
        suppressCanvasClickRef.current = false;
      }, 0);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [canvas, filteredCards, geometryForCard]);

  const handleCardSelect = (cardId, e) => {
    if (mode === 'erase') {
      deleteCard(cardId);
      return;
    }
    if (mode === 'connection') {
      setSelectedCardIds([]);
      // Compute a per-side anchor from where the user clicked so the
      // noodle latches near the mouse instead of falling back to the
      // center-to-center heuristic. Requires the click event + the
      // canvas container so we can translate screen → canvas space.
      let anchor = null;
      if (e && containerRef.current) {
        const card = cards.find(c => c.id === cardId);
        if (card) {
          const rect = containerRef.current.getBoundingClientRect();
          const pos = canvas.screenToCanvas(e.clientX, e.clientY, rect);
          anchor = getEdgeAnchorOffset(card, pos.x, pos.y);
        }
      }
      const target = { id: cardId, kind: 'card', anchor };
      if (!connectionSource) { setConnectionSource(target); }
      else { createConnection(connectionSource, target); setConnectionSource(null); setTempLine(null); }
      return;
    }
    // Cmd/Ctrl+click — additive toggle into the multi-select group.
    if (e && (e.metaKey || e.ctrlKey)) {
      setSelectedCardIds(prev => {
        const next = prev.includes(cardId) ? prev.filter(id => id !== cardId) : [...prev, cardId];
        setSelectedCardId(next.length === 1 ? next[0] : null);
        return next;
      });
      setSelectedConnectionId(null);
      setSelectedObjectId(null);
      return;
    }
    if (selectedCardIds.length > 1 && selectedCardIds.includes(cardId)) {
      setSelectedCardId(null);
      setSelectedConnectionId(null);
      setSelectedObjectId(null);
      return;
    }
    setSelectedCardId(cardId);
    setSelectedCardIds([cardId]);
    setSelectedConnectionId(null);
    setSelectedObjectId(null);
    setSelectedPointIds([]);
  };

  const handleObjectSelect = (objId) => {
    if (mode === 'erase') {
      deleteCanvasObject(objId);
      return;
    }
    setSelectedObjectId(objId);
    setSelectedCardId(null);
    setSelectedCardIds([]);
    setSelectedConnectionId(null);
    setSelectedPointIds([]);
  };

  // Points participate in connection-mode just like cards: clicking one
  // either picks the source or completes the link.
  // In hand mode, if the clicked point is already part of a multi-select
  // group, we keep the group intact and arm the group-drag origins so that
  // dragging this point moves all grouped cards and points together.
  const handlePointSelect = (objId, e) => {
    if (mode === 'erase') {
      deleteCanvasObject(objId);
      return;
    }
    if (mode === 'connection') {
      const target = { id: objId, kind: 'point' };
      if (!connectionSource) { setConnectionSource(target); }
      else { createConnection(connectionSource, target); setConnectionSource(null); setTempLine(null); }
      return;
    }
    // Cmd/Ctrl+click — additive toggle into the multi-select group.
    // Keeps any existing card selection so cards + points can be grouped.
    if (e && (e.metaKey || e.ctrlKey)) {
      setSelectedPointIds(prev =>
        prev.includes(objId) ? prev.filter(id => id !== objId) : [...prev, objId]
      );
      setSelectedConnectionId(null);
      setSelectedObjectId(null);
      multiDragPointOriginsRef.current = null;
      multiDragOriginRef.current = null;
      return;
    }
    const ptIds = selectedPointIdsRef.current;
    const cIds = selectedCardIds;
    if (ptIds.includes(objId) && (cIds.length > 0 || ptIds.length > 1)) {
      // Point is part of a multi-select — arm group-drag origins and keep
      // the selection intact so dragging this point moves everything.
      multiDragPointOriginsRef.current = Object.fromEntries(
        canvasObjects
          .filter(o => ptIds.includes(o.id))
          .map(o => [o.id, { x: o.x, y: o.y }])
      );
      multiDragOriginRef.current = cIds.length > 0
        ? Object.fromEntries(
            cards.filter(c => cIds.includes(c.id)).map(c => [c.id, { x: c.x, y: c.y }])
          )
        : null;
      return;
    }
    // Solo click — drop any existing multi-select and treat as single object.
    multiDragPointOriginsRef.current = null;
    multiDragOriginRef.current = null;
    handleObjectSelect(objId);
  };

  const handleCardDragStart = useCallback((cardId) => {
    // Note: history snapshot is captured by handlePositionUpdate on the
    // first real movement, not here — pure selection clicks must not
    // pollute the undo stack or wipe the redo stack.

    const isMultiDrag = selectedCardIds.length > 1 && selectedCardIds.includes(cardId);
    const draggedIds = new Set(isMultiDrag ? selectedCardIds : [cardId]);

    if (isMultiDrag) {
      multiDragOriginRef.current = Object.fromEntries(
        cards
          .filter(card => selectedCardIds.includes(card.id))
          .map(card => [card.id, { x: card.x, y: card.y }])
      );
      // Capture any routing-points that are part of the group selection so
      // they travel with the cards during the drag.
      const ptIds = selectedPointIdsRef.current;
      multiDragPointOriginsRef.current = ptIds.length > 0
        ? Object.fromEntries(
            canvasObjectsRef.current
              .filter(o => ptIds.includes(o.id))
              .map(o => [o.id, { x: o.x, y: o.y }])
          )
        : null;
    } else {
      multiDragOriginRef.current = null;
      multiDragPointOriginsRef.current = null;
    }

    // Lock anchor sides for all connections touching the dragged card(s) so
    // the far endpoint doesn't auto-snap to a different side during the move.
    const cardMap = Object.fromEntries(cards.map(c => [c.id, c]));
    newlyMaterializedAnchorsRef.current = {};

    setConnections(prev => prev.map(conn => {
      const fromKind = conn.from_kind || 'card';
      const toKind = conn.to_kind || 'card';
      if (fromKind !== 'card' || toKind !== 'card') return conn;
      if (!draggedIds.has(conn.from_card_id) && !draggedIds.has(conn.to_card_id)) return conn;
      if (conn.from_anchor_offset && conn.to_anchor_offset) return conn;

      const fromCard = cardMap[conn.from_card_id];
      const toCard = cardMap[conn.to_card_id];
      if (!fromCard || !toCard) return conn;

      const fromGeometry = geometryForCard(fromCard);
      const toGeometry = geometryForCard(toCard);
      const fromCx = (fromCard.x || 0) + fromGeometry.center.x;
      const fromCy = (fromCard.y || 0) + fromGeometry.center.y;
      const toCx = (toCard.x || 0) + toGeometry.center.x;
      const toCy = (toCard.y || 0) + toGeometry.center.y;
      const dx = toCx - fromCx;
      const dy = toCy - fromCy;

      let fromSide, toSide;
      if (Math.abs(dx) >= Math.abs(dy)) {
        fromSide = dx >= 0 ? 'right' : 'left';
        toSide = dx >= 0 ? 'left' : 'right';
      } else {
        fromSide = dy >= 0 ? 'bottom' : 'top';
        toSide = dy >= 0 ? 'top' : 'bottom';
      }

      const updates = {};
      if (!conn.from_anchor_offset) updates.from_anchor_offset = { side: fromSide };
      if (!conn.to_anchor_offset) updates.to_anchor_offset = { side: toSide };

      newlyMaterializedAnchorsRef.current[conn.id] = updates;
      return { ...conn, ...updates };
    }));
  }, [mode, cards, selectedCardIds, geometryForCard]);

  const handleCanvasMouseMove = (e) => {
    canvas.onPanMove(e);
    if (mode === 'connection' && connectionSource && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const pos = canvas.screenToCanvas(e.clientX, e.clientY, rect);
      // Source can be either a card or a routing point — both surface a
      // bounding box we can use to pick the nearest port.
      const sourceEntity = connectionSource.kind === 'card'
        ? cards.find(c => c.id === connectionSource.id)
        : canvasObjects.find(o => o.id === connectionSource.id && o.object_type === connectionSource.kind);
      if (!sourceEntity) return;

      // The source port is locked at first-click time (handleCardSelect
      // saves `connectionSource.anchor.side`). Honor it so the preview
      // line leaves exactly where the persisted connection will leave
      // from. Points have no concept of side — fall back to nearest-edge.
      const sourceGeometry = connectionSource.kind === 'card'
        ? geometryForCard(sourceEntity)
        : undefined;
      const sourcePorts = getPorts(sourceEntity, sourceGeometry);
      let fromPort;
      let fromSide;
      if (connectionSource.kind === 'card' && connectionSource.anchor?.side) {
        fromSide = connectionSource.anchor.side;
        fromPort = sourcePorts[fromSide] || sourcePorts.right;
      } else {
        const cx = (sourceEntity.x || 0) + (sourceGeometry?.center.x || (sourceEntity.width || 200) / 2);
        const cy = (sourceEntity.y || 0) + (sourceGeometry?.center.y || (sourceEntity.height || 120) / 2);
        const dx = pos.x - cx;
        const dy = pos.y - cy;
        if (Math.abs(dx) >= Math.abs(dy)) { fromSide = dx >= 0 ? 'right' : 'left'; }
        else { fromSide = dy >= 0 ? 'bottom' : 'top'; }
        fromPort = sourcePorts[fromSide];
      }

      // Hit-test the cursor against the canvas (cards first, then routing
      // points) so the preview can snap to the exact port + side that the
      // committed connection will use. If the cursor is over empty canvas,
      // the preview just tracks the cursor (no toSide hint).
      const hit = hitTestEndpointTarget(pos.x, pos.y);
      let x2 = pos.x;
      let y2 = pos.y;
      let toSide;
      if (hit && !(hit.kind === connectionSource.kind && hit.id === connectionSource.id)) {
        if (hit.kind !== 'point') {
          const targetAnchor = getEdgeAnchorOffset(hit.entity, pos.x, pos.y);
          toSide = targetAnchor.side;
          const targetGeometry = hit.kind === 'card' ? geometryForCard(hit.entity) : undefined;
          const targetPort = getPorts(hit.entity, targetGeometry)[toSide];
          x2 = targetPort.stemX;
          y2 = targetPort.stemY;
        } else if (hit.kind === 'point') {
          // Points are tiny — center on them so the preview visibly latches.
          x2 = (hit.entity.x || 0) + 6;
          y2 = (hit.entity.y || 0) + 6;
        }
      }

      setTempLine({ x1: fromPort.stemX, y1: fromPort.stemY, x2, y2, fromSide, toSide });
    }
  };

  // ── Search / Focus ──
  const handleJumpToCard = useCallback((card) => {
    setSelectedCardId(card.id);
    setSelectedCardIds([card.id]);
    setSelectedConnectionId(null);
    setSelectedObjectId(null);
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const geometry = geometryForCard(card);
      const centerX = card.x + geometry.center.x;
      const centerY = card.y + geometry.center.y;
      // Account for inspector panel that will open
      const inspectorWidth = 320;
      canvas.smoothPanTo(centerX, centerY, rect.width - inspectorWidth, rect.height, canvas.zoom);
    }
  }, [canvas.zoom, canvas.smoothPanTo, geometryForCard]);

  // Click-to-center: called when a card is clicked without dragging
  const handleCardClickNoDrag = useCallback((cardId) => {
    if (!autoFocus) return;
    if (selectedCardIds.length > 1 && selectedCardIds.includes(cardId)) return;

    const card = cards.find(c => c.id === cardId);
    if (!card || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const geometry = geometryForCard(card);
    const cardCenterX = card.x + geometry.center.x;
    const cardCenterY = card.y + geometry.center.y;

    // The inspector panel (~320px) will open on the right when a card is selected.
    // The sidebar is on the left (part of flex layout, not inside the canvas container).
    // containerRef is the canvas area, so rect.width already excludes the sidebar.
    // We need to subtract the inspector width from the right.
    const inspectorWidth = 320;
    const usableWidth = rect.width - inspectorWidth;
    const usableHeight = rect.height;

    // Check if already centered (within tolerance)
    const currentScreenX = cardCenterX * canvas.zoom + canvas.pan.x;
    const currentScreenY = cardCenterY * canvas.zoom + canvas.pan.y;
    const targetScreenX = usableWidth / 2;
    const targetScreenY = usableHeight / 2;
    const dist = Math.sqrt(Math.pow(currentScreenX - targetScreenX, 2) + Math.pow(currentScreenY - targetScreenY, 2));
    if (dist < 20) return; // Already centered, skip

    canvas.smoothPanTo(cardCenterX, cardCenterY, usableWidth, usableHeight, canvas.zoom);
  }, [autoFocus, cards, selectedCardIds, canvas.zoom, canvas.pan, canvas.smoothPanTo, geometryForCard]);

  const handleFocus = useCallback((cardId) => {
    setFocusState(prev => prev.active && prev.cardId === cardId
      ? { active: false, cardId: null, depth: 1 }
      : { active: true, cardId, depth: prev.depth });
  }, []);

  const exitFocus = useCallback(() => setFocusState({ active: false, cardId: null, depth: 1 }), []);

  // ── Sharing ──
  const handleToggleShare = async (share) => {
    const web = webs.find(w => w.id === activeWebId);
    if (!web) return;
    const shareId = share ? (web.share_id || Math.random().toString(36).slice(2, 10)) : web.share_id;
    await desktopClient.entities.KnowledgeWeb.update(activeWebId, { is_shared: share, share_id: shareId });
    setWebs(prev => prev.map(w => w.id === activeWebId ? { ...w, is_shared: share, share_id: shareId } : w));
  };

  // ── Card library: place existing card on this web ──
  const handlePlaceCard = async (card) => {
    if (!activeWebId) return;
    // A library placement is an independent local copy on the current web.
    // The old CardPlacement row was cloud-only bookkeeping and never stored
    // usable content in the desktop library.
    const newCard = await desktopClient.entities.WebCard.create({
      web_id: activeWebId, title: card.title, description: card.description,
      tags: card.tags || [], scripture_refs: card.scripture_refs || [],
      image_url: card.image_url || '', x: 100, y: 100, width: card.width || 200, height: card.height || 120,
      layout_mode: card.layout_mode || 'smart',
    });
    setCards(prev => [...prev, newCard]);
    setShowLibrary(false);
    flashSave();
  };

  const selectedCard = cards.find(c => c.id === selectedCardId);
  const selectedConnection = connections.find(c => c.id === selectedConnectionId);
  const selectedObject = canvasObjects.find(o => o.id === selectedObjectId);
  const focusCard = focusState.active ? cards.find(c => c.id === focusState.cardId) : null;
  const activeWeb = webs.find(w => w.id === activeWebId);
  // Decrypt the active web's name so the toolbar header shows the real
  // title for unlocked private webs (instead of the literal "Private Web"
  // placeholder stored in `web.title`). Updates instantly when the user
  // renames the web.
  const activeWebDecryptedName = useDecryptedWebName(activeWeb);
  const activeWebDisplayTitle = activeWeb?.is_private
    ? (activeWebDecryptedName || 'Private Web')
    : activeWeb?.title;

  /**
   * Renames the open web from its header.
   *
   * A private web's name lives encrypted in `enc_name` and the plain `title`
   * column keeps only a placeholder, so the new name is encrypted with that
   * web's key before it goes anywhere. Renaming a locked web is refused rather
   * than silently writing the name in the clear.
   */
  const renameActiveWeb = useCallback(async (nextTitle) => {
    const clean = (nextTitle || '').trim();
    if (!activeWebId || !clean) return;
    const target = webs.find((w) => w.id === activeWebId);

    try {
      if (target?.is_private) {
        const key = privateWeb.getKey(activeWebId);
        if (!key) throw new Error('Unlock this private Knowledge Web before renaming it.');
        const enc_name = await encryptString(key, clean);
        await desktopClient.entities.KnowledgeWeb.update(activeWebId, { enc_name });
        setWebs((prev) => prev.map((w) => (w.id === activeWebId ? { ...w, enc_name } : w)));
        return;
      }
      await desktopClient.entities.KnowledgeWeb.update(activeWebId, { title: clean });
      setWebs((prev) => prev.map((w) => (w.id === activeWebId ? { ...w, title: clean } : w)));
    } catch (error) {
      toast.error(error?.message || 'BEX could not rename this Knowledge Web.');
      throw error;
    }
  }, [activeWebId, webs, privateWeb]);

  // Name the tab after whatever is open in it, so several workspaces are told
  // apart by content instead of all reading "Knowledge Web".
  //
  // A private web deliberately contributes its placeholder name and NOT
  // `activeWebDisplayTitle`: the tab session is persisted to localStorage, and
  // the decrypted name of a private web must not be written to disk. Same reason
  // the copy/paste buffer is kept in memory only.
  const activeNoteTitle = activeNoteId
    ? notes.find((note) => note.id === activeNoteId)?.title
    : '';
  useTabTitle(
    activeNoteId
      ? activeNoteTitle
      : (activeWeb?.is_private ? 'Private Web' : activeWeb?.title),
    { enabled: !loading },
  );

  // NOTE: this effect MUST stay above the `if (loading) return ...` early
  // return below. It was originally placed further down in the file (next to
  // resolveExportRegion) but that triggered "Rendered more hooks than during
  // the previous render" the moment `loading` flipped from true → false,
  // because the early return changed the hook count between renders.
  useEffect(() => {
    if (exportRegion !== 'section') return;
    const stillValid = canvasObjects.some(
      (o) => o.id === selectedObjectId && o.object_type === 'section',
    );
    if (!stillValid) setExportRegion('whole');
  }, [exportRegion, selectedObjectId, canvasObjects]);

  if (loading) return <LoadingScreen message="Loading Knowledge Web..." />;

  const toggleGrid = () => {
    const next = !showGrid;
    setShowGrid(next);
    localStorage.setItem('kw_grid', String(next));
  };

  const toggleSnap = () => {
    const next = !snapToGrid;
    setSnapToGrid(next);
    localStorage.setItem('kw_snap', String(next));
  };

  const handleRecenterToWork = () => {
    if (!containerRef.current) return;

    const items = [
      ...cards.map((card) => {
        const geometry = geometryForCard(card);
        return {
          x: card.x || 0,
          y: card.y || 0,
          width: geometry.width,
          height: geometry.height,
        };
      }),
      ...canvasObjects.map((obj) => ({
        x: obj.x || 0,
        y: obj.y || 0,
        width: obj.width || 240,
        height: obj.height || 160,
      })),
    ];

    if (items.length === 0) {
      canvas.smoothPanTo(0, 0, containerRef.current.clientWidth, containerRef.current.clientHeight, canvas.zoom);
      return;
    }

    const bounds = items.reduce((acc, item) => ({
      minX: Math.min(acc.minX, item.x),
      minY: Math.min(acc.minY, item.y),
      maxX: Math.max(acc.maxX, item.x + item.width),
      maxY: Math.max(acc.maxY, item.y + item.height),
    }), {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity,
    });

    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;

    canvas.smoothPanTo(
      centerX,
      centerY,
      containerRef.current.clientWidth,
      containerRef.current.clientHeight,
      canvas.zoom,
    );
  };

  // Synchronously flush selection/hover clears so the cloned DOM has no
  // transient affordances (insert-card button, midpoint "+", reroute rings),
  // then wait one paint so React has actually committed before the snapshot.
  const prepareCanvasForExport = async () => {
    flushSync(() => {
      setSelectedConnectionId(null);
      setHoveredConnectionId(null);
    });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  };

  // Resolve the export region selection into bounds (world coords) plus a
  // filename suffix and padding override for the snapshot pipeline. Returns
  // null when the region is unavailable (e.g. "section" with nothing
  // selected) so the caller can bail out early.
  const resolveExportRegion = (region) => {
    if (region === 'view') {
      if (!containerRef.current) return null;
      const rect = containerRef.current.getBoundingClientRect();
      const { pan, zoom } = canvas;
      return {
        bounds: {
          minX: (0 - pan.x) / zoom,
          minY: (0 - pan.y) / zoom,
          maxX: (rect.width - pan.x) / zoom,
          maxY: (rect.height - pan.y) / zoom,
        },
        padding: 0,
        fileNameSuffix: 'view',
      };
    }
    if (region === 'section') {
      const section = canvasObjects.find(
        (o) => o.id === selectedObjectId && o.object_type === 'section',
      );
      if (!section) return null;
      const width = section.width || 400;
      const height = section.height || 300;
      const baseSuffix = section.title ? `section-${section.title}` : 'section';
      return {
        bounds: {
          minX: section.x || 0,
          minY: section.y || 0,
          maxX: (section.x || 0) + width,
          maxY: (section.y || 0) + height,
        },
        fileNameSuffix: baseSuffix,
      };
    }
    return {
      bounds: getExportBounds(cards, canvasObjects, connections, cardGeometries),
      fileNameSuffix: undefined,
    };
  };

  const handleExportPdf = async (regionOverride) => {
    const region = regionOverride || exportRegion;
    const resolved = resolveExportRegion(region);
    if (!resolved) return;
    setIsExportingPdf(true);
    try {
      await prepareCanvasForExport();
      await exportKnowledgeWebToPdf({
        canvasContentRef,
        cards,
        canvasObjects,
        connections,
        webTitle: activeWeb?.title || 'knowledge-web',
        bounds: resolved.bounds,
        padding: resolved.padding,
        fileNameSuffix: resolved.fileNameSuffix,
      });
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleExportJpeg = async (regionOverride) => {
    const region = regionOverride || exportRegion;
    const resolved = resolveExportRegion(region);
    if (!resolved) return;
    setIsExportingJpeg(true);
    try {
      await prepareCanvasForExport();
      await exportKnowledgeWebToJpeg({
        canvasContentRef,
        cards,
        canvasObjects,
        connections,
        webTitle: activeWeb?.title || 'knowledge-web',
        bounds: resolved.bounds,
        padding: resolved.padding,
        fileNameSuffix: resolved.fileNameSuffix,
      });
    } finally {
      setIsExportingJpeg(false);
    }
  };

  const handleExportPng = async (regionOverride) => {
    const region = regionOverride || exportRegion;
    const resolved = resolveExportRegion(region);
    if (!resolved) return;
    setIsExportingPng(true);
    try {
      await prepareCanvasForExport();
      await exportKnowledgeWebToPng({
        canvasContentRef,
        cards,
        canvasObjects,
        connections,
        webTitle: activeWeb?.title || 'knowledge-web',
        bounds: resolved.bounds,
        padding: resolved.padding,
        fileNameSuffix: resolved.fileNameSuffix,
      });
    } finally {
      setIsExportingPng(false);
    }
  };

  const handleExportBerean = async () => {
    setIsExportingBerean(true);
    try {
      exportKnowledgeWebToBerean({
        web: activeWeb,
        cards,
        connections,
        canvasObjects,
      });
    } finally {
      setIsExportingBerean(false);
    }
  };

  const handleExportJson = async () => {
    setIsExportingJson(true);
    try {
      exportKnowledgeWebToKumuJson({
        web: activeWeb,
        cards,
        connections,
      });
    } finally {
      setIsExportingJson(false);
    }
  };

  const handleExportMarkdown = async () => {
    setIsExportingMarkdown(true);
    try {
      exportKnowledgeWebToMarkdown({
        web: activeWeb,
        cards,
        connections,
        canvasObjects,
      });
    } finally {
      setIsExportingMarkdown(false);
    }
  };

  const handleFullBackup = async () => {
    setIsBackingUp(true);
    setBackupProgress('Preparing backup...');
    try {
      const allWebs = await desktopClient.entities.KnowledgeWeb.list('-updated_date', 1000);
      if (!allWebs || allWebs.length === 0) {
        toast.error('No Knowledge Webs to back up.');
        return;
      }

      const loadWebData = async (web) => {
        // IMPORTANT: this never touches the module-global active-encryption
        // context (setActiveEncryption). Mutating that global mid-backup
        // would race with concurrent writes — e.g. a debounced autosave on
        // the currently-open web firing while we've swapped the context to a
        // different web would encrypt the open web's data with the wrong key.
        // Instead we fetch raw rows and decrypt them ourselves with the
        // web's explicit key (decryptIncomingWithKey is read-only).
        const [rawCards, rawConnections, rawObjects] = await Promise.all([
          desktopClient.entities.WebCard.filter({ web_id: web.id }),
          desktopClient.entities.WebConnection.filter({ web_id: web.id }),
          desktopClient.entities.CanvasObject.filter({ web_id: web.id }),
        ]);

        // Public web — rows have no enc_payload, so they come back in the
        // clear regardless of whatever context happens to be active.
        if (!web?.is_private) {
          return { cards: rawCards, connections: rawConnections, canvasObjects: rawObjects };
        }

        // Private web — can only be exported when unlocked this session.
        // Otherwise its rows stay encrypted (🔒) and there is no key to
        // decrypt them, so we skip it (recorded in the manifest).
        const key = privateWeb.getKey(web.id);
        if (!key) {
          return { skipped: true, reason: 'Private web is locked — unlock it, then run the backup again to include it.' };
        }

        const [cards, connections, canvasObjects] = await Promise.all([
          Promise.all(rawCards.map((r) => decryptIncomingWithKey('WebCard', r, key))),
          Promise.all(rawConnections.map((r) => decryptIncomingWithKey('WebConnection', r, key))),
          Promise.all(rawObjects.map((r) => decryptIncomingWithKey('CanvasObject', r, key))),
        ]);

        // The web's own title lives in `enc_name`; decrypt it so the
        // exported markdown shows the real title instead of the
        // "Private Web" placeholder.
        let decryptedTitle = web.title;
        if (web.enc_name) {
          try { decryptedTitle = await decryptString(key, web.enc_name); } catch { /* keep placeholder */ }
        }
        return { cards, connections, canvasObjects, web: { ...web, title: decryptedTitle } };
      };

      const result = await exportAllKnowledgeWebsToZip({
        webs: allWebs,
        loadWebData,
        onProgress: ({ phase, current, total }) => {
          if (phase === 'exporting') setBackupProgress(`Exporting ${current} / ${total} webs...`);
          else if (phase === 'zipping') setBackupProgress('Creating zip...');
        },
      });

      if (result.failed.length > 0) {
        toast.warning(
          `Backup downloaded with ${result.failed.length} web(s) skipped. See backup-manifest.md for details.`,
        );
      } else {
        toast.success('Full Second Brain backup downloaded.');
      }
    } catch (err) {
      console.error('[fullBackup] failed:', err);
      toast.error('Backup failed. See details.');
    } finally {
      setIsBackingUp(false);
      setBackupProgress('');
    }
  };

  const reconcileImport = async (imported) => {
    const preview = await previewLocalKnowledgeWebImport(activeWebId, imported);
    const report = preview.report;
    const warnings = [];
    if (report.skippedConnections > 0) {
      warnings.push(`${report.skippedConnections} connections cannot be restored and will be skipped.`);
    }
    if (report.legacyObjectsWithoutIds > 0) {
      warnings.push('This older backup omitted canvas IDs, so its point connections cannot be identified.');
    }
    if (report.droppedSourceLinks > 0) {
      warnings.push(`${report.droppedSourceLinks} Second Brain source links are not included in this backup format.`);
    }
    const summary = [
      'This will replace the cards and connections in the open Knowledge Web.',
      '',
      `Ready: ${report.accepted.cards} cards, ${report.accepted.connections} connections, and ${report.accepted.canvasObjects} canvas objects.`,
      ...(warnings.length ? ['', ...warnings] : []),
      '',
      'Nothing will change unless the complete replacement succeeds. Continue?',
    ].join('\n');
    if (!window.confirm(summary)) return { cancelled: true, report };

    const result = await commitLocalKnowledgeWebImport(activeWebId, imported);
    applySnapshot(result.snapshot);
    setWebs((current) => current.map((web) => (
      web.id === activeWebId ? { ...web, ...result.web } : web
    )));
    if (result.web.connector_style) {
      setConnectorStyle(result.web.connector_style);
      localStorage.setItem('kw_connector_style', result.web.connector_style);
    }
    flashSave();
    return {
      createdCards: result.snapshot.cards,
      createdConnections: result.snapshot.connections,
      createdObjects: result.snapshot.canvasObjects,
      report: result.report,
    };
  };

  const handleImportBerean = async () => {
    if (!activeWebId) return;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.berean,.json,.md,.markdown';
    input.onchange = async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const lowerName = file.name.toLowerCase();
      const isJson = lowerName.endsWith('.json');
      const isMarkdown = lowerName.endsWith('.md') || lowerName.endsWith('.markdown');

      setIsImportingBerean(true);
      try {
        let imported;
        let jsonMeta = null;

        if (isMarkdown) {
          imported = await importKnowledgeWebFromMarkdown(file);
        } else if (isJson) {
          try {
            imported = await importJsonGraph(file);
            jsonMeta = imported.meta;
          } catch (e) {
            if (e.message === 'BEREAN_FORMAT') {
              imported = await importKnowledgeWebFromBerean(file);
            } else {
              toast.error(e.message || 'Failed to parse JSON file.');
              return;
            }
          }
        } else {
          imported = await importKnowledgeWebFromBerean(file);
        }

        const importResult = await reconcileImport(imported);
        if (importResult.cancelled) {
          toast.info('Import cancelled. Nothing changed.');
          return;
        }
        const { createdCards, createdConnections, report } = importResult;

        if (jsonMeta) {
          const parts = [`Imported ${createdCards.length} cards and ${createdConnections.length} connections`];
          if (jsonMeta.detectedFormat) parts.push(` (${jsonMeta.detectedFormat} format)`);
          const warnings = [];
          if (jsonMeta.malformedNodes > 0) warnings.push(`${jsonMeta.malformedNodes} malformed nodes skipped`);
          if (jsonMeta.malformedEdges > 0) warnings.push(`${jsonMeta.malformedEdges} malformed edges skipped`);
          if (jsonMeta.skippedEdges > 0) warnings.push(`${jsonMeta.skippedEdges} connections skipped (unresolved endpoints)`);
          if (jsonMeta.duplicateNodeIds > 0) warnings.push(`${jsonMeta.duplicateNodeIds} duplicate node IDs resolved`);
          if (jsonMeta.truncatedNodes > 0) warnings.push(`${jsonMeta.truncatedNodes} nodes truncated (limit reached)`);
          if (jsonMeta.truncatedEdges > 0) warnings.push(`${jsonMeta.truncatedEdges} connections truncated (limit reached)`);
          const totalSkipped = (jsonMeta.malformedNodes || 0) + (jsonMeta.malformedEdges || 0) + (jsonMeta.skippedEdges || 0) + (jsonMeta.truncatedNodes || 0) + (jsonMeta.truncatedEdges || 0);
          if (totalSkipped > 0) parts.push(`. ${totalSkipped} items skipped`);
          if (warnings.length > 0) parts.push(` (${warnings.join('; ')})`);
          const skippedBySafeImport = report.skippedConnections || 0;
          if (skippedBySafeImport > 0) parts.push(`. ${skippedBySafeImport} unsafe connections skipped`);
          const message = parts.join('') + (totalSkipped === 0 && skippedBySafeImport === 0 ? '.' : '');
          if (totalSkipped > 0 || skippedBySafeImport > 0) toast.warning(message);
          else toast.success(message);
        } else {
          const message = `Imported ${createdCards.length} cards, ${createdConnections.length} connections, and ${report.accepted.canvasObjects} canvas objects.`;
          if (report.skippedConnections > 0) {
            toast.warning(`${message} ${report.skippedConnections} unsafe connections were skipped.`);
          } else toast.success(message);
        }
      } catch (e) {
        toast.error(e.message || 'Import failed.');
      } finally {
        setIsImportingBerean(false);
      }
    };
    input.click();
  };

  const handleMassImport = () => {
    if (isMassImporting) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.berean,.md,.markdown';
    input.onchange = async (event) => {
      const files = Array.from(event.target.files || []);
      if (!files.length) return;
      setIsMassImporting(true);
      try {
        const arrivalDelay = Math.max(35, Math.min(115, Math.floor(1400 / files.length)));
        const result = await importKnowledgeFiles(files, {
          parseBerean: importKnowledgeWebFromBerean,
          createKnowledgeWeb: (title) => desktopClient.entities.KnowledgeWeb.create({ title }),
          commitKnowledgeWeb: (webId, payload) => commitLocalKnowledgeWebImport(webId, payload),
          deleteKnowledgeWeb: (webId) => desktopClient.entities.KnowledgeWeb.delete(webId),
          createNote: (note) => desktopClient.entities.MindNote.create(note),
          renderMarkdown: markdownToNoteHtml,
          onImported: async (item) => {
            flushSync(() => {
              if (item.kind === 'web') setWebs((current) => [item.record, ...current]);
              else setNotes((current) => [item.record, ...current]);
            });
            await new Promise((resolve) => window.setTimeout(resolve, arrivalDelay));
          },
        });
        const webCount = result.imported.filter((item) => item.kind === 'web').length;
        const noteCount = result.imported.filter((item) => item.kind === 'note').length;
        const summary = `Imported ${webCount} Knowledge Web${webCount === 1 ? '' : 's'} and ${noteCount} note${noteCount === 1 ? '' : 's'}.`;
        if (result.failed.length) {
          const sample = result.failed.slice(0, 3).map((failure) => failure.fileName).join(', ');
          toast.warning(`${summary} ${result.failed.length} file${result.failed.length === 1 ? '' : 's'} skipped: ${sample}${result.failed.length > 3 ? ', …' : ''}`);
        } else toast.success(summary);
      } catch (error) {
        toast.error(error?.message || 'Mass import failed.');
      } finally {
        setIsMassImporting(false);
      }
    };
    input.click();
  };

  const importExportMenu = (
    <>
      <div className="px-3 py-1.5 text-[10px] font-semibold text-ink-faint uppercase tracking-wider">Import / Export</div>
      <ExportMenu
        exportRegion={exportRegion}
        setExportRegion={setExportRegion}
        selectedObjectId={selectedObjectId}
        canvasObjects={canvasObjects}
        isExportingPdf={isExportingPdf}
        isExportingJpeg={isExportingJpeg}
        isExportingPng={isExportingPng}
        isExportingBerean={isExportingBerean}
        isExportingJson={isExportingJson}
        isExportingMarkdown={isExportingMarkdown}
        isImportingBerean={isImportingBerean}
        isMassImporting={isMassImporting}
        handleExportPdf={handleExportPdf}
        handleExportJpeg={handleExportJpeg}
        handleExportPng={handleExportPng}
        handleExportBerean={handleExportBerean}
        handleExportJson={handleExportJson}
        handleExportMarkdown={handleExportMarkdown}
        handleImportBerean={handleImportBerean}
        handleMassImport={handleMassImport}
        canUseCurrentWeb={Boolean(activeWebId)}
        isBackingUp={isBackingUp}
        backupProgress={backupProgress}
        handleFullBackup={handleFullBackup}
        onAfterAction={() => setShowImportExportMenu(false)}
      />
    </>
  );

  // Notes deliberately use the full page. The editor toolbar exists only when
  // an actual Knowledge Web is open.
  const topBarHasTools = Boolean(activeWebId);

  return (
    <div className="h-screen bg-gray-900 flex overflow-hidden">
      <CreatePrivateWebModal
        open={showCreatePrivateModal}
        busy={createPrivateBusy}
        initialName={createPrivateInitialName}
        onClose={() => !createPrivateBusy && setShowCreatePrivateModal(false)}
        onCreate={handleCreatePrivateWeb}
      />

      <UnlockWebModal
        open={!!unlockTarget}
        web={unlockTarget?.web}
        onClose={() => setUnlockTarget(null)}
        onUnlock={handleUnlockWeb}
      />

      <AnimatePresence>
        {midpointMenu && (
          <>
            {/* Click-away catcher — any click outside the menu closes it. */}
            <div
              className="fixed inset-0 z-[60]"
              onClick={closeMidpointMenu}
              onContextMenu={(e) => { e.preventDefault(); closeMidpointMenu(); }}
              data-testid="overlay-midpoint-menu"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: -2, transition: { duration: 0.09 } }}
              transition={{ type: 'spring', stiffness: 520, damping: 30, mass: 0.6 }}
              className="fixed z-[61] rounded-lg shadow-2xl overflow-hidden"
              style={{
                left: Math.min(midpointMenu.screenX + 6, window.innerWidth - MIDPOINT_MENU_W - 8),
                top: Math.min(midpointMenu.screenY + 6, window.innerHeight - MIDPOINT_MENU_H - 8),
                width: MIDPOINT_MENU_W,
                transformOrigin: 'top left',
                backgroundColor: '#161a26',
                border: '1px solid #3a4258',
                boxShadow: '0 10px 34px rgba(0,0,0,0.55), inset 0 1px 0 rgb(var(--ink-muted) / 0.07)',
              }}
              data-testid="menu-midpoint"
            >
              <div className="px-2.5 pt-1.5 pb-1 text-[9px] font-semibold uppercase tracking-[0.13em] text-gray-500 border-b border-white/5">
                Insert on link
              </div>
              <div className="p-1">
                {MIDPOINT_MENU_OPTIONS.map((opt, i) => (
                  <motion.button
                    key={opt.kind}
                    type="button"
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.03 + i * 0.028, duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                    whileHover={{ x: 2 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => handleMidpointInsert(opt.kind)}
                    className="group w-full flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-gray-300 hover:bg-violet-500/15 hover:text-white transition-colors"
                    data-testid={`button-midpoint-insert-${opt.kind}`}
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] bg-white/[0.04] text-gray-400 ring-1 ring-inset ring-white/5 transition-colors group-hover:bg-violet-500/20 group-hover:text-violet-200 group-hover:ring-violet-400/30">
                      <opt.Icon className="w-3.5 h-3.5" />
                    </span>
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block text-[12px] font-medium">{opt.label}</span>
                      <span className="block text-[9.5px] text-gray-500 truncate group-hover:text-violet-300/70">{opt.hint}</span>
                    </span>
                    <ChevronRight className="w-3 h-3 shrink-0 text-violet-300 opacity-0 -translate-x-1 transition-all duration-150 group-hover:opacity-100 group-hover:translate-x-0" />
                  </motion.button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {webLinkPickerPos && (
        <WebLinkPicker
          webs={webs}
          activeWebId={activeWebId}
          onCancel={() => {
            // Drop any pending midpoint-insert intent so the next
            // free WebLink placement doesn't reuse a stale connId.
            pendingWebLinkInsertRef.current = null;
            setWebLinkPickerPos(null);
            setMode('hand');
          }}
          onPick={async (picked) => {
            const pos = webLinkPickerPos;
            setWebLinkPickerPos(null);
            setMode('hand');
            // If this picker was opened from the connection-midpoint
            // "Insert Weblink" menu, route into the split-connection
            // flow instead of just dropping a free node.
            const pending = pendingWebLinkInsertRef.current;
            pendingWebLinkInsertRef.current = null;
            if (pending) {
              await handleInsertObjectAtMidpoint(
                pending.connId, 'web_link', pending.midX, pending.midY,
                { link_web_id: picked.id },
              );
              return;
            }
            await createCanvasObject('web_link', pos.x, pos.y, {
              link_web_id: picked.id,
              width: 180,
              height: 140,
            });
          }}
        />
      )}

      {timegraphPickerPos && (
        <TimegraphPicker
          onClose={() => {
            setTimegraphPickerPos(null);
            setMode('hand');
          }}
          onPick={async (picked) => {
            const pos = timegraphPickerPos;
            setTimegraphPickerPos(null);
            setMode('hand');
            await createCanvasObject('timegraph', pos.x, pos.y, {
              timegraph_id: picked.id,
              width: 240,
              height: 150,
            });
          }}
        />
      )}

      {webTransition && (
        <WebTransitionOverlay
          origin={webTransition.origin}
          title={webTransition.title}
          isPrivate={webTransition.isPrivate}
          onMidpoint={() => {
            // Halfway through the explode phase the screen is fully
            // covered, so this is the safe moment to swap webs — the
            // user never sees the destination snap into place.
            if (webTransition.webId) loadWeb(webTransition.webId);
          }}
          onComplete={() => setWebTransition(null)}
        />
      )}

      <div className="flex-1 flex flex-col min-w-0 relative">
        {topBarHasTools && (
        <div
          className={`bex-web-header h-10 flex items-center px-3 gap-2 z-20 flex-shrink-0 ${
            activeNoteId ? '' : 'bg-gray-850 border-b border-gray-800'
          }`}
          style={activeNoteId ? undefined : { backgroundColor: '#1a1f2e' }}
        >
          <BackToMenu />
          {activeWebId && (
            <InlineWebTitle
              title={activeWebDisplayTitle}
              onRename={renameActiveWeb}
              disabled={Boolean(activeWeb?.is_private) && !privateWeb.isUnlocked(activeWebId)}
            >
              <SpotlightLabel
                text={activeWebDisplayTitle}
                query={activeSpotlight?.field === 'title' && activeSpotlight?.cardId == null ? activeSpotlight.query : ''}
              />
            </InlineWebTitle>
          )}

          <div className="ml-auto flex items-center gap-1.5">
            {activeWebId && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => { setShowImportExportMenu((current) => !current); setShowSettingsMenu(false); }}
                  className={`grid h-7 w-7 place-items-center rounded-lg border transition-colors ${
                    showImportExportMenu
                      ? 'border-violet-400/40 bg-violet-500/15 text-violet-200'
                      : 'border-gray-700/50 bg-gray-800/60 text-gray-500 hover:border-gray-600 hover:text-gray-200'
                  }`}
                  title="Import / export"
                  aria-label="Import / export"
                  data-testid="button-import-export"
                >
                  <ArrowDownUp className="h-3.5 w-3.5" />
                </button>
                {showImportExportMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowImportExportMenu(false)} />
                    <div className="absolute right-0 top-full z-50 mt-1 max-h-[calc(100vh-5rem)] w-72 overflow-y-auto rounded-xl border border-line bg-surface shadow-2xl">
                      {importExportMenu}
                    </div>
                  </>
                )}
              </div>
            )}
            {activeWebId && (
              <>
                <SearchBar cards={cards} onJumpToCard={handleJumpToCard} />
                <FilterPanel cards={cards} filters={filters} onFiltersChange={setFilters} />
              </>
            )}
            <div className={`flex items-center gap-1 ml-1 border-l border-gray-700/50 pl-1.5 ${activeNoteId ? 'hidden' : ''}`}>
              <button
                onClick={undo}
                disabled={historyRef.current.length === 0}
                title="Undo"
                className="p-1 rounded transition-colors text-gray-600 hover:text-ink-faint disabled:opacity-40 disabled:hover:text-gray-600"
                data-testid="button-undo"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={redo}
                disabled={futureRef.current.length === 0}
                title="Redo"
                className="p-1 rounded transition-colors text-gray-600 hover:text-ink-faint disabled:opacity-40 disabled:hover:text-gray-600"
                data-testid="button-redo"
              >
                <Redo2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleRecenterToWork}
                title="Recenter to work"
                className="p-1 rounded transition-colors text-gray-600 hover:text-ink-faint"
                data-testid="button-recenter"
              >
                <Crosshair className="w-3.5 h-3.5" />
              </button>
            </div>

            {activeWebId && (
              <div className="relative ml-1">
                <button
                  onClick={handleAddToVersionHistory}
                  title="Save a snapshot you can return to (separate from autosave)"
                  className="flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs whitespace-nowrap transition-colors bg-gray-800/60 border-gray-700/50 text-gray-400 hover:text-gray-200 hover:border-gray-600"
                  data-testid="button-add-to-version-history"
                >
                  <History className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">Snapshot</span>
                </button>
              </div>
            )}

            {activeWebId && (
              <div className="relative ml-1">
                <button
                  onClick={() => setShowVersionHistory(prev => !prev)}
                  title="View saved snapshots"
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-xs transition-colors ${
                    showVersionHistory
                      ? 'bg-elevated border-line-strong text-ink'
                      : 'bg-gray-800/60 border-gray-700/50 text-gray-400 hover:text-gray-200 hover:border-gray-600'
                  }`}
                  data-testid="button-version-history-open"
                >
                  <span className="hidden sm:inline">Versions</span>
                  <span className="sm:hidden">V</span>
                </button>
                <VersionHistoryPanel
                  webId={activeWebId}
                  open={showVersionHistory}
                  onClose={() => setShowVersionHistory(false)}
                  onRestoreSnapshot={handleVersionRestore}
                  refreshKey={versionRefreshKey}
                />
              </div>
            )}

            {activeWebId && (
              <div className="relative ml-1">
                <button
                  onClick={() => { setShowSettingsMenu(prev => !prev); setShowImportExportMenu(false); }}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs transition-colors ${
                    showSettingsMenu
                      ? 'bg-elevated border-line-strong text-ink'
                      : 'bg-gray-800/60 border-gray-700/50 text-gray-400 hover:text-gray-200 hover:border-gray-600'
                  }`}
                  data-testid="button-settings"
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Settings</span>
                </button>
                {showSettingsMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowSettingsMenu(false)} />
                    <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-surface border border-line rounded-lg shadow-xl py-1 text-xs" data-testid="menu-settings">
                      <div className="px-3 py-1.5 text-[10px] font-semibold text-ink-faint uppercase tracking-wider">Text size</div>
                      <div className="px-3 pb-2" data-testid="knowledge-web-text-size-setting">
                        <TextSizeControl
                          value={textSize}
                          onChange={setTextSize}
                          ariaLabel="Knowledge Web text size"
                          testId="knowledge-web-text-size"
                        />
                      </div>
                      <div className="mb-1 border-t border-line" />
                      <div className="px-3 py-1.5 text-[10px] font-semibold text-ink-faint uppercase tracking-wider">Canvas</div>
                      <button
                        onClick={() => setAutoFocus(prev => !prev)}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-ink-muted hover:bg-elevated transition-colors"
                        data-testid="button-toggle-autofocus"
                      >
                        <span className="flex items-center gap-2"><Focus className="w-3.5 h-3.5" /> Auto-Focus on Click</span>
                        <span className={`w-7 h-4 rounded-full relative transition-colors ${autoFocus ? 'bg-brand' : 'bg-line'}`}>
                          <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${autoFocus ? 'left-3.5' : 'left-0.5'}`} />
                        </span>
                      </button>
                      <button
                        onClick={() => { const next = connectorStyle === 'curvy' ? 'straight' : 'curvy'; setConnectorStyle(next); localStorage.setItem('kw_connector_style', next); }}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-ink-muted hover:bg-elevated transition-colors"
                        data-testid="button-toggle-connector"
                      >
                        <span className="flex items-center gap-2"><Spline className="w-3.5 h-3.5" /> {connectorStyle === 'curvy' ? 'Curvy Lines' : 'Straight Lines'}</span>
                        <span className="text-ink-faint">{connectorStyle === 'curvy' ? '⌇' : '—'}</span>
                      </button>
                      {/* Global connection color — applies to every
                          connection that hasn't been individually
                          recolored via the Connection Inspector. */}
                      <label
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-ink-muted hover:bg-elevated transition-colors cursor-pointer"
                        data-testid="button-global-connection-color"
                      >
                        <span className="flex items-center gap-2"><Spline className="w-3.5 h-3.5" /> Connection Color</span>
                        <span className="flex items-center gap-2">
                          <span
                            className="w-4 h-4 rounded border border-line"
                            style={{ backgroundColor: globalConnectionColor }}
                          />
                          <input
                            type="color"
                            value={globalConnectionColor}
                            onChange={(e) => {
                              const next = e.target.value;
                              setGlobalConnectionColor(next);
                              try { localStorage.setItem('kw_connection_color', next); } catch {}
                            }}
                            className="w-0 h-0 opacity-0 absolute pointer-events-none"
                            data-testid="input-global-connection-color"
                          />
                        </span>
                      </label>
                      <button
                        onClick={() => { toggleGrid(); }}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-ink-muted hover:bg-elevated transition-colors"
                        data-testid="button-toggle-grid"
                      >
                        <span className="flex items-center gap-2"><Grid3X3 className="w-3.5 h-3.5" /> Show Grid</span>
                        <span className={`w-7 h-4 rounded-full relative transition-colors ${showGrid ? 'bg-brand' : 'bg-line'}`}>
                          <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${showGrid ? 'left-3.5' : 'left-0.5'}`} />
                        </span>
                      </button>
                      <button
                        onClick={() => { toggleSnap(); }}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-ink-muted hover:bg-elevated transition-colors"
                        data-testid="button-toggle-snap"
                      >
                        <span className="flex items-center gap-2"><Magnet className="w-3.5 h-3.5" /> Snap to Grid</span>
                        <span className={`w-7 h-4 rounded-full relative transition-colors ${snapToGrid ? 'bg-brand' : 'bg-line'}`}>
                          <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${snapToGrid ? 'left-3.5' : 'left-0.5'}`} />
                        </span>
                      </button>

                      <button
                        onClick={() => { setShowTagColorPanel(prev => !prev); setShowSettingsMenu(false); }}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-ink-muted hover:bg-elevated transition-colors"
                        data-testid="button-tag-colors"
                      >
                        <span className="flex items-center gap-2"><Tag className="w-3.5 h-3.5" /> Tag Colors</span>
                        {Object.keys(tagColors).length > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand/30 text-brand-strong">{Object.keys(tagColors).length}</span>
                        )}
                      </button>

                      <div className="my-1 border-t border-line" />
                      <div className="px-3 py-1.5 text-[10px] font-semibold text-ink-faint uppercase tracking-wider">Library & Sharing</div>
                      <button
                        onClick={() => { setShowLibrary(!showLibrary); setShowSettingsMenu(false); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-ink-muted hover:bg-elevated transition-colors"
                        data-testid="button-library"
                      >
                        <BookCopy className="w-3.5 h-3.5" /> Card Library
                      </button>
                      <button
                        onClick={() => { setShowShareDialog(true); setShowSettingsMenu(false); }}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-ink-muted hover:bg-elevated transition-colors"
                        data-testid="button-share"
                      >
                        <span className="flex items-center gap-2"><Share2 className="w-3.5 h-3.5" /> Share</span>
                        {activeWeb?.is_shared && <span className="w-1.5 h-1.5 rounded-full bg-green-400" />}
                      </button>
                    </div>
                  </>
                )}
                {showTagColorPanel && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowTagColorPanel(false)} />
                    <TagColorPanel
                      tagColors={tagColors}
                      cards={cards}
                      onChange={(next) => {
                        setTagColors(next);
                        if (activeWebId) {
                          // Local cache first so the next reload paints
                          // instantly even if the network is slow.
                          try { localStorage.setItem(`kw_tag_colors:${activeWebId}`, JSON.stringify(next)); } catch {}
                          saveTagColorsToDb(activeWebId, next);
                        }
                      }}
                      onClose={() => setShowTagColorPanel(false)}
                    />
                  </>
                )}
              </div>
            )}
            {activeWebId && (
              <span className="text-[10px] text-gray-600 ml-1 hidden sm:inline">
                {filteredCards.length}/{cards.length} cards
              </span>
            )}
          </div>
        </div>
        )}

        {/* Card Library Picker */}
        <CardLibraryPicker
          open={showLibrary}
          onClose={() => setShowLibrary(false)}
          onPlaceCard={handlePlaceCard}
          currentWebCards={cards}
        />

        {/* Share Dialog */}
        <ShareWebDialog
          open={showShareDialog}
          web={activeWeb}
          onToggleShare={handleToggleShare}
          onClose={() => setShowShareDialog(false)}
        />

        {/* First-time explainer for the manual version-history feature. */}
        <VersionHistoryIntroDialog
          open={showVersionIntro}
          onConfirm={handleVersionIntroConfirm}
          onCancel={() => setShowVersionIntro(false)}
        />

        {/* Bulk-delete confirmation: triggered when the user hits Delete with
            more than BULK_DELETE_CONFIRM_THRESHOLD cards selected. */}
        {pendingBulkDelete && (
          <div
            className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            data-testid="modal-bulk-delete-confirm"
            onClick={(e) => { if (e.target === e.currentTarget) setPendingBulkDelete(null); }}
          >
            <div className="relative bg-gray-950 rounded-xl border border-gray-800 shadow-2xl w-full max-w-md p-6 space-y-4">
              <div className="text-center">
                <h3 className="text-lg font-semibold text-gray-100" data-testid="text-bulk-delete-title">
                  Delete {pendingBulkDelete.ids.length} cards?
                </h3>
                <p className="text-sm text-gray-400 mt-2">
                  This will remove {pendingBulkDelete.ids.length} cards and any
                  connections attached to them. You can undo this with
                  Cmd/Ctrl+Z.
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setPendingBulkDelete(null)}
                  className="flex-1 h-10 rounded border border-gray-700 text-gray-200 hover:bg-gray-800 text-sm transition-colors"
                  data-testid="button-bulk-delete-cancel"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const { ids, pointIds = [] } = pendingBulkDelete;
                    setPendingBulkDelete(null);
                    ids.forEach((id) => deleteCard(id));
                    pointIds.forEach((id) => deleteCanvasObject(id));
                  }}
                  className="flex-1 h-10 rounded bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors"
                  data-testid="button-bulk-delete-confirm"
                >
                  Delete {pendingBulkDelete.ids.length}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Canvas */}
        <div className="flex-1 min-h-0 min-w-0 relative overflow-clip" data-testid="knowledge-web-viewport">
          {/* Pan/zoom owns canvas movement. Unlike hidden, clip cannot acquire
              a native scroll offset when an off-screen card receives focus;
              that offset used to drag the sibling toolbars into the canvas.
              Notes retain their own nested scrolling editor. */}
          <SaveIndicator status={saveStatus} />
          <FocusMode
            isActive={focusState.active} depth={focusState.depth}
            onToggle={exitFocus} onDepthChange={d => setFocusState(p => ({ ...p, depth: d }))}
            selectedCardTitle={focusCard?.title}
          />

          {activeNoteId ? (
            <div className="absolute inset-0 flex flex-col">
              <NoteEditorPanel
                noteId={activeNoteId}
                notes={notes}
                onNoteSaved={handleNoteSaved}
                onNoteDeleted={handleNoteDeleted}
                onPageChange={setNoteReadingPage}
                requestedPage={parseIdFromParam(routeParams.slugId || new URLSearchParams(routeLocation.search).get('note')) === activeNoteId
                  && /^[1-9]\d*$/.test(new URLSearchParams(routeLocation.search).get('page') || '')
                  ? Number(new URLSearchParams(routeLocation.search).get('page')) - 1 : null}
                spotlightQuery={activeSpotlight?.query || ''}
                spotlightField={activeSpotlight?.field || ''}
                spotlightToken={activeSpotlight?.token || ''}
                spotlightPage={activeSpotlight?.page ?? null}
                onSpotlightComplete={completeSpotlight}
              />
            </div>
          ) : !activeWebId ? (
            <div className="flex items-center justify-center h-full text-gray-600">
              <div className="text-center">
                <p className="text-lg font-medium mb-1">Nothing open</p>
                <p className="text-sm">Use the + to create a Knowledge Web or an Individual Note</p>
              </div>
            </div>
          ) : (
            <>
              <div
                ref={containerRef}
                data-canvas="true"
                className={`w-full h-full ${canvas.isPanning ? 'cursor-grabbing' : mode === 'card' || mode === 'timegraph' || mode === 'draw' || mode === 'section' || mode === 'image' || mode === 'web_link' ? 'cursor-crosshair' : mode === 'erase' ? 'cursor-not-allowed' : mode === 'hand' ? 'cursor-default' : 'cursor-default'}`}
                style={{ touchAction: 'none' }}
                onMouseDown={(e) => {
                  if (e.target.dataset.canvas !== 'true') return;
                  if (e.metaKey || e.ctrlKey) {
                    startMarqueeSelection(e);
                    return;
                  }
                  // In section mode, plain drag = create section sized
                  // to the dragged rectangle (no need to double-click).
                  if (mode === 'section') {
                    startSectionDragCreate(e);
                    return;
                  }
                  // In draw mode, plain drag = freehand stroke. We
                  // collect canvas-space points and persist on mouseup.
                  if (mode === 'draw') {
                    startDrawStroke(e);
                    return;
                  }
                  canvas.startPan(e);
                }}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={() => canvas.endPan()}
                onClick={handleCanvasClick}
                onDoubleClick={handleCanvasDoubleClick}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleCanvasDrop}
              >
                {showGrid && (
                  <div
                    className="absolute inset-0 pointer-events-none"
                    data-canvas="true"
                    style={{
                      backgroundImage: `
                        linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)
                      `,
                      backgroundSize: `${GRID_SIZE * canvas.zoom}px ${GRID_SIZE * canvas.zoom}px`,
                      backgroundPosition: `${canvas.pan.x % (GRID_SIZE * canvas.zoom)}px ${canvas.pan.y % (GRID_SIZE * canvas.zoom)}px`,
                    }}
                  />
                )}

                <SelectionMarquee selection={marqueeSelection} />

                <div
                  ref={canvasContentRef}
                  className="absolute origin-top-left"
                  data-canvas="true"
                  style={{
                    transform: `translate(${canvas.pan.x}px, ${canvas.pan.y}px) scale(${canvas.zoom})`,
                    width: '100%', height: '100%',
                  }}
                >
                  {/* Sections render first (below everything) */}
                  {canvasObjects.filter(o => o.object_type === 'section').map(obj => (
                    <CanvasSection
                      key={obj.id} obj={obj} zoom={canvas.zoom}
                      isSelected={selectedObjectId === obj.id}
                      onSelect={handleObjectSelect}
                      onDragEnd={handleObjDragEnd}
                      onPositionUpdate={handleObjPositionUpdate}
                      onUpdate={updateCanvasObject}
                      onResize={handleObjResize}
                    />
                  ))}

                  <ConnectionLines
                    connections={filteredConnections} cards={filteredCards}
                    cardGeometries={cardGeometries}
                    points={canvasObjects.filter(o => o.object_type === 'point')}
                    images={canvasObjects.filter(o => o.object_type === 'image')}
                    webLinks={canvasObjects.filter(o => o.object_type === 'web_link')}
                    timegraphs={canvasObjects.filter(o => o.object_type === 'timegraph')}
                    connectorStyle={connectorStyle}
                    globalConnectionColor={globalConnectionColor}
                    selectedConnectionId={selectedConnectionId}
                    onSelectConnection={(id) => {
                      if (mode === 'erase') {
                        deleteConnection(id);
                        return;
                      }
                      setSelectedConnectionId(id);
                      setSelectedCardId(null);
                      setSelectedCardIds([]);
                      setSelectedObjectId(null);
                    }}
                    tempLine={tempLine}
                    hoveredConnectionId={hoveredConnectionId}
                    onHoverConnection={setHoveredConnectionId}
                    onDragReroutePoint={handleDragReroutePoint}
                    onRemoveReroutePoint={handleRemoveReroutePoint}
                    onDragConnectionEndpoint={handleDragConnectionEndpoint}
                    onRequestMidpointMenu={(connId, screenX, screenY, midX, midY) => {
                      // In erase mode the same click already deleted the
                      // connection, so there is nothing left to insert into.
                      if (mode === 'erase') return;
                      setMidpointMenu({ connId, screenX, screenY, midX, midY });
                    }}
                  />

                  {/* Images */}
                  {canvasObjects.filter(o => o.object_type === 'image').map(obj => (
                    <CanvasImage
                      key={obj.id} obj={obj} zoom={canvas.zoom}
                      isSelected={selectedObjectId === obj.id}
                      onSelect={handleObjectSelect}
                      onDragEnd={handleObjDragEnd}
                      onPositionUpdate={handleObjPositionUpdate}
                    />
                  ))}

                  {/* Routing points (rendered above noodles so they're easy to grab) */}
                  {canvasObjects.filter(o => o.object_type === 'point').map(obj => (
                    <CanvasPoint
                      key={obj.id} obj={obj} zoom={canvas.zoom}
                      isSelected={selectedObjectId === obj.id || selectedPointIds.includes(obj.id)}
                      isConnectionSource={connectionSource && connectionSource.kind === 'point' && connectionSource.id === obj.id}
                      onSelect={handlePointSelect}
                      onDragEnd={handleObjDragEnd}
                      onPositionUpdate={handleObjPositionUpdate}
                    />
                  ))}

                  {/* Drawings — freehand vector strokes from the Draw tool. */}
                  {canvasObjects.filter(o => o.object_type === 'drawing').map(obj => (
                    <CanvasDrawing
                      key={obj.id} obj={obj} zoom={canvas.zoom}
                      isSelected={selectedObjectId === obj.id}
                      onSelect={handleObjectSelect}
                      onDragEnd={handleObjDragEnd}
                      onPositionUpdate={handleObjPositionUpdate}
                      onUpdate={updateCanvasObject}
                    />
                  ))}

                  {/* Live preview of an in-progress freehand stroke. */}
                  {liveStroke && (
                    <svg
                      className="absolute top-0 left-0 pointer-events-none"
                      style={{ overflow: 'visible' }}
                      width={1}
                      height={1}
                    >
                      <path
                        d={liveStroke.d}
                        stroke={liveStroke.color}
                        strokeWidth={liveStroke.thickness}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        fill="none"
                      />
                    </svg>
                  )}

                  {/* Web link nodes — clickable nodes that jump to another
                      knowledge web with a full-screen transition. Only
                      jumps in 'hand' mode so other tools (erase, select,
                      etc.) work normally on the node itself. */}
                  {canvasObjects.filter(o => o.object_type === 'web_link').map(obj => (
                    <CanvasWebLink
                      key={obj.id} obj={obj} zoom={canvas.zoom}
                      webs={webs}
                      isSelected={selectedObjectId === obj.id}
                      isInteractive={mode === 'hand'}
                      onSelect={(id) => {
                        if (mode === 'erase') {
                          deleteCanvasObject(id);
                        } else {
                          handleObjectSelect(id);
                        }
                      }}
                      onDragEnd={handleObjDragEnd}
                      onPositionUpdate={handleObjPositionUpdate}
                      onResize={handleObjResize}
                      onJump={(o) => {
                        // Refuse re-entry while a transition is already
                        // playing — without this guard a fast double-
                        // click (or two web-link nodes clicked in quick
                        // succession) can stack transitions because the
                        // overlay's internal one-shot midpoint guard
                        // only fires once per mount.
                        if (webTransition) return;
                        // Self-link guard: the picker excludes the
                        // active web at create time, but legacy/imported
                        // canvas objects could still point at the page
                        // they live on. Silently ignore — playing the
                        // transition just to land back on the same web
                        // would be confusing.
                        if (!o.link_web_id || o.link_web_id === activeWebId) return;
                        // Build the click origin in viewport coords so
                        // the transition's iris collapses toward where
                        // the user actually clicked, not screen center.
                        const rect = containerRef.current?.getBoundingClientRect();
                        const cx = rect ? rect.left + (o.x + (o.width || 280) / 2 + canvas.pan.x) * canvas.zoom : window.innerWidth / 2;
                        const cy = rect ? rect.top + (o.y + (o.height || 220) / 2 + canvas.pan.y) * canvas.zoom : window.innerHeight / 2;
                        const target = (webs || []).find(w => w.id === o.link_web_id);
                        setWebTransition({
                          webId: o.link_web_id,
                          title: target ? (target.title || 'Knowledge Web') : 'Knowledge Web',
                          isPrivate: !!target?.is_private,
                          origin: { x: cx, y: cy },
                        });
                      }}
                    />
                  ))}

                  {/* Timeline overviews — deliberately compressed, live views.
                      A double-click opens the full shared Timeline in its own tab;
                      a single click remains available for selecting and moving it. */}
                  {canvasObjects.filter(o => o.object_type === 'timegraph').map(obj => (
                    <CanvasTimegraph
                      key={obj.id}
                      obj={obj}
                      zoom={canvas.zoom}
                      isSelected={selectedObjectId === obj.id}
                      isInteractive={mode === 'hand'}
                      onSelect={(id) => {
                        if (mode === 'erase') deleteCanvasObject(id);
                        else if (mode === 'connection') {
                          const target = { id, kind: 'timegraph' };
                          if (!connectionSource) setConnectionSource(target);
                          else {
                            createConnection(connectionSource, target);
                            setConnectionSource(null);
                            setTempLine(null);
                          }
                        }
                        else handleObjectSelect(id);
                      }}
                      onDragEnd={handleObjDragEnd}
                      onPositionUpdate={handleObjPositionUpdate}
                      onResize={handleObjResize}
                      onOpen={(graph) => {
                        if (!graph?.id) return;
                        const originTab = tabs.find((tab) => tab.id === activeId);
                        const path = timegraphDeepLink(graph.id, graph.title);
                        const returnTo = {
                          kind: TAB_KINDS.KNOWLEDGE_WEB,
                          tabId: activeId,
                          path: originTab?.path || webDeepLink(activeWebId, activeWeb?.title),
                          title: originTab?.title || (activeWeb?.is_private ? 'Private Web' : activeWeb?.title) || 'Knowledge Web',
                        };
                        const existingTimelineTabs = tabs.filter((tab) => (
                          tab.kind === TAB_KINDS.TIMELINE
                          && String(parseIdFromParam(tab.path)) === String(graph.id)
                        ));
                        const existingTimelineTab = existingTimelineTabs[0];

                        if (existingTimelineTab) {
                          // One Timeline owns one workspace tab. Reuse the original
                          // tab and remove any duplicates created by older builds.
                          existingTimelineTabs.slice(1).forEach((tab) => closeTab(tab.id));
                          updateTab(existingTimelineTab.id, {
                            path,
                            title: graph.title || 'Unnamed timeline',
                            returnTo,
                          });
                          selectTab(existingTimelineTab.id);
                          return;
                        }

                        openTab(TAB_KINDS.TIMELINE, {
                          path,
                          title: graph.title || 'Unnamed timeline',
                          returnTo,
                        });
                      }}
                      textScale={contentTextScale}
                    />
                  ))}

                  {/* Cards */}
                  {filteredCards.map(card => (
                    <CanvasCard
                      key={card.id} card={card} zoom={canvas.zoom}
                      geometry={cardGeometries[card.id]}
                      onGeometryChange={handleCardGeometryChange}
                      isSelected={selectedCardIds.includes(card.id) || (connectionSource && connectionSource.kind === 'card' && connectionSource.id === card.id)}
                      onSelect={handleCardSelect}
                      onDragEnd={handleCardDragEnd}
                      onDragStart={handleCardDragStart}
                      onPositionUpdate={handlePositionUpdate}
                      onQuickRename={handleQuickRename}
                      onImageDrop={handleImageDrop}
                      onClickNoDrag={handleCardClickNoDrag}
                      onResize={handleCardResize}
                      tagColors={tagColors}
                      textScale={contentTextScale}
                    />
                  ))}
                </div>
              </div>

              <FloatingToolbar
                mode={mode}
                onModeChange={setMode}
                connectorStyle={connectorStyle}
                onToggleConnectorStyle={() => {
                  const next = connectorStyle === 'curvy' ? 'straight' : 'curvy';
                  setConnectorStyle(next);
                  localStorage.setItem('kw_connector_style', next);
                }}
                drawColor={drawColor}
                onDrawColorChange={(c) => {
                  setDrawColor(c);
                  try { localStorage.setItem('kw_draw_color', c); } catch {}
                }}
                drawThickness={drawThickness}
                onDrawThicknessChange={(t) => {
                  setDrawThickness(t);
                  try { localStorage.setItem('kw_draw_thickness', String(t)); } catch {}
                }}
                keybinds={kwKeybinds}
                onOpenRemap={() => setShowKwRemap(true)}
              />
              <KeybindRemapModal
                open={showKwRemap}
                onClose={() => setShowKwRemap(false)}
                title="Knowledge Web shortcuts"
                tools={KW_TOOLS.map((t) => ({ id: t.id, label: t.label }))}
                binds={kwKeybinds}
                onSetBind={setKwBind}
                onReset={resetKwBinds}
              />
              <FloatingZoomControls
                zoom={canvas.zoom}
                multiplyZoom={canvas.multiplyZoom}
                smoothZoomTo={canvas.smoothZoomTo}
                containerRef={containerRef}
              />
            </>
          )}
        </div>
      </div>

      {/* Inspector panels */}
      {selectedCard && selectedCardIds.length <= 1 && (
        <CardEditor
          card={selectedCard} allCards={cards}
          initialMode={currentWorkspaceTab?.webCard?.cardId === selectedCard.id ? currentWorkspaceTab.webCard.mode : 'compact'}
          onModeChange={mode => {
            if (currentWorkspaceTab) updateTab(currentWorkspaceTab.id, { webCard: { webId: activeWebId, cardId: selectedCard.id, mode } });
          }}
          onUpdate={updateCard} onDelete={deleteCard}
          onClose={() => {
            setActiveSpotlight(null);
            setSelectedCardId(null);
            setSelectedCardIds([]);
            const params = new URLSearchParams(routeLocation.search);
            if (params.has('card')) {
              params.delete('card');
              navigate(`${routeLocation.pathname}${params.size ? `?${params}` : ''}`, { replace: true });
            }
          }}
          onFocus={handleFocus}
          isFocused={focusState.active && focusState.cardId === selectedCardId}
          spotlightQuery={String(selectedCardId) === String(activeSpotlight?.cardId) ? activeSpotlight?.query || '' : ''}
          spotlightField={String(selectedCardId) === String(activeSpotlight?.cardId) ? activeSpotlight?.field || '' : ''}
          spotlightToken={String(selectedCardId) === String(activeSpotlight?.cardId) ? activeSpotlight?.token || '' : ''}
          onSpotlightComplete={completeSpotlight}
        />
      )}
      {selectedConnection && !selectedCard && !selectedObject && (
        <ConnectionEditor
          connection={selectedConnection} cards={cards}
          onUpdate={updateConnection} onDelete={deleteConnection}
          onClose={() => setSelectedConnectionId(null)}
        />
      )}

      {selectedObject && !selectedCard && !selectedConnection && selectedObject.object_type !== 'point' && selectedObject.object_type !== 'timegraph' && (
        <ObjectInspector
          obj={selectedObject}
          onUpdate={updateCanvasObject}
          onDelete={deleteCanvasObject}
          onClose={() => setSelectedObjectId(null)}
        />
      )}
    </div>
  );
}
