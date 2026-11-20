import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react';
import { LargeDeletionGuard } from './LargeDeletionGuard';
import { Extension, InputRule } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import { InheritedPasteLink, surroundingPasteLink, inheritInsertedLink } from './InheritedPasteLink';
import { ImageUpload } from './ImageUploadExtension';
import { ImageGallery } from './ImageGalleryExtension';
import ImageGalleryTools from './ImageGalleryTools';
import ImageLightbox from './ImageLightbox';
import { CollapsibleToggle, ToggleSummary, ToggleContent } from './CollapsibleToggleExtension';
import { delimitedTableToHtml } from '@/components/editor/delimitedTable';
import { markdownBlocksToHtml } from '@/components/editor/pastedMarkdown';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import {
  TableCellWithBackground,
  TableHeaderWithBackground,
} from '@/components/editor/TableCellBackground';
import TableGrips, { TABLE_GRIP_MENU_EVENT } from '@/components/editor/TableGripExtension';
import Highlight, { HIGHLIGHT_MENU_EVENT } from '@/components/editor/HighlightExtension';
import { TextCase } from '@/components/editor/TextCaseExtension';
import HighlightMenu from '@/components/editor/HighlightMenu';
import TableGripMenu from '@/components/editor/TableGripMenu';
import {
  Check,
  Code2,
  ExternalLink,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  List,
  ListCollapse,
  ListOrdered,
  Pencil,
  Quote,
  Search,
  Settings2,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { KeywordLink } from './KeywordLinkExtension';
import { BibleSiteLink } from './BibleSiteLinkExtension';
import { LogicBlock } from './LogicBlockExtension';
import { BlockDrag, blockDragPluginKey } from './BlockDragExtension';
import {
  blockFormatMenuIndex,
  blockFormatMenuSelection,
  getDraggableBlocks,
  selectedDraggableBlocks,
} from './blockDragModel';
import { FindInEditor } from './findInEditor';
import { SpotlightJourney, startEditorSpotlight } from './spotlightJourney';
import { useIsActiveTab } from '@/lib/WorkspaceTabs';
import EditorFindBar from './EditorFindBar';
import { SlashCommands } from './slashCommands';
import SlashCommandMenu from './SlashCommandMenu';
import ImageInsertPanel from './ImageInsertPanel';
import FileInsertHost from './FileInsertHost';
import { FileAttachment } from './FileAttachmentExtension';
import TimegraphInsertHost from './TimegraphInsertHost';
import LibraryLinkInsertHost from './LibraryLinkInsertHost';
import { followLibraryLink, libraryLinkPath } from '@/lib/libraryLinks';
import { shouldApplyExternalContent } from './contentSyncRule';
import { TimegraphEmbed } from './TimegraphEmbedExtension';
import { Comment } from './CommentExtension';
import CommentSidebar from './CommentSidebar';
import { Tooltip } from './TooltipExtension';
import { Footnote } from './FootnoteExtension';
import { PointerAnchor, PointerCodeBlock } from './PointerExtension';
import PointerLayer from './PointerLayer';
import TooltipLayer from './TooltipLayer';
import FootnoteComposer from './FootnoteComposer';
import PageFoot from '@/components/notes/PageFoot';
import { positionLinkPanel } from './linkPanelModel';
import {
  ListExitBoundaries,
  normalizeListExitBoundaries,
} from './ListExitBoundaryExtension';
import { ListBackspace } from './ListBackspaceExtension';
import { QuoteBoundaries } from './QuoteBoundaryExtension';
import { desktopClient } from '@/api/desktopClient';
import { LOCAL_FIND_SHORTCUT_REQUEST } from '@/lib/localFindShortcut';
import { TOOLTIP_SHORTCUT_REQUEST } from '@/lib/tooltipShortcut';

// Converts "--" (not before a word char) → em dash, and "->" → right arrow
// as the user types, matching the global typography rules elsewhere in the app.
const TypographyRules = Extension.create({
  name: 'typographyRules',
  addInputRules() {
    return [
      new InputRule({
        find: /--(?![A-Za-z0-9])$/,
        handler: ({ chain, range }) => {
          chain().deleteRange(range).insertContent('\u2014').run();
        },
      }),
      new InputRule({
        find: /->$/,
        handler: ({ chain, range }) => {
          chain().deleteRange(range).insertContent('\u2192').run();
        },
      }),
    ];
  },
});

// ── ⌘F find-in-document routing ──
// Several TEXT_EDITOR_MACHINERYs can be mounted at once (a card editor over the
// canvas, a note panel in the sidebar, an annotation popup…), so every
// instance registers here and a single rule decides which one ⌘F belongs to:
// the focused editor, else the one focused most recently, else the last
// visible one mounted (which is the one on top). Only that instance opens its
// find bar, and it swallows the keystroke so page-level ⌘F handlers — the
// knowledge-web card search, the browser's own find — stay out of the way.
const findInstances = [];
let lastFocusedFindId = null;
let findIdSeq = 0;

// The compact set of formats BEX actually supports. This is deliberately not
// Notion's full menu: selected blocks should offer real editor actions, never
// decorative buttons that lead nowhere.
const BLOCK_FORMAT_OPTIONS = Object.freeze([
  { id: 'text', label: 'Text', icon: Type },
  { id: 'heading-1', label: 'Heading 1', icon: Heading1 },
  { id: 'heading-2', label: 'Heading 2', icon: Heading2 },
  { id: 'heading-3', label: 'Heading 3', icon: Heading3 },
  { id: 'heading-4', label: 'Heading 4', icon: Heading4 },
  { id: 'bulleted-list', label: 'Bulleted list', icon: List },
  { id: 'numbered-list', label: 'Numbered list', icon: ListOrdered },
  { id: 'toggle-list', label: 'Toggle list', icon: ListCollapse },
  { id: 'code', label: 'Code', icon: Code2 },
  { id: 'quote', label: 'Quote', icon: Quote },
]);

const FORMATTABLE_BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'details',
  'codeBlock',
  'blockquote',
]);

function snapshotClientRect(rect) {
  if (!rect) return null;
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

function selectionClientRect(editor) {
  if (!editor?.view) return null;
  try {
    const { from, to } = editor.state.selection;
    const start = editor.view.coordsAtPos(from);
    const end = editor.view.coordsAtPos(to);
    const left = Math.min(start.left, end.left);
    const top = Math.min(start.top, end.top);
    const right = Math.max(start.right, end.right);
    const bottom = Math.max(start.bottom, end.bottom);
    return {
      left,
      top,
      right,
      bottom,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  } catch {
    return snapshotClientRect(editor.view.dom.getBoundingClientRect());
  }
}

function formatForBlockNode(node, container) {
  if (!node) return null;
  if (node.type.name === 'heading') return `heading-${node.attrs.level}`;
  if (node.type.name === 'paragraph') return 'text';
  if (node.type.name === 'bulletList') return 'bulleted-list';
  if (node.type.name === 'orderedList') return 'numbered-list';
  if (node.type.name === 'listItem') return container?.type.name === 'orderedList' ? 'numbered-list' : 'bulleted-list';
  if (node.type.name === 'details') return 'toggle-list';
  if (node.type.name === 'codeBlock') return 'code';
  if (node.type.name === 'blockquote') return 'quote';
  return null;
}

// Select the text inside a visible block at any dropdown depth without guessing
// at its nesting. ProseMirror descendant positions are relative to the block's
// content, so adding block.pos + 1 gives their document positions.
function textRangeForBlock(doc, block) {
  let from = null;
  let to = null;
  block.node.descendants((node, relativePos) => {
    if (!node.isText) return true;
    const absolutePos = block.pos + 1 + relativePos;
    if (from === null) from = absolutePos;
    to = absolutePos + node.nodeSize;
    return true;
  });

  if (from !== null && to !== null) return { from, to };
  const caret = Math.max(1, Math.min(doc.content.size, block.pos + 1));
  return { from: caret, to: caret };
}

function textRangeForBlocks(doc, blocks) {
  if (!Array.isArray(blocks) || !blocks.length) return null;
  const ordered = [...blocks].sort((left, right) => left.pos - right.pos);
  const first = textRangeForBlock(doc, ordered[0]);
  const last = textRangeForBlock(doc, ordered[ordered.length - 1]);
  return { from: first.from, to: last.to };
}

function isElementVisible(el) {
  if (!el || !el.isConnected || el.offsetParent === null) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function resolveFindTarget() {
  const visible = findInstances.filter(entry => isElementVisible(entry.getElement()));
  if (!visible.length) return null;
  const focused = visible.find(entry => entry.isFocused());
  if (focused) return focused.id;
  const lastFocused = visible.find(entry => entry.id === lastFocusedFindId);
  if (lastFocused) return lastFocused.id;
  return visible[visible.length - 1].id;
}

/**
 * `nested` means this editor is running *inside* another one — today
 *   that means a comment card. It keeps every writing feature (markdown,
 *   headings, bold/italic/underline, rules, LaTeX, images, "/" commands, ⌘F)
 *   but drops the two that only make sense on a top-level document: comments
 *   (a comment on a comment) and the block-drag handle.
 */
export default function TEXT_EDITOR_MACHINERY({
  content,
  onChange,
  placeholder = "Write your commentary...",
  onUploadingChange = null,
  onEditorReady = null,
  fillHeight = false,
  bare = false,
  nested = false,
  spotlightQuery = '',
  spotlightToken = '',
  onSpotlightComplete = null,
  localFindShortcut = false,
  scrollPastEnd = false,
  noteAnnotations = false,
  // Every top-level writing surface must parse and preserve the same footnotes.
  // Nested annotation bodies cannot contain another footnote composer.
  footnotes = !nested,
  plainFormatting = false,
  pageFoot = null,
  marqueeScope = 'editor',
}) {
  const navigate = useNavigate();
  const isActiveTab = useIsActiveTab();
  const spotlightCompleteRef = React.useRef(onSpotlightComplete);
  spotlightCompleteRef.current = onSpotlightComplete;
  const [showKeywordPicker, setShowKeywordPicker] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkText, setLinkText] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [keywords, setKeywords] = useState([]);
  const [keywordSearch, setKeywordSearch] = useState('');
  const [lightboxImage, setLightboxImage] = useState(null);
  const [uploadsInProgress, setUploadsInProgress] = useState(0);
  // Selected inline image: shows a floating trash overlay so the user
  // can delete it without hunting through markdown. Cleared on outside
  // click, Escape, or when the image scrolls away.
  const [selectedImage, setSelectedImage] = useState(null);
  // Click-vs-double-click timer for images. Single click selects the
  // image; a second click within ~280ms opens it in the lightbox.
  const imageClickTimerRef = React.useRef(null);
  // Saved ProseMirror selection {from, to} captured when the link modal
  // opens — restored in handleSetLink so setLink has a range to apply to.
  const savedLinkSelectionRef = React.useRef(null);
  // Viewport anchor for the floating link editor. When opened from an
  // existing hyperlink, `el` lets scroll/resize keep the panel attached.
  const [linkPanelAnchor, setLinkPanelAnchor] = useState(null);
  const [showTableMenu, setShowTableMenu] = useState(false);
  const [gripMenu, setGripMenu] = useState(null);
  const [highlightMenuOpen, setHighlightMenuOpen] = useState(false);
  const tableMenuRef = React.useRef(null);
  // ⌘F find-in-document bar for this editor. `findFocusNonce` bumps on every
  // ⌘F so pressing it again re-focuses and selects the existing query.
  const [showFindBar, setShowFindBar] = useState(false);
  const [findFocusNonce, setFindFocusNonce] = useState(0);
  const findIdRef = React.useRef(null);
  if (findIdRef.current === null) findIdRef.current = ++findIdSeq;
  const containerRef = React.useRef(null);
  // Comment cards portal to document.body, so this in-flow spacer lets their
  // bottom edge contribute to whichever ancestor owns vertical scrolling.
  const commentTailSpacerRef = React.useRef(null);
  // The HTML this editor last emitted upward. Used by the content-sync effect to
  // recognise an echo of the user's own typing coming back as a prop.
  const lastEmittedRef = React.useRef(null);
  // Floating tooltip shown when the cursor rests on a hyperlink.
  // { el, href, rect } — rect is viewport-absolute from getBoundingClientRect.
  const [hoveredLink, setHoveredLink] = useState(null);
  const linkTooltipRef = React.useRef(null);
  const linkHideTimerRef = React.useRef(null);
  // Floating tooltip shown when the cursor rests on a keyword link — mirrors
  // the hyperlink tooltip so keyword links can be opened or removed cleanly
  // without hunting through the markup.
  const [hoveredKeyword, setHoveredKeyword] = useState(null);
  const keywordTooltipRef = React.useRef(null);
  const keywordHideTimerRef = React.useRef(null);
  // Notion-like format menu for complete blocks selected from the editor
  // gutter. Ordinary character highlighting never touches this state.
  const [singleBlockMenu, setSingleBlockMenu] = useState(null);

  const closeLinkPanel = React.useCallback(() => {
    savedLinkSelectionRef.current = null;
    setShowLinkInput(false);
    setLinkText('');
    setLinkUrl('');
    setLinkPanelAnchor(null);
  }, []);

  // Close the table menu when clicking outside it.
  React.useEffect(() => {
    if (!showTableMenu) return;
    const onDocClick = (e) => {
      if (!tableMenuRef.current) return;
      if (!tableMenuRef.current.contains(e.target)) setShowTableMenu(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showTableMenu]);

  useEffect(() => {
    loadKeywords();
  }, []);

  const loadKeywords = async () => {
    try {
      const kws = await desktopClient.entities.Keyword.list('title');
      setKeywords(kws);
    } catch (e) {
      console.error('Failed to load keywords:', e);
    }
  };

  // A tooltip or footnote body is prose with formatting, not a second canvas:
  // no tables, embeds, images or slash commands inside a composer. Gating each
  // extension in place keeps the load order identical for every other surface.
  const richOnly = React.useCallback(
    (extension) => (plainFormatting ? [] : [extension]),
    [plainFormatting],
  );

  const editor = useEditor({
    extensions: [
      ...(noteAnnotations && !nested ? [LargeDeletionGuard] : []),
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3, 4],
          exitOnEnter: true
        },
        hardBreak: false,
        codeBlock: noteAnnotations && !nested ? false : undefined,
      }),
      Placeholder.configure({
        placeholder
      }),
      Underline,
      InheritedPasteLink,
      Link.configure({
        // This editor owns the external-link click below. Leaving TipTap's
        // opener enabled fires both handlers and launches every link twice.
        openOnClick: false,
        HTMLAttributes: {
          class: 'external-link',
          target: '_blank',
          rel: 'noopener noreferrer'
        }
      }),
      ...richOnly(CollapsibleToggle.configure({
        persist: true,
        HTMLAttributes: { class: 'toggle-block' },
      })),
      ...richOnly(ToggleSummary),
      ...richOnly(ToggleContent),
      ...richOnly(Table.configure({
        resizable: true,
        HTMLAttributes: { class: 'rt-table' },
      })),
      ...richOnly(TableRow),
      ...richOnly(TableHeaderWithBackground),
      ...richOnly(TableCellWithBackground),
      ...richOnly(TableGrips),
      Highlight,
      TextCase,
      ...richOnly(ImageUpload),
      ...richOnly(ImageGallery),
      ...richOnly(FileAttachment),
      ...richOnly(KeywordLink),
      ...richOnly(BibleSiteLink),
      ...richOnly(LogicBlock),
      ...richOnly(TypographyRules),
      ...richOnly(TimegraphEmbed),
      FindInEditor,
      SpotlightJourney,
      ...richOnly(SlashCommands),
      ListExitBoundaries,
      ListBackspace,
      QuoteBoundaries,
      // Not inside a comment: no commenting on a comment, and no block-drag
      // handle (the six dots) on a two-line card.
      ...(nested ? [] : [BlockDrag, Comment]),
      // Books enable their full annotation system. Study text boxes opt into
      // footnotes alone so Shift+Cmd/Ctrl+F retains its writing behavior.
      ...(noteAnnotations && !nested ? [Tooltip, Footnote, PointerAnchor, PointerCodeBlock] : footnotes && !nested ? [Footnote] : []),
    ],
    content,
    onUpdate: ({ editor }) => {
      // Store as HTML not Markdown (Markdown doesn't reliably serialize images)
      const html = editor.getHTML();
      // What this editor last handed upward. The sync effect compares against
      // this to tell an echo of the user's own typing apart from a genuinely
      // new document — see the comment there.
      lastEmittedRef.current = html;

      // DEBUG: Log updates with images
      if (html.includes('<img')) {
        console.log('✏️ EDITOR UPDATE - Content now has images:', html.substring(0, 200));
      }
      
      onChange(html);
      // Track uploads in progress
      const uploading = editor.storage.imageUpload?.uploadsInProgress || 0;
      setUploadsInProgress(uploading);
      if (onUploadingChange) {
        onUploadingChange(uploading > 0);
      }
    },
    editorProps: {
      attributes: {
        // A nested editor sizes to its content — no tall empty canvas.
        class: nested
          ? 'prose prose-invert max-w-none focus:outline-none bex-nested-editor'
          : bare
            ? 'prose prose-invert max-w-none focus:outline-none min-h-[60vh]'
            : 'prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[150px] px-3 py-2'
      }
    },
    onCreate: ({ editor }) => {
      // Saved/rich-pasted HTML may already contain paragraphs stranded inside
      // a list item. Normalize that initial document before exposing the editor
      // so two blank lines reliably start independent draggable blocks.
      const normalized = normalizeListExitBoundaries(editor.state.tr);
      if (normalized.changed) editor.view.dispatch(normalized.tr);
      if (onEditorReady) {
        onEditorReady(editor);
      }
    }
  });

  // Global search owns a cancellable arrival sequence, separate from Cmd+F.
  React.useEffect(() => {
    const term = String(spotlightQuery || '').trim();
    if (!editor || !term || !isActiveTab) return undefined;
    let disposed = false;
    const trip = startEditorSpotlight(editor, term);
    trip.finished.catch(error => console.warn('[Spotlight] Could not reveal match:', error)).finally(() => {
      if (!disposed) spotlightCompleteRef.current?.(spotlightToken);
    });
    return () => {
      disposed = true;
      trip.cancel();
    };
  }, [editor, spotlightQuery, spotlightToken, isActiveTab]);

  // A grip was clicked: the extension has already selected the band and tells
  // React where to put the menu.
  React.useEffect(() => {
    if (!editor) return undefined;
    const dom = editor.view.dom;
    const onGrip = (event) => setGripMenu(event.detail);
    // The menu names a column by its index. Once the document changes that
    // index may mean a different column, or none — press Backspace to delete
    // the selected column and the still-open menu would go on offering to
    // duplicate whatever slid into its place.
    const onTransaction = ({ transaction }) => {
      if (transaction.docChanged) setGripMenu(null);
    };
    const onHighlight = () => setHighlightMenuOpen(true);
    dom.addEventListener(TABLE_GRIP_MENU_EVENT, onGrip);
    dom.addEventListener(HIGHLIGHT_MENU_EVENT, onHighlight);
    editor.on('transaction', onTransaction);
    return () => {
      dom.removeEventListener(TABLE_GRIP_MENU_EVENT, onGrip);
      dom.removeEventListener(HIGHLIGHT_MENU_EVENT, onHighlight);
      editor.off('transaction', onTransaction);
    };
  }, [editor]);

  // Bridge the ProseMirror whole-block selection into React. The block-drag
  // plugin remains the single source of truth; this merely positions a menu by
  // the clicked block. A marquee alone never opens it, but clicking a handle in
  // a completed marquee keeps and formats the complete selection.
  React.useEffect(() => {
    if (!editor || nested) return undefined;
    let frame = null;

    const syncSingleBlockMenu = () => {
      frame = null;
      const pluginState = blockDragPluginKey.getState(editor.state);
      const index = blockFormatMenuIndex(pluginState);
      if (index === null) {
        setSingleBlockMenu(null);
        return;
      }

      const allBlocks = getDraggableBlocks(editor.state.doc);
      const block = allBlocks[index];
      const selectedBlocks = selectedDraggableBlocks(
        editor.state.doc,
        blockFormatMenuSelection(pluginState),
      );
      if (
        !block
        || !selectedBlocks.length
        || selectedBlocks.some((selected) => !FORMATTABLE_BLOCK_TYPES.has(selected.node.type.name))
      ) {
        setSingleBlockMenu(null);
        return;
      }

      const dom = editor.view.nodeDOM(block.markPos);
      const element = dom instanceof HTMLElement
        ? dom
        : dom?.parentElement instanceof HTMLElement
          ? dom.parentElement
          : null;
      if (!element) {
        setSingleBlockMenu(null);
        return;
      }

      const rect = element.getBoundingClientRect();
      const menuWidth = 232;
      const estimatedMenuHeight = 402;
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      const left = Math.min(
        Math.max(12, rect.left),
        Math.max(12, viewportWidth - menuWidth - 12),
      );
      const below = rect.bottom + 8;
      const top = below + estimatedMenuHeight <= viewportHeight - 12
        ? below
        : Math.max(12, rect.top - estimatedMenuHeight - 8);

      const selectedFormats = new Set(selectedBlocks.map(({ node, container }) => formatForBlockNode(node, container)));
      setSingleBlockMenu({
        index,
        currentFormat: selectedFormats.size === 1 ? selectedFormats.values().next().value : null,
        left,
        top,
      });
    };

    const scheduleSync = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(syncSingleBlockMenu);
    };

    editor.on('transaction', scheduleSync);
    window.addEventListener('resize', scheduleSync);
    document.addEventListener('scroll', scheduleSync, true);
    scheduleSync();

    return () => {
      editor.off('transaction', scheduleSync);
      window.removeEventListener('resize', scheduleSync);
      document.removeEventListener('scroll', scheduleSync, true);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [editor, nested]);

  const clearWholeBlockSelection = React.useCallback(() => {
    if (!editor) return;
    editor.view.dispatch(
      editor.state.tr.setMeta(blockDragPluginKey, { type: 'clear' }),
    );
  }, [editor]);

  const applySingleBlockFormat = React.useCallback((format) => {
    if (!editor) return;
    const pluginState = blockDragPluginKey.getState(editor.state);
    if (blockFormatMenuIndex(pluginState) === null) return;

    const blocks = selectedDraggableBlocks(
      editor.state.doc,
      blockFormatMenuSelection(pluginState),
    );
    if (
      !blocks.length
      || blocks.some((block) => !FORMATTABLE_BLOCK_TYPES.has(block.node.type.name))
    ) return;

    const currentFormats = new Set(blocks.map(({ node, container }) => formatForBlockNode(node, container)));
    if (currentFormats.size === 1 && currentFormats.has(format)) {
      clearWholeBlockSelection();
      return;
    }

    const range = textRangeForBlocks(editor.state.doc, blocks);
    if (!range) return;
    let chain = editor.chain().focus().setTextSelection(range);

    // Unwrap structural formats before applying a different kind. Keeping this
    // in the same TipTap chain makes the conversion one undoable action.
    if (
      (currentFormats.has('bulleted-list') || currentFormats.has('numbered-list'))
      && format !== 'bulleted-list'
      && format !== 'numbered-list'
    ) {
      chain = chain.liftListItem('listItem');
    }
    if (currentFormats.has('toggle-list') && format !== 'toggle-list') {
      chain = chain.unsetDetails();
    }
    if (currentFormats.has('quote') && format !== 'quote') {
      chain = chain.unsetBlockquote();
    }
    if (currentFormats.has('code') && format !== 'code') {
      chain = chain.setParagraph();
    }

    if (format === 'text') chain = chain.setParagraph();
    else if (format.startsWith('heading-')) {
      chain = chain.setHeading({ level: Number(format.slice(-1)) });
    } else if (format === 'bulleted-list') chain = chain.toggleBulletList();
    else if (format === 'numbered-list') chain = chain.toggleOrderedList();
    else if (format === 'toggle-list') chain = chain.setDetails();
    else if (format === 'code') chain = chain.setCodeBlock();
    else if (format === 'quote') chain = chain.setBlockquote();
    else return;

    chain.run();
  }, [clearWholeBlockSelection, editor]);


  /**
   * Is the user working in this editor right now?
   *
   * `editor.isFocused` alone is not a safe answer. It has been observed lagging
   * behind real DOM focus in this app more than once, and a whole-block
   * selection *deliberately* blurs the editor (see BlockDragExtension's
   * releaseTextCaret) while the user is very much still editing. Either case
   * would let the effect below replace the document underneath them.
   */
  const isBeingEdited = React.useCallback(() => {
    if (!editor) return false;
    if (editor.isFocused) return true;
    const active = typeof document === 'undefined' ? null : document.activeElement;
    if (containerRef.current && active && containerRef.current.contains(active)) return true;
    // A block selection released the caret but still owns the document.
    if (editor.view?.dom?.classList?.contains('bex-block-selection-active')) return true;
    return false;
  }, [editor]);

  React.useEffect(() => {
    if (!editor) return;

    // Whether an incoming prop may replace the document is a rule with several
    // branches and a very high cost of being wrong, so it lives in its own
    // tested module. See contentSyncRule.js.
    const allowed = shouldApplyExternalContent({
      incoming: content,
      current: editor.getHTML(),
      lastEmitted: lastEmittedRef.current,
      isEditing: isBeingEdited(),
    });
    if (!allowed) return;

    try {
      // Use transaction to safely update content
      editor.commands.setContent(content || '', false);
      // Loading is done without emitting an update, so nothing else moves
      // `lastEmitted` forward. Left stale, the editor would look permanently
      // "ahead of the parent" and every later change would be refused as
      // unacknowledged — a card would load once and then never again.
      lastEmittedRef.current = editor.getHTML();
    } catch (error) {
      console.error('Editor content update error:', error);
      // If error, try clearing first as fallback
      try {
        editor.commands.clearContent();
        if (content) {
          setTimeout(() => {
            editor.commands.setContent(content);
          }, 0);
        }
      } catch (e) {
        console.error('Failed to recover from content update error:', e);
      }
    }
  }, [content, editor]);

  // Convert pasted tables into real editor tables — markdown pipe tables
  // (| col | col |) and plain delimited text (CSV, TSV, semicolons).
  React.useEffect(() => {
    if (!editor) return;

    const isMarkdownTable = (text) => {
      if (!text) return false;
      const lines = text.replace(/\r\n?/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) return false;
      const sepRe = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;
      const sepIdx = lines.findIndex(l => sepRe.test(l));
      if (sepIdx < 1) return false;
      // Header row must look like a pipe row
      return lines[sepIdx - 1].includes('|');
    };

    const splitRow = (row) => {
      let r = row.trim();
      if (r.startsWith('|')) r = r.slice(1);
      if (r.endsWith('|')) r = r.slice(0, -1);
      // Split on unescaped pipes
      const cells = [];
      let cur = '';
      for (let i = 0; i < r.length; i++) {
        const ch = r[i];
        if (ch === '\\' && r[i + 1] === '|') { cur += '|'; i++; continue; }
        if (ch === '|') { cells.push(cur.trim()); cur = ''; continue; }
        cur += ch;
      }
      cells.push(cur.trim());
      return cells;
    };

    const escapeHtml = (s) => s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    // Minimal inline markdown: **bold**, *italic*, `code`, [text](url)
    const inlineMd = (s) => {
      let out = escapeHtml(s);
      out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t, u) => `<a href="${u}" class="external-link" target="_blank" rel="noopener noreferrer">${t}</a>`);
      out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
      out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
      // Smart quotes -> straight (avoid breaking attribute parsing later)
      return out;
    };

    const markdownTableToHtml = (text) => {
      const lines = text.replace(/\r\n?/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
      const sepRe = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;
      const sepIdx = lines.findIndex(l => sepRe.test(l));
      if (sepIdx < 1) return null;
      const headerCells = splitRow(lines[sepIdx - 1]);
      const bodyLines = lines.slice(sepIdx + 1).filter(l => l.includes('|'));
      const colCount = headerCells.length;
      const padRow = (cells) => {
        const out = cells.slice(0, colCount);
        while (out.length < colCount) out.push('');
        return out;
      };
      const headerHtml = `<tr>${padRow(headerCells).map(c => `<th><p>${inlineMd(c) || '&nbsp;'}</p></th>`).join('')}</tr>`;
      const bodyHtml = bodyLines.map(l => {
        const cells = padRow(splitRow(l));
        return `<tr>${cells.map(c => `<td><p>${inlineMd(c) || '&nbsp;'}</p></td>`).join('')}</tr>`;
      }).join('');
      return `<table class="rt-table"><tbody>${headerHtml}${bodyHtml}</tbody></table>`;
    };

    const onPaste = (e) => {
      const cd = e.clipboardData;
      if (!cd) return;
      const html = cd.getData('text/html') || '';
      // Preserve genuinely rich clipboard structures. Markdown conversion is
      // limited to newly pasted plain text and never reinterprets saved HTML.
      if (/<(?:table|h[1-6]|ul|ol|li|blockquote|pre)\b/i.test(html)) return;
      const text = cd.getData('text/plain') || '';
      // Markdown first: its cells carry inline formatting, and its alignment
      // row would otherwise read as one more delimited line.
      const tableHtml = isMarkdownTable(text)
        ? markdownTableToHtml(text)
        : delimitedTableToHtml(text);
      const convertedHtml = tableHtml || markdownBlocksToHtml(text);
      if (!convertedHtml) return;
      e.preventDefault();
      // stopImmediatePropagation, not stopPropagation: ProseMirror's own paste
      // handler sits on this same element, so merely stopping the bubble would
      // still let it run and drop the raw text in above the table.
      e.stopImmediatePropagation();
      const inheritedLink = surroundingPasteLink(editor.state.selection);
      const start = editor.state.selection.from;
      editor.chain().focus().insertContent(convertedHtml).command(({ tr }) => {
        inheritInsertedLink(tr, start, tr.selection.to, inheritedLink);
        return true;
      }).run();
    };

    // Capture phase, because ProseMirror registered its handler when the view
    // was created — long before this effect — and a bubble-phase listener would
    // always be second in line, converting text the editor had already pasted.
    const dom = editor.view.dom;
    dom.addEventListener('paste', onPaste, true);
    return () => dom.removeEventListener('paste', onPaste, true);
  }, [editor]);

  // Make external links clickable and images open in lightbox
  React.useEffect(() => {
    if (!editor) return;

    const handleClick = (e) => {
      const keywordLink = e.target.closest('[data-keyword-id]');
      if (keywordLink) {
        e.preventDefault();
        const keywordId = keywordLink.getAttribute('data-keyword-id');
        if (keywordId) {
          navigate(`/Keywords?keyword_id=${encodeURIComponent(keywordId)}`);
        }
        return;
      }

      if (followLibraryLink(e, navigate)) return;

      const link = e.target.closest('a.external-link');
      if (link && link.href) {
        e.preventDefault();
        window.open(link.href, '_blank', 'noopener,noreferrer');
        return;
      }

      const image = e.target.closest('img[src]');
      if (image?.closest('[data-image-gallery]')) return;
      if (image && !image.closest('[data-uploading]')) {
        e.preventDefault();
        e.stopPropagation();
        // Defer single-click so a quick second click can promote to
        // double-click (open in lightbox) instead.
        if (imageClickTimerRef.current) {
          clearTimeout(imageClickTimerRef.current);
          imageClickTimerRef.current = null;
        }
        imageClickTimerRef.current = setTimeout(() => {
          imageClickTimerRef.current = null;
          const rect = image.getBoundingClientRect();
          // Resolve the EXACT ProseMirror position of THIS image node
          // by matching the DOM element. Avoids the prior bug where
          // duplicate src values would delete the wrong instance.
          let nodePos = null;
          try {
            editor.state.doc.descendants((node, pos) => {
              if (node.type.name === 'imageUpload') {
                if (editor.view.nodeDOM(pos) === image) {
                  nodePos = pos;
                  return false;
                }
              }
              return true;
            });
          } catch {/* ignore — fall back to src match */}
          setSelectedImage({
            el: image,
            src: image.src,
            alt: image.alt || 'Image',
            pos: nodePos,
            rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
          });
        }, 280);
      }
    };

    const handleDblClick = (e) => {
      const image = e.target.closest('img[src]');
      if (image?.closest('[data-image-gallery]')) return;
      if (image && !image.closest('[data-uploading]')) {
        e.preventDefault();
        e.stopPropagation();
        if (imageClickTimerRef.current) {
          clearTimeout(imageClickTimerRef.current);
          imageClickTimerRef.current = null;
        }
        setSelectedImage(null);
        setLightboxImage({ src: image.src, alt: image.alt || 'Image' });
      }
    };

    const editorElement = editor.view.dom;
    editorElement.addEventListener('click', handleClick);
    editorElement.addEventListener('dblclick', handleDblClick);

    return () => {
      editorElement.removeEventListener('click', handleClick);
      editorElement.removeEventListener('dblclick', handleDblClick);
      if (imageClickTimerRef.current) {
        clearTimeout(imageClickTimerRef.current);
        imageClickTimerRef.current = null;
      }
    };
  }, [editor]);

  // Keep the floating trash button glued to the selected image as the
  // user scrolls or resizes; deselect on outside click or Escape.
  React.useEffect(() => {
    if (!selectedImage) return;
    const reposition = () => {
      const el = selectedImage.el;
      if (!el || !document.contains(el)) {
        setSelectedImage(null);
        return;
      }
      const rect = el.getBoundingClientRect();
      // Auto-deselect once the image has scrolled fully out of view.
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const vw = window.innerWidth || document.documentElement.clientWidth;
      if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) {
        setSelectedImage(null);
        return;
      }
      setSelectedImage((prev) => prev ? {
        ...prev,
        rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      } : prev);
    };
    const handleOutsideClick = (e) => {
      if (e.target.closest('[data-image-overlay]')) return;
      if (e.target === selectedImage.el) return;
      setSelectedImage(null);
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        setSelectedImage(null);
        return;
      }
      // Delete/Backspace removes the selected image. Allow this even
      // when the editor (which is contentEditable) has focus, since the
      // image selection is our affordance — but skip when the user is
      // typing inside an unrelated input/textarea.
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea') return;
        e.preventDefault();
        deleteSelectedImage();
      }
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [selectedImage?.el]);

  // Remove the currently selected image from the editor state.
  // Prefers the exact ProseMirror position captured at selection time
  // (resolved via view.nodeDOM === el). Falls back to the first node
  // matching the src only if that lookup failed.
  const deleteSelectedImage = React.useCallback(() => {
    if (!editor || !selectedImage) return;
    let targetPos = selectedImage.pos;
    // Re-verify the saved position still points at our image — the doc
    // may have changed since selection. If it doesn't match, fall back.
    if (targetPos !== null && targetPos !== undefined) {
      try {
        if (editor.view.nodeDOM(targetPos) !== selectedImage.el) {
          targetPos = null;
        }
      } catch {
        targetPos = null;
      }
    }
    if (targetPos === null || targetPos === undefined) {
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'imageUpload') {
          if (editor.view.nodeDOM(pos) === selectedImage.el) {
            targetPos = pos;
            return false;
          }
          if (targetPos === null && node.attrs.src === selectedImage.src) {
            targetPos = pos;
          }
        }
        return true;
      });
    }
    if (targetPos !== null && targetPos !== undefined) {
      editor.chain().focus().deleteRange({ from: targetPos, to: targetPos + 1 }).run();
    }
    setSelectedImage(null);
  }, [editor, selectedImage]);



  const handleLinkKeyword = (keyword) => {
    editor.chain().focus().setKeywordLink({
      keywordId: keyword.id,
      keywordTitle: keyword.title,
    }).run();
    setShowKeywordPicker(false);
    setKeywordSearch('');
  };

  const handleSetLink = () => {
    const displayText = linkText.trim();
    const rawUrl = linkUrl.trim();
    if (!displayText || !rawUrl) return;

    const url = libraryLinkPath(rawUrl) || (rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
    const saved = savedLinkSelectionRef.current;
    if (saved && saved.from !== saved.to) {
      const { state, view } = editor;
      const from = Math.max(0, Math.min(saved.from, state.doc.content.size));
      const to = Math.max(from, Math.min(saved.to, state.doc.content.size));
      const currentText = state.doc.textBetween(from, to, '', '');

      if (displayText === currentText) {
        // No label edit: preserve every existing inline mark exactly and only
        // update the link destination.
        editor.chain().focus().setTextSelection({ from, to }).setLink({ href: url }).run();
      } else {
        // Replace only the saved hyperlink range. Preserve any non-link mark
        // that covers the whole label (bold, italic, highlight, etc.) and
        // rebuild the link mark, so surrounding prose is never touched.
        const textMarkSets = [];
        let previousLink = null;
        state.doc.nodesBetween(from, to, (node) => {
          if (!node.isText) return;
          textMarkSets.push(node.marks);
          previousLink ||= node.marks.find(mark => mark.type.name === 'link') || null;
        });
        const linkType = state.schema.marks.link;
        const sharedMarks = (textMarkSets[0] || []).filter(mark => (
          mark.type !== linkType
          && textMarkSets.every(markSet => markSet.some(candidate => candidate.eq(mark)))
        ));
        const marks = [
          ...sharedMarks,
          linkType.create({ ...(previousLink?.attrs || {}), href: url }),
        ];
        const replacement = state.schema.text(displayText, marks);
        const tr = state.tr.replaceWith(from, to, replacement);
        tr.setSelection(TextSelection.create(tr.doc, from, from + displayText.length));
        view.dispatch(tr);
        view.focus();
      }
    } else {
      editor.chain().focus().setLink({ href: url }).run();
    }
    closeLinkPanel();
  };

  const handleUnsetLink = () => {
    editor.chain().focus().unsetLink().run();
    closeLinkPanel();
  };

  // Select the full link mark that wraps the given DOM anchor element so that
  // edit / delete operations apply to the whole hyperlinked span, not just
  // wherever the caret happens to sit.
  const selectLinkNode = React.useCallback((anchorEl) => {
    if (!editor || !anchorEl) return false;
    try {
      // Walk ProseMirror positions to find the start and end of the mark.
      let from = null; let to = null;
      editor.state.doc.descendants((node, pos) => {
        if (!node.isText) return true;
        const linkMark = node.marks.find(m => m.type.name === 'link');
        if (!linkMark) return true;
        // Check if this text node is rendered inside the hovered anchor.
        try {
          const domNode = editor.view.domAtPos(pos + 1)?.node;
          const domAnchor = domNode instanceof Text
            ? domNode.parentElement?.closest('a')
            : (domNode instanceof HTMLElement ? domNode.closest('a') : null);
          if (domAnchor === anchorEl) {
            if (from === null) from = pos;
            to = pos + node.nodeSize;
          }
        } catch { /* skip */ }
        return true;
      });
      if (from !== null && to !== null) {
        editor.chain().focus().setTextSelection({ from, to }).run();
        return true;
      }
    } catch { /* ignore */ }
    return false;
  }, [editor]);

  // Hover detection for external-link anchors — shows the floating tooltip.
  React.useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;

    const cancelHide = () => {
      if (linkHideTimerRef.current) {
        clearTimeout(linkHideTimerRef.current);
        linkHideTimerRef.current = null;
      }
    };
    const scheduleHide = () => {
      cancelHide();
      linkHideTimerRef.current = setTimeout(() => setHoveredLink(null), 150);
    };

    const onMouseOver = (e) => {
      const link = e.target.closest('a.external-link');
      if (!link) return;
      cancelHide();
      const rect = link.getBoundingClientRect();
      setHoveredLink({ el: link, href: libraryLinkPath(link.getAttribute('href')) || link.href, rect });
    };
    const onMouseOut = (e) => {
      const link = e.target.closest('a.external-link');
      if (!link) return;
      // Don't hide yet — the cursor may move into the tooltip itself.
      scheduleHide();
    };

    dom.addEventListener('mouseover', onMouseOver);
    dom.addEventListener('mouseout', onMouseOut);
    return () => {
      dom.removeEventListener('mouseover', onMouseOver);
      dom.removeEventListener('mouseout', onMouseOut);
      cancelHide();
    };
  }, [editor]);

  // Select the full keyword-link mark wrapping a given span so a remove applies
  // to the whole linked phrase, not just wherever the caret happens to sit.
  const selectKeywordNode = React.useCallback((spanEl) => {
    if (!editor || !spanEl) return false;
    try {
      let from = null; let to = null;
      editor.state.doc.descendants((node, pos) => {
        if (!node.isText) return true;
        const mark = node.marks.find(m => m.type.name === 'keywordLink');
        if (!mark) return true;
        try {
          const domNode = editor.view.domAtPos(pos + 1)?.node;
          const domSpan = domNode instanceof Text
            ? domNode.parentElement?.closest('[data-keyword-id]')
            : (domNode instanceof HTMLElement ? domNode.closest('[data-keyword-id]') : null);
          if (domSpan === spanEl) {
            if (from === null) from = pos;
            to = pos + node.nodeSize;
          }
        } catch { /* skip */ }
        return true;
      });
      if (from !== null && to !== null) {
        editor.chain().focus().setTextSelection({ from, to }).run();
        return true;
      }
    } catch { /* ignore */ }
    return false;
  }, [editor]);

  // Hover detection for keyword-link spans — shows the floating remove/open
  // tooltip, mirroring the external-link hover behaviour above.
  React.useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const cancelHide = () => {
      if (keywordHideTimerRef.current) {
        clearTimeout(keywordHideTimerRef.current);
        keywordHideTimerRef.current = null;
      }
    };
    const scheduleHide = () => {
      cancelHide();
      keywordHideTimerRef.current = setTimeout(() => setHoveredKeyword(null), 150);
    };
    const onMouseOver = (e) => {
      const span = e.target.closest('[data-keyword-id]');
      if (!span) return;
      cancelHide();
      const rect = span.getBoundingClientRect();
      setHoveredKeyword({
        el: span,
        id: span.getAttribute('data-keyword-id'),
        title: span.getAttribute('data-keyword-title') || span.textContent || 'Keyword',
        rect,
      });
    };
    const onMouseOut = (e) => {
      const span = e.target.closest('[data-keyword-id]');
      if (!span) return;
      scheduleHide();
    };
    dom.addEventListener('mouseover', onMouseOver);
    dom.addEventListener('mouseout', onMouseOut);
    return () => {
      dom.removeEventListener('mouseover', onMouseOver);
      dom.removeEventListener('mouseout', onMouseOut);
      cancelHide();
    };
  }, [editor]);

  // Keep the floating editor beside an existing link while the document or
  // window moves. The stored element is deliberately not used for toolbar
  // link creation, where the saved selection rectangle is the stable anchor.
  React.useEffect(() => {
    const anchorEl = linkPanelAnchor?.el;
    if (!showLinkInput || !anchorEl) return undefined;

    const refreshAnchor = () => {
      if (!anchorEl.isConnected) {
        closeLinkPanel();
        return;
      }
      const rect = snapshotClientRect(anchorEl.getBoundingClientRect());
      setLinkPanelAnchor(current => (
        current?.el === anchorEl ? { ...current, rect } : current
      ));
    };

    window.addEventListener('resize', refreshAnchor);
    document.addEventListener('scroll', refreshAnchor, true);
    return () => {
      window.removeEventListener('resize', refreshAnchor);
      document.removeEventListener('scroll', refreshAnchor, true);
    };
  }, [showLinkInput, linkPanelAnchor?.el, closeLinkPanel]);

  // Open the URL hyperlink panel (mirrors the "Add Link" toolbar button).
  const openLinkPanel = React.useCallback(() => {
    if (!editor) return;
    const previousUrl = editor.getAttributes('link').href || '';
    // Save the active selection BEFORE blurring — restored in handleSetLink
    // so the link mark is applied to the originally-selected text range.
    const { from, to } = editor.state.selection;
    savedLinkSelectionRef.current = { from, to };
    setLinkText(editor.state.doc.textBetween(from, to, '', ''));
    setLinkUrl(previousUrl);
    setLinkPanelAnchor({ el: null, rect: selectionClientRect(editor) });
    editor.commands.blur();
    setShowKeywordPicker(false);
    setTimeout(() => setShowLinkInput(true), 0);
  }, [editor]);

  // Open the keyword / card / knowledge-web linker (mirrors the
  // "Link Keyword" toolbar button).
  const openKeywordPicker = React.useCallback(() => {
    if (!editor) return;
    editor.commands.setTextSelection(editor.state.selection.to);
    editor.commands.blur();
    closeLinkPanel();
    setTimeout(() => setShowKeywordPicker(true), 0);
  }, [editor, closeLinkPanel]);

  // Keyboard shortcuts, scoped to the editor so they override the global
  // Cmd/Ctrl+K search only while typing here. Cmd/Ctrl+K opens the URL
  // hyperlink panel; Cmd/Ctrl+J opens the keyword/card linker. We listen on
  // the editor DOM (target phase) and stopPropagation so the window-level
  // global-search handler does not also fire.
  React.useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const onKeyDown = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === 'k') {
        e.preventDefault();
        e.stopPropagation();
        openLinkPanel();
      } else if (key === 'j') {
        e.preventDefault();
        e.stopPropagation();
        openKeywordPicker();
      }
    };
    dom.addEventListener('keydown', onKeyDown);
    return () => dom.removeEventListener('keydown', onKeyDown);
  }, [editor, openLinkPanel, openKeywordPicker]);

  // Register this editor as a ⌘F candidate and remember when it was focused,
  // so the shortcut can be routed to the editor the user is actually in.
  React.useEffect(() => {
    if (!editor) return undefined;
    const entry = {
      id: findIdRef.current,
      localFindShortcut,
      // tiptap's isFocused is a flag set from DOM focus events; fall back to
      // "is the real focus inside me" so programmatic focus counts too.
      isFocused: () => editor.isFocused
        || !!(containerRef.current && document.activeElement && containerRef.current.contains(document.activeElement)),
      getElement: () => containerRef.current,
      close: () => setShowFindBar(false),
    };
    findInstances.push(entry);
    const markFocused = () => { lastFocusedFindId = entry.id; };
    editor.on('focus', markFocused);
    return () => {
      editor.off('focus', markFocused);
      const i = findInstances.indexOf(entry);
      if (i >= 0) findInstances.splice(i, 1);
      if (lastFocusedFindId === entry.id) lastFocusedFindId = null;
    };
  }, [editor, localFindShortcut]);

  // The window-level global finder asks for a local owner before it opens.
  // Exactly one opted-in editor claims that request and opens its document
  // finder, so one Cmd/Ctrl+F can never display both search interfaces.
  React.useEffect(() => {
    if (!editor || !localFindShortcut) return undefined;
    const onLocalFindRequest = (event) => {
      if (resolveFindTarget() !== findIdRef.current) return;
      event.preventDefault();
      // Only one find bar at a time — searching here retires any other.
      findInstances.forEach(entry => { if (entry.id !== findIdRef.current) entry.close(); });
      setShowFindBar(true);
      setFindFocusNonce(n => n + 1);
    };
    window.addEventListener(LOCAL_FIND_SHORTCUT_REQUEST, onLocalFindRequest);
    return () => window.removeEventListener(LOCAL_FIND_SHORTCUT_REQUEST, onLocalFindRequest);
  }, [editor, localFindShortcut]);

  // ⌘T raises a tooltip on the selected words. The tab bar owns that shortcut
  // and listens in the capture phase, so an editor keybinding would never see
  // it; instead the tab bar asks first and this claims the key only when the
  // user is writing here with something actually selected. ⌘T with no selection
  // is left alone and still opens a new tab.
  React.useEffect(() => {
    if (!editor || !noteAnnotations) return undefined;
    const onTooltipRequest = (event) => {
      if (event.defaultPrevented) return;
      const focusedHere = editor.isFocused || !!(
        containerRef.current
        && document.activeElement
        && containerRef.current.contains(document.activeElement)
      );
      if (!focusedHere || editor.state.selection.empty) return;
      event.preventDefault();
      editor.commands.addTooltip();
    };
    window.addEventListener(TOOLTIP_SHORTCUT_REQUEST, onTooltipRequest);
    return () => window.removeEventListener(TOOLTIP_SHORTCUT_REQUEST, onTooltipRequest);
  }, [editor, noteAnnotations]);

  const filteredKeywords = keywords.filter(k =>
    k.title.toLowerCase().includes(keywordSearch.toLowerCase()) ||
    (k.category || '').toLowerCase().includes(keywordSearch.toLowerCase())
  );

  if (!editor) return null;

  const linkPanelPosition = positionLinkPanel(
    linkPanelAnchor?.rect || selectionClientRect(editor),
    {
      width: typeof window === 'undefined' ? 1024 : window.innerWidth,
      height: typeof window === 'undefined' ? 768 : window.innerHeight,
    },
  );

  return (
    <div
      ref={containerRef}
      data-bex-global-editor="true"
      data-bex-marquee-scope={marqueeScope}
      data-bex-local-find-shortcut={localFindShortcut ? 'true' : undefined}
      className={`relative ${bare ? '' : 'border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-800'} ${fillHeight ? 'flex flex-col h-full' : ''}`}
    >

      {/* ⌘F find-in-document — highlights every hit, counts them, cycles. */}
      <AnimatePresence>
        {showFindBar && (
          <EditorFindBar
            editor={editor}
            anchorRef={containerRef}
            focusNonce={findFocusNonce}
            onClose={() => setShowFindBar(false)}
          />
        )}
      </AnimatePresence>

      {/* "/" command menu, and the UI whichever command opens. */}
      <SlashCommandMenu editor={editor} />
      <ImageInsertPanel editor={editor} />
      <FileInsertHost editor={editor} />
      <TimegraphInsertHost editor={editor} />
      <LibraryLinkInsertHost editor={editor} />

      {/* ⌘M comments, in the margin beside the text they belong to. */}
      {!nested && (
        <CommentSidebar
          editor={editor}
          anchorRef={containerRef}
          tailSpacerRef={commentTailSpacerRef}
        />
      )}

      {/* Tooltips belong to notes/books; Cmd/Ctrl+Shift+F footnotes are shared
          by top-level editors and printed by their owning page or PageFoot. */}
      {noteAnnotations && !nested && (
        <>
          <TooltipLayer editor={editor} />
        </>
      )}
      {(noteAnnotations || footnotes) && !nested && <FootnoteComposer editor={editor} />}

      {/* A block-type chooser appears after explicitly opening a six-dot handle
          for one or more selected blocks. It is portaled so fullscreen cards,
          side panels and scrolling containers cannot clip it. */}
      {!nested && ReactDOM.createPortal((
        <AnimatePresence>
          {singleBlockMenu && (
            <motion.div
              key={`block-format-${singleBlockMenu.index}`}
              data-bex-block-format-menu
              data-testid="single-block-format-menu"
              role="menu"
              aria-label="Change block format"
              initial={{ opacity: 0, scale: 0.97, y: 4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 2 }}
              transition={{ duration: 0.12, ease: 'easeOut' }}
              onPointerDown={(event) => {
                // Keep the whole-block selection alive while choosing a row.
                event.preventDefault();
                event.stopPropagation();
              }}
              style={{
                position: 'fixed',
                left: singleBlockMenu.left,
                top: singleBlockMenu.top,
              }}
              className="z-[100200] w-[232px] max-h-[calc(100vh-24px)] overflow-y-auto rounded-xl border border-line bg-[#171A21]/98 p-1.5 text-ink shadow-[0_18px_50px_rgba(0,0,0,0.48)] backdrop-blur-xl"
            >
              {BLOCK_FORMAT_OPTIONS.map((option) => {
                const Icon = option.icon;
                const active = singleBlockMenu.currentFormat === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    data-testid={`block-format-${option.id}`}
                    onClick={() => applySingleBlockFormat(option.id)}
                    className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                      active
                        ? 'bg-brand/15 text-white'
                        : 'text-ink-muted hover:bg-white/[0.07] hover:text-white'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {active && <Check className="h-4 w-4 shrink-0 text-brand" strokeWidth={2.2} />}
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      ), document.body)}

      {showLinkInput && ReactDOM.createPortal((
        <>
          {/* Invisible click-outside dismisser — no dark overlay */}
          <div
            className="fixed inset-0 z-[99999]"
            onMouseDown={closeLinkPanel}
          />
          {/* Contextual floating editor, anchored beside the selected link. */}
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            style={{ left: linkPanelPosition.left, top: linkPanelPosition.top }}
            className="fixed z-[100000] w-[380px] max-w-[calc(100vw-24px)] flex flex-col rounded-2xl border border-line bg-surface/95 text-ink shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] backdrop-blur-xl overflow-hidden"
            data-testid="modal-link-input"
          >
            <div className="flex items-center justify-center border-b border-line bg-gradient-to-b from-elevated to-[#13161D] px-4 py-2.5 select-none">
              <div className="text-center text-sm font-medium text-ink-muted">
                {editor.isActive('link') ? 'Edit link' : 'Add link'}
              </div>
            </div>
            {/* Body */}
            <div className="p-4 space-y-3">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-ink-muted">Display text</span>
                <Input
                  value={linkText}
                  onChange={(e) => setLinkText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); handleSetLink(); }
                    if (e.key === 'Escape') closeLinkPanel();
                  }}
                  placeholder="Text shown in the note"
                  className="input-metal w-full bg-app/70 border-line text-ink placeholder:text-line-strong"
                  autoFocus
                  data-testid="input-link-text"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-ink-muted">Destination URL</span>
                <Input
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); handleSetLink(); }
                    if (e.key === 'Escape') closeLinkPanel();
                  }}
                  placeholder="https://example.com"
                  className="input-metal w-full bg-app/70 border-line text-ink placeholder:text-line-strong"
                  data-testid="input-link-url"
                />
              </label>
              <div className="flex gap-2 mt-3">
                <Button
                  size="sm"
                  onClick={handleSetLink}
                  disabled={!linkText.trim() || !linkUrl.trim()}
                  className="flex-1 bg-brand hover:bg-brand-strong text-white"
                  data-testid="button-set-link"
                >
                  {editor.isActive('link') ? 'Update link' : 'Set link'}
                </Button>
                {editor.isActive('link') && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleUnsetLink}
                    className="flex-1 border-red-800/60 text-red-400 hover:bg-red-900/20 hover:text-red-300"
                    data-testid="button-remove-link"
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Remove
                  </Button>
                )}
              </div>
            </div>
          </motion.div>
        </>
      ), document.body)}

      {showKeywordPicker && ReactDOM.createPortal((
        <motion.div
          className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/20 backdrop-blur-xl p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.12 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setShowKeywordPicker(false);
              setKeywordSearch('');
            }
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="w-full max-w-sm bg-[#0D0F14] border border-line rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[70vh]"
            data-testid="modal-keyword-picker"
          >
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-line/80">
              <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <Input
                value={keywordSearch}
                onChange={(e) => setKeywordSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setShowKeywordPicker(false); setKeywordSearch(''); }
                }}
                placeholder="Search keywords…"
                className="flex-1 border-0 focus-visible:ring-0 p-0 h-8 bg-transparent dark:bg-transparent"
                autoFocus
                data-testid="input-keyword-search"
              />
              <button
                type="button"
                onClick={() => { setShowKeywordPicker(false); setKeywordSearch(''); }}
                className="p-1 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700/60 transition-colors flex-shrink-0"
                data-testid="button-close-keyword-picker"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto">
              {filteredKeywords.length === 0 ? (
                <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
                  No keywords found
                </div>
              ) : (
                filteredKeywords.map((keyword) => (
                  <button
                    key={keyword.id}
                    onClick={() => handleLinkKeyword(keyword)}
                    className="w-full text-left px-4 py-2.5 hover:bg-gray-100 dark:hover:bg-gray-700/60 border-b border-gray-100 dark:border-gray-700/40 last:border-0 transition-colors"
                    data-testid={`button-pick-keyword-${keyword.id}`}
                  >
                    <div className="font-medium text-sm text-gray-900 dark:text-white">
                      {keyword.title}
                    </div>
                    {keyword.category && (
                      <div className="text-xs text-brand-strong mt-0.5">
                        {keyword.category}
                      </div>
                    )}
                  </button>
                ))
              )}
            </div>
          </motion.div>
        </motion.div>
      ), document.body)}

      <TableGripMenu editor={editor} request={gripMenu} onClose={() => setGripMenu(null)} />

      <HighlightMenu editor={editor} open={highlightMenuOpen} onClose={() => setHighlightMenuOpen(false)} />

      {/* Table bubble menu — floats directly above the active table so the
          gear sits on the table, not in the editor's outer corner. */}
      <BubbleMenu
        editor={editor}
        pluginKey="tableMenu"
        shouldShow={({ editor }) => {
          if (showKeywordPicker || showLinkInput) return false;
          return editor.isActive('table');
        }}
        tippyOptions={{
          duration: 100,
          placement: 'top-end',
          offset: [0, 6],
          maxWidth: 'none',
          // Inside React's root container, NOT document.body. Tippy moves this
          // element wherever appendTo points, and React 18 listens for events
          // on the root container only — parked on the body, the menu rendered
          // and was visible but every onClick in it was dead, which is why the
          // button appeared to do nothing. #root is static with visible
          // overflow, so the popper positions exactly as it did before.
          appendTo: () => document.getElementById('root') || document.body,
          getReferenceClientRect: () => {
            // Anchor the bubble to the active table element rather than to
            // the selection — keeps the gear visually attached to the table
            // even when the user moves between cells.
            const dom = editor.view.domAtPos(editor.state.selection.from)?.node;
            const el = dom instanceof HTMLElement ? dom : dom?.parentElement;
            const tableEl = el?.closest?.('table');
            if (tableEl) return tableEl.getBoundingClientRect();
            return new DOMRect(0, 0, 0, 0);
          },
        }}
      >
        <div ref={tableMenuRef} className="relative">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setShowTableMenu(v => !v)}
            className={`h-7 w-7 rounded-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 shadow-lg text-gray-700 dark:text-gray-200 hover:bg-violet-600/10 hover:text-brand ${showTableMenu ? 'bg-brand/15 text-brand' : ''}`}
            title="Table options"
          >
            <Settings2 className="w-3.5 h-3.5" />
          </Button>
          {showTableMenu && (
            <div className="absolute right-0 top-9 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-2xl py-1.5 overflow-hidden z-50">
              <button
                type="button"
                onClick={() => { editor.chain().focus().toggleHeaderRow().run(); setShowTableMenu(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700/60"
              >
                Toggle header row
              </button>
              <button
                type="button"
                onClick={() => { editor.chain().focus().mergeOrSplit().run(); setShowTableMenu(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700/60"
              >
                Merge / split cells
              </button>

              <div className="my-1 border-t border-gray-100 dark:border-gray-700/60" />
              <button
                type="button"
                onClick={() => { editor.chain().focus().deleteTable().run(); setShowTableMenu(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-500/10"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete table
              </button>
            </div>
          )}
        </div>
      </BubbleMenu>

      {fillHeight ? (
        <div className="flex-1 min-h-0 overflow-y-auto [&>.ProseMirror]:h-full">
          {noteAnnotations && !nested ? (
            <div className="bex-pointer-surface">
              <EditorContent editor={editor} />
              <PointerLayer editor={editor} />
            </div>
          ) : <EditorContent editor={editor} />}
          {/* The foot of the page — its footnotes, then the cut line that ends
              it — belongs between the writing and the scroll runway, so the
              runway stays below the end of the page rather than inside it. */}
          {pageFoot || (footnotes && <PageFoot editor={editor} showCutLine={false} />)}
          {!nested && (
            <div
              ref={commentTailSpacerRef}
              aria-hidden="true"
              data-comment-tail-spacer
              data-scroll-past-end={scrollPastEnd ? 'true' : 'false'}
              className="pointer-events-none w-full shrink-0"
            />
          )}
        </div>
      ) : (
        <>
          {noteAnnotations && !nested ? (
            <div className="bex-pointer-surface">
              <EditorContent editor={editor} />
              <PointerLayer editor={editor} />
            </div>
          ) : <EditorContent editor={editor} />}
          {pageFoot || (footnotes && <PageFoot editor={editor} showCutLine={false} />)}
          {!nested && (
            <div
              ref={commentTailSpacerRef}
              aria-hidden="true"
              data-comment-tail-spacer
              data-scroll-past-end={scrollPastEnd ? 'true' : 'false'}
              className="pointer-events-none w-full"
            />
          )}
        </>
      )}

      {/* Link hover tooltip — shows URL + edit/delete controls when the
          cursor rests on a hyperlinked span. Fixed to viewport so it works
          regardless of scroll position or editor overflow mode. */}
      {hoveredLink && (() => {
        const { href, rect } = hoveredLink;
        // Truncate very long URLs for display.
        const display = href.length > 55 ? href.slice(0, 52) + '…' : href;
        // Position below the link, centred on it horizontally.
        const top  = rect.bottom + 4;
        const left = rect.left + rect.width / 2;
        // Render through a portal to document.body so the fixed positioning
        // stays anchored to the link even when an ancestor (e.g. the
        // KnowledgeWeb canvas) applies a CSS transform — which would
        // otherwise make `position: fixed` relative to that ancestor and
        // make the tooltip drift far from the word.
        return ReactDOM.createPortal((
          <div
            ref={linkTooltipRef}
            data-link-tooltip
            onMouseEnter={() => {
              if (linkHideTimerRef.current) {
                clearTimeout(linkHideTimerRef.current);
                linkHideTimerRef.current = null;
              }
            }}
            onMouseLeave={() => {
              linkHideTimerRef.current = setTimeout(() => setHoveredLink(null), 150);
            }}
            style={{
              position: 'fixed',
              top,
              left,
              transform: 'translateX(-50%)',
              zIndex: 9999,
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg
                       bg-gray-900/90 border border-gray-700/60 shadow-xl
                       backdrop-blur-sm pointer-events-auto"
          >
            {/* URL — dim, open-link on click */}
            <a
              href={href}
              onClick={event => followLibraryLink(event, navigate)}
              target="_blank"
              rel="noopener noreferrer"
              title={href}
              className="text-[11px] text-gray-400 hover:text-gray-200 transition-colors
                         truncate max-w-[220px] cursor-pointer"
            >
              {display}
            </a>
            {/* Separator */}
            <span className="w-px h-3.5 bg-gray-700 flex-shrink-0" />
            {/* Edit */}
            <button
              type="button"
              title="Edit link"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const el = hoveredLink.el;
                const anchorRect = snapshotClientRect(el?.getBoundingClientRect()) || rect;
                setHoveredLink(null);
                if (selectLinkNode(el)) {
                  const { from, to } = editor.state.selection;
                  savedLinkSelectionRef.current = { from, to };
                }
                setLinkPanelAnchor({ el, rect: anchorRect });
                setLinkText(el?.textContent || '');
                setLinkUrl(href);
                setShowKeywordPicker(false);
                editor.commands.blur();
                setTimeout(() => setShowLinkInput(true), 0);
              }}
              className="flex-shrink-0 p-0.5 rounded text-gray-500 hover:text-brand-strong transition-colors"
            >
              <Pencil className="w-3 h-3" />
            </button>
            {/* Delete */}
            <button
              type="button"
              title="Remove link"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const el = hoveredLink.el;
                setHoveredLink(null);
                selectLinkNode(el);
                setTimeout(() => {
                  editor.chain().focus().unsetLink().run();
                }, 30);
              }}
              className="flex-shrink-0 p-0.5 rounded text-gray-500 hover:text-red-400 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ), document.body);
      })()}

      {hoveredKeyword && (() => {
        const { title, rect, id } = hoveredKeyword;
        const top = rect.bottom + 4;
        const left = rect.left + rect.width / 2;
        return ReactDOM.createPortal((
          <div
            ref={keywordTooltipRef}
            data-keyword-tooltip
            onMouseEnter={() => {
              if (keywordHideTimerRef.current) { clearTimeout(keywordHideTimerRef.current); keywordHideTimerRef.current = null; }
            }}
            onMouseLeave={() => {
              keywordHideTimerRef.current = setTimeout(() => setHoveredKeyword(null), 150);
            }}
            style={{ position: 'fixed', top, left, transform: 'translateX(-50%)', zIndex: 9999 }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gray-900/95 border border-gray-700/60 shadow-xl backdrop-blur-sm pointer-events-auto"
          >
            <span className="text-[11px] text-brand-strong truncate max-w-[180px]">{title}</span>
            <span className="w-px h-3.5 bg-gray-700 flex-shrink-0" />
            <button
              type="button"
              title="Open keyword"
              onMouseDown={(e) => {
                e.preventDefault(); e.stopPropagation();
                setHoveredKeyword(null);
                if (id) navigate(`/Keywords?keyword_id=${encodeURIComponent(id)}`);
              }}
              className="flex-shrink-0 p-0.5 rounded text-gray-400 hover:text-brand-strong transition-colors"
              data-testid="button-open-keyword-link"
            >
              <ExternalLink className="w-3 h-3" />
            </button>
            <button
              type="button"
              title="Remove keyword link"
              onMouseDown={(e) => {
                e.preventDefault(); e.stopPropagation();
                const el = hoveredKeyword.el;
                setHoveredKeyword(null);
                if (selectKeywordNode(el)) {
                  setTimeout(() => { editor.chain().focus().unsetKeywordLink().run(); }, 30);
                }
              }}
              className="flex-shrink-0 p-0.5 rounded text-gray-400 hover:text-red-400 transition-colors"
              data-testid="button-remove-keyword-link"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ), document.body);
      })()}

      {uploadsInProgress > 0 && (
        <div className="mt-2 px-3 py-2 bg-surface dark:bg-app/20 border border-line dark:border-line rounded-lg text-sm text-ink-faint dark:text-ink-soft">
          Uploading {uploadsInProgress} image{uploadsInProgress > 1 ? 's' : ''}… Please wait before saving.
        </div>
      )}

      {lightboxImage && (
        <ImageLightbox
          src={lightboxImage.src}
          alt={lightboxImage.alt}
          onClose={() => setLightboxImage(null)}
        />
      )}
      {!plainFormatting && <ImageGalleryTools editor={editor} />}

      {selectedImage && (
        <>
          {/* Selection ring drawn directly over the image */}
          <div
            data-image-overlay
            aria-hidden="true"
            style={{
              position: 'fixed',
              top: selectedImage.rect.top - 2,
              left: selectedImage.rect.left - 2,
              width: selectedImage.rect.width + 4,
              height: selectedImage.rect.height + 4,
              border: '2px solid #7C5CB7',
              borderRadius: 10,
              boxShadow: '0 0 0 2px rgba(124, 92, 183, 0.25)',
              pointerEvents: 'none',
              zIndex: 60,
            }}
          />
          {/* Floating trash button — top-right corner of the image */}
          <button
            type="button"
            data-image-overlay
            data-testid="button-delete-image"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              deleteSelectedImage();
            }}
            title="Delete image"
            aria-label="Delete image"
            style={{
              position: 'fixed',
              top: selectedImage.rect.top - 14,
              left: selectedImage.rect.left + selectedImage.rect.width - 14,
              zIndex: 61,
            }}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-app/95 text-white shadow-lg ring-1 ring-brand-strong/60 hover:bg-red-600 hover:ring-red-400 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          {/* Subtle hint that double-click opens fullscreen */}
          <div
            data-image-overlay
            aria-hidden="true"
            style={{
              position: 'fixed',
              top: selectedImage.rect.top + selectedImage.rect.height + 6,
              left: selectedImage.rect.left,
              zIndex: 60,
            }}
            className="pointer-events-none rounded-md bg-app/85 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-ink-muted shadow"
          >
            Double-click to open
          </div>
        </>
      )}

      <style>{`
        .ProseMirror p.is-editor-empty:first-child::before {
          color: #9ca3af;
          content: attr(data-placeholder);
          float: left;
          height: 0;
          pointer-events: none;
        }
        .ProseMirror {
          min-height: 150px;
          font-family: var(--bex-app-font-family, serif);
          font-size: var(--bex-editor-text-size, 16px);
        }
        .ProseMirror.bex-nested-editor {
          font-size: var(--bex-nested-editor-text-size, 12px);
        }
        /* Tailwind typography assigns fonts to descendants, so re-assert the
           single app token while leaving KaTeX's mathematical fonts alone. */
        .ProseMirror,
        .ProseMirror :not(.katex):not(.katex *) {
          font-family: var(--bex-app-font-family, serif);
        }
        /* No backticks in here: this CSS is inside a JSX template literal. */
        .ProseMirror em,
        .ProseMirror i {
          font-style: italic;
          font-synthesis: style;
        }
        .ProseMirror:focus {
          outline: none;
        }
        .ProseMirror h1 {
          font-size: 1.65em;
          font-weight: 700;
          margin-top: 0.5rem;
          margin-bottom: 0.5rem;
          line-height: 1.2;
        }
        .ProseMirror h2 {
          font-size: 1.4em;
          font-weight: 600;
          margin-top: 0.5rem;
          margin-bottom: 0.5rem;
          line-height: 1.25;
        }
        .ProseMirror h3 {
          font-size: 1.2em;
          font-weight: 600;
          margin-top: 0.5rem;
          margin-bottom: 0.5rem;
          line-height: 1.3;
        }
        .ProseMirror h4 {
          font-size: 1.08em;
          font-weight: 600;
          margin-top: 0.5rem;
          margin-bottom: 0.25rem;
          letter-spacing: 0.02em;
          line-height: 1.35;
          color: #FFFFFF;
        }
        .dark .ProseMirror h4 {
          color: #FFFFFF;
        }
        .ProseMirror code {
          background-color: rgba(0, 0, 0, 0.05);
          padding: 0.125rem 0.25rem;
          border-radius: 0.25rem;
          font-family: var(--bex-app-font-family, serif);
          font-size: 0.875em;
        }
        .dark .ProseMirror code {
          background-color: rgba(255, 255, 255, 0.1);
        }
        .ProseMirror pre {
          background-color: #1e1e1e;
          color: #d4d4d4;
          padding: 0.75rem;
          border-radius: 0.5rem;
          overflow-x: auto;
          font-family: var(--bex-app-font-family, serif);
        }
        .ProseMirror blockquote {
          /* Notion-style quote: one quiet square-ended rule, with the quote
             keeping the same typography and colour as the surrounding text. */
          margin: 0.65em 0;
          padding: 0.1em 0 0.1em 0.9em;
          border: 0;
          border-left: 3px solid hsl(var(--foreground) / 0.72);
          border-radius: 0;
          background: transparent;
          color: inherit;
          font-style: normal;
        }
        .ProseMirror blockquote p {
          margin: 0;
        }
        .ProseMirror blockquote p + p {
          margin-top: 0.25em;
        }
        /* Tailwind Typography can generate quote marks around blockquotes;
           Notion uses only the vertical rule. Literal marks in the text stay. */
        .ProseMirror blockquote p:first-of-type::before,
        .ProseMirror blockquote p:last-of-type::after {
          content: none;
        }
        .ProseMirror hr {
          border: none;
          border-top: 2px solid #e5e7eb;
          margin: 1rem 0;
        }
        .dark .ProseMirror hr {
          border-top-color: #374151;
        }
        .ProseMirror ul, .ProseMirror ol {
          padding-left: 1.5rem;
          margin: 0.5rem 0;
        }
        /* Tailwind's Preflight clears the marker on every ul/ol, and this
           project doesn't load @tailwindcss/typography — so the prose class
           that would normally put them back does nothing here. Without these
           rules a list indents but shows no bullet or number at all. */
        .ProseMirror ol { list-style: decimal outside; }
        .ProseMirror ol ol { list-style-type: lower-alpha; }
        .ProseMirror ol ol ol { list-style-type: lower-roman; }
        /* One bullet, at every depth. The browser's own default steps a nested
           list down to a hollow circle and then a square, which read as three
           different kinds of thing rather than as one list indented — so the
           depth is left to the indent alone, and stated at every level because
           the default would otherwise take back over further down. */
        .ProseMirror ul,
        .ProseMirror ul ul,
        .ProseMirror ul ul ul,
        .ProseMirror ul ul ul ul { list-style: disc outside; }
        .ProseMirror li {
          margin: 0.25rem 0;
        }
        /* tiptap wraps each item's text in a paragraph; keep it on the
           marker's line instead of starting a new block under it. */
        .ProseMirror li > p {
          margin: 0;
        }
        .ProseMirror .keyword-link {
          color: #C46A2B;
          text-decoration: underline;
          cursor: pointer;
          position: relative;
        }
        .dark .ProseMirror .keyword-link {
          color: #D89160;
        }
        .ProseMirror .keyword-link:hover {
          color: #A95622;
        }
        .dark .ProseMirror .keyword-link:hover {
          color: #F2D3B3;
        }
        .ProseMirror u {
          text-decoration: underline;
        }
        .ProseMirror .external-link {
          color: #2563eb;
          text-decoration: underline;
          cursor: pointer;
        }
        .dark .ProseMirror .external-link {
          color: #60a5fa;
        }
        .ProseMirror .external-link:hover {
          color: #1d4ed8;
        }
        .dark .ProseMirror .external-link:hover {
          color: #93c5fd;
        }
        
        /* Bible Site Links - Rustic Orange with badges */
        .ProseMirror .bible-site-link {
          color: #C46A2B !important;
          text-decoration: none;
          cursor: pointer;
          position: relative;
          padding-right: 24px;
          transition: all 0.8s ease;
          animation: bibleSiteLinkFadeIn 0.8s ease;
        }
        .dark .ProseMirror .bible-site-link {
          color: #D89160 !important;
        }
        .ProseMirror .bible-site-link:hover {
          color: #A95622 !important;
          text-decoration: underline;
        }
        .dark .ProseMirror .bible-site-link:hover {
          color: #F2D3B3 !important;
        }
        
        /* Local external-link badge; no cloud logo download is required. */
        .ProseMirror .bible-site-link::after {
          content: '↗';
          display: inline-block;
          width: 18px;
          height: 18px;
          border: 1px solid currentColor;
          border-radius: 9999px;
          font-size: 11px;
          line-height: 16px;
          text-align: center;
          margin-left: 4px;
          vertical-align: super;
          position: relative;
          top: -4px;
          opacity: 0;
          animation: bibleSiteBadgeFadeIn 0.8s ease 0.2s forwards;
        }
        
        @keyframes bibleSiteLinkFadeIn {
          from {
            opacity: 0;
            transform: translateY(2px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        @keyframes bibleSiteBadgeFadeIn {
          from {
            opacity: 0;
            transform: scale(0.8);
          }
          to {
            opacity: 0.95;
            transform: scale(1);
          }
        }

        /* Commented text — a light purple wash, deepening for whichever
           comment is in focus in the margin. */
        .ProseMirror .bex-comment {
          background: rgba(139, 92, 246, 0.16);
          border-bottom: 1px solid rgba(139, 92, 246, 0.45);
          border-radius: 2px;
          cursor: pointer;
          transition: background 140ms ease, border-color 140ms ease;
        }
        .ProseMirror .bex-comment:hover {
          background: rgba(139, 92, 246, 0.24);
        }
        .ProseMirror .bex-comment--active {
          background: rgba(139, 92, 246, 0.34);
          border-bottom-color: rgba(167, 139, 250, 0.9);
        }

        /* Footnote references. The digit comes from the numbering decoration,
           never from the document, so deleting note 2 renumbers 3, 4 and 5
           without rewriting a thing. */
        .ProseMirror .bex-footnote {
          display: inline-block;
          min-width: 0.55em;
          padding: 0 0.1em;
          border-radius: 2px;
          font-size: 0.68em;
          font-weight: 700;
          line-height: 0;
          color: #C4B5FD;
          cursor: pointer;
          user-select: none;
          transition: color 140ms ease, background 140ms ease;
        }
        .ProseMirror .bex-footnote::after {
          content: attr(data-footnote-number);
        }
        .ProseMirror .bex-footnote:hover {
          color: #EDE9FE;
          background: rgba(139, 92, 246, 0.22);
        }
        .ProseMirror .bex-footnote--active,
        .ProseMirror .bex-footnote.ProseMirror-selectednode {
          color: #EDE9FE;
          background: rgba(139, 92, 246, 0.32);
        }

        /* Tooltipped text itself carries no decoration at all — no wash, no
           rule, no zone spelled out across the words. That restraint is the
           whole difference from a comment. The ⓘ below is what marks it. */
        .ProseMirror .bex-tooltip {
          border-radius: 2px;
        }

        /* Image Upload Styles */
        .ProseMirror .image-upload-node {
          margin: 1rem 0;
          display: block;
        }

        .ProseMirror .uploaded-image {
          max-width: min(320px, 100%);
          max-height: 240px;
          width: auto;
          height: auto;
          object-fit: contain;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          cursor: pointer;
          transition: transform 0.2s ease, box-shadow 0.2s ease, opacity 0.3s ease;
        }

        .ProseMirror .uploaded-image:hover {
          transform: scale(1.02);
          box-shadow: 0 4px 12px rgba(124, 92, 183, 0.25);
        }

        /* Resize frame: shrink-wraps the picture so the corner handle lands on
           the image itself, not out at the edge of the text column. */
        .ProseMirror .image-resize-frame {
          position: relative;
          display: inline-block;
          line-height: 0;
          max-width: 100%;
        }

        /* The hover nudge fights the drag — the corner would creep away from
           the cursor — so a resizable image holds still. */
        .ProseMirror .image-resize-frame:hover .uploaded-image,
        .ProseMirror .image-resize-frame.is-resizing .uploaded-image {
          transform: none;
        }

        .ProseMirror .image-resize-handle {
          position: absolute;
          right: -5px;
          bottom: -5px;
          width: 14px;
          height: 14px;
          border: 2px solid #fff;
          border-radius: 3px;
          background: #6B4C9A;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.45);
          cursor: nwse-resize;
          opacity: 0;
          transform: scale(0.7);
          transition: opacity 140ms ease, transform 140ms ease;
          touch-action: none;
        }

        .ProseMirror .image-resize-frame:hover .image-resize-handle,
        .ProseMirror .image-resize-frame.is-resizing .image-resize-handle,
        .ProseMirror .ProseMirror-selectednode .image-resize-handle {
          opacity: 1;
          transform: scale(1);
        }

        .ProseMirror .image-resize-frame.is-resizing .uploaded-image {
          outline: 2px solid rgba(107, 76, 154, 0.65);
          outline-offset: 2px;
        }

        .dark .ProseMirror .uploaded-image {
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        }

        .dark .ProseMirror .uploaded-image:hover {
          box-shadow: 0 4px 12px rgba(196, 106, 43, 0.3);
        }

        /* Premium Upload Placeholder */
        .ProseMirror .image-upload-placeholder {
          position: relative;
          width: 100%;
          max-width: 600px;
          height: 200px;
          border: 2px dashed rgba(196, 106, 43, 0.3);
          border-radius: 12px;
          background: linear-gradient(135deg, rgba(245, 234, 211, 0.3), rgba(234, 217, 182, 0.3));
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .dark .ProseMirror .image-upload-placeholder {
          background: linear-gradient(135deg, rgba(75, 52, 36, 0.3), rgba(58, 42, 30, 0.3));
          border-color: rgba(196, 106, 43, 0.4);
        }

        .ProseMirror .placeholder-shimmer {
          position: absolute;
          top: 0;
          left: -100%;
          width: 100%;
          height: 100%;
          background: linear-gradient(
            90deg,
            transparent 0%,
            rgba(255, 255, 255, 0.15) 25%,
            rgba(255, 248, 220, 0.25) 50%,
            rgba(255, 255, 255, 0.15) 75%,
            transparent 100%
          );
          animation: shimmer 1.4s ease-in-out infinite;
        }

        @keyframes shimmer {
          0% {
            left: -100%;
          }
          100% {
            left: 100%;
          }
        }

        .ProseMirror .placeholder-content {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }

        .ProseMirror .upload-spinner {
          width: 32px;
          height: 32px;
          border: 3px solid rgba(196, 106, 43, 0.2);
          border-top-color: rgb(196, 106, 43);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        .ProseMirror .upload-label {
          font-size: 14px;
          font-weight: 500;
          color: rgb(196, 106, 43);
          letter-spacing: 0.5px;
        }

        .dark .ProseMirror .upload-label {
          color: rgb(216, 145, 96);
        }

        /* Upload Error State */
        .ProseMirror .image-upload-error {
          padding: 24px;
          border: 2px solid rgba(155, 61, 43, 0.4);
          border-radius: 12px;
          background: rgba(251, 242, 241, 0.8);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          max-width: 400px;
        }

        .dark .ProseMirror .image-upload-error {
          background: rgba(75, 30, 25, 0.3);
          border-color: rgba(155, 61, 43, 0.5);
        }

        .ProseMirror .error-icon {
          width: 32px;
          height: 32px;
          color: rgb(155, 61, 43);
          stroke-width: 2;
        }

        .dark .ProseMirror .error-icon {
          color: rgb(220, 100, 80);
        }

        .ProseMirror .image-upload-error span {
          font-size: 14px;
          font-weight: 500;
          color: rgb(155, 61, 43);
        }

        .dark .ProseMirror .image-upload-error span {
          color: rgb(220, 100, 80);
        }

        .ProseMirror .retry-button {
          padding: 6px 16px;
          border-radius: 6px;
          background: rgb(196, 106, 43);
          color: white;
          font-size: 13px;
          font-weight: 500;
          border: none;
          cursor: pointer;
          transition: background 0.2s ease;
        }

        .ProseMirror .retry-button:hover {
          background: rgb(169, 86, 34);
        }

        /* ── Toggle / Collapsible blocks (Notion-style) ──
           In the editor a toggle is rendered by a custom NodeView: a chevron
           <button> sibling + a content host holding the <summary> title and the
           animatable body. Read-only/exported content serializes to a native
           <details> element, styled separately at the bottom of this block. */
        .ProseMirror .toggle-block {
          position: relative;
          margin: 2px 0;
        }
        .ProseMirror .toggle-block__chevron {
          position: absolute;
          /* Sits out in the gutter rather than in the text flow, so a toggle's
             text lines up with the paragraphs and list items around it. */
          left: -22px;
          top: 1px;
          width: 20px;
          height: 24px;
          padding: 0;
          margin: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: none;
          background: transparent;
          color: #9a8e80;
          cursor: pointer;
          border-radius: 4px;
          transition: transform 0.18s ease, background-color 0.15s ease, color 0.15s ease;
        }
        /* An empty toggle stays dim; one holding something reads bright. The
           triangle is the only affordance saying whether a collapsed toggle is
           worth opening, so it carries that state itself. */
        .ProseMirror .toggle-block.has-content > .toggle-block__chevron {
          color: #2f2a24;
        }
        .ProseMirror .toggle-block__chevron:hover {
          background: rgba(0, 0, 0, 0.06);
          color: #5a5048;
        }
        .dark .ProseMirror .toggle-block__chevron {
          color: #6b6b6b;
        }
        .dark .ProseMirror .toggle-block.has-content > .toggle-block__chevron {
          color: #ffffff;
        }
        .dark .ProseMirror .toggle-block__chevron:hover {
          background: rgba(255, 255, 255, 0.08);
          color: #ffffff;
        }
        .ProseMirror .toggle-block__chevron:focus-visible {
          outline: 2px solid #C46A2B;
          outline-offset: 1px;
        }
        /* The editable node view sets its own triangle rotation inline (see
           CollapsibleToggleExtension), so this rule exists only for the
           read-only / exported native <details> rendering, where there is no
           node view to do it. Direct child, so a closed toggle nested inside an
           open one keeps its own triangle pointing right. */
        .ProseMirror details.toggle-block[open] > .toggle-block__chevron {
          transform: rotate(90deg);
        }
        /* No indent: the chevron hangs in the gutter, so the summary and body
           start exactly where ordinary text does. */
        .ProseMirror .toggle-block__host {
          padding-left: 0;
        }
        .ProseMirror .toggle-block summary {
          display: block;
          list-style: none;
          cursor: text;
          padding: 1px 2px;
          border-radius: 4px;
          font-weight: 500;
          color: #2B1D12;
        }
        .dark .ProseMirror .toggle-block summary {
          color: #f3ede3;
        }
        .ProseMirror .toggle-block summary::-webkit-details-marker { display: none; }
        .ProseMirror .toggle-block summary:focus { outline: none; }
        .ProseMirror .toggle-block__body {
          overflow: hidden;
          padding: 2px 0;
          transition: height 0.22s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.18s ease;
        }
        .ProseMirror .toggle-block__body > :first-child { margin-top: 0; }
        /* A list directly inside a toggle is already visually grouped by the
           disclosure control. Do not add the editor's ordinary list gutter a
           second time; that made items after the toggle look accidentally
           nested. The inside marker position keeps it visible while the animated body
           clips its contents. Truly nested lists still use the normal gutter. */
        .ProseMirror .toggle-block__body > ol,
        .ProseMirror .toggle-block__body > ul {
          padding-left: 0;
          list-style-position: inside;
        }
        /* With an inside marker, a block-level first paragraph starts below
           the bullet/number. TipTap always wraps list-item text in a paragraph,
           so let only that first paragraph share the marker's line; any later
           paragraphs and nested lists keep their normal block layout. */
        .ProseMirror .toggle-block__body > ol > li > p:first-child,
        .ProseMirror .toggle-block__body > ul > li > p:first-child {
          display: inline;
        }
        /* A nested toggle needs room for its own triangle.
           The body must clip (that is how its height animates), and a triangle
           sits 22px out in the gutter, so a nested toggle's triangle was being
           cut off entirely — the child appeared to have no control at all.
           Stepping in only the nested toggle, and bringing its triangle inside
           that step, keeps ordinary body text flush the way it should be. */
        .ProseMirror .toggle-block__body > .toggle-block {
          margin-left: 0;
          padding-left: 22px;
        }
        .ProseMirror .toggle-block__body > .toggle-block > .toggle-block__chevron {
          left: 0;
        }

        /* ── Gap cursor ──
           StarterKit ships the Gapcursor extension but no CSS, so the blinking
           caret was invisible when placed in the gap below/after a block node
           (e.g. right under a toggle). Restore the standard visible caret. */
        .ProseMirror-gapcursor {
          display: none;
          pointer-events: none;
          position: absolute;
          margin: 0;
        }
        .ProseMirror-gapcursor::after {
          content: '';
          display: block;
          position: absolute;
          top: -2px;
          width: 24px;
          border-top: 1px solid #2B1D12;
          animation: ProseMirror-cursor-blink 1.1s steps(2, start) infinite;
        }
        .dark .ProseMirror-gapcursor::after { border-top-color: #f3ede3; }
        @keyframes ProseMirror-cursor-blink { to { visibility: hidden; } }
        .ProseMirror-focused .ProseMirror-gapcursor { display: block; }
        @media (prefers-reduced-motion: reduce) {
          .ProseMirror .toggle-block__chevron,
          .ProseMirror .toggle-block__body,
          details.toggle-block > summary::before {
            transition: none !important;
          }
        }

        /* ── Read-only / exported native <details> rendering ──
           Outside the editor the toggle is a real <details class="toggle-block">,
           which collapses/expands natively. Give it a matching chevron. */
        details.toggle-block {
          position: relative;
          margin: 2px 0;
        }
        details.toggle-block > summary {
          display: block;
          list-style: none;
          cursor: pointer;
          font-weight: 500;
          padding: 1px 2px;
          color: #2B1D12;
        }
        .dark details.toggle-block > summary { color: #f3ede3; }
        details.toggle-block > summary::-webkit-details-marker { display: none; }
        /* Same gutter treatment as the editor so a saved toggle keeps the
           alignment it was written with. */
        details.toggle-block > summary::before {
          content: '';
          position: absolute;
          left: -14px;
          top: 0.55em;
          width: 0;
          height: 0;
          border-style: solid;
          border-width: 4px 0 4px 6px;
          border-color: transparent transparent transparent #9a8e80;
          transition: transform 0.18s ease;
        }
        details.toggle-block[open] > summary::before { transform: rotate(90deg); }
        details.toggle-block > div[data-type="detailsContent"] {
          padding: 2px 0;
        }
        details.toggle-block > div[data-type="detailsContent"] > ol,
        details.toggle-block > div[data-type="detailsContent"] > ul {
          padding-left: 0;
          list-style-position: inside;
        }
        details.toggle-block > div[data-type="detailsContent"] > ol > li > p:first-child,
        details.toggle-block > div[data-type="detailsContent"] > ul > li > p:first-child {
          display: inline;
        }

        /* ── Tables ──
           High-specificity selectors so they beat @tailwindcss/typography
           (.prose) defaults that the editor wraps content in. */
        .ProseMirror .tableWrapper {
          margin: 0.75rem 0;
          overflow-x: auto;
        }
        .ProseMirror table.rt-table {
          border-collapse: collapse !important;
          table-layout: auto;
          width: auto;
          max-width: 100%;
          margin: 0;
          border: 1px solid #9ca3af !important;
        }
        .dark .ProseMirror table.rt-table {
          border-color: #6b7280 !important;
        }
        .ProseMirror table.rt-table td,
        .ProseMirror table.rt-table th {
          min-width: 2em;
          border: 1px solid #9ca3af !important;
          padding: 6px 10px !important;
          vertical-align: top !important;
          text-align: left !important;
          box-sizing: border-box;
          position: relative;
          word-break: break-word;
        }
        .dark .ProseMirror table.rt-table td,
        .dark .ProseMirror table.rt-table th {
          border-color: #4b5563 !important;
        }
        .ProseMirror table.rt-table th {
          background: rgba(196, 106, 43, 0.12) !important;
          font-weight: 600 !important;
          color: #2B1D12 !important;
        }
        .dark .ProseMirror table.rt-table th {
          background: rgba(196, 106, 43, 0.22) !important;
          color: #f3ede3 !important;
        }
        .ProseMirror table.rt-table tbody tr:nth-child(even) > td {
          background: rgba(0, 0, 0, 0.025);
        }
        .dark .ProseMirror table.rt-table tbody tr:nth-child(even) > td {
          background: rgba(255, 255, 255, 0.03);
        }
        .ProseMirror table.rt-table p {
          margin: 0 !important;
        }
        /* Selecting a whole row or column from its grip. The rule used to be
           written for table.rt-table only, which the LIVE table never carries —
           the resizable node view builds its own table element and the class
           survives only into the saved HTML. So the highlight never appeared
           while editing, which is the state you actually select cells in. */
        .ProseMirror table .selectedCell,
        .ProseMirror table.rt-table .selectedCell {
          background: rgba(139, 92, 246, 0.20) !important;
          box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.55);
        }
        .dark .ProseMirror table .selectedCell,
        .dark .ProseMirror table.rt-table .selectedCell {
          background: rgba(139, 92, 246, 0.30) !important;
          box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.7);
        }
        .ProseMirror table.rt-table .column-resize-handle {
          position: absolute;
          right: -2px;
          top: 0;
          bottom: -2px;
          width: 4px;
          background-color: #6B4C9A;
          pointer-events: none;
        }
        .ProseMirror.resize-cursor {
          cursor: ew-resize;
          cursor: col-resize;
        }

        /* Reduced motion support */
        @media (prefers-reduced-motion: reduce) {
          .ProseMirror .placeholder-shimmer {
            animation: none;
            display: none;
          }
          
          .ProseMirror .upload-spinner {
            animation: none;
            border-top-color: rgb(196, 106, 43);
            opacity: 0.7;
          }

          .ProseMirror .uploaded-image {
            transition: none;
          }

          .ProseMirror .uploaded-image:hover {
            transform: none;
          }
        }

        /* Responsive images on mobile */
        @media (max-width: 640px) {
          .ProseMirror .uploaded-image,
          .ProseMirror .image-upload-placeholder {
            border-radius: 6px;
          }

          .ProseMirror .image-upload-placeholder {
            height: 160px;
          }
        }
      `}</style>
    </div>
  );
}
