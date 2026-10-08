import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canFrameOpenedWeb } from '../src/components/knowledgeweb/knowledgeWebOpeningFrame.js';

describe('Knowledge Web opening frame', () => {
  it('waits while the newly active web is still loading', () => {
    assert.equal(canFrameOpenedWeb(22, 22, null), false);
  });

  it('rejects cards left over from the previously loaded web', () => {
    assert.equal(canFrameOpenedWeb(22, 22, 21), false);
  });

  it('frames only after the requested web is active and fully loaded', () => {
    assert.equal(canFrameOpenedWeb(22, 22, 22), true);
  });

  it('does not let a superseded request move the current camera', () => {
    assert.equal(canFrameOpenedWeb(21, 22, 22), false);
  });
});
