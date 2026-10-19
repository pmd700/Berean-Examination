import { desktopClient } from '@/api/desktopClient';
import { sanitizeFileName } from '@/components/knowledgeweb/bereanFileFormat';
import { buildNoteBackupMarkdown } from '@/lib/noteBackupMarkdown';
import { flushPendingEditorSaves } from '@/lib/pendingEditorSaves';
import { waitForLocalEntityWritesToSettle } from '@/lib/localEntities';

export async function waitForNoteExportSaves() {
  let timeout;
  let stopped = false;
  const prepare = async () => {
    await flushPendingEditorSaves();
    if (stopped) return;
    do {
      await waitForLocalEntityWritesToSettle({ operationName: 'Export' });
      if (stopped) return;
    } while (await flushPendingEditorSaves());
  };
  try {
    await Promise.race([
      prepare(),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('BEX is still saving. Your edits are kept open; try Export again when saving finishes.')), 20000); }),
    ]);
  } finally {
    stopped = true;
    clearTimeout(timeout);
  }
}

/** Call after settling saves. Always read the vault, never a library snapshot. */
export async function buildCurrentNoteExport(noteId) {
  const note = await desktopClient.entities.MindNote.get(noteId);
  return {
    fileName: `${sanitizeFileName(note.title || 'note')}.md`,
    content: buildNoteBackupMarkdown({ title: note.title, content: note.content }),
    type: 'text/markdown;charset=utf-8',
  };
}
