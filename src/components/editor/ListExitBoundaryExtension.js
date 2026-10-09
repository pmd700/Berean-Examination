import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';

const LIST_NODE_NAMES = new Set(['bulletList', 'orderedList']);

/**
 * Blocks that have no business inside a list item.
 *
 * A rule or a heading is document structure, not part of a bullet. Nothing in
 * this editor can put one inside a list item on purpose — there is no command
 * for it — so finding one means a paste brought it in, carrying whatever
 * followed it along for the ride.
 *
 * Deliberately narrow. Paragraphs and nested lists belong in a list item and are
 * left alone, and so is anything else, because guessing wrong here would tear
 * apart writing somebody meant to keep.
 */
const STRANDED_BLOCK_NAMES = new Set(['heading', 'horizontalRule']);

const isEmptyParagraph = (node) => (
  node?.type?.name === 'paragraph' && node.content.size === 0
);

/**
 * Where a list item stops being a list item.
 *
 * Two things mark the boundary. Two consecutive empty paragraphs are a
 * deliberate exit gesture: the blank lines and everything after them belong
 * below the list, where the block-drag system can recognize each as its own
 * Notion-style item.
 *
 * A heading or a horizontal rule is the same thing arrived at by accident. Rich
 * clipboard HTML — a passage copied from a Bible site, say — routinely lands
 * with everything after the list tucked inside its final <li>. That reads
 * perfectly: a list item renders its children in order, so the heading and the
 * verses below it look exactly as they should. It only shows itself when the
 * writer presses Enter down there and gets a numbered bullet, because Enter in
 * a list item splits the *item* — silently minting "3." out of a passage nobody
 * thought was in a list at all.
 */
function exitBoundaryIndex(listItem) {
  let emptyRunStart = -1;
  let emptyRunLength = 0;

  for (let index = 1; index < listItem.childCount; index += 1) {
    const child = listItem.child(index);

    if (STRANDED_BLOCK_NAMES.has(child.type.name)) return index;

    if (isEmptyParagraph(child)) {
      if (emptyRunLength === 0) emptyRunStart = index;
      emptyRunLength += 1;
      if (emptyRunLength >= 2) return emptyRunStart;
    } else {
      emptyRunStart = -1;
      emptyRunLength = 0;
    }
  }

  return -1;
}

function adjustedListAttrs(listNode, firstItemIndex) {
  if (listNode.type.name !== 'orderedList') return listNode.attrs;
  const start = Number(listNode.attrs?.start);
  if (!Number.isFinite(start)) return listNode.attrs;
  return { ...listNode.attrs, start: start + firstItemIndex };
}

function splitListAtExitBoundaries(listNode) {
  const replacement = [];
  let currentItems = [];
  let currentStartIndex = 0;
  let changed = false;

  const flushList = () => {
    if (!currentItems.length) return;
    replacement.push(listNode.type.create(
      adjustedListAttrs(listNode, currentStartIndex),
      currentItems,
      listNode.marks,
    ));
    currentItems = [];
  };

  listNode.forEach((listItem, _offset, itemIndex) => {
    const boundary = exitBoundaryIndex(listItem);
    if (boundary < 0) {
      if (!currentItems.length) currentStartIndex = itemIndex;
      currentItems.push(listItem);
      return;
    }

    changed = true;
    if (!currentItems.length) currentStartIndex = itemIndex;

    const kept = [];
    const lifted = [];
    listItem.forEach((child, _childOffset, childIndex) => {
      (childIndex < boundary ? kept : lifted).push(child);
    });

    currentItems.push(listItem.type.create(listItem.attrs, kept, listItem.marks));
    flushList();
    replacement.push(...lifted);
    currentStartIndex = itemIndex + 1;
  });

  flushList();
  return changed ? replacement : null;
}

function normalizeContinuationInContainer(container, contentStart, tr) {
  let changed = false;
  let currentPos = contentStart;
  let lastOrderedListEnd = null;

  for (let i = 0; i < container.childCount; i += 1) {
    const child = container.child(i);
    const childPos = currentPos;
    currentPos += child.nodeSize;

    if (child.type.name === 'orderedList') {
      const currentStart = Number.isFinite(Number(child.attrs?.start))
        ? Number(child.attrs.start)
        : 1;

      if (lastOrderedListEnd !== null) {
        const expectedStart = lastOrderedListEnd + 1;
        if (child.attrs?.start !== expectedStart) {
          tr.setNodeMarkup(childPos, undefined, { ...child.attrs, start: expectedStart });
          changed = true;
        }
        lastOrderedListEnd = expectedStart + child.childCount - 1;
      } else {
        lastOrderedListEnd = currentStart + child.childCount - 1;
      }
    } else if (child.isTextblock && child.textContent.trim() === '') {
      // Empty or whitespace-only paragraph: preserve lastOrderedListEnd
    } else {
      lastOrderedListEnd = null;
    }
  }

  return changed;
}

export function normalizeOrderedListContinuation(tr) {
  let changed = false;

  if (normalizeContinuationInContainer(tr.doc, 0, tr)) {
    changed = true;
  }

  tr.doc.descendants((node, pos) => {
    if (node.isBlock && !node.type.inlineContent && node.type.name !== 'doc' && !LIST_NODE_NAMES.has(node.type.name)) {
      if (normalizeContinuationInContainer(node, pos + 1, tr)) {
        changed = true;
      }
    }
    return true;
  });

  return changed;
}

/** Normalize every qualifying list in a transaction, deepest positions first. */
export function normalizeListExitBoundaries(tr) {
  let changed = false;
  const replacements = [];

  tr.doc.descendants((node, pos) => {
    if (!LIST_NODE_NAMES.has(node.type.name)) return true;
    const replacement = splitListAtExitBoundaries(node);
    if (!replacement) return true;
    replacements.push({ from: pos, to: pos + node.nodeSize, replacement });
    // This complete list is being replaced. Nested candidates can be handled
    // by the appended transaction that follows, without overlapping ranges.
    return false;
  });

  if (replacements.length) {
    replacements
      .sort((a, b) => b.from - a.from)
      .forEach(({ from, to, replacement }) => tr.replaceWith(from, to, replacement));
    changed = true;
  }

  if (normalizeOrderedListContinuation(tr)) {
    changed = true;
  }

  return { tr, changed };
}

/** Keep newly pasted or edited rich list content normalized automatically. */
export const ListExitBoundaries = Extension.create({
  name: 'listExitBoundaries',

  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction(transactions, _oldState, newState) {
        if (!transactions.some(transaction => transaction.docChanged)) return null;
        const normalized = normalizeListExitBoundaries(newState.tr);
        return normalized.changed ? normalized.tr : null;
      },
    })];
  },
});

export default ListExitBoundaries;
