import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  isOnlineOnlyTranslation,
  isOnlineTranslationAvailable,
  ONLINE_MODE_ENABLED,
  ONLINE_MODE_REQUIRED_MESSAGE,
} from '../src/lib/onlineMode.js';

test('Offline Mode blocks ESV but leaves all local translations available', () => {
  assert.equal(ONLINE_MODE_ENABLED, false);
  assert.equal(ONLINE_MODE_REQUIRED_MESSAGE, 'Requires Online Mode');

  assert.equal(isOnlineOnlyTranslation('ESV'), true);
  assert.equal(isOnlineTranslationAvailable('ESV'), false);

  for (const version of ['BSB', 'KJV', 'BGB', 'BIB', 'LSV', 'Paste Your Own']) {
    assert.equal(isOnlineOnlyTranslation(version), false);
    assert.equal(isOnlineTranslationAvailable(version), true);
  }
});

test('Study uses the canonical guarded search session while the legacy provider stays dormant', async () => {
  const studySource = await readFile(new URL('../src/pages/Study.jsx', import.meta.url), 'utf8');
  const sessionSource = await readFile(new URL('../src/components/scripture/useScriptureSearchSession.js', import.meta.url), 'utf8');
  const desktopSource = await readFile(new URL('../src/api/desktopClient.js', import.meta.url), 'utf8');
  assert.match(studySource, /useScriptureSearchSession/);
  assert.match(studySource, /startSearch\(queryText, bibleId/);
  const guard = sessionSource.indexOf('if (isTranslationRemovedFromPlan(session.abbreviation))');
  const batch = sessionSource.indexOf('await fetchScriptureBatch(');
  assert.notEqual(guard, -1, 'Removed translations must be guarded by the current reader');
  assert.ok(batch > guard, 'The edition guard must run before retrieval');
  assert.match(sessionSource.slice(guard, batch), /return;/);
  assert.match(desktopSource, /Online Mode is dormant/);
  assert.match(desktopSource, /No provider or Internet request was started/);
});
