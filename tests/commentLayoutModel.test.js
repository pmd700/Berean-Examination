import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bundleNearbyComments } from '../src/components/editor/commentLayoutModel.js';

describe('comment card bundling', () => {
  it('leaves well-separated comments attached to their own anchors', () => {
    assert.deepEqual(
      bundleNearbyComments([
        { id: 'a', anchorTop: 100, height: 80 },
        { id: 'b', anchorTop: 240, height: 80 },
      ]),
      [
        { ids: ['a'], anchorTop: 100 },
        { ids: ['b'], anchorTop: 240 },
      ],
    );
  });

  it('bundles a dense run instead of pushing its cards away from their text', () => {
    const dense = Array.from({ length: 7 }, (_, index) => ({
      id: `comment-${index + 1}`,
      anchorTop: 200 + index * 12,
      height: 120,
    }));

    assert.deepEqual(bundleNearbyComments(dense), [{
      ids: dense.map(item => item.id),
      anchorTop: 200,
    }]);
  });

  it('starts a new group once the next card can sit at its real anchor', () => {
    assert.deepEqual(
      bundleNearbyComments([
        { id: 'a', anchorTop: 100, height: 100 },
        { id: 'b', anchorTop: 160, height: 100 },
        { id: 'c', anchorTop: 310, height: 60 },
      ]),
      [
        { ids: ['a', 'b'], anchorTop: 100 },
        { ids: ['c'], anchorTop: 310 },
      ],
    );
  });
});

