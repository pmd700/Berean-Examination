import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import TEXT_EDITOR_MACHINERY from '@/components/editor/TEXT_EDITOR_MACHINERY';
import { APP_FONT_FAMILY, getAppFontFamily, installAppTypography } from '@/styles/typography';
import '@/index.css';

// Let the native proof exercise the Windows fallback while running on a Mac.
const platform = new URLSearchParams(location.search).get('platform');
const typographyReady = platform ? Promise.resolve() : installAppTypography();
let fontFamily;
const samples = ['😀', '❌', '✅', '🔥', '❤️', '👩🏽‍💻', '🇺🇸', '1️⃣', 'A', '1', 'א', 'Ω',
  '💯', '🟢', '🟡', '📚', '🧠', '🙏🏿', '👨‍👩‍👧‍👦', '🫱🏻‍🫲🏿', '🧑🏿‍🤝‍🧑🏻', '🏳️‍🌈'];
let editor;
function Fixture() {
  return <MemoryRouter><TEXT_EDITOR_MACHINERY bare content={`<h1>📚 Heading 😀</h1><h2>✅ Bold heading ❌</h2><p>${samples.map(text => `<span>${text}</span> `).join('')}</p>`}
    onChange={() => {}} onEditorReady={value => { editor = value; }} /></MemoryRouter>;
}
typographyReady.then(() => {
  fontFamily = platform ? getAppFontFamily(platform) : APP_FONT_FAMILY;
  document.documentElement.style.setProperty('--bex-app-font-family', fontFamily);
  createRoot(document.getElementById('editor')).render(<Fixture />);
});
window.emojiProof = {
  ready: () => !!editor,
  samples,
  async prepare() {
    await document.fonts.load(`36px "BEX Color Emoji"`);
    await document.fonts.ready;
    const host = document.getElementById('samples');
    // Exercise the same token on normal, bold and italic text, plus SVG/canvas.
    for (const style of ['', 'font-weight:700', 'font-style:italic']) {
      for (const text of samples) {
        const span = document.createElement('span');
        span.className = 'sample'; span.textContent = text; span.style.cssText = style;
        host.append(span);
      }
    }
    const canvas = document.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `36px ${fontFamily}`;
    ctx.fillText('❌', 8, 45);
    return editor.getText();
  },
  glyphRectangles() {
    // Ranges isolate actual emoji ink in a bold heading, rather than passing
    // because the surrounding heading letters happened to paint successfully.
    return Array.from(document.querySelectorAll('.ProseMirror h1,.ProseMirror h2')).flatMap(heading => {
      const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
      const rectangles = [];
      let node;
      while ((node = walker.nextNode())) {
        for (const match of node.textContent.matchAll(/📚|😀|✅|❌/gu)) {
          const range = document.createRange();
          range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length);
          const r = range.getBoundingClientRect();
          rectangles.push({ label: `heading ${match[0]}`, x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) });
        }
      }
      return rectangles;
    });
  },
  alignmentChecks() {
    const canvas = document.createElement('canvas');
    canvas.width = 800; canvas.height = 400;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    function ink(text) {
      context.clearRect(0, 0, 800, 400);
      context.fillText(text, 20, 240);
      const pixels = context.getImageData(0, 0, 800, 400).data;
      let top = 400, bottom = -1;
      for (let y = 0; y < 400; y += 1) {
        for (let x = 0; x < 800; x += 1) {
          if (pixels[(y * 800 + x) * 4 + 3] > 30) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
        }
      }
      return { top, bottom, center: (top + bottom) / 2 };
    }
    const checks = [];
    for (const size of [12, 16, 24, 36, 72, 144]) {
      for (const weight of [400, 700]) {
        context.font = `${weight} ${size}px ${fontFamily}`;
        const text = ink('obey');
        for (const emoji of ['😋', '😜', '😀']) {
          const face = ink(emoji);
          checks.push({ size, weight, emoji, text, face, offset: face.center - text.center });
        }
      }
    }
    return checks;
  },
  copy() {
    editor.commands.selectAll();
    const data = new DataTransfer();
    editor.view.dom.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
    return data.getData('text/plain');
  },
};
