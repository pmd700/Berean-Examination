import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SYNC_DECISION,
  decideContentSync,
  shouldApplyExternalContent,
} from '../src/components/editor/contentSyncRule.js';

/**
 * The rule that decides whether an incoming `content` prop may replace the
 * document. Getting this wrong loses the user's writing silently, so every
 * branch is pinned here.
 */

const decide = (overrides) => decideContentSync({
  incoming: '<p>b</p>',
  current: '<p>a</p>',
  lastEmitted: '<p>a</p>',
  isEditing: false,
  ...overrides,
});

describe('content sync rule', () => {
  describe('the document is already current', () => {
    test('identical content is a no-op, even mid-edit', () => {
      // Re-applying identical HTML would still reset the caret to the top.
      assert.equal(
        decide({ incoming: '<p>a</p>', current: '<p>a</p>', isEditing: true }),
        SYNC_DECISION.ALREADY_CURRENT,
      );
    });

    test('null and empty incoming are treated the same as empty content', () => {
      assert.equal(
        decide({ incoming: null, current: '', lastEmitted: null }),
        SYNC_DECISION.ALREADY_CURRENT,
      );
      assert.equal(
        decide({ incoming: undefined, current: '', lastEmitted: null }),
        SYNC_DECISION.ALREADY_CURRENT,
      );
    });
  });

  describe('before the user has typed anything', () => {
    test('a late load from the database applies', () => {
      // The common case at mount: content arrives after the editor exists.
      assert.equal(
        decide({ incoming: '<p>loaded</p>', current: '', lastEmitted: null }),
        SYNC_DECISION.APPLY,
      );
    });

    test('but not while the user is already in the editor', () => {
      assert.equal(
        decide({ incoming: '<p>loaded</p>', current: '', lastEmitted: null, isEditing: true }),
        SYNC_DECISION.BUSY,
      );
    });

    test('undefined lastEmitted behaves like null', () => {
      assert.equal(
        decide({ incoming: '<p>loaded</p>', current: '', lastEmitted: undefined }),
        SYNC_DECISION.APPLY,
      );
    });
  });

  describe('protecting work in progress', () => {
    test('refuses while the user is editing', () => {
      assert.equal(decide({ isEditing: true }), SYNC_DECISION.BUSY);
    });

    test('refuses when the editor has moved on from what the parent knows', () => {
      // The stale-prop case: the user typed, the parent has not caught up, and
      // its older value comes back down.
      assert.equal(
        decide({
          incoming: '<p>stale</p>',
          current: '<p>a plus new typing</p>',
          lastEmitted: '<p>a</p>',
        }),
        SYNC_DECISION.UNACKNOWLEDGED,
      );
    });

    test('unacknowledged work is protected even when the editor looks idle', () => {
      // This is the marquee case: a block selection deliberately blurs the
      // editor, so "idle" is not the same as "safe to overwrite".
      assert.equal(
        decide({
          incoming: '<p>stale</p>',
          current: '<p>typed then blurred</p>',
          lastEmitted: '<p>a</p>',
          isEditing: false,
        }),
        SYNC_DECISION.UNACKNOWLEDGED,
      );
    });
  });

  describe('genuine document changes still load', () => {
    test('applies when idle and in step with the parent', () => {
      // Switching Knowledge Web cards reuses this editor without remounting, so
      // this path has to keep working.
      assert.equal(decide({}), SYNC_DECISION.APPLY);
    });

    test('applies an empty document, such as clearing a card', () => {
      assert.equal(
        decide({ incoming: '', current: '<p>a</p>', lastEmitted: '<p>a</p>' }),
        SYNC_DECISION.APPLY,
      );
    });
  });

  describe('shouldApplyExternalContent', () => {
    test('is true only for APPLY', () => {
      assert.equal(shouldApplyExternalContent({
        incoming: '<p>b</p>', current: '<p>a</p>', lastEmitted: '<p>a</p>', isEditing: false,
      }), true);

      for (const state of [
        { incoming: '<p>a</p>', current: '<p>a</p>', lastEmitted: '<p>a</p>', isEditing: false },
        { incoming: '<p>b</p>', current: '<p>a</p>', lastEmitted: '<p>a</p>', isEditing: true },
        { incoming: '<p>b</p>', current: '<p>c</p>', lastEmitted: '<p>a</p>', isEditing: false },
      ]) {
        assert.equal(shouldApplyExternalContent(state), false);
      }
    });
  });

  describe('the regression this replaced', () => {
    test('a blurred editor with unsaved work is no longer overwritten', () => {
      // Old behaviour: the only guard was `editor.isFocused`. With the caret
      // released by a marquee selection that read false, and the stale prop was
      // applied — the user's paragraph vanished.
      const state = {
        incoming: '<p>value from a slow save</p>',
        current: '<p>a sentence the user just finished</p>',
        lastEmitted: '<p>a sentence the user</p>',
        isEditing: false,
      };
      assert.equal(shouldApplyExternalContent(state), false);
      assert.equal(decideContentSync(state), SYNC_DECISION.UNACKNOWLEDGED);
    });
  });
});
