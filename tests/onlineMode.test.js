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

test('Study guards offline translations before the preserved API branch', async () => {
  const studySource = await readFile(new URL('../src/pages/Study.jsx', import.meta.url), 'utf8');
  const offlineGuard = studySource.indexOf('if (!isOnlineTranslationAvailable(selectedVersion))');
  const preservedApi = studySource.indexOf("platformFunctions.invoke('fetchBibleChapter'");

  assert.notEqual(offlineGuard, -1, 'Offline guard must remain in Study');
  assert.notEqual(preservedApi, -1, 'Future Online Mode API code must remain preserved');
  assert.ok(offlineGuard < preservedApi, 'Offline guard must run before the API branch');
  assert.match(studySource, /value: 'ESV'.*onlineOnly: true/);
  assert.doesNotMatch(studySource, /value: 'KJV'.*onlineOnly: true/);
  assert.match(studySource, /useState\('BSB'\)/);
});
