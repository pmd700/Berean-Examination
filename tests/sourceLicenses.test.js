import assert from 'node:assert/strict';
import test from 'node:test';

import { SOURCE_LICENSE_SECTIONS } from '../src/components/licenses/sourceLicensesData.jsx';
import { getStudyExportRightsNotice } from '../src/lib/bibleStudyExportPolicy.js';
import { LOCAL_BIBLE_OPTIONS } from '../src/lib/localBible.js';

const items = SOURCE_LICENSE_SECTIONS.flatMap((section) => section.items);
const source = (name) => items.find((item) => item.name === name);

test('bundled Bible sources carry their required attribution and license terms', () => {
  const bsb = source('Berean Standard Bible (BSB)');
  assert.match(bsb.license, /Public domain/);
  assert.equal(bsb.licenseUrl, 'https://berean.bible/terms.htm');

  const lsv = source('Literal Standard Version (LSV)');
  assert.match(lsv.attribution, /Covenant Press/);
  assert.match(lsv.attribution, /Covenant Christian Coalition/);
  assert.match(lsv.attribution, /Attribution-ShareAlike 4\.0/);
  assert.match(lsv.attribution, /do not endorse BEX/);
  assert.match(lsv.exportPolicy, /do not apply DRM/);
  assert.match(lsv.exportPolicy, /source link/);
  assert.equal(lsv.licenseUrl, 'https://creativecommons.org/licenses/by-sa/4.0/');

  const exportNotice = getStudyExportRightsNotice('LSV');
  assert.match(exportNotice, /Covenant Press/);
  assert.match(exportNotice, /Covenant Christian Coalition/);
  assert.match(exportNotice, /Do not apply DRM/);
  assert.match(exportNotice, /creativecommons\.org\/licenses\/by-sa\/4\.0/);
});

test('original-language sources carry creator and copying information', () => {
  const sblgnt = source('SBL Greek New Testament (SBLGNT)');
  assert.match(sblgnt.attribution, /Michael W\. Holmes/);
  assert.match(sblgnt.attribution, /Logos Bible Software/);
  assert.match(sblgnt.attribution, /Society of Biblical Literature/);
  assert.equal(sblgnt.licenseUrl, 'https://www.sblgnt.com/license/');

  const uxlc = source('Unicode/XML Leningrad Codex (UXLC)');
  assert.match(uxlc.attribution, /Tanach\.us Inc/);
  assert.match(uxlc.license, /unrestricted copying/);
  assert.equal(uxlc.licenseUrl, 'https://tanach.us/License.html');
});

test('removed downloads and API-only editions do not falsely claim bundled permission', () => {
  for (const name of ['New Living Translation (NLT)']) {
    const item = source(name);
    assert.equal(item.legallyRemoved, true);
    assert.match(item.license, /Temporarily removed from plan/);
    assert.doesNotMatch(item.attribution, /Used by permission/i);
    assert.match(item.attribution, /does not ship|does not distribute|does not bundle/i);
  }
  for (const name of ['New American Standard Bible 1995 (NASB 1995)', 'New American Standard Bible 2020 (NASB 2020)']) {
    const item = source(name);
    assert.notEqual(item.legallyRemoved, true);
    assert.match(item.usage, /API\.Bible/);
    assert.doesNotMatch(item.attribution, /Used by permission/i);
    assert.match(item.usage + item.exportPolicy, /on demand|not selectable|not bundled/i);
  }
});

test('ESV stays online-only while KJV is accurately documented as local', () => {
  const esv = source('English Standard Version (ESV)');
  assert.match(esv.usage, /Future Online Mode only/);
  assert.match(esv.exportPolicy, /commercial API access/);
  assert.equal(esv.exportStatus, 'blocked');

  const kjv = source('King James Version (KJV)');
  assert.match(kjv.usage, /Bundled locally/);
  assert.match(kjv.exportPolicy, /United Kingdom/);
});

test('every selectable local Bible has credits and an export notice', () => {
  for (const option of LOCAL_BIBLE_OPTIONS) {
    const item = items.find((candidate) => candidate.code === option.value);
    assert.ok(item, `Missing Sources & Licenses entry for ${option.value}`);
    assert.match(item.usage, /Bundled locally|May be read/);
    assert.ok(getStudyExportRightsNotice(option.value), `Missing export notice for ${option.value}`);
  }
});

test('special public-domain boundaries remain visible', () => {
  assert.match(source('World English Bible (WEB)').exportPolicy, /do not identify/i);
  assert.match(source('American King James Version (AKJV)').attribution, /Michael Peter/);
  assert.match(source('Catholic Public Domain Version (CPDV)').attribution, /Ronald L\. Conte Jr/);
  assert.match(source('Berean Interlinear Bible (BIB)').attribution, /software, apps, and websites/);
  assert.match(source('JPS Tanakh 1917 / Weymouth New Testament').usage, /combined edition/);
});

test('KaTeX distribution retains both required MIT notices', () => {
  const katex = source('KaTeX 0.18.1');
  assert.equal(katex.license, 'MIT');
  assert.match(katex.usage, /without Internet access/);
  assert.match(katex.attribution, /2013–2020 Khan Academy and other contributors/);
  assert.match(katex.attribution, /2018 Khan Academy/);
  assert.equal(katex.documents.length, 2);

  const notices = katex.documents.map((document) => document.content).join('\n');
  assert.match(notices, /Copyright \(c\) 2013-2020 Khan Academy and other contributors/);
  assert.match(notices, /Copyright \(c\) 2018 Khan Academy/);
  assert.match(notices, /copyright notice and this permission notice shall be included/);
  assert.match(notices, /THE SOFTWARE IS PROVIDED "AS IS"/);
});

test('local Rajdhani distribution retains its copyright and full OFL notice', () => {
  const rajdhani = source('Rajdhani');
  assert.equal(rajdhani.license, 'SIL OFL 1.1');
  assert.match(rajdhani.usage, /Bundled locally/);
  assert.match(rajdhani.usage, /Bundled locally as a licensed legacy option/);
  assert.match(rajdhani.attribution, /2014 Indian Type Foundry/);
  assert.equal(rajdhani.documents.length, 1);

  const notice = rajdhani.documents[0].content;
  assert.match(notice, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(notice, /each copy\s+contains the above copyright notice and this license/);
  assert.match(notice, /THE FONT SOFTWARE IS PROVIDED "AS IS"/);
});
