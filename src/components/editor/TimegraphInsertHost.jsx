import React from 'react';
import TimegraphPicker from '@/components/timegraph/TimegraphPicker';
import { closeSlashPanel, getSlashState } from './slashCommands';

/**
 * Bridges the `/timegraph` slash command to the picker.
 *
 * Mirrors ImageInsertPanel: watch the slash plugin's panel state, show the UI
 * while it names this panel, and close it when the command completes. Keeping the
 * bridge here means the picker itself knows nothing about the editor.
 */
export default function TimegraphInsertHost({ editor }) {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (!editor) return undefined;
    const sync = () => {
      setOpen(getSlashState(editor.state).panel?.kind === 'timegraph');
    };
    sync();
    editor.on('transaction', sync);
    return () => { editor.off('transaction', sync); };
  }, [editor]);

  if (!open || !editor) return null;

  return (
    <TimegraphPicker
      onClose={() => closeSlashPanel(editor)}
      onPick={(record) => {
        closeSlashPanel(editor);
        // The document stores only the id — see TimegraphEmbedExtension.
        editor.chain().focus().insertTimegraph(record.id).run();
      }}
    />
  );
}
