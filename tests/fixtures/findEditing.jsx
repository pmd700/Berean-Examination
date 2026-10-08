import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import NoteEditorPanel from '@/components/knowledgeweb/NoteEditorPanel';
import { desktopClient } from '@/api/desktopClient';
import { requestLocalFindShortcut } from '@/lib/localFindShortcut';

desktopClient.entities.MindNote = { update: async (_id, updates) => updates };
const note = { id: 702, title: 'Find editing fixture', content: '<h1>Find editing fixture</h1><blockquote><p>First text in a paragraph with bold <strong>words</strong>.</p><details><summary>Outer section</summary><div data-type="detailsContent"><details><summary>Dropdown section</summary><div data-type="detailsContent"><p>Second times in the dropdown.</p><p>More times here.</p></div></details></div></details><p>Third times in the following paragraph.</p></blockquote><p>Ordinary editable paragraph.</p>' };
createRoot(document.getElementById('root')).render(<MemoryRouter><NoteEditorPanel noteId={702} notes={[note]} /></MemoryRouter>);
window.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f' && requestLocalFindShortcut()) { event.preventDefault(); event.stopImmediatePropagation(); }
}, true);
window.findEditingProof = {
  snapshot() {
    const sel = window.getSelection();
    return {
      active: document.activeElement?.getAttribute('data-testid') || document.activeElement?.className,
      anchor: sel?.anchorNode?.textContent, offset: sel?.anchorOffset,
      paragraph: sel?.anchorNode?.parentElement?.closest('p')?.textContent,
      text: document.querySelector('.ProseMirror')?.textContent,
      find: document.querySelector('[data-testid="input-editor-find"]')?.value,
      matches: document.querySelectorAll('.bex-find-hit').length,
      open: [...document.querySelectorAll('.toggle-block')].map(el => el.classList.contains('is-open')),
    };
  },
};
