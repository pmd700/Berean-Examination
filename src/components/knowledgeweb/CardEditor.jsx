import SizeSwitch from '../editor/TextEditorSizeSwitch';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X, Trash2, Image as ImageIcon, Clock, Tag, BookOpen, Plus, Crosshair, ExternalLink, PanelRightClose, PanelRightOpen, Copy, Check } from 'lucide-react';
import { desktopClient } from '@/api/desktopClient';
import RichTextEditor from '../editor/RichTextEditor';
import { isSidebarToggleShortcut } from './sidebarShortcut';
import { usePersistentPreference } from '@/lib/usePersistentPreference';
import { normalizeCardTitle } from './cardTitle';
import { buildCardClipboardText } from './cardClipboard';
import moment from 'moment';
import { startFieldSpotlight } from '@/lib/spotlightMotion';

const AUTO_EXPAND_THRESHOLD = 350;

// Shown in the sidebar-toggle tooltip. The shortcut itself accepts either
// modifier (see isSidebarToggleShortcut); this is only the label.
const MODIFIER_LABEL = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent || '')
  ? '⌘'
  : 'Ctrl+';

function getDescriptionCharCount(content = '') {
  return content
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .length;
}

export default function CardEditor({
  card,
  allCards,
  onUpdate,
  onDelete,
  onClose,
  onFocus,
  isFocused,
  spotlightQuery = '',
  spotlightField = '',
  spotlightToken = '',
  onSpotlightComplete,
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tagsStr, setTagsStr] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [scriptureRefs, setScriptureRefs] = useState([]);
  const [newRef, setNewRef] = useState('');
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // 'compact' | 'expanded' | 'fullscreen'
  const [descriptionMode, setDescriptionMode] = useState('compact');
  const [tagFocused, setTagFocused] = useState(false);
  const [activeSuggestionIdx, setActiveSuggestionIdx] = useState(-1);
  const [titleFocused, setTitleFocused] = useState(false);
  const [copied, setCopied] = useState(false);
  // Remembered, so a user who works with the sidebar collapsed doesn't have to
  // collapse it again for every card they open.
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistentPreference('kw_card_details_collapsed', false);
  const tagInputRef = useRef(null);
  const editorRootRef = useRef(null);
  const spotlightCompleteRef = useRef(onSpotlightComplete);
  spotlightCompleteRef.current = onSpotlightComplete;
  const saveTimer = useRef(null);
  // Track which field scheduled the pending autosave so external changes
  // to other fields don't accidentally cancel an in-flight save (and so
  // we can cancel the title autosave specifically when the title is
  // updated from elsewhere — e.g. inline canvas rename).
  const pendingFieldRef = useRef(null);

  // Collect all unique tags from other cards in this web
  const allExistingTags = useMemo(() => {
    const tagSet = new Set();
    (allCards || []).forEach(c => {
      if (c.id === card.id) return;
      (c.tags || []).forEach(t => { if (t.trim()) tagSet.add(t.trim()); });
    });
    return Array.from(tagSet).sort((a, b) => a.localeCompare(b));
  }, [allCards, card.id]);

  // Current fragment = the tag currently being typed (after last comma)
  const currentFragment = useMemo(() => {
    const parts = tagsStr.split(',');
    return parts[parts.length - 1].trimStart();
  }, [tagsStr]);

  // Already-committed tags (all but the last fragment)
  const committedTags = useMemo(() => {
    const parts = tagsStr.split(',');
    return parts.slice(0, -1).map(t => t.trim()).filter(Boolean);
  }, [tagsStr]);

  // Suggestions: existing tags that match the fragment and aren't already used
  const tagSuggestions = useMemo(() => {
    const frag = currentFragment.trim().toLowerCase();
    if (!frag) return [];
    return allExistingTags.filter(t =>
      t.toLowerCase().includes(frag) && !committedTags.includes(t)
    );
  }, [currentFragment, allExistingTags, committedTags]);

  const showSuggestions = tagFocused && tagSuggestions.length > 0;

  const applyTagSuggestion = (tag) => {
    const parts = tagsStr.split(',');
    parts[parts.length - 1] = ' ' + tag;
    const newStr = parts.join(',') + ', ';
    setTagsStr(newStr);
    const tags = newStr.split(',').map(t => t.trim()).filter(Boolean);
    autosave({ tags });
    setActiveSuggestionIdx(-1);
    tagInputRef.current?.focus();
  };

  useEffect(() => {
    clearTimeout(saveTimer.current);
    pendingFieldRef.current = null;
    setTitle(normalizeCardTitle(card.title));
    setDescription(card.description || '');
    setTagsStr((card.tags || []).join(', '));
    setImageUrl(card.image_url || '');
    setScriptureRefs(card.scripture_refs || []);
    setNewRef('');
    setConfirmDelete(false);
    setDescriptionMode('compact');
  }, [card.id]);

  // When card.title changes from outside the inspector (e.g. inline
  // rename on the canvas card), keep the inspector's local title in
  // sync UNLESS the user is currently typing here. Also cancel any
  // pending title autosave so the older keystroke can't fire later
  // and clobber the freshly-renamed value with a stale one.
  useEffect(() => {
    if (titleFocused) return;
    if (pendingFieldRef.current === 'title') {
      clearTimeout(saveTimer.current);
      pendingFieldRef.current = null;
    }
    setTitle(normalizeCardTitle(card.title));
  }, [card.title, titleFocused]);

  // Spotlight opens the exact card and then hands the match to the field that
  // owns it. Long-form text opens full screen; short fields use native text
  // selection so the purple match is immediately editable.
  useEffect(() => {
    const query = String(spotlightQuery || '').trim();
    if (!query) return undefined;
    if (spotlightField === 'body') {
      setDescriptionMode('fullscreen');
      return undefined;
    }

    const selector = spotlightField === 'tags'
      ? '[data-spotlight-card-tags]'
      : '[data-spotlight-card-title]';
    let secondFrame = null;
    let trip;
    let disposed = false;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const field = editorRootRef.current?.querySelector(selector);
        if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
        trip = startFieldSpotlight(field, query);
        trip.finished.finally(() => { if (!disposed) spotlightCompleteRef.current?.(spotlightToken); });
      });
    });
    return () => {
      disposed = true;
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) window.cancelAnimationFrame(secondFrame);
      trip?.cancel();
    };
  }, [card.id, spotlightField, spotlightQuery, spotlightToken]);

  // ⌘\ / Ctrl+\ collapses the card-details sidebar while the editor is
  // fullscreen. Registered on the capture phase and stopping propagation so it
  // beats the Knowledge Web's own ⌘\ handler: that one toggles the left web
  // sidebar, which this fullscreen overlay is covering, so the keystroke would
  // otherwise appear to do nothing at all.
  useEffect(() => {
    if (descriptionMode !== 'fullscreen') return undefined;
    const toggleFromKeyboard = (event) => {
      if (!isSidebarToggleShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setSidebarCollapsed((current) => !current);
    };
    window.addEventListener('keydown', toggleFromKeyboard, true);
    return () => window.removeEventListener('keydown', toggleFromKeyboard, true);
  }, [descriptionMode, setSidebarCollapsed]);

  const autosave = (updates) => {
    const currentCardId = card.id;
    const fields = Object.keys(updates);
    clearTimeout(saveTimer.current);
    pendingFieldRef.current = fields.length === 1 ? fields[0] : 'multi';
    saveTimer.current = setTimeout(() => {
      pendingFieldRef.current = null;
      onUpdate(currentCardId, updates);
    }, 500);
  };

  // Flush a pending title autosave immediately — used on Enter / blur
  // so the user gets instant persistence rather than a 500ms wait.
  const flushTitleSave = () => {
    if (pendingFieldRef.current !== 'title') return;
    clearTimeout(saveTimer.current);
    pendingFieldRef.current = null;
    const trimmed = (title || '').trim();
    if (trimmed !== normalizeCardTitle(card.title).trim()) {
      setTitle(trimmed);
      onUpdate(card.id, { title: trimmed });
    }
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const { file_url } = await desktopClient.media.uploadFile({ file });
    setImageUrl(file_url);
    onUpdate(card.id, { image_url: file_url });
    setUploading(false);
  };

  const addScriptureRef = () => {
    if (!newRef.trim()) return;
    const updated = [...scriptureRefs, newRef.trim()];
    setScriptureRefs(updated);
    setNewRef('');
    onUpdate(card.id, { scripture_refs: updated });
  };

  const copyCardText = async () => {
    const text = buildCardClipboardText({ title, description });
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  const copyButton = (
    <button
      type="button"
      onClick={copyCardText}
      title={copied ? 'Copied title and description' : 'Copy title and description'}
      aria-label={copied ? 'Copied title and description' : 'Copy title and description'}
      className={`p-1 rounded transition-all duration-150 ${copied ? 'text-emerald-400 scale-110' : 'text-gray-500 hover:text-gray-200 hover:bg-gray-800'}`}
    >
      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
    </button>
  );

  const removeScriptureRef = (idx) => {
    const updated = scriptureRefs.filter((_, i) => i !== idx);
    setScriptureRefs(updated);
    onUpdate(card.id, { scripture_refs: updated });
  };

  const isFullscreen = descriptionMode === 'fullscreen';
  const descriptionIsEmpty = getDescriptionCharCount(description) === 0;
  const widthClass =
    descriptionMode === 'expanded'
      ? 'w-[28rem] xl:w-[32rem]'
      : 'w-80';

  return (
    <div
      ref={editorRootRef}
      className={
        isFullscreen
          // Starts below the workspace tab bar rather than at the top of the
          // window, so the bar doesn't sit over this editor's own header row.
          ? 'fixed left-0 right-0 bottom-0 z-50 bg-gray-900 flex flex-row'
          : `${widthClass} kw-card-inspector-enter bg-gray-900 border-l border-gray-800 flex flex-col h-full transition-[width] duration-200`
      }
      style={isFullscreen ? { top: 'var(--bex-tabbar-height, 0px)' } : undefined}
    >
      {/* Fullscreen layout: description on the left (large), other fields on the right (narrow side panel) */}
      {isFullscreen ? (
        <>
          {/* Main description area */}
          <div className={`flex-1 flex flex-col min-w-0${sidebarCollapsed ? '' : ' border-r border-gray-800'}`}>
            <div className="flex items-center justify-between gap-3 px-6 py-3 border-b border-gray-800 bg-gray-900">
              <div className="flex items-center gap-2 min-w-0">
                {copyButton}
                <div className="w-2 h-2 rounded-full bg-brand shrink-0" />
                <h3 className="text-sm font-semibold text-gray-200 truncate">{title || 'Untitled card'}</h3>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {/* Delete lives up here rather than at the foot of the sidebar so
                    it stays reachable when the sidebar is collapsed. */}
                {confirmDelete ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      data-testid="button-confirm-delete-card"
                      onClick={() => onDelete(card.id)}
                      className="h-6 px-2 rounded text-[10px] font-semibold uppercase tracking-wider bg-red-600 hover:bg-red-700 text-white transition-colors"
                    >
                      Confirm delete
                    </button>
                    <button
                      type="button"
                      data-testid="button-cancel-delete-card"
                      onClick={() => setConfirmDelete(false)}
                      className="h-6 px-2 rounded text-[10px] font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    data-testid="button-delete-card"
                    onClick={() => setConfirmDelete(true)}
                    title="Delete card"
                    className="inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-semibold uppercase tracking-wider text-red-400/80 hover:text-red-300 hover:bg-red-900/25 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" /> Delete
                  </button>
                )}
                <div className="w-px h-5 bg-gray-800" />
                <SizeSwitch mode={descriptionMode} onChange={setDescriptionMode} />
                <button
                  type="button"
                  data-testid="button-toggle-card-details"
                  onClick={() => setSidebarCollapsed((current) => !current)}
                  title={`${sidebarCollapsed ? 'Show' : 'Hide'} card details (${MODIFIER_LABEL}\\)`}
                  aria-label={`${sidebarCollapsed ? 'Show' : 'Hide'} card details`}
                  aria-expanded={!sidebarCollapsed}
                  className={`p-1 rounded transition-colors ${sidebarCollapsed ? 'text-gray-500 hover:text-gray-300' : 'text-ink-faint bg-brand/15 hover:text-ink-soft'}`}
                >
                  {sidebarCollapsed ? <PanelRightOpen className="w-4 h-4" /> : <PanelRightClose className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  title="Close editor"
                  aria-label="Close editor"
                  className="text-gray-500 hover:text-gray-300 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="bex-card-text-editor flex-1 overflow-y-auto kw-card-editor-fullscreen">
                <RichTextEditor
                  content={description}
                  onChange={(value) => {
                    setDescription(value);
                    autosave({ description: value });
                  }}
                  placeholder="Add description or notes with rich text or markdown..."
                  scrollPastEnd
                  localFindShortcut
                  spotlightQuery={spotlightField === 'body' ? spotlightQuery : ''}
                  spotlightToken={spotlightToken}
                  onSpotlightComplete={onSpotlightComplete}
                />
              </div>
          </div>
          {/* Narrow side panel for everything else. Collapsing it to zero width
              hands the whole window to the description. `visibility` is part of
              the transition so it flips only once the panel has finished
              shrinking — while still taking the fields out of the tab order for
              as long as they are hidden. */}
          <div
            className="kw-card-details-panel bg-gray-900 flex flex-col h-full overflow-hidden shrink-0"
            style={{
              width: sidebarCollapsed ? 0 : '20rem',
              visibility: sidebarCollapsed ? 'hidden' : 'visible',
            }}
            aria-hidden={sidebarCollapsed}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Card Details</h3>
            </div>
            <div className="flex-1 overflow-y-auto">
              {renderSidePanel()}
            </div>
          </div>
          <style>{`
            /* In fullscreen the outer scroll container (.overflow-y-auto)
               handles vertical scrolling. The editor wrapper must grow with
               its content (min-height, not fixed height) — otherwise its
               own overflow-hidden clips long content and the parent never
               knows to scroll. */
            .kw-card-editor-fullscreen > div {
              min-height: 100%;
              background: #020617;
              border: 0;
              border-radius: 0;
            }
            .kw-card-editor-fullscreen .ProseMirror {
              min-height: calc(100vh - 14rem);
              width: min(calc(100% - 5rem), 104rem);
              margin-inline: auto;
            }
            @media (max-width: 48rem) {
              .kw-card-editor-fullscreen .ProseMirror {
                width: calc(100% - 2rem);
              }
            }
            .kw-card-details-panel {
              transition: width 200ms ease-out, visibility 200ms ease-out;
            }
            @media (prefers-reduced-motion: reduce) {
              .kw-card-details-panel { transition: none; }
            }
          `}</style>
        </>
      ) : (
        <>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2">
          {copyButton}
          <div className="w-2 h-2 rounded-full bg-brand" />
          <h3 className="text-sm font-semibold text-gray-200">Card Inspector</h3>
        </div>
        <div className="flex items-center gap-1">
          {onFocus && (
            <button
              onClick={() => onFocus(card.id)}
              className={`p-1 rounded transition-colors ${isFocused ? 'text-ink-faint bg-brand/15' : 'text-gray-500 hover:text-ink-faint'}`}
              title="Focus on this card"
            >
              <Crosshair className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Image Section */}
        <div className="border-b border-gray-800">
          {imageUrl ? (
            <div className="relative group">
              <img src={imageUrl} alt="" className="w-full h-44 object-cover" />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                <button
                  onClick={() => { setImageUrl(''); onUpdate(card.id, { image_url: '' }); }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity bg-red-600/80 text-white text-xs px-3 py-1.5 rounded-lg"
                >
                  Remove Image
                </button>
              </div>
            </div>
          ) : (
            <label className="flex items-center justify-center gap-2 h-28 cursor-pointer hover:bg-gray-800/50 transition-colors m-3 rounded-xl border border-dashed border-gray-700 hover:border-line-strong/40">
              {uploading ? (
                <span className="text-xs text-gray-500 animate-pulse">Uploading...</span>
              ) : (
                <>
                  <ImageIcon className="w-4 h-4 text-gray-600" />
                  <span className="text-xs text-gray-500">Click or drop image</span>
                </>
              )}
              <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
            </label>
          )}
        </div>

        {/* Fields */}
        <div className="p-4 space-y-4">
          {/* Title */}
          <div>
            <label className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Title</label>
            <Input
              data-spotlight-card-title
              value={title}
              onChange={e => { setTitle(e.target.value); autosave({ title: e.target.value }); }}
              onFocus={() => setTitleFocused(true)}
              onBlur={() => { flushTitleSave(); setTitleFocused(false); }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); flushTitleSave(); e.currentTarget.blur(); } }}
              className="mt-1 bg-gray-800/50 border-gray-700 text-gray-100 h-9 text-sm focus:border-line"
              placeholder="card title"
            />
          </div>

          {/* Description */}
          <div>
            <div className="flex items-center justify-between gap-2">
              <label className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Description</label>
              <div className="flex items-center gap-1.5">
                <SizeSwitch mode={descriptionMode} onChange={setDescriptionMode} iconsOnly />
              </div>
            </div>
            <div className={`bex-card-text-editor mt-1 ${
              descriptionMode === 'expanded'
                ? 'min-h-[28rem]'
                : descriptionIsEmpty
                  ? 'min-h-[10rem]'
                  : 'min-h-[16rem]'
            }`}>
                <RichTextEditor
                  content={description}
                  onChange={(value) => {
                    setDescription(value);
                    if (descriptionMode === 'compact' && getDescriptionCharCount(value) >= AUTO_EXPAND_THRESHOLD) {
                      setDescriptionMode('expanded');
                    }
                    autosave({ description: value });
                  }}
                  placeholder="Add description or notes with rich text or markdown..."
                  scrollPastEnd={false}
                  localFindShortcut
                  spotlightQuery={spotlightField === 'body' ? spotlightQuery : ''}
                  spotlightToken={spotlightToken}
                  onSpotlightComplete={onSpotlightComplete}
                />
              </div>
          </div>

          {/* Smart edges */}
          <div>
            <label className="flex min-h-11 items-center justify-between gap-2 rounded-md border border-gray-700 bg-gray-800/50 px-3 py-2 cursor-pointer hover:border-gray-600 transition-colors">
              <span>
                <span className="block text-xs text-gray-300">Smart edges</span>
                <span className="block text-[9px] text-gray-500">Rounded, title-only cards. Body, images and tags stay in the editor.</span>
              </span>
              <input
                type="checkbox"
                checked={card.layout_mode !== 'manual'}
                onChange={e => onUpdate(card.id, { layout_mode: e.target.checked ? 'smart' : 'manual' })}
                className="w-4 h-4 accent-brand-strong cursor-pointer"
                data-testid="checkbox-card-smart-edges"
              />
            </label>
          </div>

          {/* Transparent */}
          <div>
            <label className="flex items-center justify-between gap-2 px-3 h-9 rounded-md bg-gray-800/50 border border-gray-700 cursor-pointer hover:border-gray-600 transition-colors">
              <span className="text-xs text-gray-300">Transparent</span>
              <input
                type="checkbox"
                checked={!!card.is_transparent}
                onChange={e => onUpdate(card.id, { is_transparent: e.target.checked })}
                className="w-4 h-4 accent-brand-strong cursor-pointer"
                data-testid="checkbox-card-transparent"
              />
            </label>
          </div>

          {/* Tags */}
          <div className="relative">
            <label className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold flex items-center gap-1">
              <Tag className="w-3 h-3" /> Tags
            </label>
            <Input
              ref={tagInputRef}
              data-spotlight-card-tags
              value={tagsStr}
              onChange={e => {
                setTagsStr(e.target.value);
                setActiveSuggestionIdx(-1);
                const tags = e.target.value.split(',').map(t => t.trim()).filter(Boolean);
                autosave({ tags });
              }}
              onFocus={() => setTagFocused(true)}
              onBlur={() => setTimeout(() => setTagFocused(false), 150)}
              onKeyDown={e => {
                if (!showSuggestions) return;
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActiveSuggestionIdx(i => Math.min(i + 1, tagSuggestions.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActiveSuggestionIdx(i => Math.max(i - 1, 0));
                } else if (e.key === 'Enter' || e.key === 'Tab') {
                  const idx = activeSuggestionIdx >= 0 ? activeSuggestionIdx : 0;
                  if (tagSuggestions[idx]) {
                    e.preventDefault();
                    applyTagSuggestion(tagSuggestions[idx]);
                  }
                } else if (e.key === 'Escape') {
                  setTagFocused(false);
                }
              }}
              className="mt-1 bg-gray-800/50 border-gray-700 text-gray-100 h-9 text-sm"
              placeholder="tag1, tag2, ..."
            />
            {showSuggestions && (
              <div className="absolute z-50 left-0 right-0 mt-0.5 bg-[#111827] border border-[#374151] rounded-md shadow-lg overflow-hidden max-h-44 overflow-y-auto">
                {tagSuggestions.map((tag, i) => (
                  <button
                    key={tag}
                    type="button"
                    onMouseDown={e => { e.preventDefault(); applyTagSuggestion(tag); }}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                      i === activeSuggestionIdx
                        ? 'bg-brand/60 text-white'
                        : 'text-gray-300 hover:bg-[#1f2937]'
                    }`}
                  >
                    <span className="text-[#8B5CF6] mr-1">#</span>{tag}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Scripture References */}
          <div>
            <label className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold flex items-center gap-1">
              <BookOpen className="w-3 h-3" /> Scripture References
            </label>
            <div className="mt-1 space-y-1">
              {scriptureRefs.map((ref, idx) => (
                <div key={idx} className="flex items-center gap-1.5 group">
                  <a
                    href={`https://www.biblegateway.com/passage/?search=${encodeURIComponent(ref)}&version=NASB`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 text-xs text-ink-faint hover:text-ink-soft flex items-center gap-1 px-2 py-1.5 bg-brand/10 rounded-md border border-line"
                    onClick={e => e.stopPropagation()}
                  >
                    {ref}
                    <ExternalLink className="w-2.5 h-2.5 opacity-50" />
                  </a>
                  <button
                    onClick={() => removeScriptureRef(idx)}
                    className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              <div className="flex gap-1.5">
                <Input
                  value={newRef}
                  onChange={e => setNewRef(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addScriptureRef(); }}
                  className="bg-gray-800/50 border-gray-700 text-gray-100 h-7 text-xs flex-1"
                  placeholder="e.g. John 3:16"
                />
                <Button
                  size="sm"
                  onClick={addScriptureRef}
                  disabled={!newRef.trim()}
                  className="h-7 w-7 p-0 bg-violet-600/10 hover:bg-brand/40 text-ink-faint"
                >
                  <Plus className="w-3 h-3" />
                </Button>
              </div>
            </div>
          </div>

          {/* Metadata */}
          <div className="pt-2 border-t border-gray-800 space-y-2">
            <label className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold flex items-center gap-1">
              <Clock className="w-3 h-3" /> Metadata
            </label>
            <div className="text-[11px] text-gray-500 space-y-1">
              <div className="flex justify-between">
                <span>Created</span>
                <span className="text-gray-400">{moment(card.created_date).format('MMM D, YYYY h:mm A')}</span>
              </div>
              <div className="flex justify-between">
                <span>Updated</span>
                <span className="text-gray-400">{moment(card.updated_date || card.created_date).format('MMM D, YYYY h:mm A')}</span>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* Delete — pinned to the bottom of the panel. Inline styles are
          used for the hit-rect because a previous tailwind-only version
          had its hit area shrunk to a thin strip at the top (something
          in the editor stacking context was eating the rest). Forcing
          `position: relative; isolation: isolate; z-index: 50` gives the
          area its own stacking context above any portaled tippy / select
          popovers, and explicit `display:flex; height; width` guarantees
          the entire visible rectangle is the click target. */}
      <div
        style={{
          position: 'relative',
          zIndex: 50,
          isolation: 'isolate',
          flexShrink: 0,
          padding: 12,
          background: '#111827',
          borderTop: '1px solid #1f2937',
        }}
      >
        {confirmDelete ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              data-testid="button-confirm-delete-card"
              onClick={() => onDelete(card.id)}
              style={{
                flex: 1, height: 44, borderRadius: 6, fontSize: 12, fontWeight: 500,
                background: '#dc2626', color: '#ffffff', cursor: 'pointer',
                border: 'none', transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#b91c1c'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = '#dc2626'; }}
            >
              Confirm Delete
            </button>
            <button
              type="button"
              data-testid="button-cancel-delete-card"
              onClick={() => setConfirmDelete(false)}
              style={{
                height: 44, padding: '0 16px', borderRadius: 6, fontSize: 12,
                color: '#9ca3af', background: 'transparent', cursor: 'pointer',
                border: 'none',
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            data-testid="button-delete-card"
            onClick={() => setConfirmDelete(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              width: '100%',
              height: 44,
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 500,
              color: 'rgba(248, 113, 113, 0.8)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              transition: 'background 0.15s, color 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(127, 29, 29, 0.3)';
              e.currentTarget.style.color = '#fca5a5';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'rgba(248, 113, 113, 0.8)';
            }}
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete Card
          </button>
        )}
      </div>
        </>
      )}
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────
  // renderSidePanel: re-uses the right-hand "card details" area in
  // fullscreen mode — image, title, type, tags, scripture refs, web list,
  // delete. Inline so it has access to all state/handlers above.
  // ─────────────────────────────────────────────────────────────────────
  function renderSidePanel() {
    return (
      <div className="p-4 space-y-4">
        {/* Image */}
        <div>
          <label className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Image</label>
          {imageUrl ? (
            <div className="relative group mt-1 rounded-lg overflow-hidden">
              <img src={imageUrl} alt="" className="w-full h-32 object-cover" />
              <button
                onClick={() => { setImageUrl(''); onUpdate(card.id, { image_url: '' }); }}
                className="absolute top-1 right-1 bg-red-600/80 hover:bg-red-600 text-white text-[10px] px-2 py-1 rounded"
              >
                Remove
              </button>
            </div>
          ) : (
            <label className="mt-1 flex items-center justify-center gap-2 h-20 cursor-pointer hover:bg-gray-800/50 transition-colors rounded-lg border border-dashed border-gray-700">
              {uploading ? (
                <span className="text-xs text-gray-500 animate-pulse">Uploading...</span>
              ) : (
                <>
                  <ImageIcon className="w-4 h-4 text-gray-600" />
                  <span className="text-xs text-gray-500">Click or drop image</span>
                </>
              )}
              <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
            </label>
          )}
        </div>

        {/* Title */}
        <div>
          <label className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Title</label>
          <Input
            data-spotlight-card-title
            value={title}
            onChange={e => { setTitle(e.target.value); autosave({ title: e.target.value }); }}
            onFocus={() => setTitleFocused(true)}
            onBlur={() => { flushTitleSave(); setTitleFocused(false); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); flushTitleSave(); e.currentTarget.blur(); } }}
            className="mt-1 bg-gray-800/50 border-gray-700 text-gray-100 h-9 text-sm focus:border-line"
            placeholder="card title"
          />
        </div>

        {/* Tags */}
        <div>
          <label className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold flex items-center gap-1">
            <Tag className="w-3 h-3" /> Tags
          </label>
          <Input
            data-spotlight-card-tags
            value={tagsStr}
            onChange={e => {
              setTagsStr(e.target.value);
              const tags = e.target.value.split(',').map(t => t.trim()).filter(Boolean);
              autosave({ tags });
            }}
            className="mt-1 bg-gray-800/50 border-gray-700 text-gray-100 h-9 text-sm focus:border-line"
            placeholder="comma, separated, tags"
          />
        </div>

        {/* Scripture Refs */}
        <div>
          <label className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold flex items-center gap-1">
            <BookOpen className="w-3 h-3" /> Scripture
          </label>
          <div className="mt-1 space-y-1">
            {scriptureRefs.map((ref, idx) => (
              <div key={idx} className="flex items-center justify-between bg-gray-800/50 px-2 py-1 rounded text-xs text-gray-200">
                <span>{ref}</span>
                <button onClick={() => removeScriptureRef(idx)} className="text-gray-500 hover:text-red-400">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            <div className="flex gap-1">
              <Input
                value={newRef}
                onChange={e => setNewRef(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addScriptureRef(); } }}
                className="flex-1 bg-gray-800/50 border-gray-700 text-gray-100 h-8 text-xs"
                placeholder="e.g. John 3:16"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={addScriptureRef}
                className="h-8 px-2 border-gray-700 bg-gray-800/50 hover:bg-gray-800 text-gray-300"
              >
                <Plus className="w-3 h-3" />
              </Button>
            </div>
          </div>
        </div>

      </div>
    );
  }
}

// Three-state size switch shared by both layouts.
// `iconsOnly` collapses the buttons to icons (used in the narrow inspector
// where horizontal space is limited and labels would wrap).
