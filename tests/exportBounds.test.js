import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getExportBounds, getObjectDimensions } from '../src/components/knowledgeweb/exportBounds.js';

describe('getObjectDimensions', () => {
  it('uses a 16x16 anchor box (centered) for routing points', () => {
    assert.deepEqual(
      getObjectDimensions({ object_type: 'point' }),
      { width: 16, height: 16, offsetX: -8, offsetY: -8 },
    );
  });

  it('uses section / image / text type-specific defaults', () => {
    assert.deepEqual(getObjectDimensions({ object_type: 'section' }), { width: 400, height: 300 });
    assert.deepEqual(getObjectDimensions({ object_type: 'image' }), { width: 240, height: 160 });
    assert.deepEqual(getObjectDimensions({ object_type: 'text' }), { width: 240, height: 60 });
  });

  it('honors explicit width/height when set', () => {
    assert.deepEqual(
      getObjectDimensions({ object_type: 'section', width: 999, height: 555 }),
      { width: 999, height: 555 },
    );
  });
});

describe('getExportBounds', () => {
  it('returns a default canvas-sized box when nothing is passed', () => {
    assert.deepEqual(getExportBounds(), { minX: 0, minY: 0, maxX: 1200, maxY: 800 });
    assert.deepEqual(getExportBounds([], [], []), { minX: 0, minY: 0, maxX: 1200, maxY: 800 });
  });

  describe('cards-only canvas', () => {
    it('computes a tight bounding box around cards using width/height', () => {
      const cards = [
        { x: 100, y: 200, width: 300, height: 150, layout_mode: 'manual' },
        { x: 700, y: 50, width: 100, height: 400, layout_mode: 'manual' },
      ];
      assert.deepEqual(getExportBounds(cards, [], []), {
        minX: 100,
        minY: 50,
        maxX: 800,
        maxY: 450,
      });
    });

    it('uses a tight smart outline for legacy cards whose layout mode is missing', () => {
      const cards = [{ x: 0, y: 0, title: '' }];
      assert.deepEqual(getExportBounds(cards, [], []), {
        minX: 0, minY: 0, maxX: 86, maxY: 40,
      });
    });
  });

  describe('points-only canvas (routing points + standalone canvas points)', () => {
    it('does NOT inflate bounds with a generic 240x160 fallback for routing points', () => {
      // Regression guard for the no-double-counting fix: routing points are
      // tiny anchors and used to be sized 240x160, which blew up the export
      // bounds and produced trailing whitespace in the PDF.
      const connections = [
        { reroute_points: [{ x: 100, y: 100 }, { x: 500, y: 400 }] },
      ];
      const bounds = getExportBounds([], [], connections);
      // Connection reroute points contribute zero-area boxes.
      assert.deepEqual(bounds, { minX: 100, minY: 100, maxX: 500, maxY: 400 });
    });

    it('treats canvas point objects as 16x16 boxes centered on their anchor', () => {
      const canvasObjects = [{ object_type: 'point', x: 100, y: 200 }];
      // 16x16 centered → minX = 92, minY = 192, maxX = 108, maxY = 208
      assert.deepEqual(getExportBounds([], canvasObjects, []), {
        minX: 92, minY: 192, maxX: 108, maxY: 208,
      });
    });

    it('combines canvas points and reroute points without inflating bounds', () => {
      const canvasObjects = [{ object_type: 'point', x: 0, y: 0 }];
      const connections = [{ reroute_points: [{ x: 1000, y: 1000 }] }];
      const bounds = getExportBounds([], canvasObjects, connections);
      // The point contributes -8..8 box; reroute point contributes (1000,1000).
      assert.deepEqual(bounds, { minX: -8, minY: -8, maxX: 1000, maxY: 1000 });
    });
  });

  describe('mixed canvas (cards + sections + points + connections)', () => {
    it('unions all geometry into a single bounding box', () => {
      const cards = [{ x: 0, y: 0, width: 200, height: 120 }];
      const canvasObjects = [
        { object_type: 'section', x: 300, y: 100, width: 400, height: 300 },
        { object_type: 'point', x: 50, y: 50 },
      ];
      const connections = [{ reroute_points: [{ x: 800, y: 500 }] }];
      assert.deepEqual(getExportBounds(cards, canvasObjects, connections), {
        minX: 0,
        minY: 0,
        maxX: 800,
        maxY: 500,
      });
    });

    it('routing points do not extend bounds past actual card/section geometry', () => {
      // The routing point is *inside* the card region; bounds should match
      // the card geometry exactly with no inflation.
      const cards = [{ x: 0, y: 0, width: 1000, height: 1000, layout_mode: 'manual' }];
      const connections = [{ reroute_points: [{ x: 500, y: 500 }] }];
      assert.deepEqual(getExportBounds(cards, [], connections), {
        minX: 0, minY: 0, maxX: 1000, maxY: 1000,
      });
    });

    it('handles multiple connections each with multiple reroute points', () => {
      const connections = [
        { reroute_points: [{ x: 10, y: 20 }, { x: 30, y: 40 }] },
        { reroute_points: [{ x: -50, y: 600 }] },
        { /* no reroute_points key */ },
      ];
      assert.deepEqual(getExportBounds([], [], connections), {
        minX: -50, minY: 20, maxX: 30, maxY: 600,
      });
    });
  });
});
