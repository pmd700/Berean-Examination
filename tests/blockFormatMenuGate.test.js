import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { blockFormatMenuIndex, singleSelectedBlockIndex } from '../src/components/editor/blockDragModel.js';

/**
 * When the block-format chooser is allowed to open.
 *
 * Being selected and asking to be re-typed are different things. Carrying a
 * block across the page leaves it selected where it lands, and a rubber band
 * can close around a single block — in both cases the chooser used to spring
 * open over the text in the middle of a gesture that had nothing to do with
 * formatting. It now answers exactly one gesture: a press on the handle that
 * never travelled.
 */

const root = path.resolve(import.meta.dirname, '..');
const blockDrag = fs.readFileSync(path.join(root, 'src/components/editor/BlockDragExtension.js'), 'utf8');

const state = (overrides) => ({
  selected: [3],
  anchor: 3,
  dropIndex: null,
  previewing: false,
  source: 'click',
  ...overrides,
});

describe('opening the format chooser', () => {
  it('opens on a click that selected one block', () => {
    assert.equal(blockFormatMenuIndex(state()), 3);
  });

  it('stays shut while a block is being carried', () => {
    // The reported bug: the menu opened over the page mid-drag.
    assert.equal(blockFormatMenuIndex(state({ source: 'drag' })), null);
  });

  it('stays shut after the block is dropped', () => {
    // The block stays selected where it lands, which is how the menu used to
    // reappear the instant the drag ended.
    assert.equal(blockFormatMenuIndex(state({ source: 'drag', previewing: false })), null);
  });

  it('stays shut for a rubber band that closed around one block', () => {
    assert.equal(blockFormatMenuIndex(state({ source: 'marquee' })), null);
  });

  it('stays shut for a selection with no recorded gesture', () => {
    // Anything that selects a block without saying how is not a click.
    assert.equal(blockFormatMenuIndex(state({ source: null })), null);
    assert.equal(blockFormatMenuIndex(state({ source: undefined })), null);
  });

  it('still refuses everything it refused before', () => {
    assert.equal(blockFormatMenuIndex(state({ selected: [] })), null);
    assert.equal(blockFormatMenuIndex(state({ selected: [3, 4] })), null);
    assert.equal(blockFormatMenuIndex(state({ previewing: true })), null);
    assert.equal(blockFormatMenuIndex(null), null);
    assert.equal(blockFormatMenuIndex(undefined), null);
  });

  it('leaves the plain "one block is selected" question unchanged', () => {
    // Selection highlighting, Delete and copy still key on this, and none of
    // them care which gesture made the selection.
    assert.equal(singleSelectedBlockIndex(state({ source: 'drag' })), 3);
    assert.equal(singleSelectedBlockIndex(state({ source: 'marquee' })), 3);
  });
});

describe('the gestures that record themselves', () => {
  it('marks a handle press that never travelled as a click', () => {
    const click = blockDrag.slice(blockDrag.indexOf("if (mode === 'drag' && !dragging)"));
    assert.match(click.slice(0, 500), /source: SELECTION_SOURCE\.CLICK/);
  });

  it('marks the moment a press becomes a carry as a drag', () => {
    const start = blockDrag.slice(blockDrag.indexOf('if (!state.selected.includes(initialIndex))'));
    assert.match(start.slice(0, 300), /source: SELECTION_SOURCE\.DRAG/);
  });

  it('keeps a dropped block marked as a drag, not reset to nothing', () => {
    const moved = blockDrag.slice(blockDrag.indexOf("if (meta?.type === 'moved')"));
    assert.match(moved.slice(0, 500), /source: SELECTION_SOURCE\.DRAG/);
  });

  it('marks both the live marquee and its release', () => {
    assert.equal((blockDrag.match(/source: SELECTION_SOURCE\.MARQUEE/g) || []).length, 2);
  });

  it('carries the gesture through the plugin state', () => {
    assert.match(blockDrag, /source: meta\.source \?\? null/);
    assert.match(blockDrag, /source: null,/);
  });
});
