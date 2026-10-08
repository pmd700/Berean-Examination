import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { positionLinkPanel } from '../src/components/editor/linkPanelModel.js';

describe('link editor placement', () => {
  it('opens directly below the link', () => {
    assert.deepEqual(
      positionLinkPanel(
        { left: 180, top: 220, bottom: 240 },
        { width: 1200, height: 800 },
      ),
      { left: 180, top: 248 },
    );
  });

  it('flips above a link near the bottom edge', () => {
    assert.deepEqual(
      positionLinkPanel(
        { left: 180, top: 700, bottom: 720 },
        { width: 1200, height: 800 },
      ),
      { left: 180, top: 536 },
    );
  });

  it('stays inside both horizontal viewport edges', () => {
    assert.equal(positionLinkPanel(
      { left: -40, top: 100, bottom: 120 },
      { width: 1200, height: 800 },
    ).left, 12);
    assert.equal(positionLinkPanel(
      { left: 1100, top: 100, bottom: 120 },
      { width: 1200, height: 800 },
    ).left, 808);
  });
});
