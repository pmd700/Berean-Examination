import React from 'react';
import ReactDOM from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Pencil, Trash2, Check, X } from 'lucide-react';
import { collectComments, getCommentState } from './CommentExtension';
import {
  bundleNearbyComments,
  ESTIMATED_COMMENT_CARD_HEIGHT,
} from './commentLayoutModel';
import LogicRichHtml from '../logic/LogicRichHtml';
import TEXT_EDITOR_MACHINERY from './TEXT_EDITOR_MACHINERY';
import { useIsActiveTab } from '@/lib/WorkspaceTabs';

const EDITING_WIDTH = 264;  // room to actually write in
const MAX_WIDTH = 280;      // a saved card never grows past this
const GAP = 16;             // between the text column and the cards
const STACK_GAP = 8;        // between two cards
const TAIL_GAP = 24;        // breathing room below the final comment
const COLLAPSED_BODY_HEIGHT = 120;
const scrollOwnerCache = new WeakMap();

function sameIds(left, right) {
  if (left.size !== right.size) return false;
  for (const id of left) if (!right.has(id)) return false;
  return true;
}

function scrollViewportOwner(spacer) {
  let owner = scrollOwnerCache.get(spacer);
  if (!owner?.isConnected) {
    owner = null;
    let ancestor = spacer.parentElement;
    while (ancestor) {
      const overflowY = window.getComputedStyle(ancestor).overflowY;
      if (/auto|scroll|overlay/.test(overflowY)) {
        owner = ancestor;
        break;
      }
      ancestor = ancestor.parentElement;
    }
    if (owner) scrollOwnerCache.set(spacer, owner);
  }

  return owner;
}

function scrollViewportHeight(spacer) {
  const owner = scrollViewportOwner(spacer);
  const ownerHeight = owner?.clientHeight || owner?.getBoundingClientRect?.().height || 0;
  return ownerHeight > 0 ? ownerHeight : Math.max(0, window.innerHeight || 0);
}

function setTailSpace(tailSpacerRef, commentHeight) {
  const spacer = tailSpacerRef?.current;
  if (!spacer) return;
  // One viewport is the normal reading runway: it lets the document's final
  // line move completely above the viewport, then scrolling stops. A comment
  // may extend that runway only when its own overflow is genuinely longer.
  const naturalHeight = spacer.dataset.scrollPastEnd === 'true'
    ? scrollViewportHeight(spacer)
    : 0;
  const nextHeight = `${Math.max(0, Math.ceil(naturalHeight), Math.ceil(commentHeight))}px`;
  if (spacer.style.height !== nextHeight) spacer.style.height = nextHeight;
}

function renderedCommentAnchors(editorDom) {
  const anchors = new Map();
  editorDom.querySelectorAll('[data-comment-id]').forEach((element) => {
    let ancestor = element.parentElement;
    let hiddenByToggle = false;
    while (ancestor && ancestor !== editorDom) {
      if (ancestor.classList.contains('toggle-block__body')) {
        const toggle = ancestor.closest('.toggle-block');
        if (ancestor.hidden || !toggle?.classList.contains('is-open')) {
          hiddenByToggle = true;
          break;
        }
      }
      ancestor = ancestor.parentElement;
    }
    if (hiddenByToggle) return;

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) return;
    const id = element.getAttribute('data-comment-id');
    if (!id) return;
    const previous = anchors.get(id);
    if (!previous || rect.top < previous.top) anchors.set(id, rect);
  });
  return anchors;
}

const groupKey = (ids) => ids.join('|');

/** A comment body is "empty" when it's blank or just an empty paragraph. */
export function isEmptyBody(html) {
  return !String(html || '').replace(/<[^>]*>/g, '').replace(/&nbsp;|\s/g, '').length
    && !/<(img|hr|table)\b/i.test(String(html || ''));
}

/**
 * Comment cards in the margin beside the text they belong to.
 *
 * Positions are written straight to the DOM rather than held in React state:
 * a scroll listener that re-renders lands a frame late, which is what made the
 * cards swim behind the text. Writing `style.top` inside the scroll event puts
 * them in the same frame as the text they're bolted to.
 */
export default function CommentSidebar({ editor, anchorRef, tailSpacerRef }) {
  const isActiveTab = useIsActiveTab();
  const [comments, setComments] = React.useState([]);
  const [activeId, setActiveId] = React.useState(null);
  const [draftId, setDraftId] = React.useState(null);
  const [editingId, setEditingId] = React.useState(null);
  const [value, setValue] = React.useState('');
  const [expandedIds, setExpandedIds] = React.useState(() => new Set());
  const [collapsibleIds, setCollapsibleIds] = React.useState(() => new Set());
  const [layoutGroups, setLayoutGroups] = React.useState(null);
  const [expandedBundles, setExpandedBundles] = React.useState(() => new Set());
  const cardRefs = React.useRef(new Map());
  const bodyRefs = React.useRef(new Map());
  const bundleRefs = React.useRef(new Map());
  const cardHeightCacheRef = React.useRef(new Map());
  const groupHeightCacheRef = React.useRef(new Map());
  const layoutSignatureRef = React.useRef('');

  React.useEffect(() => {
    if (!editor) return undefined;
    let previousDoc = null;
    const sync = () => {
      // Selection/meta transactions keep the same immutable ProseMirror doc.
      // Keep syncing active/draft state without rescanning all written text or
      // replacing the comment list on every caret movement.
      if (editor.state.doc !== previousDoc) {
        previousDoc = editor.state.doc;
        setComments(collectComments(previousDoc));
      }
      const { activeId: nextActive, draftId: nextDraft } = getCommentState(editor.state);
      setActiveId(nextActive);
      setDraftId(nextDraft);
    };
    sync();
    editor.on('transaction', sync);
    return () => { editor.off('transaction', sync); };
  }, [editor]);

  // A freshly made comment opens straight into writing.
  React.useEffect(() => {
    if (!draftId) return;
    setEditingId(draftId);
    setValue('');
    editor?.commands.clearCommentDraft();
  }, [draftId, editor]);

  const measureCommentBodies = React.useCallback(() => {
    const liveIds = new Set(comments.map(comment => comment.id));
    setCollapsibleIds((current) => {
      const next = new Set([...current].filter(id => liveIds.has(id)));
      comments.forEach((comment) => {
        const body = bodyRefs.current.get(comment.id);
        if (!body) return;
        if (body.scrollHeight > COLLAPSED_BODY_HEIGHT + 1) next.add(comment.id);
        else next.delete(comment.id);
      });
      return sameIds(current, next) ? current : next;
    });
  }, [comments]);

  // Only long comments get disclosure controls. Measuring their rendered HTML
  // handles headings, lists, quotes and images correctly instead of guessing
  // from source-text length.
  React.useLayoutEffect(() => {
    if (!isActiveTab || comments.length === 0) return undefined;
    const frame = requestAnimationFrame(measureCommentBodies);
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(measureCommentBodies);
    bodyRefs.current.forEach((body) => observer?.observe(body));
    window.addEventListener('resize', measureCommentBodies);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', measureCommentBodies);
    };
  }, [isActiveTab, comments.length, editingId, expandedBundles, expandedIds, layoutGroups, measureCommentBodies]);

  const toggleExpanded = (id) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleBundle = (key) => {
    setExpandedBundles((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Clicking commented text should reveal its comment even when that comment
  // lives inside a dense bundle.
  React.useEffect(() => {
    const targetId = editingId || activeId;
    if (!targetId || !layoutGroups) return;
    const group = layoutGroups.find(item => item.ids.length > 1 && item.ids.includes(targetId));
    if (!group) return;
    const key = groupKey(group.ids);
    setExpandedBundles((current) => {
      if (current.has(key)) return current;
      const next = new Set(current);
      next.add(key);
      return next;
    });
  }, [activeId, editingId, layoutGroups]);

  // Place every card at its actual rendered comment mark. Dense runs become a
  // single bundle instead of pushing later cards away from their parent text.
  const position = React.useCallback(() => {
    const host = anchorRef?.current;
    if (!editor || !host || !editor.view?.dom?.isConnected) return;

    cardRefs.current.forEach((element) => {
      if (element) element.style.visibility = 'hidden';
    });
    bundleRefs.current.forEach((element) => {
      if (element) element.style.visibility = 'hidden';
    });

    if (comments.length === 0) {
      setTailSpace(tailSpacerRef, 0);
      return;
    }
    // Cards portal to <body>, so an editor sitting in a hidden background tab
    // would otherwise float its comments over the tab you're looking at.
    if (host.offsetParent === null) {
      setTailSpace(tailSpacerRef, 0);
      return;
    }
    const hostRect = host.getBoundingClientRect();

    let left = hostRect.right + GAP;
    if (left + MAX_WIDTH > window.innerWidth - 12) {
      left = Math.max(12, window.innerWidth - MAX_WIDTH - 12);
    }

    const anchors = renderedCommentAnchors(editor.view.dom);
    const items = comments.flatMap((comment) => {
      const anchor = anchors.get(comment.id);
      if (!anchor) return [];

      const card = cardRefs.current.get(comment.id);
      if (card?.offsetHeight > 0) {
        cardHeightCacheRef.current.set(comment.id, card.offsetHeight);
      }
      return [{
        id: comment.id,
        anchorTop: anchor.top,
        height: cardHeightCacheRef.current.get(comment.id)
          || ESTIMATED_COMMENT_CARD_HEIGHT,
      }];
    });
    const groups = bundleNearbyComments(items, { gap: STACK_GAP });
    const signature = groups.map(group => groupKey(group.ids)).join(';');
    if (signature !== layoutSignatureRef.current || layoutGroups === null) {
      layoutSignatureRef.current = signature;
      setLayoutGroups(groups.map(group => ({ ids: group.ids })));
    }

    let finalBottom = -Infinity;
    groups.forEach((group) => {
      const key = groupKey(group.ids);
      const isBundle = group.ids.length > 1;
      const element = isBundle
        ? bundleRefs.current.get(key)
        : cardRefs.current.get(group.ids[0]);
      if (!element) return;

      element.style.visibility = '';
      const topPx = `${group.anchorTop}px`;
      const leftPx = `${left}px`;
      if (element.style.top !== topPx) element.style.top = topPx;
      if (element.style.left !== leftPx) element.style.left = leftPx;

      if (element.offsetHeight > 0) {
        if (isBundle) groupHeightCacheRef.current.set(key, element.offsetHeight);
        else cardHeightCacheRef.current.set(group.ids[0], element.offsetHeight);
      }
      const fallbackHeight = isBundle ? 36 : ESTIMATED_COMMENT_CARD_HEIGHT;
      const height = (isBundle
        ? groupHeightCacheRef.current.get(key)
        : cardHeightCacheRef.current.get(group.ids[0])) || fallbackHeight;
      finalBottom = Math.max(finalBottom, group.anchorTop + height);
    });

    // The cards portal to <body>, so their height is invisible to every
    // scroll container around the editor. Extend the in-flow editor content by
    // exactly the amount the stacked comments continue past the written text.
    // Because this measures the ProseMirror bottom (not the spacer's bottom),
    // the value is stable rather than feeding back into itself.
    const contentBottom = editor.view.dom.getBoundingClientRect().bottom;
    const tailSpace = Number.isFinite(finalBottom)
      ? finalBottom - contentBottom + TAIL_GAP
      : 0;
    setTailSpace(tailSpacerRef, tailSpace);
  }, [editor, anchorRef, comments, layoutGroups, tailSpacerRef]);

  // Re-place the cards every frame.
  //
  // Listening for `scroll` is the obvious approach and it's what made these
  // swim behind the text: scroll events are coalesced and delivered on their
  // own schedule, and any handler that routes through React state lands a
  // frame late. A rAF loop runs immediately before every paint instead, so a
  // card is drawn at its anchor's new position in the very same frame the text
  // moves — and it covers scrolling of any ancestor pane, window resizes and
  // cards growing as you type, without listening for any of them.
  React.useLayoutEffect(() => {
    // Most editors have no margin comments. Their natural reading runway only
    // depends on viewport size, so it needs resize notifications, not a 60 Hz
    // polling loop. Background tabs keep their editor mounted but must not
    // poll layout or leave body-portaled comments above the active workspace.
    if (!editor || !isActiveTab || comments.length === 0) {
      setTailSpace(tailSpacerRef, 0);
      if (!editor || !isActiveTab) return undefined;
      const resize = () => setTailSpace(tailSpacerRef, 0);
      const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
      const owner = tailSpacerRef?.current && scrollViewportOwner(tailSpacerRef.current);
      if (owner) observer?.observe(owner);
      window.addEventListener('resize', resize);
      return () => {
        observer?.disconnect();
        window.removeEventListener('resize', resize);
      };
    }
    let frame = 0;
    const tick = () => {
      position();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    position();
    return () => {
      cancelAnimationFrame(frame);
      setTailSpace(tailSpacerRef, 0);
    };
  }, [editor, isActiveTab, comments.length, position, tailSpacerRef]);

  if (!editor || comments.length === 0 || !isActiveTab) return null;

  const startEditing = (comment) => {
    setEditingId(comment.id);
    setValue(comment.text || '');
    editor.commands.setActiveComment(comment.id);
  };

  const save = (comment) => {
    if (isEmptyBody(value)) {
      editor.commands.removeComment(comment.id);
    } else {
      editor.commands.updateComment(comment.id, value);
    }
    setEditingId(null);
    setValue('');
    editor.commands.focus();
  };

  const cancel = (comment) => {
    // Backing out of a brand-new comment removes the highlight too.
    if (isEmptyBody(comment.text)) editor.commands.removeComment(comment.id);
    setEditingId(null);
    setValue('');
    editor.commands.focus();
  };

  const focusComment = (comment) => {
    if (activeId !== comment.id) editor.commands.setActiveComment(comment.id);
  };

  const renderCommentContents = (comment, isActive, grouped = false) => {
    const isEditing = comment.id === editingId;
    const isExpanded = expandedIds.has(comment.id);
    const isCollapsible = collapsibleIds.has(comment.id);

    if (isEditing) {
      return (
        <div className="p-2">
          <div
            className="bex-comment-editor rounded-md border border-line bg-[#05070B] px-2 py-1.5"
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Escape') { event.preventDefault(); cancel(comment); }
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                save(comment);
              }
            }}
            data-testid="input-comment-text"
          >
            <TEXT_EDITOR_MACHINERY
              nested
              bare
              content={value}
              onChange={setValue}
              placeholder="Write a comment…"
            />
          </div>
          <div className="mt-1.5 flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => cancel(comment)}
              className="h-6 w-6 grid place-items-center rounded text-ink-soft hover:bg-white/[0.07] hover:text-white transition-colors"
              title="Cancel (Esc)"
              data-testid="button-comment-cancel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => save(comment)}
              className="h-6 w-6 grid place-items-center rounded bg-violet-600/80 text-white hover:bg-violet-600 active:scale-95 transition-all"
              title="Save (⌘↵)"
              data-testid="button-comment-save"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      );
    }

    return (
      <>
        {grouped && (
          <button
            type="button"
            onClick={() => focusComment(comment)}
            className="block w-full truncate border-b border-line/60 px-2.5 py-1.5 text-left text-[10px] font-medium text-violet-300/80 hover:bg-white/[0.04]"
            title={comment.quote || 'Commented text'}
          >
            “{comment.quote || 'Commented text'}”
          </button>
        )}
        <div className="relative">
          <div
            ref={(node) => {
              if (node) bodyRefs.current.set(comment.id, node);
              else bodyRefs.current.delete(comment.id);
            }}
            id={`comment-body-${comment.id}`}
            data-comment-body
            className="bex-comment-body overflow-hidden px-2.5 py-2 text-[12px] leading-snug text-ink"
            style={{ maxHeight: isExpanded ? 'none' : COLLAPSED_BODY_HEIGHT }}
          >
            <LogicRichHtml content={comment.text} />
          </div>
          {isCollapsible && !isExpanded && (
            <div
              aria-hidden="true"
              className={`pointer-events-none absolute inset-x-0 bottom-0 h-9 bg-gradient-to-t to-transparent ${
                isActive ? 'from-[#171526]' : 'from-surface'
              }`}
            />
          )}
        </div>

        {isCollapsible && (
          <button
            type="button"
            aria-expanded={isExpanded}
            aria-controls={`comment-body-${comment.id}`}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => toggleExpanded(comment.id)}
            className="flex w-full items-center justify-center gap-1 border-t border-line/70 px-2.5 py-1.5 text-[11px] font-medium text-ink-soft transition-colors hover:bg-white/[0.05] hover:text-white"
            data-testid={`button-comment-toggle-${comment.id}`}
          >
            {isExpanded ? 'Show less' : 'Show more'}
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              strokeWidth={1.8}
            />
          </button>
        )}

        <div className="absolute -top-2.5 right-1 flex items-center gap-0.5 rounded-md border border-line bg-surface px-0.5 py-0.5 opacity-0 shadow-lg transition-opacity group-hover/comment:opacity-100">
          <button
            type="button"
            onClick={() => startEditing(comment)}
            className="h-5 w-5 grid place-items-center rounded text-ink-soft hover:bg-white/[0.07] hover:text-white transition-colors"
            title="Edit comment"
            data-testid="button-comment-edit"
          >
            <Pencil className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => editor.commands.removeComment(comment.id)}
            className="h-5 w-5 grid place-items-center rounded text-ink-soft hover:bg-red-500/15 hover:text-red-400 transition-colors"
            title="Delete comment"
            data-testid="button-comment-delete"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </>
    );
  };

  return ReactDOM.createPortal((
    <div className="fixed inset-0 pointer-events-none z-[60]" data-testid="sidebar-comments">
      <AnimatePresence initial={false}>
        {comments.map((comment) => {
          const group = layoutGroups?.find(item => item.ids.includes(comment.id));
          if (!group || group.ids.length !== 1) return null;
          const isActive = comment.id === activeId;
          const isEditing = comment.id === editingId;

          return (
            <motion.div
              key={comment.id}
              ref={(node) => {
                if (node) cardRefs.current.set(comment.id, node);
                else cardRefs.current.delete(comment.id);
              }}
              initial={{ opacity: 0, x: 10, scale: 0.97 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 10, scale: 0.97, transition: { duration: 0.12 } }}
              transition={{ type: 'spring', stiffness: 520, damping: 34, mass: 0.6 }}
              onMouseDown={() => focusComment(comment)}
              className={`group/comment pointer-events-auto absolute rounded-lg border shadow-[0_10px_30px_-10px_rgba(0,0,0,0.7)] transition-colors ${
                isActive ? 'border-violet-500/50 bg-[#171526]' : 'border-line bg-surface hover:border-[#3A4258]'
              }`}
              style={{
                // Shrink to the words it holds; only a long comment reaches
                // the cap. While writing it keeps a steady, usable width.
                width: isEditing ? EDITING_WIDTH : 'max-content',
                maxWidth: MAX_WIDTH,
                minWidth: isEditing ? EDITING_WIDTH : 92,
              }}
              data-testid={`card-comment-${comment.id}`}
            >
              {/* Arrow back to the commented text. */}
              <span
                data-comment-arrow
                className={`absolute -left-[5px] h-2 w-2 rotate-45 border-b border-l transition-colors ${
                  isActive ? 'border-violet-500/50 bg-[#171526]' : 'border-line bg-surface'
                }`}
                aria-hidden="true"
              />

              {renderCommentContents(comment, isActive)}
            </motion.div>
          );
        })}

        {(layoutGroups || []).filter(group => group.ids.length > 1).map((group) => {
          const key = groupKey(group.ids);
          const isExpanded = expandedBundles.has(key);
          const groupedComments = group.ids
            .map(id => comments.find(comment => comment.id === id))
            .filter(Boolean);
          const hasActiveComment = groupedComments.some(comment => comment.id === activeId);

          return (
            <motion.div
              key={key}
              ref={(node) => {
                if (node) bundleRefs.current.set(key, node);
                else bundleRefs.current.delete(key);
              }}
              initial={{ opacity: 0, x: 10, scale: 0.97 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 10, scale: 0.97, transition: { duration: 0.12 } }}
              transition={{ type: 'spring', stiffness: 520, damping: 34, mass: 0.6 }}
              className={`pointer-events-auto absolute w-[280px] rounded-lg border bg-surface shadow-[0_10px_30px_-10px_rgba(0,0,0,0.7)] ${
                hasActiveComment ? 'border-violet-500/50' : 'border-line'
              }`}
              data-testid={`bundle-comments-${group.ids[0]}`}
            >
              <span
                aria-hidden="true"
                className={`absolute -left-[5px] top-3 h-2 w-2 rotate-45 border-b border-l ${
                  hasActiveComment ? 'border-violet-500/50 bg-surface' : 'border-line bg-surface'
                }`}
              />
              <button
                type="button"
                aria-expanded={isExpanded}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => toggleBundle(key)}
                className={`flex w-full items-center justify-between gap-3 rounded-t-lg px-3 py-2 text-left text-xs font-semibold text-violet-200 transition-colors hover:bg-white/[0.05] ${
                  isExpanded ? '' : 'rounded-b-lg'
                }`}
                data-testid={`button-comment-bundle-${group.ids[0]}`}
              >
                <span>{isExpanded ? `Hide ${group.ids.length} comments` : `See ${group.ids.length}+ comments`}</span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  strokeWidth={1.8}
                />
              </button>

              {isExpanded && (
                <div className="max-h-[min(60vh,520px)] space-y-2 overflow-y-auto rounded-b-lg border-t border-line/70 p-2">
                  {groupedComments.map((comment) => {
                    const isActive = comment.id === activeId;
                    return (
                      <div
                        key={comment.id}
                        onMouseDown={() => focusComment(comment)}
                        className={`group/comment relative rounded-md border ${
                          isActive
                            ? 'border-violet-500/50 bg-[#171526]'
                            : 'border-line/80 bg-[#11141B] hover:border-[#3A4258]'
                        }`}
                        data-testid={`card-comment-${comment.id}`}
                      >
                        {renderCommentContents(comment, isActive, true)}
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  ), document.body);
}
