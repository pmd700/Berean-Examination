import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSpotlightPath,
  clearSpotlightPath,
  sameSpotlightWorkspace,
  spotlightWorkspaceKey,
} from '../src/lib/spotlightNavigation.js';

test('book hits carry a page and the exact matched phrase, then consume both', () => {
  const path = buildSpotlightPath({ href: '/notes/research-4', matchPage: 2, matchText: 'conscience' }, 'clear conscience', 'three');
  const params = new URL(path, 'https://bex.local').searchParams;
  assert.equal(params.get('spotlightPage'), '2');
  assert.equal(params.get('spotlight'), 'conscience');
  assert.equal(clearSpotlightPath(path), '/notes/research-4');
});

test('builds a one-use jump to an exact Knowledge Web card', () => {
  const path = buildSpotlightPath({
    href: '/knowledge-webs/gospel-threads-41?web=41&card=51',
    matchField: 'body',
    targetId: 51,
    type: 'Web Card',
  }, 'empty tomb', 'jump-1');
  const url = new URL(path, 'https://bex.local');
  assert.equal(url.pathname, '/knowledge-webs/gospel-threads-41');
  assert.equal(url.searchParams.get('card'), '51');
  assert.equal(url.searchParams.get('spotlight'), 'empty tomb');
  assert.equal(url.searchParams.get('spotlightField'), 'body');
  assert.equal(url.searchParams.get('spotlightJump'), 'jump-1');
});

test('builds a jump to one event inside a Timeline', () => {
  const path = buildSpotlightPath({
    href: '/timegraphs/reformation-chronology-71',
    matchField: 'title',
    targetId: 'event-luther',
    type: 'Timeline Event',
  }, 'Luther posts', 'jump-2');
  const url = new URL(path, 'https://bex.local');
  assert.equal(url.searchParams.get('event'), 'event-luther');
  assert.equal(url.searchParams.get('spotlight'), 'Luther posts');
});

test('different hits in the same saved item reuse one workspace tab', () => {
  const original = '/notes/council-notes-61';
  const nextHit = '/notes/council-notes-61?spotlight=phrase&spotlightJump=two';
  assert.equal(spotlightWorkspaceKey(original), '/notes/61');
  assert.equal(sameSpotlightWorkspace(original, nextHit), true);
  assert.equal(sameSpotlightWorkspace(original, '/notes/another-note-62'), false);
});

test('a completed Knowledge Web jump is consumed without losing unrelated state', () => {
  const completed = clearSpotlightPath(
    '/knowledge-webs/gospel-threads-41?web=41&card=51&spotlight=smith&spotlightField=body&spotlightJump=once',
    ['card'],
  );
  assert.equal(completed, '/knowledge-webs/gospel-threads-41?web=41');
  assert.equal(completed.includes('smith'), false);
  assert.equal(completed.includes('card='), false);
});
