import React from 'react';
import ReactDOM from 'react-dom';
import { motion } from 'framer-motion';
import { Image as ImageIcon, Loader2 } from 'lucide-react';
import { getSlashState, closeSlashPanel } from './slashCommands';
import { insertImageFromFile, insertImageFromUrl } from './ImageUploadExtension';

const PANEL_WIDTH = 420;

/**
 * The /image picker: upload a file from this computer, or embed one that
 * already lives at a URL. Both routes end up in the same insert pipeline as
 * drag-and-drop (see ImageUploadExtension).
 */
export default function ImageInsertPanel({ editor }) {
  const [panel, setPanel] = React.useState(null);
  const [coords, setCoords] = React.useState(null);
  const [tab, setTab] = React.useState('upload');
  const [url, setUrl] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const fileInputRef = React.useRef(null);
  const urlInputRef = React.useRef(null);
  const panelRef = React.useRef(null);

  React.useEffect(() => {
    if (!editor) return undefined;
    const sync = () => {
      const next = getSlashState(editor.state).panel;
      setPanel(next?.kind === 'image' ? next : null);
    };
    sync();
    editor.on('transaction', sync);
    return () => { editor.off('transaction', sync); };
  }, [editor]);

  // Fresh panel each time it opens.
  React.useEffect(() => {
    if (panel) { setTab('upload'); setUrl(''); setBusy(false); }
  }, [panel?.pos, panel?.kind]);

  React.useLayoutEffect(() => {
    if (!editor || !panel) { setCoords(null); return undefined; }
    const place = () => {
      let caret;
      try {
        caret = editor.view.coordsAtPos(panel.pos);
      } catch {
        return;
      }
      const height = 190;
      const below = caret.bottom + 8;
      const fitsBelow = below + height < window.innerHeight - 8;
      setCoords({
        top: fitsBelow ? below : Math.max(8, caret.top - height - 8),
        left: Math.min(Math.max(caret.left, 8), Math.max(8, window.innerWidth - PANEL_WIDTH - 8)),
      });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [editor, panel]);

  // Click anywhere else to dismiss.
  React.useEffect(() => {
    if (!panel) return undefined;
    const onDown = (event) => {
      if (!panelRef.current?.contains(event.target)) closeSlashPanel(editor);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [panel, editor]);

  React.useEffect(() => {
    if (panel && tab === 'link') urlInputRef.current?.focus();
  }, [panel, tab]);

  if (!panel || !coords) return null;

  const close = () => closeSlashPanel(editor);

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    // Close first: the upload shows its own placeholder in the document, so
    // leaving the panel up would just cover it.
    close();
    await insertImageFromFile(editor, file, panel.pos);
    setBusy(false);
    editor.commands.focus();
  };

  const handleEmbed = () => {
    if (!url.trim()) return;
    if (insertImageFromUrl(editor, url, panel.pos)) {
      close();
      editor.commands.focus();
    }
  };

  const tabClass = (id) => `relative pb-1.5 text-[13px] transition-colors ${
    tab === id ? 'text-white' : 'text-ink-soft hover:text-[#C7CDD9]'
  }`;

  return ReactDOM.createPortal((
    <motion.div
      ref={panelRef}
      initial={{ opacity: 0, y: -6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 540, damping: 34, mass: 0.6 }}
      className="fixed z-[100000] rounded-xl border border-line bg-surface/97 backdrop-blur-xl shadow-[0_20px_56px_-14px_rgba(0,0,0,0.8)] p-3"
      style={{ top: coords.top, left: coords.left, width: PANEL_WIDTH }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}
      data-testid="panel-image-insert"
    >
      <div className="flex items-center gap-2 px-1 pb-2.5 text-[#C7CDD9]">
        <ImageIcon className="w-4 h-4 text-ink-soft" />
        <span className="text-[13px]">Add an image</span>
      </div>

      <div className="rounded-lg border border-line p-3">
        <div className="flex items-center gap-4 border-b border-line mb-3">
          <button type="button" className={tabClass('upload')} onClick={() => setTab('upload')} data-testid="tab-image-upload">
            Upload
            {tab === 'upload' && <motion.span layoutId="image-tab-underline" className="absolute left-0 right-0 -bottom-px h-0.5 bg-violet-400/80 rounded-full" />}
          </button>
          <button type="button" className={tabClass('link')} onClick={() => setTab('link')} data-testid="tab-image-link">
            Link
            {tab === 'link' && <motion.span layoutId="image-tab-underline" className="absolute left-0 right-0 -bottom-px h-0.5 bg-violet-400/80 rounded-full" />}
          </button>
        </div>

        {tab === 'upload' ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="hidden"
              onChange={handleFile}
              data-testid="input-image-file"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="w-full h-10 rounded-md bg-[#05070B] border border-line text-[13px] font-medium text-white transition-colors hover:border-[#3A4258] hover:bg-app disabled:opacity-60"
              data-testid="button-image-upload"
            >
              {busy ? <span className="inline-flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading…</span> : 'Upload file'}
            </button>
            <p className="mt-2 text-center text-[10.5px] text-ink-faint">
              PNG, JPG, GIF or WebP — up to 10MB. You can also drag one straight into the page.
            </p>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <input
                ref={urlInputRef}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleEmbed(); } }}
                placeholder="Paste an image link…"
                spellCheck={false}
                className="flex-1 min-w-0 h-10 px-3 rounded-md bg-[#05070B] border border-line text-[13px] text-white placeholder:text-ink-faint outline-none focus:border-brand transition-colors"
                data-testid="input-image-url"
              />
              <button
                type="button"
                onClick={handleEmbed}
                disabled={!url.trim()}
                className="h-10 px-3 shrink-0 rounded-md bg-violet-600/85 text-[13px] font-medium text-white transition-all hover:bg-violet-600 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
                data-testid="button-image-embed"
              >
                Embed
              </button>
            </div>
            <p className="mt-2 text-[10.5px] text-ink-faint">
              Links stay remote — the image loads from the web, so it won't show when you're offline. Upload it instead to keep a copy.
            </p>
          </>
        )}
      </div>
    </motion.div>
  ), document.body);
}
