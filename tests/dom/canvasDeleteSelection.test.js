import { describe, expect, it } from 'vitest';
import { canvasDeleteSelection } from '@/components/knowledgeweb/canvasDeleteSelection';

describe('canvas delete selection', () => {
  it('targets a marquee-selected point even without any selected cards or single object', () => {
    expect(canvasDeleteSelection({ pointIds: [7], cardId: null, objectId: null })).toEqual({ cardIds: [], objectIds: [7] });
  });
  it('targets all points and cards in a mixed marquee, ignoring stale individual selections', () => {
    expect(canvasDeleteSelection({ cardIds: [1, 2], pointIds: [7, 8, 7], objectId: 9, connectionId: 10 })).toEqual({ cardIds: [1, 2], objectIds: [7, 8] });
  });
  it('retains individual card, object and connection deletion priorities', () => {
    expect(canvasDeleteSelection({ cardId: 1, objectId: 7, connectionId: 8 })).toEqual({ cardIds: [1], objectIds: [] });
    expect(canvasDeleteSelection({ objectId: 7, connectionId: 8 })).toEqual({ cardIds: [], objectIds: [7] });
    expect(canvasDeleteSelection({ connectionId: 8 })).toEqual({ connectionId: 8 });
    expect(canvasDeleteSelection({})).toBeNull();
  });
});
