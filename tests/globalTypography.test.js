import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('global app typography', () => {
  it('has one JavaScript source of truth installed by both app entry points', () => {
    const typography = read('src/styles/typography.js');
    assert.match(typography, /export const APP_FONT_FAMILY = '[^']+'/);
    assert.match(typography, /setProperty\('--bex-app-font-family', APP_FONT_FAMILY\)/);
    assert.match(read('src/main.jsx'), /installAppTypography\(\)/);
    assert.match(read('src/studio/main.jsx'), /installAppTypography\(\)/);
  });

  it('routes every major text surface through the global token', () => {
    const surfaces = [
      'src/Layout.jsx',
      'src/index.css',
      'src/components/editor/RichTextEditor.jsx',
      'src/components/desktop/ActivationGate.css',
      'src/styles/timegraph.css',
      'src/components/markdown/markdown-report.css',
    ];
    for (const file of surfaces) {
      assert.match(read(file), /--bex-app-font-family/, `${file} bypasses the app font`);
    }

    const timegraph = read('src/components/timegraph/TimegraphCanvas.jsx');
    assert.match(timegraph, /import \{ APP_FONT_FAMILY \}/);
    assert.match(timegraph, /createMeasurer\(`600 \$\{12\.5 \* textScale\}px \$\{APP_FONT_FAMILY\}`\)/);
    assert.match(timegraph, /style=\{\{ fontFamily: APP_FONT_FAMILY \}\}/);
  });

  it('keeps KaTeX and interlinear Scripture on their glyph-safe fonts', () => {
    assert.match(read('src/components/logic/logic-renderer.css'), /KaTeX_Math/);
    assert.match(read('src/components/interlinear/InterlinearVerse.jsx'), /--interlinear-hebrew-font/);
    assert.match(read('src/components/interlinear/InterlinearVerse.jsx'), /--interlinear-greek-font/);
  });
});

describe('full-screen card reading width', () => {
  it('centers prose inside a bounded column and keeps a compact mobile gutter', () => {
    const cardEditor = read('src/components/knowledgeweb/CardEditor.jsx');
    assert.match(cardEditor, /width: min\(calc\(100% - 5rem\), 104rem\)/);
    assert.match(cardEditor, /margin-inline: auto/);
    assert.match(cardEditor, /@media \(max-width: 48rem\)/);
    assert.match(cardEditor, /width: calc\(100% - 2rem\)/);
  });
});
