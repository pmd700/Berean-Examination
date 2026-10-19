import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import TEXT_EDITOR_MACHINERY from '@/components/editor/TEXT_EDITOR_MACHINERY';

const paragraphs = count => Array.from({ length: count }, (_, index) => `<p>Research paragraph ${index + 1}. Supporting context for this section.</p>`).join('');
const content = `${paragraphs(32)}<details><summary>Evidence and sources</summary><div data-type="detailsContent">${paragraphs(10)}<details><summary>A closer examination</summary><div data-type="detailsContent">${paragraphs(8)}<p>The <strong>conscience</strong> is a witness.</p>${paragraphs(10)}</div></details></div></details>${paragraphs(10)}`;
let editor;
let start;
let samples = [];
let recording = false;
const scroller = () => document.getElementById('scroll');
function snapshot() {
  const sections = [...document.querySelectorAll('.ProseMirror .toggle-block')];
  const hit = document.querySelector('.bex-spotlight-hit');
  return {
    scroll: scroller().scrollTop,
    sections: sections.map(section => ({ open: section.classList.contains('is-open'), y: section.querySelector('summary').getBoundingClientRect().top })),
    hit: hit?.textContent || null,
    hitY: hit?.getBoundingClientRect().top,
    fading: Boolean(hit?.classList.contains('bex-spotlight-hit--fading')),
    color: hit ? getComputedStyle(hit).backgroundColor : null,
  };
}
function record() {
  if (!recording) return;
  samples.push(snapshot());
  requestAnimationFrame(record);
}
function Fixture() {
  const [html, setHtml] = React.useState(content);
  const [query, setQuery] = React.useState('');
  const [token, setToken] = React.useState(0);
  start = () => { setToken(current => current + 1); setQuery('conscience'); };
  return <MemoryRouter><TEXT_EDITOR_MACHINERY bare content={html} onChange={setHtml}
    onEditorReady={instance => { editor = instance; }} spotlightQuery={query} spotlightToken={String(token)}
    onSpotlightComplete={() => setQuery('')} /></MemoryRouter>;
}
createRoot(document.getElementById('editor')).render(<Fixture />);
window.spotlightProof = {
  ready: () => Boolean(editor),
  start() { samples = []; recording = true; record(); start(); },
  snapshot,
  samples: () => samples,
  reset() { recording = false; editor.commands.setContent(content); scroller().scrollTop = 0; },
  saved: () => editor.getHTML(),
};
