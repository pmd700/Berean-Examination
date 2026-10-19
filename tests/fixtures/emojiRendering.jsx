import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import TEXT_EDITOR_MACHINERY from '@/components/editor/TEXT_EDITOR_MACHINERY';
import { APP_FONT_FAMILY, getAppFontFamily, installAppTypography } from '@/styles/typography';
import '@/index.css';

installAppTypography();
// Let the native proof exercise the Windows fallback while running on a Mac.
const platform = new URLSearchParams(location.search).get('platform');
const fontFamily = platform ? getAppFontFamily(platform) : APP_FONT_FAMILY;
document.documentElement.style.setProperty('--bex-app-font-family', fontFamily);
const samples = ['😀', '❌', '✅', '🔥', '❤️', '👩🏽‍💻', '🇺🇸', '1️⃣', 'A', '1', 'א', 'Ω'];
let editor;
function Fixture() {
  return <MemoryRouter><TEXT_EDITOR_MACHINERY bare content={`<p>${samples.map((text, i) => `<span>${text}</span> `).join('')}</p>`}
    onChange={() => {}} onEditorReady={value => { editor = value; }} /></MemoryRouter>;
}
createRoot(document.getElementById('editor')).render(<Fixture />);
window.emojiProof = {
  ready: () => !!editor,
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
  copy() {
    editor.commands.selectAll();
    const data = new DataTransfer();
    editor.view.dom.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
    return data.getData('text/plain');
  },
};
