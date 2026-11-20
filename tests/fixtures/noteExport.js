import { chooseExportFile, saveExportFile, cancelExportFile } from '@/lib/saveExportFile';
import { exportNotePdf } from '@/lib/notePdf';
import { setPageTitle } from '@/components/notes/bookModel';

window.runNoteExportProof = async ({ imageUrl, selected = false, markdown = false }) => {
  let corsBlocked = false;
  try { await fetch(imageUrl); } catch { corsBlocked = true; }
  const fileName = markdown ? 'export-proof.md' : selected ? 'export-proof-page-2.pdf' : 'export-proof.pdf';
  const destination = await chooseExportFile(fileName);
  if (destination.status === 'canceled') return { status: 'canceled' };
  const pages = [
    setPageTitle('<h2>First page evidence</h2><p>WHOLE_NOTE_FIRST_PAGE</p><table><tr><th>Evidence</th><th>Status</th></tr><tr><td>Readable text</td><td>Preserved</td></tr></table>', 'First page'),
    setPageTitle(`<h2>Selected page evidence</h2><p>SELECTED_PAGE_SECOND_PAGE<sup data-footnote-id="source" data-footnote-text="&lt;p&gt;Verified source detail&lt;/p&gt;"></sup></p><img src="${imageUrl}" alt="Purple proof image">`, 'Second page'),
  ];
  const progress = [];
  try {
    const result = markdown
      ? await saveExportFile(new Blob(['# Markdown proof\n\nCurrent selected page.\n'], { type: 'text/markdown' }), fileName, destination)
      : await exportNotePdf({ title: 'Export proof', pages, indices: selected ? [1] : undefined, destination, onProgress: message => progress.push(message) });
    return { ...result, corsBlocked, progress };
  } finally { await cancelExportFile(destination); }
};
