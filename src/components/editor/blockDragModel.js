import { Fragment } from '@tiptap/pm/model';
import { Transform } from '@tiptap/pm/transform';

const isList = (node) => ['bulletList', 'orderedList'].includes(node?.type?.name);

export function getTopLevelBlocks(doc) {
  const blocks = [];
  doc.forEach((node, pos, index) => {
    blocks.push({ node, pos, end: pos + node.nodeSize, index });
  });
  return blocks;
}

const defaultOpenContainer = (node) => (
  node?.type?.name === 'details' && node.attrs?.open === true
);

/**
 * Every visible block row in document order.
 *
 * A toggle is a parent block whose selectable row is its summary. When it is
 * open, the blocks in its detailsContent are rows in their own right, and the
 * same rule recurses through nested toggles. Positions still name the complete
 * document nodes, while markPos/markEnd name the DOM row that receives block
 * chrome (the summary for a toggle, the node itself for everything else).
 * Lists contribute their individual entries rather than a row spanning the
 * entire list. An entry keeps its attached quotation and continuation blocks.
 */
export function getDraggableBlocks(doc, isOpenContainer = defaultOpenContainer) {
  const blocks = [];

  const walk = (container, contentStart, depth, containerPos) => {
    container.forEach((node, offset, siblingIndex) => {
      const pos = contentStart + offset;
      const end = pos + node.nodeSize;
      // A list is layout for several entries, not one enormous selectable row.
      // Keep each item's attached quotation/sub-blocks with that entry, just as
      // moving/copying the bullet should keep its complete text and formatting.
      if (isList(node)) {
        walk(node, pos + 1, depth + 1, pos);
        return;
      }
      const isToggle = node.type.name === 'details';
      const summary = isToggle ? node.firstChild : null;
      const markPos = summary ? pos + 1 : pos;
      const markEnd = summary ? markPos + summary.nodeSize : end;

      blocks.push({
        node,
        pos,
        end,
        markPos,
        markEnd,
        index: blocks.length,
        depth,
        siblingIndex,
        container,
        containerPos,
        containerStart: contentStart,
        containerEnd: contentStart + container.content.size,
      });

      if (!isOpenContainer(node)) return;
      const body = node.lastChild;
      if (!summary || !body || body === summary) return;
      const bodyPos = pos + summary.nodeSize + 1;
      walk(body, bodyPos + 1, depth + 1, bodyPos);
    });
  };

  walk(doc, 0, 0, null);
  return blocks;
}

/** Selected visible rows, with descendants removed when their parent is also selected. */
export function selectedDraggableBlocks(doc, selectedIndexes) {
  const blocks = getDraggableBlocks(doc);
  const picked = Array.from(new Set(selectedIndexes || []))
    .map((index) => blocks[index])
    .filter(Boolean)
    .sort((a, b) => a.pos - b.pos || b.end - a.end);

  return picked.filter((candidate) => !picked.some((other) => (
    other !== candidate
    && other.pos <= candidate.pos
    && other.end >= candidate.end
  )));
}

/** Clipboard/move fragments need the list wrapper as well as the selected li. */
export function nodesForDraggableBlocks(blocks) {
  const nodes = [];
  let run = null;
  for (const block of blocks) {
    if (block.node.type.name !== 'listItem') {
      nodes.push(block.node);
      run = null;
      continue;
    }
    if (run?.containerPos === block.containerPos && run.lastIndex + 1 === block.siblingIndex) {
      run.items.push(block.node);
      run.lastIndex = block.siblingIndex;
      nodes[nodes.length - 1] = block.container.type.create(run.attrs, run.items, block.container.marks);
    } else {
      const attrs = block.container.type.name === 'orderedList'
        ? { ...block.container.attrs, start: block.container.attrs.start + block.siblingIndex }
        : block.container.attrs;
      run = { containerPos: block.containerPos, lastIndex: block.siblingIndex, attrs, items: [block.node] };
      nodes.push(block.container.type.create(attrs, run.items, block.container.marks));
    }
  }
  return nodes;
}

// This legacy helper identifies a single complete selected block. It remains
// useful to callers that specifically require one block rather than a range.
export function singleSelectedBlockIndex(selectionState) {
  if (!selectionState || selectionState.previewing === true) return null;
  const selected = Array.isArray(selectionState.selected) ? selectionState.selected : [];
  if (selected.length !== 1 || !Number.isInteger(selected[0])) return null;
  return selected[0];
}

/**
 * The block the format chooser should open on, if any.
 *
 * Being selected is not the same as asking to be re-typed. Carrying a block
 * across the page leaves it selected where it lands, and a rubber band can
 * close around a single block — in both cases the menu used to spring open over
 * the text, in the middle of a gesture that had nothing to do with formatting.
 * So the chooser answers one gesture only: a press on the handle that never
 * travelled, which is the deliberate "I mean this block" click.
 */
export function blockFormatMenuIndex(selectionState) {
  if (selectionState?.source !== 'click') return null;
  if (selectionState.previewing === true) return null;
  const selected = Array.from(new Set(selectionState.selected || []))
    .filter(Number.isInteger);
  if (!selected.length) return null;
  return selected.includes(selectionState.anchor) ? selectionState.anchor : selected[0];
}

/**
 * The complete block selection owned by an explicitly opened format menu.
 *
 * A marquee by itself still opens no menu. Clicking the six-dot handle of one
 * of its selected rows changes the source to `click` while keeping the full
 * selection, which lets one format command act on the whole run.
 */
export function blockFormatMenuSelection(selectionState) {
  if (selectionState?.source !== 'click' || selectionState.previewing === true) return [];
  return Array.from(new Set(selectionState.selected || []))
    .filter(Number.isInteger);
}

/**
 * Every position a dragged block can be dropped at, in document order.
 *
 * Dropping used to be expressed as an INDEX into the top-level blocks, which
 * meant a toggle was a single indivisible target: you could drop above it or
 * below it, never inside. Hovering over an open toggle's contents produced no
 * usable drop line at all, because the only two answers available were "before
 * this toggle" and "before whatever follows it".
 *
 * A slot is a document position instead, so an open toggle's body contributes
 * its own slots between its own children — and nested toggles do the same, all
 * the way down.
 */
export function dropSlotsForDoc(doc, isOpenContainer) {
  const slots = [];

  const walk = (container, contentStart, depth, containerPos) => {
    let lastEnd = null;
    let lastSize = 0;

    container.forEach((child, offset) => {
      const pos = contentStart + offset;
      slots.push({ pos, markPos: pos, markEnd: pos + child.nodeSize, side: 'before', depth, containerPos });
      lastEnd = pos + child.nodeSize;
      lastSize = child.nodeSize;

      if (isList(child)) {
        walk(child, pos + 1, depth + 1, pos);
        return;
      }
      if (!isOpenContainer(child)) return;
      const summary = child.firstChild;
      const body = child.lastChild;
      if (!summary || !body || body === summary) return;
      // A details node is [summary, body]: step into the node, past the
      // summary, then into the body's own content. The body's own position is
      // carried down so the slots inside it know what encloses them.
      walk(body, pos + summary.nodeSize + 2, depth + 1, pos + summary.nodeSize + 1);
    });

    // The end of the container, so something can be dropped as its last child.
    if (lastEnd !== null) {
      slots.push({
        pos: lastEnd, markPos: lastEnd - lastSize, markEnd: lastEnd, side: 'after', depth, containerPos,
      });
    }
  };

  walk(doc, 0, 0, null);
  return slots;
}

/** Slots inside the range being dragged: a block cannot be dropped into itself. */
export function usableDropSlots(slots, fromPos, toPos) {
  return slots.filter((slot) => !(slot.pos > fromPos && slot.pos < toPos));
}

/**
 * The slot a pointer is aiming at.
 *
 * A slot inside a toggle is only on offer while the pointer is actually within
 * that toggle's body. Without that rule the slot at the end of a body and the
 * slot just after the whole toggle sit at the same height, and whichever one
 * the tie-break favours, the other becomes unreachable — either you can never
 * append to a toggle, or you can never drop anything after one.
 *
 * Containment rather than indentation, because this editor does not indent a
 * top-level toggle's contents: there is no left edge to aim past.
 */
export function dropSlotAt(slots, y, tolerance = 6) {
  if (!Array.isArray(slots) || !slots.length) return null;

  const eligible = slots.filter((slot) => (
    slot.depth === 0
    || (y >= slot.containerTop && y <= slot.containerBottom)
  ));
  if (!eligible.length) return null;

  let nearest = Infinity;
  eligible.forEach((slot) => { nearest = Math.min(nearest, Math.abs(slot.top - y)); });
  const near = eligible.filter((slot) => Math.abs(slot.top - y) <= nearest + tolerance);

  // Genuinely level with each other: inside the toggle is the more specific
  // reading, and the one the pointer had to travel into the body to reach.
  return near.reduce((best, slot) => (slot.depth > best.depth ? slot : best), near[0]);
}

/**
 * Moves a run of top-level blocks to an arbitrary document position.
 *
 * The index-based move above can only ever land between two top-level blocks.
 * This one takes the slot's position, so the run can be carried into a toggle.
 * `landedNested` says the blocks are no longer top level, which means the
 * caller's index-based selection no longer describes anything and must go.
 */
export function moveTopLevelRangeToPos(tr, startIndex, endIndex, slot) {
  const blocks = getTopLevelBlocks(tr.doc);
  if (
    blocks.length === 0
    || !slot
    || startIndex < 0
    || endIndex >= blocks.length
    || startIndex > endIndex
  ) {
    return { tr, changed: false, startIndex, endIndex, landedNested: false };
  }

  const from = blocks[startIndex].pos;
  const to = blocks[endIndex].end;
  const targetPos = slot.pos;

  // Dropping against its own edges, or inside itself, moves nothing.
  if (targetPos >= from && targetPos <= to) {
    return { tr, changed: false, startIndex, endIndex, landedNested: false };
  }

  const content = tr.doc.slice(from, to).content;
  const removedSize = to - from;
  const insertPos = targetPos > to ? targetPos - removedSize : targetPos;

  tr.delete(from, to);
  tr.insert(insertPos, content);

  if (slot.depth > 0) {
    return { tr, changed: true, startIndex, endIndex, landedNested: true };
  }

  // Still top level: work out where the run ended up so it stays selected.
  const count = endIndex - startIndex + 1;
  const targetIndex = blocks.findIndex((block) => block.pos === targetPos);
  const resolvedTarget = targetIndex === -1 ? blocks.length : targetIndex;
  const nextStart = resolvedTarget > endIndex ? resolvedTarget - count : resolvedTarget;
  return {
    tr,
    changed: true,
    startIndex: nextStart,
    endIndex: nextStart + count - 1,
    landedNested: false,
  };
}

/**
 * Move a contiguous selection to a compatible document, dropdown or list slot.
 * Lists expose individual rows to the marquee, so a heading + prose + list
 * naturally spans containers. selectedDraggableBlocks already removes children
 * whose parent is selected; check for unselected intervening rows rather than
 * rejecting every selection with more than one parent.
 */
export function moveDraggableBlocksToPos(tr, selectedIndexes, slot) {
  const blocks = selectedDraggableBlocks(tr.doc, selectedIndexes);
  if (!slot || blocks.length === 0) {
    return { tr, changed: false, selectedPositions: [] };
  }

  const from = blocks[0].pos;
  const to = blocks[blocks.length - 1].end;
  const hasGap = getDraggableBlocks(tr.doc).some(row => row.pos >= from && row.end <= to
    && !blocks.some(block => row.pos >= block.pos && row.end <= block.end));
  if (hasGap) return { tr, changed: false, selectedPositions: [] };
  const targetPos = slot.pos;
  if (targetPos >= from && targetPos <= to) {
    return { tr, changed: false, selectedPositions: [] };
  }

  // Work on a scratch transform so an incompatible target cannot partially
  // delete the source. This also removes an emptied list instead of leaving a
  // phantom bullet when its last entry is carried elsewhere.
  const attempt = new Transform(tr.doc);
  deleteDraggableBlocks(attempt, selectedIndexes);
  const insertPos = attempt.mapping.map(targetPos);
  const $target = attempt.doc.resolve(insertPos);
  const content = Fragment.fromArray(isList($target.parent)
    ? blocks.map(block => block.node)
    : nodesForDraggableBlocks(blocks));
  if (!$target.parent.canReplace($target.index(), $target.index(), content)) {
    return { tr, changed: false, selectedPositions: [] };
  }
  const selectedPositions = [];
  let offset = 0;
  content.forEach((node) => {
    if (isList(node)) node.forEach((_item, itemOffset) => selectedPositions.push(insertPos + offset + 1 + itemOffset));
    else selectedPositions.push(insertPos + offset);
    offset += node.nodeSize;
  });

  attempt.insert(insertPos, content);
  attempt.steps.forEach(step => tr.step(step));
  return { tr, changed: true, selectedPositions };
}

export function contiguousBlockIndexes(anchorIndex, headIndex) {
  const start = Math.min(anchorIndex, headIndex);
  const end = Math.max(anchorIndex, headIndex);
  return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
}

export const BLOCK_POINTER_ORIGIN = Object.freeze({
  TEXT: 'text',
  SELECTION_GUTTER: 'selection-gutter',
  OUTSIDE: 'outside',
});

/**
 * Where a press landed, which decides whether it starts a text selection or a
 * marquee.
 *
 * A marquee may begin in the empty space on EITHER side of the text. That space
 * is the page gutter, and it is where a rubber-band selection naturally starts —
 * limiting it to the left was arbitrary.
 *
 * It may not begin outside the page surface, and that bound is what the `surface`
 * is for. It is the pane the editor is laid out in, not the text column: in a
 * note the wide empty margin belongs to the page and dragging there should
 * select, while in a Knowledge Web card inspector the space beside the text is
 * the canvas, and a drag there has to pan the canvas instead.
 */
export function classifyBlockPointerOrigin(clientX, bounds) {
  const { surfaceLeft, surfaceRight, blockLeft, blockRight } = bounds || {};
  const numbers = [clientX, surfaceLeft, surfaceRight, blockLeft, blockRight];
  if (!numbers.every(Number.isFinite)) return BLOCK_POINTER_ORIGIN.OUTSIDE;

  if (clientX < surfaceLeft || clientX > surfaceRight) return BLOCK_POINTER_ORIGIN.OUTSIDE;
  // A few pixels of slack, so pressing right on the first or last glyph is still
  // treated as text rather than as a marquee start.
  if (clientX >= blockLeft - 3 && clientX <= blockRight + 3) return BLOCK_POINTER_ORIGIN.TEXT;
  return BLOCK_POINTER_ORIGIN.SELECTION_GUTTER;
}

/**
 * Every block the marquee rectangle touches or encloses.
 *
 * A block's hit box is its whole row, not just its text: a paragraph occupies the
 * full width of the page, so a rectangle dragged down the empty gutter beside it
 * has genuinely touched it. Testing against the text box instead would mean a
 * marquee drawn purely in the gutter — which is exactly where the gesture starts
 * — selected nothing at all.
 *
 * `blocks` are `{ index, rect }`; `rect`s are viewport boxes.
 */
export function blocksIntersectingRect(blocks, marquee, { rowLeft, rowRight } = {}) {
  if (!marquee) return [];
  const top = Math.min(marquee.top, marquee.bottom);
  const bottom = Math.max(marquee.top, marquee.bottom);
  const left = Math.min(marquee.left, marquee.right);
  const right = Math.max(marquee.left, marquee.right);

  const selected = [];
  for (const block of blocks || []) {
    const rect = block?.rect;
    if (!rect) continue;
    const boxLeft = Number.isFinite(rowLeft) ? Math.min(rowLeft, rect.left) : rect.left;
    const boxRight = Number.isFinite(rowRight) ? Math.max(rowRight, rect.right) : rect.right;
    const verticalHit = rect.bottom >= top && rect.top <= bottom;
    const horizontalHit = boxRight >= left && boxLeft <= right;
    if (verticalHit && horizontalHit) selected.push(block.index);
  }
  return selected;
}

export function hasBlockSelectionDrag(startX, startY, currentX, currentY, minimumDistance = 5) {
  return Math.hypot(currentX - startX, currentY - startY) >= minimumDistance;
}

/**
 * Vertical speed for Notion-style edge auto-scroll while a block marquee is
 * active. The pointer gets a forgiving slow zone as it enters an edge, then
 * accelerates smoothly until it reaches the pane boundary. Returning pixels
 * per second keeps the gesture equally quick on 60 Hz and 120 Hz displays.
 */
export function blockSelectionAutoScrollVelocity(
  clientY,
  bounds,
  { edgeSize = 96, maxSpeed = 1400 } = {},
) {
  const top = Number(bounds?.top);
  const bottom = Number(bounds?.bottom);
  if (
    !Number.isFinite(clientY)
    || !Number.isFinite(top)
    || !Number.isFinite(bottom)
    || bottom <= top
    || edgeSize <= 0
    || maxSpeed <= 0
  ) return 0;

  // On a short editor, never let the top and bottom activation zones overlap.
  const zone = Math.min(edgeSize, (bottom - top) / 2);
  const speedAtDepth = (depth) => {
    const clamped = Math.max(0, Math.min(1, depth));
    // A small linear component makes the first part of the edge responsive;
    // the quadratic component supplies the satisfying speed ramp near the lip.
    return maxSpeed * clamped * (0.18 + 0.82 * clamped);
  };

  if (clientY < top + zone) {
    return -speedAtDepth((top + zone - clientY) / zone);
  }
  if (clientY > bottom - zone) {
    return speedAtDepth((clientY - (bottom - zone)) / zone);
  }
  return 0;
}

// Moves one contiguous top-level range to a document boundary. targetIndex is
// a boundary from 0..childCount (0 = before the first block).
export function moveTopLevelBlockRange(tr, startIndex, endIndex, targetIndex) {
  const blocks = getTopLevelBlocks(tr.doc);
  if (
    blocks.length === 0
    || startIndex < 0
    || endIndex >= blocks.length
    || startIndex > endIndex
    || targetIndex < 0
    || targetIndex > blocks.length
    || (targetIndex >= startIndex && targetIndex <= endIndex + 1)
  ) {
    return { tr, changed: false, startIndex, endIndex };
  }

  const from = blocks[startIndex].pos;
  const to = blocks[endIndex].end;
  const targetPos = targetIndex === blocks.length
    ? tr.doc.content.size
    : blocks[targetIndex].pos;
  const content = tr.doc.slice(from, to).content;
  const removedSize = to - from;
  const insertPos = targetIndex > endIndex ? targetPos - removedSize : targetPos;

  tr.delete(from, to);
  tr.insert(insertPos, content);

  const count = endIndex - startIndex + 1;
  const nextStart = targetIndex > endIndex ? targetIndex - count : targetIndex;
  return {
    tr,
    changed: true,
    startIndex: nextStart,
    endIndex: nextStart + count - 1,
  };
}

// Deletes one contiguous range of top-level editor blocks. The editor schema
// requires at least one block, so deleting the entire note/card leaves behind
// one clean empty paragraph instead of producing an invalid document.
export function deleteTopLevelBlockRange(tr, startIndex, endIndex) {
  const blocks = getTopLevelBlocks(tr.doc);
  if (
    blocks.length === 0
    || startIndex < 0
    || endIndex >= blocks.length
    || startIndex > endIndex
  ) {
    return { tr, changed: false };
  }

  const from = blocks[startIndex].pos;
  const to = blocks[endIndex].end;

  if (startIndex === 0 && endIndex === blocks.length - 1) {
    const emptyBlock = tr.doc.type.contentMatch.defaultType?.createAndFill();
    if (!emptyBlock) return { tr, changed: false };
    tr.replaceWith(0, tr.doc.content.size, emptyBlock);
  } else {
    tr.delete(from, to);
  }

  return { tr, changed: true };
}

/** Delete visible rows at any toggle depth while preserving required containers. */
export function deleteDraggableBlocks(tr, selectedIndexes) {
  const blocks = selectedDraggableBlocks(tr.doc, selectedIndexes);
  if (blocks.length === 0) return { tr, changed: false };

  const groups = new Map();
  blocks.forEach((block) => {
    const key = block.containerPos == null ? 'doc' : `body:${block.containerPos}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(block);
  });

  const operations = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.siblingIndex - b.siblingIndex);
    const { container, containerStart, containerEnd } = group[0];
    const selectedSiblings = new Set(group.map((block) => block.siblingIndex));

    if (selectedSiblings.size === container.childCount) {
      if (isList(container)) {
        operations.push({ from: group[0].containerPos, to: group[0].containerPos + container.nodeSize, replacement: null });
        continue;
      }
      const emptyBlock = container.type.contentMatch.defaultType?.createAndFill();
      if (!emptyBlock) continue;
      operations.push({ from: containerStart, to: containerEnd, replacement: emptyBlock });
      continue;
    }

    let runStart = group[0];
    let runEnd = group[0];
    for (let index = 1; index <= group.length; index += 1) {
      const next = group[index];
      if (next && next.siblingIndex === runEnd.siblingIndex + 1) {
        runEnd = next;
        continue;
      }
      operations.push({ from: runStart.pos, to: runEnd.end, replacement: null });
      runStart = next;
      runEnd = next;
    }
  }

  if (!operations.length) return { tr, changed: false };
  operations.sort((a, b) => b.from - a.from);
  operations.forEach(({ from, to, replacement }) => {
    if (replacement) tr.replaceWith(from, to, replacement);
    else tr.delete(from, to);
  });
  return { tr, changed: true };
}

// ── Drag-to-itemize ──
// A gutter drag selects a run of blocks and, on release, turns them into one
// list — the "itemized boxes" preview shown while dragging is the same range.

export const LIST_STYLES = Object.freeze({
  BULLETED: 'bulleted',
  NUMBERED: 'numbered',
  TOGGLE: 'toggle',
  // Escape hatch: drag still selects and previews, but releasing leaves the
  // document alone. Use this to keep plain block-selection behaviour.
  NONE: 'none',
});

/**
 * The indexes a drag between two blocks acts on: the inclusive range, in
 * document order.
 *
 * One block is one Return. Every top-level node counts as its own item —
 * a paragraph, a heading of any level, a horizontal rule, and an empty
 * paragraph the user made by pressing Return on a blank line. What does *not*
 * start a new one: bold/italic or any other formatting inside a line, and a
 * long paragraph that wraps across several visual lines on its own.
 */
export function itemizableBlockIndexes(doc, anchorIndex, headIndex) {
  const blocks = getTopLevelBlocks(doc);
  if (!blocks.length) return [];
  const start = Math.max(0, Math.min(anchorIndex, headIndex));
  const end = Math.min(blocks.length - 1, Math.max(anchorIndex, headIndex));
  const indexes = [];
  for (let i = start; i <= end; i += 1) indexes.push(i);
  return indexes;
}

function listItemFor(schema, node) {
  const itemType = schema.nodes.listItem;
  if (!itemType) return null;
  if (node.type === itemType) return node;
  const content = node.isTextblock
    ? schema.nodes.paragraph.create(null, node.content, node.marks)
    : node;
  // createAndFill supplies anything the item's content spec requires around
  // what we hand it (a leading paragraph before an image, say).
  return itemType.createAndFill(null, content)
    || itemType.createAndFill(null, schema.nodes.paragraph.create(null, node.content));
}

function toggleFor(schema, node) {
  const { details, detailsSummary, detailsContent } = schema.nodes;
  if (!details || !detailsSummary || !detailsContent) return null;
  const item = node.type.name === 'listItem';
  const summary = detailsSummary.createAndFill(null, item ? node.firstChild.content : node.isTextblock ? node.content : null);
  const body = detailsContent.createAndFill(null, item && node.childCount > 1 ? node.content.cut(node.firstChild.nodeSize) : null);
  if (!summary || !body) return null;
  return details.createAndFill({ open: false }, [summary, body]);
}

/** Replace selected sibling rows at any visible toggle depth with item rows. */
export function convertDraggableBlocksToItems(tr, selectedIndexes, style, schema) {
  if (style === LIST_STYLES.NONE) return { tr, changed: false };

  const blocks = selectedDraggableBlocks(tr.doc, selectedIndexes);
  if (!blocks.length) return { tr, changed: false };
  const containerPos = blocks[0].containerPos;
  const sameContainer = blocks.every((block) => block.containerPos === containerPos);
  const contiguous = blocks.every((block, index) => (
    index === 0 || block.siblingIndex === blocks[index - 1].siblingIndex + 1
  ));
  if (!sameContainer || !contiguous) return { tr, changed: false };

  let replacement;
  if (style === LIST_STYLES.TOGGLE) {
    const toggles = blocks.map((block) => toggleFor(schema, block.node)).filter(Boolean);
    if (toggles.length !== blocks.length) return { tr, changed: false };
    replacement = toggles;
  } else {
    const listType = style === LIST_STYLES.NUMBERED
      ? schema.nodes.orderedList
      : schema.nodes.bulletList;
    if (!listType) return { tr, changed: false };
    const items = blocks.map((block) => listItemFor(schema, block.node)).filter(Boolean);
    if (items.length !== blocks.length) return { tr, changed: false };
    replacement = [listType.create(null, items)];
  }

  if (isList(blocks[0].container)) {
    const { container, containerPos } = blocks[0];
    const first = blocks[0].siblingIndex;
    const last = blocks[blocks.length - 1].siblingIndex;
    const siblings = [];
    const part = (start, end) => {
      if (start >= end) return;
      const children = [];
      for (let index = start; index < end; index += 1) children.push(container.child(index));
      const attrs = container.type.name === 'orderedList' ? { ...container.attrs, start: container.attrs.start + start } : container.attrs;
      siblings.push(container.type.create(attrs, children, container.marks));
    };
    part(0, first);
    siblings.push(...replacement);
    part(last + 1, container.childCount);
    tr.replaceWith(containerPos, containerPos + container.nodeSize, siblings);
  } else {
    tr.replaceWith(blocks[0].pos, blocks[blocks.length - 1].end, replacement);
  }
  return { tr, changed: true };
}

/**
 * Replace a run of top-level blocks with one itemized list.
 *
 * Every block in the range becomes exactly one row, in document order —
 * including empty ones, which become empty rows. The preview showed one box
 * per block, so the result has to match it one for one.
 */
export function convertBlocksToItems(tr, anchorIndex, headIndex, style, schema) {
  if (style === LIST_STYLES.NONE) return { tr, changed: false };

  const blocks = getTopLevelBlocks(tr.doc);
  const indexes = itemizableBlockIndexes(tr.doc, anchorIndex, headIndex);
  if (indexes.length === 0) return { tr, changed: false };

  const first = blocks[indexes[0]];
  const last = blocks[indexes[indexes.length - 1]];

  let replacement;
  if (style === LIST_STYLES.TOGGLE) {
    const toggles = indexes.map((i) => toggleFor(schema, blocks[i].node)).filter(Boolean);
    if (toggles.length !== indexes.length) return { tr, changed: false };
    replacement = toggles;
  } else {
    const listType = style === LIST_STYLES.NUMBERED ? schema.nodes.orderedList : schema.nodes.bulletList;
    if (!listType) return { tr, changed: false };
    const items = indexes.map((i) => listItemFor(schema, blocks[i].node)).filter(Boolean);
    if (items.length !== indexes.length) return { tr, changed: false };
    replacement = [listType.create(null, items)];
  }

  tr.replaceWith(first.pos, last.end, replacement);
  return { tr, changed: true };
}
