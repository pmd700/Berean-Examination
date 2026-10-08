import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import NoteEditorPanel from '@/components/knowledgeweb/NoteEditorPanel';
import { setPageTitle, joinBookPages } from '@/components/notes/bookModel';
import { desktopClient } from '@/api/desktopClient';

desktopClient.entities.MindNote = { update: async (_id, updates) => updates };
const paragraphs = count => Array.from({ length: count }, (_, i) => `<p>Context paragraph ${i + 1}. Supporting notes for the study.</p>`).join('');
const body = `<p>Exact evidence appears in this early mention, too.</p>${paragraphs(28)}<details><summary>Outer section</summary><div data-type="detailsContent">${paragraphs(8)}<details><summary>Inner section</summary><div data-type="detailsContent">${paragraphs(8)}<h2>Exact evidence</h2><p>The actual indexed destination.</p>${paragraphs(9)}</div></details></div></details>`;
const note = { id: 701, title: 'Navigation fixture', content: joinBookPages([
  setPageTitle('<h2>Opening topic</h2><p>First page.</p>', 'Navigation fixture'),
  setPageTitle('<p>Middle page.</p>', 'Middle'), setPageTitle(body, 'Sources'),
]) };
createRoot(document.getElementById('root')).render(<MemoryRouter><NoteEditorPanel noteId={701} notes={[note]} /></MemoryRouter>);
let recording = false;
let samples = [];
function snapshot() {
  const editor = document.querySelector('.book-live-page .ProseMirror') || document.querySelector('.ProseMirror');
  const heading = [...(editor?.querySelectorAll('h2') || [])].find(el => el.textContent === 'Exact evidence');
  const scroll = document.querySelector('[data-testid="note-zoom-viewport"]') || [...document.querySelectorAll('div')].find(el => getComputedStyle(el).overflowY === 'auto' && el.scrollHeight > el.clientHeight);
  return { turning: Boolean(document.querySelector('[data-testid="book-page-turn"]')), y: heading?.getBoundingClientRect().top,
    open: [...(editor?.querySelectorAll('.toggle-block') || [])].map(el => el.classList.contains('is-open')), scroll: scroll?.scrollTop || 0,
    highlighted: Boolean(document.querySelector('.bex-spotlight-hit')) };
}
function record() { if (!recording) return; samples.push(snapshot()); requestAnimationFrame(record); }
window.indexProof = { snapshot, samples: () => samples, record() { samples = []; recording = true; record(); } };
