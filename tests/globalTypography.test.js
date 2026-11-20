import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getAppFontFamily } from '../src/styles/typography.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('global app typography', () => {
  it('has one JavaScript source of truth installed by both app entry points', () => {
    const typography = read('src/styles/typography.js');
    assert.match(typography, /export let APP_FONT_FAMILY = getAppFontFamily\(\)/);
    assert.match(typography, /setProperty\('--bex-app-font-family', APP_FONT_FAMILY\)/);
    assert.match(read('src/main.jsx'), /installAppTypography\(\)/);
    assert.match(read('src/studio/main.jsx'), /installAppTypography\(\)/);
  });

  it('routes every major text surface through the global token', () => {
    const surfaces = [
      'src/Layout.jsx',
      'src/index.css',
      'src/components/editor/TEXT_EDITOR_MACHINERY.jsx',
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

  it('bundles a licensed offline emoji fallback before generic system fallback', () => {
    assert.ok(getAppFontFamily('Win32').indexOf('"BEX Color Emoji"') < getAppFontFamily('Win32').indexOf('"Segoe UI Emoji"'));
    assert.match(read('src/index.css'), /@import '\.\/styles\/emoji\.css'/);
    const css = read('src/styles/emoji.css');
    assert.match(css, /font-family: "BEX Color Emoji"/);
    assert.match(css, /url\('\.\/fonts\/Noto-COLRv1\.ttf'\)/);
    const font = fs.readFileSync(path.join(root, 'src/styles/fonts/Noto-COLRv1.ttf'));
    assert.equal(font.readUInt32BE(0), 0x00010000, 'Fallback must be an actual TrueType font');
    assert.match(read('src/styles/fonts/OFL.txt'), /SIL OPEN FONT LICENSE Version 1\.1/);
  });

  it('prefers Apple artwork on macOS and keeps the bundled style on Windows/Linux', () => {
    for (const platform of ['MacIntel', 'MacPPC', 'macOS', 'iPad']) {
      const font = getAppFontFamily(platform);
      assert.ok(font.indexOf('Arial') < font.indexOf('"Apple Color Emoji"'));
      assert.ok(font.indexOf('"Apple Color Emoji"') < font.indexOf('"BEX Color Emoji"'));
    }
    for (const platform of ['Win32', 'Windows', 'Linux x86_64', '']) {
      const font = getAppFontFamily(platform);
      assert.ok(font.indexOf('Arial') < font.indexOf('"BEX Color Emoji"'));
      assert.ok(font.indexOf('"BEX Color Emoji"') < font.indexOf('"Apple Color Emoji"'));
    }
  });

  it('uses locally derived Apple artwork when the native font paints blank pixels', () => {
    const font = getAppFontFamily('MacIntel', false);
    assert.ok(font.indexOf('"BEX Native Apple Emoji"') < font.indexOf('"BEX Color Emoji"'));
    assert.ok(font.indexOf('"BEX Color Emoji"') < font.indexOf('"Apple Color Emoji"'));
    const typography = read('src/styles/typography.js');
    assert.match(typography, /getImageData/);
    assert.match(typography, /getNativeEmojiFont/);
    assert.match(read('desktop/main.cjs'), /registerEmojiHandlers/);
    assert.match(read('desktop/course-studio-main.cjs'), /registerEmojiHandlers/);
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
