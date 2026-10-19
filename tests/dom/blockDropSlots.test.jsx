import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  CollapsibleToggle,
  ToggleContent,
  ToggleSummary,
} from '@/components/editor/CollapsibleToggleExtension';
import {
  BlockDrag,
  blockDragPluginKey,
  isModifierOnlyKey,
} from '@/components/editor/BlockDragExtension';
import {
  deleteDraggableBlocks,
  dropSlotAt,
  dropSlotsForDoc,
  getDraggableBlocks,
  moveDraggableBlocksToPos,
  moveTopLevelRangeToPos,
  usableDropSlots,
} from '@/components/editor/blockDragModel';

/**
 * Dropping a block INSIDE a toggle.
 *
 * A drop used to be an index into the top-level blocks, which made a toggle one
 * indivisible target — hovering its contents offered only "before this toggle"
 * or "before whatever follows", so no usable line ever appeared and nothing
 * could be filed into a dropdown. A drop is now a document position, and an
 * open toggle's body contributes its own.
 */

const isOpenToggle = (node) => node?.type?.name === 'details' && node.attrs?.open === true;

const DOC = `
  <p>Before</p>
  <details open>
    <summary>Exegetical Analysis</summary>
    <div data-type="detailsContent"><p>Inside one</p><p>Inside two</p></div>
  </details>
  <p>Matthew</p>
  <p>After</p>
`;

let editor;
let host;

function mount(content = DOC) {
  host = document.createElement('div');
  document.body.appendChild(host);
  editor = new Editor({
    element: host,
    extensions: [StarterKit, CollapsibleToggle, ToggleSummary, ToggleContent, BlockDrag],
    content,
  });
  return editor;
}

afterEach(() => { editor?.destroy(); host?.remove(); editor = null; host = null; });
beforeEach(() => { editor = null; host = null; });

const slots = () => dropSlotsForDoc(editor.state.doc, isOpenToggle);

function blockLabel(block) {
  return block.node.type.name === 'details'
    ? block.node.firstChild?.textContent
    : block.node.textContent;
}

/** The node a slot would mark, so a slot can be named rather than counted. */
function describeSlot(slot) {
  const node = editor.state.doc.nodeAt(slot.markPos);
  return `${slot.side} "${node?.textContent ?? '?'}" @${slot.depth}`;
}

function topLevelRange(index) {
  const block = editor.state.doc.child(index);
  let pos = 0;
  for (let before = 0; before < index; before += 1) pos += editor.state.doc.child(before).nodeSize;
  return { from: pos, to: pos + block.nodeSize };
}

describe('where a block can be dropped', () => {
  it('offers a slot inside an open toggle, which is what was missing', () => {
    mount();
    const nested = slots().filter((slot) => slot.depth === 1).map(describeSlot);
    expect(nested).toEqual([
      'before "Inside one" @1',
      'before "Inside two" @1',
      'after "Inside two" @1',
    ]);
  });

  it('still offers every top-level slot it always did', () => {
    mount();
    const top = slots().filter((slot) => slot.depth === 0).map(describeSlot);
    expect(top).toEqual([
      'before "Before" @0',
      'before "Exegetical AnalysisInside oneInside two" @0',
      'before "Matthew" @0',
      'before "After" @0',
      'after "After" @0',
    ]);
  });

  it('offers nothing inside a CLOSED toggle', () => {
    // Its contents are not on screen, so there is nowhere visible to aim.
    mount(`
      <p>Before</p>
      <details><summary>Shut</summary><div data-type="detailsContent"><p>Hidden</p></div></details>
    `);
    expect(slots().every((slot) => slot.depth === 0)).toBe(true);
  });

  it('goes all the way down through nested toggles', () => {
    mount(`
      <details open>
        <summary>Outer</summary>
        <div data-type="detailsContent">
          <details open>
            <summary>Inner</summary>
            <div data-type="detailsContent"><p>Deep</p></div>
          </details>
        </div>
      </details>
    `);
    expect(Math.max(...slots().map((slot) => slot.depth))).toBe(2);
    expect(slots().filter((slot) => slot.depth === 2).map(describeSlot))
      .toEqual(['before "Deep" @2', 'after "Deep" @2']);
  });

  it('refuses to drop a block inside itself', () => {
    mount();
    const { from, to } = topLevelRange(1); // the toggle
    const usable = usableDropSlots(slots(), from, to);
    expect(usable.some((slot) => slot.depth === 1)).toBe(false);
    // Its own edges survive: those are simply no-ops, not nonsense.
    expect(usable.length).toBeGreaterThan(0);
  });
});

describe('modifier keys preserve a marquee selection', () => {
  it('recognizes Command and Control themselves as modifiers, not commands', () => {
    expect(isModifierOnlyKey({ key: 'Meta', metaKey: true })).toBe(true);
    expect(isModifierOnlyKey({ key: 'Control', ctrlKey: true })).toBe(true);
    expect(isModifierOnlyKey({ key: 'c', metaKey: true })).toBe(false);
  });

  it('does not turn selected blocks into an ordinary text range when Cmd is pressed', () => {
    mount('<p>First item</p><p>Second item</p><p>Third item</p>');
    const blocks = getDraggableBlocks(editor.state.doc);
    const selected = [blocks[0].index, blocks[1].index];

    editor.view.dispatch(editor.state.tr.setMeta(blockDragPluginKey, {
      type: 'selection',
      selected,
      anchor: selected[0],
      previewing: false,
      source: 'marquee',
    }));

    // jsdom has no layout, so make this editor count as visible — the old bug
    // lived beyond that production-only visibility guard.
    Object.defineProperty(editor.view.dom, 'offsetParent', {
      configurable: true,
      get: () => document.body,
    });
    const selectionBefore = editor.state.selection;

    document.body.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Meta',
      code: 'MetaLeft',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    }));

    const stateAfter = blockDragPluginKey.getState(editor.state);
    expect(stateAfter.selected).toEqual(selected);
    expect(editor.state.selection.eq(selectionBefore)).toBe(true);
    expect(editor.view.dom.classList.contains('bex-block-selection-active')).toBe(true);
  });
});

describe('visible blocks inside dropdowns', () => {
  it('recognizes the dropdown header and every body line as separate blocks', () => {
    mount();
    const blocks = getDraggableBlocks(editor.state.doc);

    expect(blocks.map((block) => [blockLabel(block), block.depth])).toEqual([
      ['Before', 0],
      ['Exegetical Analysis', 0],
      ['Inside one', 1],
      ['Inside two', 1],
      ['Matthew', 0],
      ['After', 0],
    ]);
  });

  it('counts empty Return-created lines inside a dropdown too', () => {
    mount(`
      <details open>
        <summary>Open</summary>
        <div data-type="detailsContent"><p>First</p><p></p><p>Third</p></div>
      </details>
    `);
    const bodyBlocks = getDraggableBlocks(editor.state.doc).filter((block) => block.depth === 1);
    expect(bodyBlocks).toHaveLength(3);
    expect(bodyBlocks.map(blockLabel)).toEqual(['First', '', 'Third']);
  });

  it('keeps hidden body lines out of the selectable sequence while closed', () => {
    mount(`
      <details>
        <summary>Closed</summary>
        <div data-type="detailsContent"><p>Hidden one</p><p>Hidden two</p></div>
      </details>
    `);
    expect(getDraggableBlocks(editor.state.doc).map(blockLabel)).toEqual(['Closed']);
  });

  it('puts selection chrome on the inner line, not the whole dropdown', () => {
    mount();
    const blocks = getDraggableBlocks(editor.state.doc);
    const innerIndex = blocks.find((block) => blockLabel(block) === 'Inside one').index;
    editor.view.dispatch(editor.state.tr.setMeta(blockDragPluginKey, {
      type: 'selection',
      selected: [innerIndex],
      anchor: innerIndex,
      previewing: false,
      source: 'click',
    }));

    const toggle = host.querySelector('.toggle-block');
    const summary = toggle.querySelector('summary');
    const inside = Array.from(toggle.querySelectorAll('.toggle-block__body > p'))
      .find((paragraph) => paragraph.textContent === 'Inside one');

    expect(inside.classList.contains('bex-block-selected')).toBe(true);
    expect(summary.classList.contains('bex-block-selected')).toBe(false);
    expect(toggle.classList.contains('bex-block-selected')).toBe(false);
  });

  it('deletes one inner line without deleting its dropdown', () => {
    mount();
    const blocks = getDraggableBlocks(editor.state.doc);
    const innerIndex = blocks.find((block) => blockLabel(block) === 'Inside one').index;
    const deleted = deleteDraggableBlocks(editor.state.tr, [innerIndex]);
    editor.view.dispatch(deleted.tr);

    expect(deleted.changed).toBe(true);
    expect(host.querySelector('.toggle-block')).toBeTruthy();
    expect(editor.getHTML()).not.toContain('Inside one');
    expect(editor.getHTML()).toContain('<p>Inside two</p>');
  });

  it('can drag an inner line out of its dropdown', () => {
    mount();
    const blocks = getDraggableBlocks(editor.state.doc);
    const innerIndex = blocks.find((block) => blockLabel(block) === 'Inside two').index;
    const target = slots().find((slot) => slot.depth === 0
      && editor.state.doc.nodeAt(slot.markPos)?.textContent === 'After');
    const moved = moveDraggableBlocksToPos(editor.state.tr, [innerIndex], target);
    editor.view.dispatch(moved.tr);

    expect(moved.changed).toBe(true);
    expect(editor.getHTML()).toContain('<p>Inside one</p></div></details><p>Matthew</p><p>Inside two</p><p>After</p>');
  });
});

describe('choosing between slots that sit at the same height', () => {
  // The end of a toggle's body and the gap after the whole toggle are level
  // with each other on screen. Containment is what tells them apart.
  const measured = [
    { pos: 10, depth: 0, top: 100, side: 'before', containerTop: -Infinity, containerBottom: Infinity },
    { pos: 20, depth: 1, top: 150, side: 'before', containerTop: 120, containerBottom: 180 },
    { pos: 30, depth: 1, top: 180, side: 'after', containerTop: 120, containerBottom: 180 },
    { pos: 40, depth: 0, top: 182, side: 'before', containerTop: -Infinity, containerBottom: Infinity },
  ];

  it('drops inside the body when the pointer is inside the body', () => {
    expect(dropSlotAt(measured, 148).pos).toBe(20);
  });

  it('appends to the body at its very bottom edge', () => {
    expect(dropSlotAt(measured, 179).pos).toBe(30);
  });

  it('drops after the whole toggle once the pointer leaves the body', () => {
    // Without the containment rule this is unreachable: the nested slot is
    // level with it and a depth tie-break would always win.
    expect(dropSlotAt(measured, 184).pos).toBe(40);
  });

  it('never offers a nested slot from a toggle the pointer is nowhere near', () => {
    expect(dropSlotAt(measured, 100).pos).toBe(10);
  });

  it('has no answer when there are no slots', () => {
    expect(dropSlotAt([], 100)).toBeNull();
    expect(dropSlotAt(null, 100)).toBeNull();
  });
});

describe('moving the block to the slot', () => {
  const html = () => editor.getHTML();

  function moveTo(startIndex, endIndex, slot) {
    const result = moveTopLevelRangeToPos(editor.state.tr, startIndex, endIndex, slot);
    if (result.changed) editor.view.dispatch(result.tr);
    return result;
  }

  it('moves a marquee containing a heading, prose, a blank line and numbered items into a dropdown', () => {
    mount('<details open><summary>Professor Mindset</summary><div data-type="detailsContent"><p></p></div></details><h2>Principles:</h2><p>You find the real problem <strong>under the surface.</strong></p><p></p><ol><li><p>surface</p></li><li><p>mechanism</p></li><li><p>impact</p></li><li><p>attempt</p></li><li><p>priority</p></li></ol><p>Keep outside</p>');
    const before = html();
    const selected = getDraggableBlocks(editor.state.doc).filter(block => block.node.type.name === 'heading' || block.node.type.name === 'listItem' || block.depth === 0 && block.node.type.name === 'paragraph' && block.node.textContent !== 'Keep outside').map(block => block.index);
    const target = slots().find(slot => slot.depth === 1 && slot.side === 'before');
    const moved = moveDraggableBlocksToPos(editor.state.tr, selected, target);
    expect(moved.changed).toBe(true);
    editor.view.dispatch(moved.tr);
    const body = host.querySelector('.toggle-block__body');
    expect(body.querySelector('h2').textContent).toBe('Principles:');
    expect(body.querySelector('strong').textContent).toBe('under the surface.');
    expect([...body.querySelectorAll('li')].map(item => item.textContent)).toEqual(['surface', 'mechanism', 'impact', 'attempt', 'priority']);
    expect(editor.state.doc.lastChild.textContent).toBe('Keep outside');
    expect(host.querySelectorAll('h2')).toHaveLength(1);
    editor.commands.undo(); expect(html()).toBe(before);
    editor.commands.redo(); expect(host.querySelector('.toggle-block__body ol')).toBeTruthy();
  });

  it('moves prose and a partial numbered list together while retaining the unselected entries and numbering', () => {
    mount('<details open><summary>Target</summary><div data-type="detailsContent"><p>Existing</p></div></details><p>Carry prose</p><ol start="4"><li><p>Carry first</p></li><li><p>Carry second</p></li><li><p>Leave third</p></li></ol><p>Outside</p>');
    const selected = getDraggableBlocks(editor.state.doc).filter(block => block.node.textContent.startsWith('Carry')).map(block => block.index);
    const moved = moveDraggableBlocksToPos(editor.state.tr, selected, slots().find(slot => slot.depth === 1 && slot.side === 'after'));
    expect(moved.changed).toBe(true); editor.view.dispatch(moved.tr);
    expect(host.querySelector('.toggle-block__body').textContent).toBe('ExistingCarry proseCarry firstCarry second');
    expect(host.querySelector('.toggle-block__body ol').getAttribute('start')).toBe('4');
    expect(editor.state.doc.child(1).textContent).toBe('Leave third');
    expect(editor.state.doc.lastChild.textContent).toBe('Outside');
    editor.state.doc.check();
  });

  it('rejects mixed selections with a gap and a dropdown dropped into itself without changing any source text', () => {
    mount('<details open><summary>Target</summary><div data-type="detailsContent"><p>Existing</p></div></details><p>Carry prose</p><ol><li><p>Leave first</p></li><li><p>Carry second</p></li></ol>');
    const before = editor.getJSON(), rows = getDraggableBlocks(editor.state.doc);
    const target = slots().find(slot => slot.depth === 1 && slot.side === 'before');
    const selected = rows.filter(block => block.node.textContent.startsWith('Carry')).map(block => block.index);
    expect(moveDraggableBlocksToPos(editor.state.tr, selected, target).changed).toBe(false);
    expect(moveDraggableBlocksToPos(editor.state.tr, [0, 1], target).changed).toBe(false);
    expect(editor.getJSON()).toEqual(before);
  });

  it('files a top-level block into the toggle', () => {
    mount();
    const target = slots().find((slot) => slot.depth === 1 && slot.side === 'before'
      && editor.state.doc.nodeAt(slot.markPos)?.textContent === 'Inside two');

    const result = moveTo(2, 2, target); // "Matthew"
    expect(result.changed).toBe(true);
    expect(result.landedNested).toBe(true);
    expect(html()).toContain('<p>Inside one</p><p>Matthew</p><p>Inside two</p>');
    expect(html()).not.toMatch(/<\/details><p>Matthew<\/p>/);
  });

  it('appends a block to the end of the toggle', () => {
    mount();
    const target = slots().find((slot) => slot.depth === 1 && slot.side === 'after');
    moveTo(2, 2, target);
    expect(html()).toContain('<p>Inside one</p><p>Inside two</p><p>Matthew</p>');
  });

  it('carries a whole run of blocks in together', () => {
    mount();
    const target = slots().find((slot) => slot.depth === 1 && slot.side === 'after');
    moveTo(2, 3, target); // Matthew + After
    expect(html()).toContain('<p>Inside one</p><p>Inside two</p><p>Matthew</p><p>After</p>');
  });

  it('still moves a block from one top-level place to another', () => {
    mount();
    const target = slots().find((slot) => slot.depth === 0
      && editor.state.doc.nodeAt(slot.markPos)?.textContent === 'Before');

    const result = moveTo(3, 3, target); // "After" to the very top
    expect(result.changed).toBe(true);
    expect(result.landedNested).toBe(false);
    // Still top level, so it stays selected — at its new index.
    expect(result.startIndex).toBe(0);
    expect(html()).toMatch(/^<p>After<\/p><p>Before<\/p>/);
  });

  it('moves nothing when dropped against its own edges', () => {
    mount();
    const own = slots().find((slot) => slot.depth === 0
      && editor.state.doc.nodeAt(slot.markPos)?.textContent === 'Matthew');
    const before = html();
    expect(moveTo(2, 2, own).changed).toBe(false);
    expect(html()).toBe(before);
  });

  it('refuses a slot that is not there', () => {
    mount();
    expect(moveTopLevelRangeToPos(editor.state.tr, 0, 0, null).changed).toBe(false);
    expect(moveTopLevelRangeToPos(editor.state.tr, -1, 0, { pos: 0, depth: 0 }).changed).toBe(false);
    expect(moveTopLevelRangeToPos(editor.state.tr, 0, 99, { pos: 0, depth: 0 }).changed).toBe(false);
  });
});
