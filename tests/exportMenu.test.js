import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ExportMenu from '../src/components/knowledgeweb/ExportMenu.jsx';

// Render-level guard for the export menu UI. The reviewer flagged that
// without coverage of the actual buttons (test ids + disabled-state during
// export), regressions like a missing button or a stuck "Exporting..."
// state can ship silently.
//
// We render the menu via react-dom/server (no JSDOM, no extra devDeps) and
// inspect the resulting markup. This is intentionally lightweight: a real
// browser-driven E2E (logging in, clicking the buttons, watching the disabled
// state toggle) still requires a test-mode auth bypass — see follow-up #13.

function render(props = {}) {
  return renderToStaticMarkup(React.createElement(ExportMenu, props));
}

function assertButtonPresent(html, testId) {
  assert.match(html, new RegExp(`data-testid="${testId}"`),
    `expected markup to contain a button with data-testid="${testId}"`);
}

function assertButtonDisabled(html, testId) {
  // react-dom/server renders boolean `disabled` as the attribute `disabled=""`.
  // (Tailwind variants like `disabled:opacity-50` live inside `class=`, so we
  // must match the standalone attribute, not the substring.)
  const re = new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>`);
  const match = html.match(re);
  assert.ok(match, `no button with data-testid="${testId}" found`);
  assert.match(match[0], /\sdisabled=""/,
    `expected button "${testId}" to be disabled but it was enabled`);
}

function assertButtonEnabled(html, testId) {
  const re = new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>`);
  const match = html.match(re);
  assert.ok(match, `no button with data-testid="${testId}" found`);
  assert.doesNotMatch(match[0], /\sdisabled=""/,
    `expected button "${testId}" to be enabled but it was disabled`);
}

function buttonLabel(html, testId) {
  // Pull the inner text after the icon. We just check the visible label
  // contains either "Exporting..." or "Export ...".
  const re = new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>([\\s\\S]*?)</button>`);
  const match = html.match(re);
  assert.ok(match, `no button with data-testid="${testId}" found`);
  return match[1];
}

describe('ExportMenu', () => {
  it('renders all five export buttons (PDF, JPEG, PNG, .berean, Markdown) with the expected test ids', () => {
    const html = render({});
    assertButtonPresent(html, 'button-export-pdf');
    assertButtonPresent(html, 'button-export-json');
    assertButtonPresent(html, 'button-export-jpeg');
    assertButtonPresent(html, 'button-export-png');
    assertButtonPresent(html, 'button-export-berean');
    assertButtonPresent(html, 'button-export-markdown');
    // and the import button next to them
    assertButtonPresent(html, 'button-import-berean');
    assertButtonPresent(html, 'button-mass-import');
  });

  it('renders the export region radio buttons', () => {
    const html = render({});
    assertButtonPresent(html, 'button-export-region-whole');
    assertButtonPresent(html, 'button-export-region-view');
    assertButtonPresent(html, 'button-export-region-section');
  });

  it('shows idle labels by default and leaves the export buttons enabled', () => {
    const html = render({});
    // Labels were tightened in the grouped-menu redesign: the surrounding
    // "AS IMAGE" / "AS DATA" group headings + the per-row file-extension chip
    // (".pdf", ".jpg", ".berean") carry the "this is an export" affordance,
    // so the row text itself is now the format name only.
    assert.match(buttonLabel(html, 'button-export-pdf'), /PDF/);
    assert.match(buttonLabel(html, 'button-export-jpeg'), /JPEG/);
    assert.match(buttonLabel(html, 'button-export-berean'), /Berean/);
    assertButtonEnabled(html, 'button-export-pdf');
    assertButtonEnabled(html, 'button-export-jpeg');
    assertButtonEnabled(html, 'button-export-berean');
  });

  it('disables the PDF button and shows "Exporting..." while a PDF export is in flight', () => {
    const html = render({ isExportingPdf: true });
    assertButtonDisabled(html, 'button-export-pdf');
    assert.match(buttonLabel(html, 'button-export-pdf'), /Exporting\.\.\./);
    // Other buttons stay enabled — exports are independent.
    assertButtonEnabled(html, 'button-export-jpeg');
    assertButtonEnabled(html, 'button-export-berean');
  });

  it('disables the JPEG button and shows "Exporting..." while a JPEG export is in flight', () => {
    const html = render({ isExportingJpeg: true });
    assertButtonDisabled(html, 'button-export-jpeg');
    assert.match(buttonLabel(html, 'button-export-jpeg'), /Exporting\.\.\./);
    assertButtonEnabled(html, 'button-export-pdf');
    assertButtonEnabled(html, 'button-export-berean');
  });

  it('disables the PNG button and shows "Exporting..." while a PNG export is in flight', () => {
    const html = render({ isExportingPng: true });
    assertButtonDisabled(html, 'button-export-png');
    assert.match(buttonLabel(html, 'button-export-png'), /Exporting\.\.\./);
    assertButtonEnabled(html, 'button-export-pdf');
    assertButtonEnabled(html, 'button-export-jpeg');
  });

  it('disables the .berean button and shows "Exporting..." while a .berean export is in flight', () => {
    const html = render({ isExportingBerean: true });
    assertButtonDisabled(html, 'button-export-berean');
    assert.match(buttonLabel(html, 'button-export-berean'), /Exporting\.\.\./);
    assertButtonEnabled(html, 'button-export-pdf');
    assertButtonEnabled(html, 'button-export-jpeg');
  });

  it('disables PDF and JPEG when "Selected section" is chosen but no section is selected', () => {
    const html = render({ exportRegion: 'section', selectedObjectId: null, canvasObjects: [] });
    assertButtonDisabled(html, 'button-export-pdf');
    assertButtonDisabled(html, 'button-export-jpeg');
    // .berean export is independent of region and remains enabled.
    assertButtonEnabled(html, 'button-export-berean');
  });

  it('enables PDF and JPEG when a section is selected and "Selected section" region is active', () => {
    const html = render({
      exportRegion: 'section',
      selectedObjectId: 'sec-1',
      canvasObjects: [{ id: 'sec-1', object_type: 'section' }],
    });
    assertButtonEnabled(html, 'button-export-pdf');
    assertButtonEnabled(html, 'button-export-jpeg');
  });

  it('disables the import button while an import is in flight', () => {
    const html = render({ isImportingBerean: true });
    assertButtonDisabled(html, 'button-import-berean');
    assert.match(buttonLabel(html, 'button-import-berean'), /Importing\.\.\./);
  });

  it('renders mass import directly after single-file import and gives it an independent busy state', () => {
    const html = render({ isMassImporting: true });
    assert.ok(html.indexOf('button-import-berean') < html.indexOf('button-mass-import'));
    assertButtonDisabled(html, 'button-mass-import');
    assert.match(buttonLabel(html, 'button-mass-import'), /Importing files\.\.\./);
    assertButtonEnabled(html, 'button-import-berean');
  });

  it('keeps mass import available when there is no open Knowledge Web', () => {
    const html = render({ canUseCurrentWeb: false });
    assertButtonDisabled(html, 'button-export-berean');
    assertButtonDisabled(html, 'button-import-berean');
    assertButtonEnabled(html, 'button-mass-import');
  });

  it('renders the Full Second Brain Backup button with the required helper text when a handler is provided', () => {
    const html = render({ handleFullBackup: () => {} });
    assertButtonPresent(html, 'button-full-backup');
    assert.match(buttonLabel(html, 'button-full-backup'), /Full Second Brain Backup/);
    assert.match(
      buttonLabel(html, 'button-full-backup'),
      /Exports every Knowledge Web as restore-compatible Markdown and downloads them in one zip\./,
    );
    assertButtonEnabled(html, 'button-full-backup');
  });

  it('omits the backup button when no handler is provided', () => {
    const html = render({});
    assert.doesNotMatch(html, /data-testid="button-full-backup"/);
  });

  it('disables the backup button and shows progress text while a backup is in flight', () => {
    const html = render({ handleFullBackup: () => {}, isBackingUp: true, backupProgress: 'Exporting 3 / 14 webs...' });
    assertButtonDisabled(html, 'button-full-backup');
    assert.match(buttonLabel(html, 'button-full-backup'), /Exporting 3 \/ 14 webs\.\.\./);
  });
});
