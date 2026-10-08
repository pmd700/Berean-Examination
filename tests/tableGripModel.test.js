import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GRIP_AXIS,
  GRIP_THICKNESS,
  bandFromRect,
  bandIndexAt,
  dropIndexForPointer,
  dropMarkerRect,
  gripRect,
} from '../src/components/editor/tableGripModel.js';

/**
 * Where the grips sit and where a dragged band lands.
 *
 * Pure arithmetic over rectangles, and the only part of the grip feature that
 * can be checked without a real table and a real mouse. The drop rule in
 * particular is worth pinning: the obvious version of it — swap as soon as the
 * bands touch — makes a slow drag flicker, and that is not something a
 * screenshot would ever show.
 */

const rect = (left, top, width, height) => ({
  left, top, width, height, right: left + width, bottom: top + height,
});

const table = rect(100, 200, 600, 300);

describe('placing a grip', () => {
  it("straddles the table's top border, centred on the column", () => {
    // ON the line, not floating beside it: half above, half below, which is
    // what makes it read as a handle belonging to that edge.
    const grip = gripRect(GRIP_AXIS.COLUMN, rect(220, 200, 120, 40), table);
    // A share of the band, not the whole of it: a pill running the full width
    // reads as a bar capping the column rather than a handle on it.
    assert.equal(grip.width, 96);           // 120 * 0.8
    assert.equal(grip.height, GRIP_THICKNESS);
    assert.equal(grip.left, 232);           // centred: 220 + (120 - 96) / 2
    assert.equal(grip.top, table.top - GRIP_THICKNESS / 2);
    assert.ok(grip.top < table.top && grip.top + grip.height > table.top);
  });

  it("straddles the table's left border, centred on the row", () => {
    const grip = gripRect(GRIP_AXIS.ROW, rect(100, 260, 600, 50), table);
    assert.equal(grip.height, 40);          // 50 * 0.8
    assert.equal(grip.width, GRIP_THICKNESS);
    assert.equal(grip.top, 265);            // centred: 260 + (50 - 40) / 2
    assert.equal(grip.left, table.left - GRIP_THICKNESS / 2);
    assert.ok(grip.left < table.left && grip.left + grip.width > table.left);
  });

  it("keeps a narrow band's pill big enough to aim at", () => {
    // A 12px column would otherwise get a 6px grip nobody can hit, and one too
    // short to show the six dots that say it can be dragged.
    const grip = gripRect(GRIP_AXIS.COLUMN, rect(220, 200, 12, 40), table);
    assert.equal(grip.width, 18);           // the floor, not 12 * 0.8
  });

  it('is a small pill, not a slab', () => {
    // It sits on the table's own border; anything thicker reads as a bar
    // stuck to the edge rather than a handle for it.
    assert.ok(GRIP_THICKNESS <= 10, 'the pill got fat again');
  });

  it('has nothing to place without a band', () => {
    assert.equal(gripRect(GRIP_AXIS.COLUMN, null, table), null);
    assert.equal(gripRect(GRIP_AXIS.COLUMN, rect(0, 0, 10, 10), null), null);
  });
});

describe('finding the band under a pointer', () => {
  const bands = [{ start: 0, end: 100 }, { start: 100, end: 250 }, { start: 250, end: 400 }];

  it('finds the band a position falls in', () => {
    assert.equal(bandIndexAt(bands, 50), 0);
    assert.equal(bandIndexAt(bands, 180), 1);
    assert.equal(bandIndexAt(bands, 399), 2);
  });

  it('returns nothing past the last band', () => {
    assert.equal(bandIndexAt(bands, 500), null);
    assert.equal(bandIndexAt(null, 10), null);
  });
});

describe('deciding where a dragged band lands', () => {
  // Three equal bands, so the midpoints are 50, 150 and 250.
  const bands = [{ start: 0, end: 100 }, { start: 100, end: 200 }, { start: 200, end: 300 }];

  it("stays put while the pointer has not passed a neighbour's middle", () => {
    // The obvious rule — swap as soon as the bands touch — makes a slow drag
    // flicker, because the swap moves the band back under the pointer and
    // immediately re-triggers itself.
    assert.equal(dropIndexForPointer(bands, 0, 120), 0);
    assert.equal(dropIndexForPointer(bands, 2, 180), 2);
  });

  it("moves forward once the pointer passes the next band's middle", () => {
    assert.equal(dropIndexForPointer(bands, 0, 160), 1);
    assert.equal(dropIndexForPointer(bands, 0, 260), 2);
  });

  it("moves back once the pointer passes the previous band's middle", () => {
    assert.equal(dropIndexForPointer(bands, 2, 140), 1);
    assert.equal(dropIndexForPointer(bands, 2, 40), 0);
  });

  it('cannot be dragged off either end', () => {
    assert.equal(dropIndexForPointer(bands, 0, -400), 0);
    assert.equal(dropIndexForPointer(bands, 2, 900), 2);
  });

  it('answers with the band it was given when there is nothing to compare', () => {
    assert.equal(dropIndexForPointer([], 0, 10), 0);
    assert.equal(dropIndexForPointer(bands, 9, 10), 9);
    assert.equal(dropIndexForPointer(null, 1, 10), 1);
  });
});

describe('the drop marker', () => {
  const bands = [{ start: 0, end: 100 }, { start: 100, end: 200 }, { start: 200, end: 300 }];

  it('draws on the leading edge when moving forward', () => {
    const marker = dropMarkerRect(GRIP_AXIS.COLUMN, bands, 0, 1, table);
    assert.equal(marker.left, 199);
    assert.equal(marker.height, table.height);
  });

  it('draws on the trailing edge when moving back', () => {
    const marker = dropMarkerRect(GRIP_AXIS.COLUMN, bands, 2, 0, table);
    assert.equal(marker.left, -1);
  });

  it('lies across the table for a row', () => {
    const marker = dropMarkerRect(GRIP_AXIS.ROW, bands, 0, 2, table);
    assert.equal(marker.top, 299);
    assert.equal(marker.width, table.width);
  });

  it('draws nothing when the band has not moved', () => {
    assert.equal(dropMarkerRect(GRIP_AXIS.COLUMN, bands, 1, 1, table), null);
    assert.equal(dropMarkerRect(GRIP_AXIS.COLUMN, bands, 0, 9, table), null);
  });
});

describe('reading a rect along an axis', () => {
  it('takes the horizontal extent for a column and the vertical for a row', () => {
    assert.deepEqual(bandFromRect(GRIP_AXIS.COLUMN, rect(10, 20, 30, 40)), { start: 10, end: 40 });
    assert.deepEqual(bandFromRect(GRIP_AXIS.ROW, rect(10, 20, 30, 40)), { start: 20, end: 60 });
  });
});
