import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSession, normalizeWorkspacePath } from '../src/lib/workspaceSession.js';

test('restored picker tabs become home tabs without losing identities or saved study targets', () => {
  const original = { tabs: [
    { id: 'picker', kind: 'study', path: '/Study?new=1', title: 'New Bible Study' },
    { id: 'chapter', kind: 'study', path: '/Study?chapter_id=42', title: 'Matthew 5' },
    { id: 'history', kind: 'study', path: '/Study', title: 'Bible Study' },
    { id: 'note', kind: 'notes', path: '/notes/research-7', title: 'Research' },
  ], activeId: 'picker' };
  const restored = normalizeSession(original);
  assert.equal(restored.activeId, 'picker');
  assert.deepEqual(restored.tabs[0], { id: 'picker', kind: 'home', path: '/LibraryHome', title: 'New tab' });
  assert.deepEqual(restored.tabs.slice(1), original.tabs.slice(1));
  assert.equal(original.tabs[0].path, '/Study?new=1');
  assert.equal(normalizeWorkspacePath('/Study?new=1&chapter_id=42'), '/Study?new=1&chapter_id=42');
});
