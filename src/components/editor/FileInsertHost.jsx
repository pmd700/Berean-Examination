import React from 'react';
import { toast } from 'sonner';
import { runWithLocalBackupBarrier } from '@/lib/localEntities';
import { closeSlashPanel, getSlashState } from './slashCommands';

/** The native picker copies selected files into the vault before insertion. */
export default function FileInsertHost({ editor }) {
  const [kind, setKind] = React.useState(null);
  const pendingRef = React.useRef(false);

  React.useEffect(() => {
    if (!editor) return undefined;
    const sync = () => setKind(getSlashState(editor.state).panel?.kind || null);
    sync();
    editor.on('transaction', sync);
    return () => editor.off('transaction', sync);
  }, [editor]);

  React.useEffect(() => {
    if (!editor || kind !== 'file' || pendingRef.current) return;
    pendingRef.current = true;
    runWithLocalBackupBarrier(async () => {
      try {
        const desktop = /** @type {any} */ (window).bexDesktop;
        if (!desktop?.isDesktop || typeof desktop.importLocalFiles !== 'function') {
          throw new Error('File attachments are available inside the BEX desktop app.');
        }
        const result = await desktop.importLocalFiles();
        if (!result?.ok) throw new Error(result?.error || 'BEX could not import those files.');
        if (editor.isDestroyed || result.canceled) return;
        const panel = getSlashState(editor.state).panel;
        if (panel?.kind !== 'file') return;
        const attachments = (result.attachments || []).map(attachment => ({
          type: 'fileAttachment',
          attrs: { ...attachment, display: 'icon' },
        }));
        if (attachments.length) {
          editor.chain().focus().insertContentAt(panel.pos, [
            ...attachments,
            { type: 'paragraph' },
          ]).run();
        }
      } catch (error) {
        toast.error(error?.message || 'BEX could not import those files.');
      } finally {
        if (!editor.isDestroyed && getSlashState(editor.state).panel?.kind === 'file') {
          closeSlashPanel(editor);
        }
        pendingRef.current = false;
      }
    });
  }, [editor, kind]);

  return null;
}
