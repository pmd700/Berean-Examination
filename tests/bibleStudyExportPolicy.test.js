import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ESV_STUDY_EXPORT_POLICY,
  assertStudyMaterialExportAllowed,
  getBlockedStudyExportTranslations,
  getStudyExportRightsNotice,
  isStudyMaterialExportAllowed,
} from '../src/lib/bibleStudyExportPolicy.js';
import { buildStudyChapterMarkdown } from '../src/lib/bibleStudyExport.js';

const chapter = (version) => ({
  id: 1,
  book: 'Genesis',
  chapter_number: 1,
  version,
  raw_text: '~1 In the beginning God created the heavens and the earth.',
  notes: 'Personal note',
});

describe('Bible Study export rights policy', () => {
  it('keeps ESV export permanently disabled for the current product', () => {
    assert.equal(ESV_STUDY_EXPORT_POLICY.enabled, false);
    assert.match(ESV_STUDY_EXPORT_POLICY.status, /permanently disabled/i);
    assert.equal(isStudyMaterialExportAllowed(chapter('ESV')), false);
    assert.equal(isStudyMaterialExportAllowed(chapter('English Standard Version')), false);
    assert.throws(
      () => assertStudyMaterialExportAllowed(chapter('ESV')),
      (error) => error.code === 'BIBLE_STUDY_EXPORT_BLOCKED',
    );
  });

  it('blocks an entire mixed export when any selected chapter is ESV', () => {
    assert.deepEqual(
      getBlockedStudyExportTranslations([
        chapter('KJV'),
        chapter('BSB'),
        chapter('ESV'),
        chapter('LSV'),
      ]),
      ['ESV'],
    );
  });

  it('allows KJV, BSB, and LSV study exports', () => {
    for (const version of ['KJV', 'BSB', 'LSV']) {
      assert.equal(isStudyMaterialExportAllowed(chapter(version)), true);
      assert.doesNotThrow(() => assertStudyMaterialExportAllowed(chapter(version)));
    }
  });

  it('refuses to build an ESV export before any browser download begins', () => {
    assert.throws(
      () => buildStudyChapterMarkdown({ chapter: chapter('ESV') }),
      (error) => error.code === 'BIBLE_STUDY_EXPORT_BLOCKED',
    );
  });

  it('adds the appropriate rights notice to allowed chapter exports', () => {
    const bsb = buildStudyChapterMarkdown({ chapter: chapter('BSB') });
    const lsv = buildStudyChapterMarkdown({ chapter: chapter('LSV') });
    const kjv = buildStudyChapterMarkdown({ chapter: chapter('KJV') });

    assert.match(bsb, /dedicated to the public domain/i);
    assert.match(lsv, /Literal Standard Version/);
    assert.match(lsv, /CC BY-SA 4\.0/);
    assert.match(kjv, /public domain in the United States/i);
    assert.match(kjv, /Cambridge University Press/i);
  });

  it('keeps current rights notices centralized', () => {
    assert.match(getStudyExportRightsNotice('BSB'), /berean\.bible\/terms/);
    assert.match(getStudyExportRightsNotice('LSV'), /creativecommons\.org\/licenses\/by-sa\/4\.0/);
    assert.match(getStudyExportRightsNotice('KJV'), /cambridge\.org/);
    assert.match(getStudyExportRightsNotice('NASB1995'), /1995.*The Lockman Foundation/);
    assert.match(getStudyExportRightsNotice({ version: 'NASB1995', api_copyright: 'Edition-specific notice' }), /Edition-specific notice/);
    assert.match(getStudyExportRightsNotice({ version: 'NASB', api_copyright: 'Publisher-supplied NASB notice' }), /Publisher-supplied NASB notice/);
    assert.match(getStudyExportRightsNotice({ version: 'NBLA', api_copyright: 'Derechos reservados del editor' }), /Nueva Biblia de las Américas.*\nDerechos reservados del editor/);
  });

  it('requires every active Bible Study exporter to use the shared policy', () => {
    const files = [
      'src/components/progress/ProgressTracker.jsx',
      'src/components/drawing/DrawingEditor.jsx',
      'src/pages/Study.jsx',
    ];
    for (const file of files) {
      const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      assert.match(source, /bibleStudyExportPolicy/);
    }
  });
});
