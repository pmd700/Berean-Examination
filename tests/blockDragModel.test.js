import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorState } from '@tiptap/pm/state';
import {
  BLOCK_POINTER_ORIGIN,
  blockFormatMenuIndex,
  blockFormatMenuSelection,
  blockSelectionAutoScrollVelocity,
  blocksIntersectingRect,
  classifyBlockPointerOrigin,
  itemizableBlockIndexes,
  contiguousBlockIndexes,
  deleteTopLevelBlockRange,
  getTopLevelBlocks,
  hasBlockSelectionDrag,
  moveTopLevelBlockRange,
  singleSelectedBlockIndex,
} from '../src/components/editor/blockDragModel.js';

const schema = getSchema([StarterKit]);
const paragraph = (text = '') => schema.node('paragraph', null, text ? schema.text(text) : undefined);
const heading = (text) => schema.node('heading', { level: 3 }, schema.text(text));
const rule = () => schema.node('horizontalRule');
const labels = (doc) => Array.from({ length: doc.childCount }, (_, index) => {
  const node = doc.child(index);
  return node.type.name === 'horizontalRule' ? '---' : node.textContent;
});

describe('Notion-style block model', () => {
  it('treats headings, paragraphs, dividers, long paragraphs, and empty lines as separate blocks', () => {
    const doc = schema.node('doc', null, [
      heading('Header'),
      paragraph('Body'),
      rule(),
      paragraph('A very long paragraph remains one block even when it wraps visually.'),
      paragraph(),
      paragraph('After empty line'),
    ]);
    assert.equal(getTopLevelBlocks(doc).length, 6);
  });

  it('keeps mixed bold and italic text inside one paragraph block', () => {
    const bold = schema.marks.bold.create();
    const italic = schema.marks.italic.create();
    const mixed = schema.node('paragraph', null, [
      schema.text('bold', [bold]),
      schema.text(' and '),
      schema.text('italic', [italic]),
    ]);
    const doc = schema.node('doc', null, [mixed]);
    assert.equal(getTopLevelBlocks(doc).length, 1);
  });

  it('selects every block between the gutter anchor and pointer', () => {
    assert.deepEqual(contiguousBlockIndexes(4, 1), [1, 2, 3, 4]);
  });

  // A page 1000px wide with an 820px text column centred in it: the surface runs
  // 0..1000 and the text 90..910, leaving a 90px gutter either side.
  const PAGE = { surfaceLeft: 0, surfaceRight: 1000, blockLeft: 90, blockRight: 910 };

  it('keeps a press on the text as text selection', () => {
    assert.equal(classifyBlockPointerOrigin(90, PAGE), BLOCK_POINTER_ORIGIN.TEXT);
    assert.equal(classifyBlockPointerOrigin(500, PAGE), BLOCK_POINTER_ORIGIN.TEXT);
    assert.equal(classifyBlockPointerOrigin(910, PAGE), BLOCK_POINTER_ORIGIN.TEXT);
  });

  it('starts a marquee from the gutter on either side of the text', () => {
    assert.equal(classifyBlockPointerOrigin(40, PAGE), BLOCK_POINTER_ORIGIN.SELECTION_GUTTER);
    // The right gutter counts too; limiting the gesture to the left was arbitrary.
    assert.equal(classifyBlockPointerOrigin(960, PAGE), BLOCK_POINTER_ORIGIN.SELECTION_GUTTER);
  });

  it('refuses to start outside the page surface', () => {
    // Beyond the pane is another surface entirely — in a card inspector, the
    // Knowledge Web canvas — and a drag there must not select paragraphs.
    assert.equal(classifyBlockPointerOrigin(-1, PAGE), BLOCK_POINTER_ORIGIN.OUTSIDE);
    assert.equal(classifyBlockPointerOrigin(1001, PAGE), BLOCK_POINTER_ORIGIN.OUTSIDE);
  });

  it('treats missing geometry as outside rather than guessing', () => {
    assert.equal(classifyBlockPointerOrigin(NaN, PAGE), BLOCK_POINTER_ORIGIN.OUTSIDE);
    assert.equal(classifyBlockPointerOrigin(40, null), BLOCK_POINTER_ORIGIN.OUTSIDE);
    assert.equal(
      classifyBlockPointerOrigin(40, { ...PAGE, blockRight: undefined }),
      BLOCK_POINTER_ORIGIN.OUTSIDE,
    );
  });

  describe('marquee hit-testing', () => {
    const rows = [
      { index: 0, rect: { top: 0, bottom: 20, left: 90, right: 910 } },
      { index: 1, rect: { top: 30, bottom: 50, left: 90, right: 910 } },
      { index: 2, rect: { top: 60, bottom: 80, left: 90, right: 910 } },
    ];
    const ROW = { rowLeft: 0, rowRight: 1000 };

    it('selects every block the rectangle touches', () => {
      const marquee = { left: 10, top: 10, right: 400, bottom: 65 };
      assert.deepEqual(blocksIntersectingRect(rows, marquee, ROW), [0, 1, 2]);
    });

    it('selects nothing when the rectangle misses every block', () => {
      const marquee = { left: 10, top: 21, right: 400, bottom: 29 };
      assert.deepEqual(blocksIntersectingRect(rows, marquee, ROW), []);
    });

    it('works the same dragged upward, because it is a rectangle not a run', () => {
      // Bottom-up: the old run-based rule kept extending downward from the
      // starting block, so the highlight and the rectangle disagreed.
      const upward = { left: 400, top: 65, right: 10, bottom: 10 };
      assert.deepEqual(blocksIntersectingRect(rows, upward, ROW), [0, 1, 2]);
    });

    it('selects a row from a rectangle drawn only in the gutter', () => {
      // Never reaches the text horizontally. A block's hit box is its whole row,
      // so this still counts as touching it — otherwise a marquee started in the
      // gutter, which is the only place it can start, would select nothing.
      const gutterOnly = { left: 5, top: 35, right: 45, bottom: 45 };
      assert.deepEqual(blocksIntersectingRect(rows, gutterOnly, ROW), [1]);
    });

    it('ignores blocks with no measurable geometry', () => {
      const marquee = { left: 0, top: 0, right: 1000, bottom: 100 };
      assert.deepEqual(blocksIntersectingRect([{ index: 9 }, ...rows], marquee, ROW), [0, 1, 2]);
    });

    it('handles an empty document and a missing rectangle', () => {
      assert.deepEqual(blocksIntersectingRect([], { left: 0, top: 0, right: 1, bottom: 1 }), []);
      assert.deepEqual(blocksIntersectingRect(rows, null), []);
    });
  });

  it('counts one item per Return, empty lines included', () => {
    const doc = schema.node('doc', null, [
      paragraph('first'),
      paragraph(''),
      schema.node('heading', { level: 2 }, schema.text('a header')),
      schema.node('horizontalRule'),
      paragraph('a long paragraph that wraps but was never split by a Return'),
    ]);
    // Five Returns, five items — the blank line and the rule each count, and
    // the wrapping paragraph counts once.
    assert.deepEqual(itemizableBlockIndexes(doc, 0, 4), [0, 1, 2, 3, 4]);
    assert.deepEqual(itemizableBlockIndexes(doc, 3, 1), [1, 2, 3]);
  });

  it('requires a real gutter drag before selecting blocks', () => {
    assert.equal(hasBlockSelectionDrag(10, 10, 12, 13), false);
    assert.equal(hasBlockSelectionDrag(10, 10, 10, 15), true);
  });

  describe('edge auto-scroll', () => {
    const VIEWPORT = { top: 100, bottom: 700 };

    it('stays still away from the top and bottom edges', () => {
      assert.equal(blockSelectionAutoScrollVelocity(350, VIEWPORT), 0);
    });

    it('scrolls faster as the pointer approaches the bottom lip', () => {
      const entering = blockSelectionAutoScrollVelocity(620, VIEWPORT);
      const nearLip = blockSelectionAutoScrollVelocity(690, VIEWPORT);
      assert.ok(entering > 0);
      assert.ok(nearLip > entering);
    });

    it('mirrors the same speed ramp above the top lip', () => {
      const entering = blockSelectionAutoScrollVelocity(180, VIEWPORT);
      const nearLip = blockSelectionAutoScrollVelocity(110, VIEWPORT);
      assert.ok(entering < 0);
      assert.ok(nearLip < entering);
      assert.equal(Math.abs(nearLip), blockSelectionAutoScrollVelocity(690, VIEWPORT));
    });

    it('caps the speed after the pointer leaves the pane', () => {
      assert.equal(blockSelectionAutoScrollVelocity(900, VIEWPORT), 1400);
      assert.equal(blockSelectionAutoScrollVelocity(-100, VIEWPORT), -1400);
    });
  });

  describe('whole-block formatting ownership', () => {
    it('still identifies exactly one completed whole-block selection', () => {
      assert.equal(singleSelectedBlockIndex({ selected: [3], previewing: false }), 3);
    });

    it('rejects zero blocks, multiple blocks, and an active marquee preview as single selections', () => {
      assert.equal(singleSelectedBlockIndex({ selected: [], previewing: false }), null);
      assert.equal(singleSelectedBlockIndex({ selected: [1, 2], previewing: false }), null);
      assert.equal(singleSelectedBlockIndex({ selected: [1], previewing: true }), null);
      assert.equal(singleSelectedBlockIndex(null), null);
    });

    it('keeps the complete marquee selection after one of its handles opens the menu', () => {
      const state = {
        selected: [2, 3, 4],
        anchor: 3,
        previewing: false,
        source: 'click',
      };
      assert.equal(blockFormatMenuIndex(state), 3);
      assert.deepEqual(blockFormatMenuSelection(state), [2, 3, 4]);
    });

    it('does not open the format menu from the marquee gesture alone', () => {
      const state = {
        selected: [2, 3, 4],
        anchor: 2,
        previewing: false,
        source: 'marquee',
      };
      assert.equal(blockFormatMenuIndex(state), null);
      assert.deepEqual(blockFormatMenuSelection(state), []);
    });
  });

  it('moves a selected block group downward without changing its internal order', () => {
    const doc = schema.node('doc', null, ['A', 'B', 'C', 'D', 'E'].map(paragraph));
    const state = EditorState.create({ doc });
    const moved = moveTopLevelBlockRange(state.tr, 1, 2, 5);
    assert.equal(moved.changed, true);
    assert.deepEqual(labels(moved.tr.doc), ['A', 'D', 'E', 'B', 'C']);
    assert.deepEqual([moved.startIndex, moved.endIndex], [3, 4]);
  });

  it('moves a selected block group upward and preserves empty blocks', () => {
    const doc = schema.node('doc', null, [paragraph('A'), paragraph(), paragraph('C'), paragraph('D')]);
    const state = EditorState.create({ doc });
    const moved = moveTopLevelBlockRange(state.tr, 2, 3, 0);
    assert.deepEqual(labels(moved.tr.doc), ['C', 'D', 'A', '']);
  });

  it('does nothing when dropped inside its own selected range', () => {
    const doc = schema.node('doc', null, ['A', 'B', 'C'].map(paragraph));
    const state = EditorState.create({ doc });
    const moved = moveTopLevelBlockRange(state.tr, 0, 1, 1);
    assert.equal(moved.changed, false);
    assert.deepEqual(labels(moved.tr.doc), ['A', 'B', 'C']);
  });

  it('deletes only the selected block range and preserves surrounding content', () => {
    const doc = schema.node('doc', null, ['Keep A', 'Delete B', 'Delete C', 'Keep D'].map(paragraph));
    const state = EditorState.create({ doc });
    const deleted = deleteTopLevelBlockRange(state.tr, 1, 2);
    assert.equal(deleted.changed, true);
    assert.deepEqual(labels(deleted.tr.doc), ['Keep A', 'Keep D']);
  });

  it('leaves one empty editable block when every block is deleted', () => {
    const doc = schema.node('doc', null, ['Delete A', 'Delete B'].map(paragraph));
    const state = EditorState.create({ doc });
    const deleted = deleteTopLevelBlockRange(state.tr, 0, 1);
    assert.equal(deleted.changed, true);
    assert.equal(deleted.tr.doc.childCount, 1);
    assert.equal(deleted.tr.doc.firstChild.type.name, 'paragraph');
    assert.equal(deleted.tr.doc.firstChild.textContent, '');
  });
});
