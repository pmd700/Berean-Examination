import { Extension } from '@tiptap/core';
import { AllSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { expandPointerEcho } from './pointerClipboard';
import { DOMSerializer, Fragment, Slice } from '@tiptap/pm/model';
import { redo, undo } from '@tiptap/pm/history';
import {
  BLOCK_POINTER_ORIGIN,
  LIST_STYLES,
  blockSelectionAutoScrollVelocity,
  blocksIntersectingRect,
  classifyBlockPointerOrigin,
  convertDraggableBlocksToItems,
  deleteDraggableBlocks,
  getDraggableBlocks,
  hasBlockSelectionDrag,
  dropSlotAt,
  dropSlotsForDoc,
  moveDraggableBlocksToPos,
  selectedDraggableBlocks,
  usableDropSlots,
} from './blockDragModel.js';
import { announceCopy, announceCopyFailed } from '@/lib/copyFeedback';

export const blockDragPluginKey = new PluginKey('bexBlockDrag');

const EMPTY_STATE = Object.freeze({
  selected: [],
  anchor: null,
  dropSlot: null,
  // True only while a gutter drag is in flight. It is what turns the plain
  // selection highlight into the itemized-box preview.
  previewing: false,
  // How this selection was made — see SELECTION_SOURCE. A block ends up
  // selected by several different gestures, and only one of them is asking to
  // be shown the format chooser.
  source: null,
});

export const SELECTION_SOURCE = Object.freeze({
  // A press on the handle that never travelled: the user pointed at one block
  // and stopped. The only gesture the format chooser answers.
  CLICK: 'click',
  // The block was picked up and carried, during and after the move.
  DRAG: 'drag',
  // A rubber band was pulled across the gutter.
  MARQUEE: 'marquee',
});

/**
 * A modifier being pressed, rather than a command made with that modifier.
 *
 * macOS reports the bare Command key as `{ key: 'Meta', metaKey: true }` and
 * Windows/Linux do the equivalent for Control. That satisfies the same first
 * guard as Cmd/Ctrl+C, but there is no command to route yet. Treating it as a
 * formatting shortcut focuses ProseMirror, turns the selected blocks into a
 * native text range, and clears the marquee before C/X/etc. ever arrives.
 */
export function isModifierOnlyKey(event) {
  const key = String(event?.key || '').toLowerCase();
  return key === 'meta'
    || key === 'control'
    || key === 'shift'
    || key === 'alt'
    || key === 'altgraph'
    || key === 'os';
}

const HANDLE_WIDTH = 28;  // keep in step with .bex-block-drag-handle
const HANDLE_HEIGHT = 30; // keep in step with .bex-block-drag-handle
const HANDLE_GAP = 6;     // clear space between the handle and what follows it

// How far left of a block anything is allowed to reach. A toggle's chevron is
// the only thing that does, at 22px (see .toggle-block__chevron).
const MAX_GUTTER_OVERHANG = 40;

// Controls that live in the gutter and own their own clicks, so a press on
// them must never be taken as the start of a block drag.
const GUTTER_CONTROL_SELECTOR = 'button, a, input, textarea, select, [role="button"]';

/**
 * The x the drag handle should sit just left of.
 *
 * Normally that's the block's own left edge, but a toggle's chevron hangs
 * outside that edge (see .toggle-block__chevron), and a toggle nested in a
 * list sits further in again. Measuring the chevrons instead of assuming a
 * fixed offset means the handle clears them at any nesting depth — if it
 * doesn't, the handle covers the chevron and the toggle can't be clicked.
 */
function handleAnchorLeft(block) {
  let anchor = block.rect.left;
  const controlRoot = block.controlElement || block.element;
  Array.from(controlRoot?.children || [])
    .filter((child) => child.classList?.contains('toggle-block__chevron'))
    .forEach((chevron) => {
      const rect = chevron.getBoundingClientRect();
      // A chevron inside a collapsed toggle body isn't laid out, so its rect is
      // all zeros. Taking that as a position pinned the handle to x=0 and threw
      // it to the far edge of the screen.
      if (rect.width === 0 || rect.height === 0) return;
      if (rect.left < anchor) anchor = rect.left;
    });
  // Nothing legitimately hangs more than a chevron's width into the gutter;
  // anything further out is a measurement we should not trust.
  return Math.max(anchor, block.rect.left - MAX_GUTTER_OVERHANG);
}

function setPluginState(view, update) {
  view.dispatch(view.state.tr.setMeta(blockDragPluginKey, update));
}

function blockGeometry(view) {
  return getDraggableBlocks(view.state.doc).map((block) => {
    const element = elementAt(view, block.markPos);
    const controlElement = block.node.type.name === 'details'
      ? elementAt(view, block.pos)
      : element;
    return element
      ? { ...block, element, controlElement, rect: element.getBoundingClientRect() }
      : null;
  }).filter(Boolean);
}

/** Past this the ghost stops being a preview and starts being a second page. */
export const GHOST_MAX_BLOCKS = 8;

/**
 * Where the lifted copy sits, and how wide it is.
 *
 * The width is the widest block's own width so the clone wraps its lines
 * exactly where the original does, and the offset is the grab point inside the
 * run — carrying it means the block lifts off in place rather than snapping its
 * corner to the cursor, which is the difference between "I am holding this
 * paragraph" and "a label is following my mouse".
 */
export function ghostPlacement(rects, pointer) {
  if (!rects?.length) return null;
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const width = Math.max(...rects.map((rect) => rect.width));
  return { left, top, width, offsetX: pointer.clientX - left, offsetY: pointer.clientY - top };
}

/**
 * A copy of a block that is safe to park in the body.
 *
 * The live block carries editing machinery the clone must not inherit: an
 * editable clone would take a caret, duplicated ids would break every
 * `getElementById` and `aria-controls` pointing at the real one, and the
 * selection decorations would draw the purple itemized box around a thing that
 * is supposed to look lifted, not selected.
 */
export function cleanGhostClone(element) {
  const clone = element.cloneNode(true);
  clone.classList.remove('bex-block-selected', 'bex-item-box', 'bex-drop-before', 'bex-drop-after');
  clone.removeAttribute('id');
  clone.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  [clone, ...clone.querySelectorAll('[contenteditable]')].forEach((node) => {
    node.removeAttribute?.('contenteditable');
  });
  clone.querySelectorAll('.bex-block-selected, .bex-item-box').forEach((node) => {
    node.classList.remove('bex-block-selected', 'bex-item-box');
  });
  return clone;
}

function blockAtY(view, clientY) {
  const blocks = blockGeometry(view);
  if (!blocks.length) return null;
  if (clientY <= blocks[0].rect.top) return blocks[0];
  for (const block of blocks) {
    if (clientY <= block.rect.bottom) return block;
  }
  return blocks[blocks.length - 1];
}

/**
 * The page surface a marquee may be drawn on.
 *
 * This is the nearest scrolling ancestor of the editor — the pane the page is
 * laid out in — not the text column. That distinction is the whole reason the
 * gesture can be offered in the margin at all: in a note the wide empty space
 * beside the text belongs to this same pane, so dragging there is dragging on the
 * page; in a Knowledge Web card inspector the pane stops at the panel edge, so
 * the canvas beyond it is correctly out of bounds.
 */
function pageSurface(view) {
  let node = view.dom.parentElement;
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node);
    if (/(auto|scroll|overlay)/.test(`${style.overflowY} ${style.overflowX} ${style.overflow}`)) {
      return node;
    }
    node = node.parentElement;
  }
  return view.dom;
}

/** An open toggle's body takes drops; a closed one hides where they would go. */
function isOpenToggle(node) {
  return node?.type?.name === 'details' && node.attrs?.open === true;
}

/**
 * Every drop position, measured. The document decides WHERE the slots are; the
 * DOM decides what they look like, which is why the two are separate.
 */
function elementAt(view, pos) {
  const dom = view.nodeDOM(pos);
  if (dom instanceof HTMLElement) return dom;
  return dom?.parentElement instanceof HTMLElement ? dom.parentElement : null;
}

function dropSlotGeometry(view) {
  const containerBounds = new Map();
  return dropSlotsForDoc(view.state.doc, isOpenToggle).map((slot) => {
    const element = elementAt(view, slot.markPos);
    if (!element) return null;
    const rect = element.getBoundingClientRect();

    let bounds = { containerTop: -Infinity, containerBottom: Infinity };
    if (slot.containerPos != null) {
      if (!containerBounds.has(slot.containerPos)) {
        const body = elementAt(view, slot.containerPos);
        const bodyRect = body?.getBoundingClientRect();
        containerBounds.set(slot.containerPos, bodyRect
          ? { containerTop: bodyRect.top, containerBottom: bodyRect.bottom }
          : null);
      }
      bounds = containerBounds.get(slot.containerPos);
      if (!bounds) return null;
    }

    return {
      ...slot,
      ...bounds,
      top: slot.side === 'before' ? rect.top : rect.bottom,
      left: rect.left,
    };
  }).filter(Boolean);
}


class BlockDragPluginView {
  constructor(view, listStyle) {
    this.view = view;
    this.hoveredIndex = null;
    this.gestureCleanup = null;
    this.hideTimer = null;

    this.handle = document.createElement('button');
    this.handle.type = 'button';
    this.handle.className = 'bex-block-drag-handle';
    this.handle.setAttribute('aria-label', 'Drag block');
    this.handle.innerHTML = '<span></span><span></span><span></span><span></span><span></span><span></span>';
    this.handle.addEventListener('pointerenter', this.onHandleEnter);
    this.handle.addEventListener('pointerleave', this.onHandleLeave);
    this.handle.addEventListener('pointerdown', this.onHandlePointerDown);
    document.body.appendChild(this.handle);

    // One rectangle covering the whole selected run, not one per block.
    this.overlay = document.createElement('div');
    this.overlay.className = 'bex-block-drag-overlay';
    this.overlay.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.overlay);

    // Translucent copy of what's being dragged, following the pointer. The
    // clones go inside a .ProseMirror wrapper because the editor's typography
    // is written as descendant rules on that class — dropped straight into the
    // body, a cloned paragraph would lose its font, size and spacing and stop
    // resembling the thing being dragged.
    this.ghost = document.createElement('div');
    this.ghost.className = 'bex-block-drag-ghost';
    this.ghost.setAttribute('aria-hidden', 'true');
    this.ghostSurface = document.createElement('div');
    this.ghostSurface.className = 'ProseMirror bex-block-drag-ghost__surface';
    this.ghost.appendChild(this.ghostSurface);
    document.body.appendChild(this.ghost);
    this.ghostOffset = { x: 0, y: 0 };

    this.listStyle = listStyle;
    // Lets the preview marker (bullet / number / chevron) match what the
    // release will actually produce.
    this.view.dom.setAttribute('data-list-style', listStyle);
    this.view.dom.classList.add('bex-block-editor');
    this.view.dom.addEventListener('pointermove', this.onEditorPointerMove);

    this.view.dom.addEventListener('pointerleave', this.onEditorPointerLeave);
    this.view.dom.addEventListener('pointerdown', this.onEditorPointerDown, true);
    // Whole-block selection deliberately releases the text caret, so capture
    // Delete at window level before the surrounding card shortcut can see it.
    window.addEventListener('keydown', this.onBlockKeyDown, true);
    window.addEventListener('keydown', this.onEscape, true);
    window.addEventListener('keydown', this.onBlockUndo, true);
    window.addEventListener('keydown', this.onBlockEditorShortcut, true);
    document.addEventListener('copy', this.onCopy, true);
    document.addEventListener('cut', this.onCopy, true);
    document.addEventListener('pointerdown', this.onDocumentPointerDown, true);
    document.addEventListener('scroll', this.onScroll, true);
  }

  /**
   * The rubber band: a rectangle from where the drag started to where the
   * pointer is now, the way Finder draws a selection.
   *
   * This used to be the bounding box of the selected blocks instead, which is
   * why it read as one static slab laid over the whole run — it snapped to block
   * edges and so never appeared to follow the mouse at all. Which blocks are
   * caught is shown separately, by the highlight on each block.
   */
  showMarquee = (startX, startY, currentX, currentY) => {
    Object.assign(this.overlay.style, {
      left: `${Math.min(startX, currentX)}px`,
      top: `${Math.min(startY, currentY)}px`,
      width: `${Math.abs(currentX - startX)}px`,
      height: `${Math.abs(currentY - startY)}px`,
    });
    this.overlay.classList.add('is-visible');
  };

  hideOverlay = () => this.overlay.classList.remove('is-visible');

  /**
   * The block itself, lifted off the page.
   *
   * This used to be a small dark card holding the blocks' text, which read as a
   * tooltip rather than as the paragraph you picked up: different width,
   * different type size, its own border and shadow. Notion instead shows the
   * real thing at its real size, faded — so the clone below is the actual block
   * DOM, measured to the same width, and it keeps the offset you grabbed it at
   * so it lifts in place instead of jumping under the cursor.
   */
  showGhostFor = (indexes, event) => {
    const geometry = blockGeometry(this.view);
    const picked = indexes.map((index) => geometry[index]).filter(Boolean);
    if (!picked.length) return;

    const placement = ghostPlacement(picked.map((block) => block.rect), event);
    if (!placement) return;

    this.ghostSurface.replaceChildren();
    picked.slice(0, GHOST_MAX_BLOCKS).forEach((block) => {
      this.ghostSurface.appendChild(cleanGhostClone(block.element));
    });
    if (picked.length > GHOST_MAX_BLOCKS) {
      const more = document.createElement('div');
      more.className = 'bex-block-drag-ghost__more';
      more.textContent = `+${picked.length - GHOST_MAX_BLOCKS} more`;
      this.ghostSurface.appendChild(more);
    }

    this.ghost.style.width = `${placement.width}px`;
    this.ghostOffset = { x: placement.offsetX, y: placement.offsetY };
    this.ghost.classList.add('is-visible');
    this.moveGhost(event);
  };

  moveGhost = (event) => {
    const x = event.clientX - this.ghostOffset.x;
    const y = event.clientY - this.ghostOffset.y;
    this.ghost.style.transform = `translate(${x}px, ${y}px)`;
  };

  hideGhost = () => {
    this.ghost.classList.remove('is-visible');
    this.ghost.style.width = '';
    this.ghostSurface.replaceChildren();
  };

  /** Cmd+C / Cmd+X with whole blocks selected copies those blocks. */
  /**
   * Put the selected blocks on the clipboard during the browser's own copy.
   *
   * Bound on the document in the capture phase, not on the editor element. That
   * is the whole fix: a whole-block selection deliberately releases the text
   * caret, so the copy event fires against document.body and never reached a
   * listener sitting on the editor. Copying itemized blocks then fell through to
   * navigator.clipboard.write(), which cannot work here — the desktop app denies
   * every permission it is asked for (setPermissionRequestHandler in
   * desktop/main.cjs), clipboard-write included, so every itemized copy failed
   * with "permission denied". Ordinary text copying never had the problem
   * because the browser does it through this same event, which needs no
   * permission at all.
   */
  onCopy = (event) => {
    const pluginState = blockDragPluginKey.getState(this.view.state) || EMPTY_STATE;
    if (!pluginState.selected.length) return;
    // Several editors can be alive at once — a book keeps the page being turned
    // away from until its animation ends. Only the one on screen may answer.
    if (!this.view.dom.isConnected || this.view.dom.offsetParent === null) return;

    const payload = this.selectedBlockClipboardPayload();
    if (!payload || !event.clipboardData) return;

    event.clipboardData.setData('text/html', payload.html);
    event.clipboardData.setData('text/plain', payload.text);
    event.preventDefault();
    // ProseMirror keeps its own copy handler on the editor element. Ours is the
    // one that knows about the block selection, so the event stops here rather
    // than being served twice with different content.
    event.stopPropagation();

    const count = payload.blocks.length;
    announceCopy(`${event.type === 'cut' ? 'Cut' : 'Copied'} ${count} ${count === 1 ? 'block' : 'blocks'}`);

    // The default was prevented, so the browser removes nothing: a cut has to
    // take the blocks out itself, whole, exactly as Delete would.
    if (event.type === 'cut') this.deleteSelectedBlocks();
  };

  onEscape = (event) => {
    if (event.key !== 'Escape') return;
    if (this.gestureCleanup) {
      event.preventDefault();
      // Nothing has been written to the document yet, so abandoning the gesture
      // is all it takes to put things back the way they were.
      this.gestureCleanup({ commit: false });
      return;
    }
    const pluginState = blockDragPluginKey.getState(this.view.state) || EMPTY_STATE;
    if (!pluginState.selected.length) return;
    event.preventDefault();
    setPluginState(this.view, { type: 'clear' });
  };

  /**
   * Undo/redo while blocks are selected.
   *
   * A block selection deliberately releases the text caret, which blurs the
   * editor — so ProseMirror's own ⌘Z keymap no longer sees the key, and a
   * page-level ⌘Z handler that only skips contentEditable targets thinks nobody
   * is editing. On a Knowledge Web that ran the *canvas* undo instead, which
   * re-rendered the page and threw the reader back to the top.
   *
   * While this editor holds a block selection it owns ⌘Z, and it stops the event
   * so nothing further up can act on it too.
   */
  onBlockUndo = (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    if (event.key !== 'z' && event.key !== 'Z') return;

    const pluginState = blockDragPluginKey.getState(this.view.state) || EMPTY_STATE;
    if (!pluginState.selected.length) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const run = event.shiftKey ? redo : undo;
    run(this.view.state, this.view.dispatch);
  };

  /**
   * Keep modifier-key commands inside the text editor while whole blocks are
   * selected.
   *
   * A gutter selection intentionally hides and releases the text caret so
   * Backspace deletes blocks instead of one character. That leaves the
   * keyboard event targeted at document.body, however, and the surrounding
   * Knowledge Web used to mistake Cmd/Ctrl+C/X/V/A/etc. for canvas commands.
   * The editor is still the thing the user is interacting with, so restore its
   * DOM focus for the command and stop the event before the card/canvas sees it.
   */
  onBlockEditorShortcut = async (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;

    // Command/Control alone changes no selection state. Wait for the actual
    // command key — C, X, V, B, etc. — before focusing the editor or converting
    // the block selection into a text range.
    if (isModifierOnlyKey(event)) return;

    const pluginState = blockDragPluginKey.getState(this.view.state) || EMPTY_STATE;
    if (!pluginState.selected.length) return;
    if (!this.view.dom.isConnected || this.view.dom.offsetParent === null) return;

    // If the event already started inside this editor, ProseMirror and the
    // browser have the correct target and should handle it normally.
    if (this.view.dom.contains(event.target)) return;

    const key = String(event.key || '').toLowerCase();
    // Undo/redo has its own synchronous history handler immediately above.
    if (key === 'z') return;

    event.stopPropagation();
    event.stopImmediatePropagation();
    this.view.focus();

    if (key === 'a') {
      // Cmd/Ctrl+A means all text in this editor, never all cards on the web.
      event.preventDefault();
      const tr = this.view.state.tr
        .setSelection(new AllSelection(this.view.state.doc))
        .setMeta(blockDragPluginKey, { type: 'clear' });
      this.view.dispatch(tr);
      return;
    }

    // Shift is not part of copy or cut. ⌘⇧C recases the selection, and letting
    // it fall through to the re-dispatch below is what carries it into the
    // editor, where the text-case extension can answer it.
    if ((key === 'c' || key === 'x') && !event.shiftKey) {
      event.preventDefault();

      // Left to itself the browser copies nothing here. A whole-block selection
      // has deliberately released the caret, so at the moment this key was
      // pressed there was no selection to copy, and one made now arrives too
      // late for the default action — no clipboard event is fired at all.
      //
      // So the event is asked for explicitly. execCommand fires `copy`/`cut`
      // synchronously against the selection we have just made, onCopy fills it
      // with the selected blocks, and the whole thing needs no permission —
      // which matters, because navigator.clipboard is refused outright in this
      // app and was the reason copying blocks never once worked.
      this.selectBlockTextRange({ keepBlockSelection: true });
      const wrote = document.execCommand(key === 'x' ? 'cut' : 'copy');
      if (!wrote) announceCopyFailed('Could not copy those blocks');
      return;
    }

    // Pointers can target disjoint selected blocks. Let their handler read
    // the original block selection before reducing it to one text range.
    if (key === 'p' && !event.shiftKey && this.view.state.schema.marks.pointerAnchor) {
      event.preventDefault();
      this.view.someProp('handleKeyDown', handler => handler(this.view, event));
      return;
    }

    if (key === 'v') {
      this.selectBlockTextRange();
      // Leave the browser default alone: after focus moves back into the
      // editor, trusted paste keeps rich HTML/images as well as plain text.
      return;
    }

    // The original event's path was fixed when it began on document.body, so
    // focusing now is not enough for TipTap shortcuts such as Cmd+B/I/U/K/L/F.
    // Re-dispatch the same command from the editor. The target guard above
    // prevents recursion while letting ProseMirror handle it normally.
    event.preventDefault();
    this.selectBlockTextRange();
    this.view.dom.dispatchEvent(new KeyboardEvent('keydown', {
      key: event.key,
      code: event.code,
      location: event.location,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      repeat: event.repeat,
      bubbles: true,
      cancelable: true,
      composed: true,
    }));
  };

  selectBlockTextRange = ({ keepBlockSelection = false } = {}) => {
    const payload = this.selectedBlockClipboardPayload();
    if (!payload) return false;
    const first = payload.blocks[0];
    const last = payload.blocks[payload.blocks.length - 1];
    if (!first || !last) return false;

    const doc = this.view.state.doc;
    const from = Math.min(doc.content.size, first.pos + 1);
    const to = Math.max(from, Math.min(doc.content.size, last.end - 1));
    const selection = TextSelection.between(doc.resolve(from), doc.resolve(to));
    const tr = this.view.state.tr.setSelection(selection);
    // A copy needs a real selection for the browser to act on, but must keep the
    // block selection too — that is what onCopy reads to know which
    // blocks are being taken.
    if (!keepBlockSelection) tr.setMeta(blockDragPluginKey, { type: 'clear' });
    this.view.dispatch(tr);
    return true;
  };

  selectedBlockClipboardPayload = () => {
    const pluginState = blockDragPluginKey.getState(this.view.state) || EMPTY_STATE;
    if (!pluginState.selected.length) return null;

    const blocks = selectedDraggableBlocks(this.view.state.doc, pluginState.selected);
    if (!blocks.length) return null;
    const serializer = DOMSerializer.fromSchema(this.view.state.schema);
    const wrapper = document.createElement('div');
    const original = new Slice(Fragment.fromArray(blocks.map(block => block.node)), 0, 0);
    const copied = expandPointerEcho(original, this.view.state.doc);
    wrapper.appendChild(serializer.serializeFragment(copied.content));
    return {
      html: wrapper.innerHTML,
      // textBetween, not textContent: a list is a single draggable block, and
      // textContent runs every item together into one line — "…your
      // dwellingYou cannot bake or boil". Asking for the text *between* the
      // block's boundaries puts the separator back at each one, so an itemized
      // block pasted into a plain-text field arrives as a list of lines.
      text: copied.content.content
        .map(node => node.textBetween(0, node.content.size, '\n'))
        .join('\n\n'),
      blocks,
    };
  };

  deleteSelectedBlocks = () => {
    const pluginState = blockDragPluginKey.getState(this.view.state) || EMPTY_STATE;
    if (!pluginState.selected.length) return false;
    const deleted = deleteDraggableBlocks(this.view.state.tr, pluginState.selected);
    if (!deleted.changed) return false;
    deleted.tr.setMeta(blockDragPluginKey, { type: 'clear' });
    this.view.dispatch(deleted.tr.scrollIntoView());
    return true;
  };

  scheduleHide = () => {
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.hideHandle(), 120);
  };

  hideHandle = () => {
    this.handle.classList.remove('is-visible', 'is-dragging');
    this.hoveredIndex = null;
  };

  showHandleFor = (block) => {
    if (!block) return this.scheduleHide();
    clearTimeout(this.hideTimer);
    this.hoveredIndex = block.index;
    const top = block.rect.top + Math.min(8, Math.max(2, (block.rect.height - HANDLE_HEIGHT) / 2));
    // Sit outside whatever is furthest left in this block — its own edge, or
    // a toggle's chevron hanging in the gutter.
    const left = Math.max(4, handleAnchorLeft(block) - HANDLE_GAP - HANDLE_WIDTH);
    this.handle.style.left = `${left}px`;
    this.handle.style.top = `${top}px`;
    this.handle.classList.add('is-visible');
  };

  onEditorPointerMove = (event) => {
    if (this.gestureCleanup) return;
    this.showHandleFor(blockAtY(this.view, event.clientY));
  };

  onEditorPointerLeave = () => {
    if (!this.gestureCleanup) this.scheduleHide();
  };

  onHandleEnter = () => clearTimeout(this.hideTimer);
  onHandleLeave = () => {
    if (!this.gestureCleanup) this.scheduleHide();
  };

  onScroll = () => {
    if (!this.gestureCleanup) this.hideHandle();
  };

  onBlockKeyDown = (event) => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    const pluginState = blockDragPluginKey.getState(this.view.state) || EMPTY_STATE;
    if (!pluginState.selected.length) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const deleted = deleteDraggableBlocks(this.view.state.tr, pluginState.selected);
    if (!deleted.changed) return;

    deleted.tr.setMeta(blockDragPluginKey, { type: 'clear' });
    this.view.dispatch(deleted.tr.scrollIntoView());
  };

  onDocumentPointerDown = (event) => {
    if (this.handle.contains(event.target)) return;
    // The single-block format menu is portaled to document.body, outside the
    // editor DOM. Its press must not look like an outside click that clears the
    // very selection the menu is about to format.
    if (event.target?.closest?.('[data-bex-block-format-menu]')) return;

    // A press in the page margin lands outside the editor element entirely, so
    // the listener on view.dom never sees it. That is why dragging from the empty
    // space beside the text did nothing: the gesture was only ever offered from
    // the editor's own padding. Presses inside view.dom are left to
    // onEditorPointerDown so a single press is never handled twice.
    if (!this.view.dom.contains(event.target) && this.startGutterGesture(event)) return;

    const pluginState = blockDragPluginKey.getState(this.view.state) || EMPTY_STATE;
    if (!pluginState.selected.length || this.view.dom.contains(event.target)) return;
    setPluginState(this.view, { type: 'clear' });
  };

  /**
   * Begin a marquee if this press landed in the page gutter — the empty space on
   * either side of the text, anywhere within the page surface.
   *
   * Returns whether it took the event.
   */
  startGutterGesture = (event) => {
    if (event.button !== 0) return false;

    // Some controls live in the gutter themselves — a toggle's chevron hangs
    // out there. Claiming the press for a drag would preventDefault their
    // click away, which is exactly what stopped toggles from opening.
    if (event.target?.closest?.(GUTTER_CONTROL_SELECTOR)) return false;

    const surface = pageSurface(this.view);

    // The press has to land on the page surface itself. Floating UI — a comment
    // card, a menu, a dialog — is portaled to document.body, so it sits visually
    // in the margin while living outside the surface in the DOM. Without this the
    // marquee claimed those presses and preventDefault'd them, which is exactly
    // what made the comment box impossible to type in: it never took focus.
    if (!surface.contains(event.target)) return false;

    // Any other editable surface inside the page owns its own press too.
    const editable = event.target?.closest?.('[contenteditable="true"], [contenteditable=""]');
    if (editable && editable !== this.view.dom) return false;

    const surfaceRect = surface.getBoundingClientRect();

    // The full-height left and right margins belong to the writing surface,
    // even above the first block or below the last one. `blockAtY` deliberately
    // resolves those presses to the nearest edge block, so the user can begin
    // a marquee anywhere in either side panel and sweep toward the document.

    const block = blockAtY(this.view, event.clientY);
    if (!block) return false;

    const origin = classifyBlockPointerOrigin(event.clientX, {
      surfaceLeft: surfaceRect.left,
      surfaceRight: surfaceRect.right,
      blockLeft: block.rect.left,
      blockRight: block.rect.right,
    });
    if (origin !== BLOCK_POINTER_ORIGIN.SELECTION_GUTTER) return false;

    event.preventDefault();
    event.stopPropagation();
    this.beginGesture(event, 'select', block.index, {
      rowLeft: surfaceRect.left,
      rowRight: surfaceRect.right,
    });
    return true;
  };

  releaseTextCaret() {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) activeElement.blur();
    window.getSelection?.()?.removeAllRanges();
  }

  beginGesture(event, mode, initialIndex, rowBounds = {}) {
    const view = this.view;
    const startX = event.clientX;
    const startY = event.clientY;
    const pointerId = event.pointerId;
    const scrollSurface = pageSurface(view);
    const initialScrollTop = scrollSurface.scrollTop;
    let dragging = false;
    let lastDrop = null;
    let latestPointer = { clientX: startX, clientY: startY };
    let autoScrollFrame = null;
    let previousFrameTime = null;

    // Capture keeps the drag alive when the pointer leaves the editor, which
    // it will as soon as you drag up into the margin.
    try { view.dom.setPointerCapture?.(pointerId); } catch { /* not a pointer event */ }

    const visibleScrollBounds = () => {
      const rect = scrollSurface.getBoundingClientRect();
      return {
        top: Math.max(0, rect.top),
        bottom: Math.min(window.innerHeight, rect.bottom),
      };
    };

    const updateGesture = ({ clientX, clientY }) => {
      if (mode === 'select') {
        // The first marquee point belongs to the document, not permanently to
        // one viewport pixel. Move it by the pane's scroll delta so blocks that
        // leave the screen remain selected while new blocks arrive below.
        const adjustedStartY = startY - (scrollSurface.scrollTop - initialScrollTop);
        const marquee = {
          left: startX,
          top: adjustedStartY,
          right: clientX,
          bottom: clientY,
        };
        const indexes = blocksIntersectingRect(blockGeometry(view), marquee, rowBounds);
        setPluginState(view, {
          type: 'selection',
          selected: indexes,
          anchor: initialIndex,
          previewing: true,
          source: SELECTION_SOURCE.MARQUEE,
        });
        this.showMarquee(startX, adjustedStartY, clientX, clientY);
        return;
      }

      this.moveGhost({ clientX, clientY });
      const dragged = blockDragPluginKey.getState(view.state)?.selected || [];
      const blocks = selectedDraggableBlocks(view.state.doc, dragged);
      const first = blocks[0];
      const last = blocks[blocks.length - 1];
      const slots = first && last
        ? usableDropSlots(dropSlotGeometry(view), first.pos, last.end)
        : dropSlotGeometry(view);
      const dropSlot = dropSlotAt(slots, clientY);
      if (dropSlot?.pos !== lastDrop?.pos) {
        lastDrop = dropSlot;
        setPluginState(view, { type: 'drop', dropSlot });
      }
    };

    const runAutoScroll = (frameTime) => {
      if (!dragging) return;
      const elapsed = previousFrameTime == null
        ? 16
        : Math.min(40, Math.max(0, frameTime - previousFrameTime));
      previousFrameTime = frameTime;

      const velocity = blockSelectionAutoScrollVelocity(
        latestPointer.clientY,
        visibleScrollBounds(),
      );
      if (velocity !== 0) {
        const before = scrollSurface.scrollTop;
        scrollSurface.scrollTop += velocity * (elapsed / 1000);
        if (scrollSurface.scrollTop !== before) updateGesture(latestPointer);
      }
      autoScrollFrame = window.requestAnimationFrame(runAutoScroll);
    };

    const onMove = (moveEvent) => {
      latestPointer = { clientX: moveEvent.clientX, clientY: moveEvent.clientY };
      if (!dragging && !hasBlockSelectionDrag(
        startX,
        startY,
        moveEvent.clientX,
        moveEvent.clientY,
      )) return;

      if (!dragging) {
        dragging = true;
        previousFrameTime = null;
        autoScrollFrame = window.requestAnimationFrame(runAutoScroll);
        document.body.classList.add('bex-is-dragging-blocks');
        this.releaseTextCaret();
        if (mode === 'drag') {
          const state = blockDragPluginKey.getState(view.state) || EMPTY_STATE;
          if (!state.selected.includes(initialIndex)) {
            setPluginState(view, {
              type: 'selection',
              selected: [initialIndex],
              anchor: initialIndex,
              source: SELECTION_SOURCE.DRAG,
            });
          }
          this.handle.classList.add('is-dragging');
          const dragged = blockDragPluginKey.getState(view.state) || EMPTY_STATE;
          this.showGhostFor(
            dragged.selected.length ? dragged.selected : [initialIndex],
            moveEvent,
          );
        }
      }

      moveEvent.preventDefault();
      updateGesture(latestPointer);
    };

    const finish = (upEvent, options = {}) => {
      upEvent?.preventDefault?.();
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', cancel, true);
      if (autoScrollFrame != null) window.cancelAnimationFrame(autoScrollFrame);
      autoScrollFrame = null;
      this.gestureCleanup = null;
      this.handle.classList.remove('is-dragging');
      document.body.classList.remove('bex-is-dragging-blocks');
      this.hideOverlay();
      this.hideGhost();
      try { this.view.dom.releasePointerCapture?.(pointerId); } catch { /* already released */ }

      const pluginState = blockDragPluginKey.getState(view.state) || EMPTY_STATE;

      // A gutter drag turns the run it covered into one list. Escape and
      // pointercancel come through here with commit:false, which leaves the
      // document exactly as it was — nothing was written during the drag.
      if (mode === 'select') {
        const commit = options.commit !== false && dragging && pluginState.selected.length > 1;
        if (commit) {
          const converted = convertDraggableBlocksToItems(
            view.state.tr,
            pluginState.selected,
            this.listStyle,
            view.state.schema,
          );
          if (converted.changed) {
            converted.tr.setMeta(blockDragPluginKey, { type: 'clear' });
            view.dispatch(converted.tr.scrollIntoView());
            this.scheduleHide();
            return;
          }
        }
        // Nothing converted: keep the blocks selected, drop the preview styling.
        setPluginState(view, {
          type: 'selection',
          selected: options.commit === false ? [] : pluginState.selected,
          anchor: pluginState.anchor,
          previewing: false,
          source: SELECTION_SOURCE.MARQUEE,
        });
        this.scheduleHide();
        return;
      }
      // A press on the handle that never travelled far enough to become a drag
      // opens the format menu. When that handle belongs to an existing marquee
      // selection, keep the entire selection: collapsing it to the clicked row
      // made a multi-paragraph Quote command affect only the first paragraph.
      if (mode === 'drag' && !dragging) {
        // The caret has to go: with it still blinking inside the block, Delete
        // would take one character instead of the highlighted block.
        this.releaseTextCaret();
        const keepMarqueeSelection = pluginState.selected.length > 1
          && pluginState.selected.includes(initialIndex);
        setPluginState(view, {
          type: 'selection',
          selected: keepMarqueeSelection ? pluginState.selected : [initialIndex],
          anchor: initialIndex,
          previewing: false,
          source: SELECTION_SOURCE.CLICK,
        });
        // No scheduleHide here — the pointer is still resting on the handle, so
        // hiding it now would make it vanish under the cursor.
        return;
      }

      if (mode === 'drag' && dragging && pluginState.selected.length && pluginState.dropSlot) {
        const moved = moveDraggableBlocksToPos(
          view.state.tr,
          pluginState.selected,
          pluginState.dropSlot,
        );
        if (moved.changed) {
          const movedBlocks = getDraggableBlocks(moved.tr.doc);
          const selected = moved.selectedPositions
            .map((pos) => movedBlocks.find((block) => block.pos === pos)?.index)
            .filter(Number.isInteger);
          moved.tr.setMeta(blockDragPluginKey, selected.length
            ? { type: 'moved', selected, anchor: selected[0] }
            : { type: 'clear' });
          view.dispatch(moved.tr.scrollIntoView());
        } else {
          setPluginState(view, { type: 'drop', dropSlot: null });
        }
      } else if (pluginState.dropSlot) {
        setPluginState(view, { type: 'drop', dropSlot: null });
      }
      this.scheduleHide();
    };

    const cancel = (options = {}) => {
      finish(null, { commit: false, ...options });
    };

    this.gestureCleanup = cancel;
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', cancel, true);
  }

  onHandlePointerDown = (event) => {
    if (event.button !== 0 || this.hoveredIndex == null) return;
    event.preventDefault();
    event.stopPropagation();
    this.beginGesture(event, 'drag', this.hoveredIndex);
  };

  onEditorPointerDown = (event) => {
    if (event.button !== 0) return;
    // Presses inside the editor can still land in a gutter when the editor
    // carries its own left padding.
    if (this.startGutterGesture(event)) return;

    // Starting inside text is always ordinary text/caret selection. We do not
    // prevent the browser event; we only clear an earlier block selection.
    const current = blockDragPluginKey.getState(this.view.state) || EMPTY_STATE;
    if (current.selected.length) setPluginState(this.view, { type: 'clear' });
  };

  update() {
    const pluginState = blockDragPluginKey.getState(this.view.state) || EMPTY_STATE;
    this.view.dom.classList.toggle('bex-block-selection-active', pluginState.selected.length > 0);
    if (this.hoveredIndex == null || this.gestureCleanup) return;
    const block = blockGeometry(this.view).find((item) => item.index === this.hoveredIndex);
    if (block) this.showHandleFor(block);
  }

  destroy() {
    clearTimeout(this.hideTimer);
    this.gestureCleanup?.();
    this.view.dom.classList.remove('bex-block-editor');
    this.view.dom.removeEventListener('pointermove', this.onEditorPointerMove);
    this.view.dom.removeEventListener('pointerleave', this.onEditorPointerLeave);
    this.view.dom.removeEventListener('pointerdown', this.onEditorPointerDown, true);
    this.view.dom.classList.remove('bex-block-selection-active');
    window.removeEventListener('keydown', this.onBlockKeyDown, true);
    window.removeEventListener('keydown', this.onEscape, true);
    window.removeEventListener('keydown', this.onBlockUndo, true);
    window.removeEventListener('keydown', this.onBlockEditorShortcut, true);
    document.removeEventListener('pointerdown', this.onDocumentPointerDown, true);
    document.removeEventListener('scroll', this.onScroll, true);
    this.handle.removeEventListener('pointerenter', this.onHandleEnter);
    this.handle.removeEventListener('pointerleave', this.onHandleLeave);
    this.handle.removeEventListener('pointerdown', this.onHandlePointerDown);
    document.removeEventListener('copy', this.onCopy, true);
    document.removeEventListener('cut', this.onCopy, true);
    this.handle.remove();
    this.overlay.remove();
    this.ghost.remove();
  }
}

export const BlockDrag = Extension.create({
  name: 'bexBlockDrag',

  addOptions() {
    return {
      // What a gutter drag turns the blocks it covered into on release.
      //
      // Default is 'none': dragging selects blocks and previews them, but
      // changes nothing. Converting on every marquee meant an ordinary
      // select-to-delete or select-to-copy silently rewrote the document into
      // a bullet list — including a bullet for every blank line.
      // Set 'bulleted' | 'numbered' | 'toggle' to turn the conversion back on.
      listStyle: LIST_STYLES.NONE,
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: blockDragPluginKey,
        state: {
          init: () => EMPTY_STATE,
          apply(tr, previous) {
            const meta = tr.getMeta(blockDragPluginKey);
            if (meta?.type === 'selection') {
              return {
                selected: meta.selected,
                anchor: meta.anchor,
                dropSlot: null,
                previewing: meta.previewing === true,
                source: meta.source ?? null,
              };
            }
            if (meta?.type === 'drop') return { ...previous, dropSlot: meta.dropSlot };
            if (meta?.type === 'moved') {
              // The blocks stay selected where they landed, but the gesture was
              // a carry — the chooser must not appear at the end of a drag.
              return {
                selected: meta.selected,
                anchor: meta.anchor,
                dropSlot: null,
                previewing: false,
                source: SELECTION_SOURCE.DRAG,
              };
            }
            if (meta?.type === 'clear' || tr.docChanged) return EMPTY_STATE;
            return previous;
          },
        },
        props: {
          decorations(state) {
            const pluginState = blockDragPluginKey.getState(state) || EMPTY_STATE;
            const selected = new Set(pluginState.selected);
            const blocks = getDraggableBlocks(state.doc);
            // While dragging, a selected block also renders as an itemized
            // row — bullet gutter and all — so the list you are about to get
            // is visible before you let go.
            let row = 0;
            const decorations = blocks.map((block) => {
              const isSelected = selected.has(block.index);
              const classes = ['bex-draggable-block'];
              if (isSelected) classes.push('bex-block-selected');
              const attrs = { class: classes.join(' ') };
              if (isSelected && pluginState.previewing) {
                row += 1;
                classes.push('bex-item-box');
                attrs.class = classes.join(' ');
                attrs['data-item-row'] = String(row);
              }
              return Decoration.node(block.markPos, block.markEnd, attrs);
            });

            const { dropSlot } = pluginState;
            if (dropSlot && dropSlot.markEnd <= state.doc.content.size) {
              // The slot names the node to mark and which of its edges, so a
              // block inside a toggle draws the same line as a top-level one.
              decorations.push(Decoration.node(dropSlot.markPos, dropSlot.markEnd, {
                class: dropSlot.side === 'after' ? 'bex-drop-after' : 'bex-drop-before',
              }));
            }
            return DecorationSet.create(state.doc, decorations);
          },
        },
        view: (view) => new BlockDragPluginView(view, this.options.listStyle),
      }),
    ];
  },
});
