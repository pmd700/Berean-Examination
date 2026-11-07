import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Two protections against losing work.
 *
 * A render crash used to unmount the whole app, taking every tab's unsaved state
 * with it; and the tab session lived only in localStorage, which the packaged
 * app throws away on every launch because it is served from a new origin.
 */

const root = path.resolve(import.meta.dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('crash containment', () => {
  const boundary = read('src/components/ErrorBoundary.jsx');
  const workspace = read('src/components/tabs/TabWorkspace.jsx');

  test('the boundary implements both halves of the React contract', () => {
    // getDerivedStateFromError renders the fallback; componentDidCatch is where
    // the error is actually reported. One without the other is a silent failure.
    assert.match(boundary, /static getDerivedStateFromError\(error\)/);
    assert.match(boundary, /componentDidCatch\(error, info\)/);
  });

  test('every tab pane is wrapped, so a crash cannot take the app down', () => {
    assert.match(workspace, /import ErrorBoundary from '@\/components\/ErrorBoundary'/);
    assert.match(workspace, /<ErrorBoundary[^>]*>[\s\S]*?<React\.Suspense[\s\S]*?<TabRoutes path=\{tab\.path\} \/>[\s\S]*?<\/React\.Suspense>\s*<\/ErrorBoundary>/);
  });

  test('retry remounts the subtree rather than re-rendering the broken one', () => {
    // Without the key bump, "retry" just re-runs the same render and fails again
    // with no clean state.
    assert.match(boundary, /attempt: current\.attempt \+ 1/);
    assert.match(boundary, /<React\.Fragment key=\{attempt\}>/);
  });

  test('a pane that navigates away clears its own error', () => {
    assert.match(boundary, /previousProps\.resetKey !== this\.props\.resetKey/);
    assert.match(workspace, /resetKey=\{tab\.path\}/);
  });

  test('the crash report stays local', () => {
    // This is a local-first app; a component stack is a page of the user's own
    // study material and must not be shipped anywhere.
    assert.match(boundary, /console\.error/);
    assert.equal(/fetch\(|XMLHttpRequest|sendBeacon/.test(boundary), false);
  });
});

describe('tab session survives a relaunch', () => {
  const tabs = read('src/lib/WorkspaceTabs.jsx');

  test('the session is mirrored into the library, not just localStorage', () => {
    // localStorage alone is lost every launch: the packaged app is served from
    // an ephemeral port, so the origin and its whole storage bucket change.
    assert.match(tabs, /desktopClient\.owner\.updatePreferences\(\{ \[STORAGE_KEY\]: session \}\)/);
    assert.match(tabs, /readLocalOwner/);
  });

  test('localStorage stays the synchronous first-paint cache', () => {
    // The first render needs a session before any async read could return.
    assert.match(tabs, /window\.localStorage\.setItem\(STORAGE_KEY/);
    assert.match(tabs, /window\.localStorage\.getItem\(STORAGE_KEY\)/);
  });

  test('the library copy is only adopted when this launch had nothing', () => {
    // Read during the first render, because the persist effect writes
    // localStorage immediately and would erase the distinction.
    assert.match(tabs, /hadLocalSession\.current = Boolean\(readStoredSession\(\)\)/);
    assert.match(tabs, /if \(!isDesktopRuntime\(\) \|\| hadLocalSession\.current\) return undefined;/);
  });

  test('a session the user has already touched always wins', () => {
    assert.match(tabs, /if \(cancelled \|\| !stored \|\| touched\.current\) return;/);
    assert.match(tabs, /if \(firstPersist\.current\) firstPersist\.current = false;\s*\n\s*else touched\.current = true;/);
  });

  test('neither store is allowed to break the app when unavailable', () => {
    assert.match(tabs, /catch \{ \/\* storage full or blocked/);
    assert.match(tabs, /catch \{ \/\* cached locally/);
    assert.match(tabs, /catch \{ \/\* not signed in yet/);
  });
});

describe('the session shape guard', () => {
  const load = () => import('../src/lib/workspaceSession.js');

  test('accepts a real session and picks a valid active tab', async () => {
    const { normalizeSession } = await load();
    const result = normalizeSession({
      activeId: 'b',
      tabs: [{ id: 'a', path: '/Study' }, { id: 'b', path: '/Keywords' }],
    });
    assert.equal(result.tabs.length, 2);
    assert.equal(result.activeId, 'b');
  });

  test('falls back to the first tab when the active id is missing', async () => {
    const { normalizeSession } = await load();
    const result = normalizeSession({
      activeId: 'gone',
      tabs: [{ id: 'a', path: '/Study' }],
    });
    assert.equal(result.activeId, 'a');
  });

  test('refuses anything that would blank the workspace', async () => {
    const { normalizeSession } = await load();
    // Adopting any of these would replace the user's tabs with nothing.
    assert.equal(normalizeSession(null), null);
    assert.equal(normalizeSession({}), null);
    assert.equal(normalizeSession({ tabs: [] }), null);
    assert.equal(normalizeSession({ tabs: 'not an array' }), null);
    assert.equal(normalizeSession({ tabs: [{ id: 'a' }] }), null);        // no path
    assert.equal(normalizeSession({ tabs: [{ path: '/Study' }] }), null); // no id
  });

  test('drops malformed tabs but keeps the sound ones', async () => {
    const { normalizeSession } = await load();
    const result = normalizeSession({
      activeId: 'a',
      tabs: [{ id: 'a', path: '/Study' }, null, { id: 'b' }, { path: '/x' }],
    });
    assert.deepEqual(result.tabs.map((tab) => tab.id), ['a']);
  });
});
