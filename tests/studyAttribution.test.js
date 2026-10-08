import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { SOURCE_LICENSE_SECTIONS } from '../src/components/licenses/sourceLicensesData.jsx';
import { LOCAL_BIBLE_OPTIONS } from '../src/lib/localBible.js';
import { getStudyExportRightsNotice } from '../src/lib/bibleStudyExportPolicy.js';

const items = SOURCE_LICENSE_SECTIONS.flatMap((section) => section.items);

test('every local Bible credit uses secure working-link plumbing', async () => {
  for (const option of LOCAL_BIBLE_OPTIONS) {
    const item = items.find((candidate) => candidate.code === option.value);
    assert.ok(item, `Missing credit for ${option.value}`);
    for (const url of [item.sourceUrl, item.licenseUrl].filter(Boolean)) {
      assert.match(url, /^https:\/\//);
    }
  }

  const componentSource = await readFile(
    new URL('../src/components/licenses/SourceLicenseSection.jsx', import.meta.url),
    'utf8',
  );
  assert.match(componentSource, /ExternalWebLink/);
  assert.doesNotMatch(componentSource, /<a\s+href=\{item\.(?:sourceUrl|licenseUrl)\}/);
});

test('Study renders the active translation notice after the Scripture area', async () => {
  const studySource = await readFile(new URL('../src/pages/Study.jsx', import.meta.url), 'utf8');
  const scriptureClose = studySource.lastIndexOf('</div>\n              <ScriptureAttribution');
  assert.notEqual(scriptureClose, -1);
  assert.match(studySource, /data-testid="text-scripture-attribution"/);

  for (const option of LOCAL_BIBLE_OPTIONS) {
    assert.ok(getStudyExportRightsNotice(option.value), `Missing Study footer for ${option.value}`);
  }
});
