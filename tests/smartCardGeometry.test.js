import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_CARD_HEIGHT,
  DEFAULT_CARD_WIDTH,
  estimateSmartCardGeometry,
  geometryFromLineBands,
  getCardGeometrySignature,
  getClosestGeometryAnchor,
  getGeometryPort,
  getGeometryRightAtY,
  getGeometrySideSpan,
  pointInCardGeometry,
  rectIntersectsCardGeometry,
} from '../src/components/knowledgeweb/smartCardGeometry.js';

describe('geometryFromLineBands', () => {
  it('keeps the stepped profile but rounds every inward and outward corner', () => {
    const geometry = geometryFromLineBands([
      { top: 0, bottom: 20, right: 100 },
      { top: 20, bottom: 40, right: 150 },
      { top: 40, bottom: 60, right: 70 },
    ], { signature: 'line-profile' });

    assert.equal(geometry.mode, 'smart');
    assert.equal(geometry.width, 150);
    assert.equal(geometry.height, 60);
    assert.deepEqual(geometry.polygon, [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 20 },
      { x: 150, y: 20 },
      { x: 150, y: 40 },
      { x: 70, y: 40 },
      { x: 70, y: 60 },
      { x: 0, y: 60 },
    ]);
    assert.equal(geometry.bottomRight.x, 70);
    assert.match(geometry.path, /^M 0 10 Q 0 0 10 0/);
    assert.equal((geometry.path.match(/ Q /g) || []).length, geometry.polygon.length);
    assert.equal(geometry.clipPath, `path("${geometry.path}")`);
    assert.match(geometry.path, /Q 100 20 110 20/); // inward corner
    assert.match(geometry.path, /Q 150 20 150 30/); // outward corner
  });

  it('merges adjacent line bands whose right edges differ only sub-pixel amounts', () => {
    const geometry = geometryFromLineBands([
      { top: 0, bottom: 20, right: 100 },
      { top: 20, bottom: 40, right: 100.75 },
      { top: 40, bottom: 60, right: 130 },
    ]);

    assert.deepEqual(geometry.bands, [
      { top: 0, bottom: 40, right: 100.75 },
      { top: 40, bottom: 60, right: 130 },
    ]);
  });

  it('falls back safely to the requested rectangle for empty or malformed input', () => {
    const empty = geometryFromLineBands([], {
      signature: 'fallback',
      fallbackWidth: 240,
      fallbackHeight: 90,
    });
    const malformed = geometryFromLineBands([
      { top: 10, bottom: 5, right: 80 },
      { top: 0, bottom: 10, right: Number.NaN },
    ]);

    assert.deepEqual(empty.bands, [{ top: 0, bottom: 90, right: 240 }]);
    assert.equal(empty.signature, 'fallback');
    assert.equal(malformed.width, DEFAULT_CARD_WIDTH);
    assert.equal(malformed.height, DEFAULT_CARD_HEIGHT);
  });

  it('caps corner radii on tiny steps without crossing the outline', () => {
    const geometry = geometryFromLineBands([
      { top: 0, bottom: 4, right: 40 },
      { top: 4, bottom: 7, right: 42 },
      { top: 7, bottom: 10, right: 38 },
    ]);
    assert.ok(!/NaN|Infinity/.test(geometry.path));
    assert.ok(geometry.contour.every(point => point.x >= 0 && point.x <= 42 && point.y >= 0 && point.y <= 10));
    assert.match(geometry.path, /Q 40 4 41 4/);
  });
});

describe('estimated smart and manual card geometry', () => {
  it('keeps explicitly manual cards rectangular at their persisted dimensions', () => {
    const geometry = estimateSmartCardGeometry({
      title: 'Manually sized',
      layout_mode: 'manual',
      width: 320,
      height: 84,
    });

    assert.equal(geometry.mode, 'manual');
    assert.equal(geometry.width, 320);
    assert.equal(geometry.height, 84);
    assert.deepEqual(geometry.bands, [{ top: 0, bottom: 84, right: 320 }]);
  });

  it('treats missing layout mode as smart and wraps a title into stepped bands', () => {
    const geometry = estimateSmartCardGeometry({
      title: 'Alpha beta gamma delta epsilon zeta',
      width: 120,
    });

    assert.equal(geometry.mode, 'smart');
    assert.ok(geometry.bands.length > 1);
    assert.ok(geometry.width <= 120);
    assert.ok(new Set(geometry.bands.map((band) => band.right)).size > 1);
  });

  it('uses the visible Untitled placeholder for an empty title', () => {
    const empty = estimateSmartCardGeometry({ title: '' });
    const legacy = estimateSmartCardGeometry({ title: 'New Card' });

    assert.equal(empty.mode, 'smart');
    assert.ok(empty.width > 0);
    assert.ok(empty.height > 0);
    assert.deepEqual(empty.bands, legacy.bands);
  });

  it('changes its geometry signature when relevant content or layout changes', () => {
    const base = { title: 'Alpha', width: 200 };
    assert.notEqual(getCardGeometrySignature(base), getCardGeometrySignature({ ...base, title: 'Beta' }));
    assert.notEqual(getCardGeometrySignature(base), getCardGeometrySignature({ ...base, width: 240 }));
    assert.notEqual(
      getCardGeometrySignature(base),
      getCardGeometrySignature({ ...base, layout_mode: 'manual', height: 120 }),
    );
  });

  it('sizes smart cards from the title alone, even before DOM measurement', () => {
    const card = { title: 'Alpha beta gamma delta epsilon zeta', width: 120 };
    const titleOnly = estimateSmartCardGeometry(card);
    const withHiddenContent = estimateSmartCardGeometry({ ...card, description: '<p>Saved body</p>', image_url: 'bex-media://image', tags: ['one', 'two'] });
    assert.equal(withHiddenContent.path, titleOnly.path);
    assert.equal(withHiddenContent.signature, titleOnly.signature);
    assert.ok(titleOnly.bands.length > 1);
  });
});

describe('smart boundary hit testing and ports', () => {
  const geometry = geometryFromLineBands([
    { top: 0, bottom: 30, right: 140 },
    { top: 30, bottom: 60, right: 70 },
    { top: 60, bottom: 90, right: 110 },
  ]);

  it('resolves the right edge at each vertical profile', () => {
    assert.equal(getGeometryRightAtY(geometry, 10), 140);
    assert.equal(getGeometryRightAtY(geometry, 45), 70);
    assert.equal(getGeometryRightAtY(geometry, 90), 100); // rounded bottom corner
  });

  it('rejects points and marquee rectangles wholly inside a right-edge notch', () => {
    assert.equal(pointInCardGeometry(geometry, 100, 45), false);
    assert.equal(pointInCardGeometry(geometry, 60, 45), true);
    assert.equal(
      rectIntersectsCardGeometry(geometry, { x: 90, y: 38, width: 20, height: 12 }),
      false,
    );
    assert.equal(
      rectIntersectsCardGeometry(geometry, { x: 60, y: 38, width: 20, height: 12 }),
      true,
    );
  });

  it('places ports on the actual side profile and honors fan-out ratios', () => {
    assert.deepEqual(getGeometryPort(geometry, 'top'), {
      x: 70, y: 0, side: 'top', ratio: 0.5,
    });
    assert.deepEqual(getGeometryPort(geometry, 'right'), {
      x: 70, y: 45, side: 'right', ratio: 0.5,
    });
    assert.deepEqual(getGeometryPort(geometry, 'bottom', 0.25), {
      x: 27.5, y: 90, side: 'bottom', ratio: 0.25,
    });
    assert.deepEqual(getGeometryPort(geometry, 'left', 0.75), {
      x: 0, y: 67.5, side: 'left', ratio: 0.75,
    });
  });

  it('uses each stepped band width for top and bottom anchor ratios', () => {
    assert.equal(getGeometrySideSpan(geometry, 'top'), 140);
    assert.equal(getGeometrySideSpan(geometry, 'bottom'), 110);
    assert.deepEqual(getClosestGeometryAnchor(geometry, 99, 89), {
      side: 'bottom', ratio: 0.9,
    });
    assert.deepEqual(getGeometryPort(geometry, 'bottom', 0.9), {
      x: 99, y: 90, side: 'bottom', ratio: 0.9,
    });
  });

  it('chooses the nearest real side profile for endpoint dragging', () => {
    assert.deepEqual(getClosestGeometryAnchor(geometry, 69, 45), {
      side: 'right', ratio: 0.5,
    });
    assert.deepEqual(getClosestGeometryAnchor(geometry, 1, 72), {
      side: 'left', ratio: 0.8,
    });
  });

  it('rejects a rounded-away corner but includes the softened inside notch', () => {
    assert.equal(pointInCardGeometry(geometry, 1, 1), false);
    assert.equal(pointInCardGeometry(geometry, 10, 1), true);
    assert.equal(pointInCardGeometry(geometry, 71, 32), true);
    assert.equal(pointInCardGeometry(geometry, 74, 32), false);
    assert.equal(rectIntersectsCardGeometry(geometry, { x: 0, y: 0, width: 1, height: 1 }), false);
    assert.equal(rectIntersectsCardGeometry(geometry, { x: 70.5, y: 31, width: 1, height: 1 }), true);
    assert.equal(rectIntersectsCardGeometry(geometry, { x: -10, y: -10, width: 200, height: 200 }), true);
    assert.equal(rectIntersectsCardGeometry(geometry, { x: 500, y: 500, width: 20, height: 20 }), false);
  });

  it('keeps corner ports on the curved fill, not the old square bounds', () => {
    const top = getGeometryPort(geometry, 'top', 0);
    const right = getGeometryPort(geometry, 'right', 0);
    const bottom = getGeometryPort(geometry, 'bottom', 1);
    assert.deepEqual(top, { x: 0, y: 10, side: 'top', ratio: 0 });
    assert.deepEqual(right, { x: 130, y: 0, side: 'right', ratio: 0 });
    assert.deepEqual(bottom, { x: 110, y: 80, side: 'bottom', ratio: 1 });
    for (const point of [top, right, bottom]) assert.ok(pointInCardGeometry(geometry, point.x, point.y));
  });
});
