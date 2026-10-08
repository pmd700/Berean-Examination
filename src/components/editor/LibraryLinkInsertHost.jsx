import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Search, X, FileText, Network, CalendarRange, Lock } from 'lucide-react';
import { desktopClient } from '@/api/desktopClient';
import { listAllEntityRecords } from '@/lib/massBackup';
import { usePrivateWeb } from '@/lib/PrivateWebContext';
import { decryptString } from '@/lib/webCrypto';
import { LIBRARY_LINK_TYPES, libraryLinkHref } from '@/lib/libraryLinks';
import { getSlashState, closeSlashPanel } from './slashCommands';

const ICONS = { note: FileText, web: Network, timeline: CalendarRange };

function LibraryLinkPicker({ onPick, onClose, onRestoreFocus }) {
  const { getKey } = usePrivateWeb();
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [errors, setErrors] = React.useState([]);
  const [query, setQuery] = React.useState('');
  const [index, setIndex] = React.useState(0);
  const [attempt, setAttempt] = React.useState(0);
  const searchRef = React.useRef(null);
  const listId = React.useId();

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrors([]);
    Promise.allSettled(LIBRARY_LINK_TYPES.map(async spec => {
      const records = await listAllEntityRecords(desktopClient.entities[spec.entity]);
      return Promise.all(records.map(async record => {
        let title = String(record.title || '').trim() || spec.fallback;
        if (spec.kind === 'web' && record.is_private) {
          title = `Private knowledge web (${record.id})`;
          const key = getKey(record.id);
          if (key && record.enc_name) {
            try { title = await decryptString(key, record.enc_name) || title; } catch { /* Keep the private label. */ }
          }
        }
        return { kind: spec.kind, id: record.id, label: spec.label, title, private: Boolean(record.is_private) };
      }));
    })).then(results => {
      if (cancelled) return;
      setItems(results.flatMap(result => result.status === 'fulfilled' ? result.value : [])
        .sort((a, b) => a.title.localeCompare(b.title) || a.kind.localeCompare(b.kind)));
      setErrors(results.flatMap((result, i) => result.status === 'rejected' ? [LIBRARY_LINK_TYPES[i].label] : []));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [attempt, getKey]);

  const filtered = React.useMemo(() => {
    const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return items.filter(item => words.every(word => `${item.title} ${item.label}`.toLocaleLowerCase().includes(word)));
  }, [items, query]);
  const active = Math.min(index, Math.max(0, filtered.length - 1));
  React.useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, listId, query]);

  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100001] bg-black/40" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[100002] w-[min(32rem,calc(100vw-2rem))] max-h-[80vh] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-surface text-ink shadow-2xl flex flex-col overflow-hidden"
          onOpenAutoFocus={event => { event.preventDefault(); searchRef.current?.focus(); }}
          onCloseAutoFocus={event => { event.preventDefault(); onRestoreFocus(); }}
          onKeyDown={event => {
            // Canvas/editor shortcuts must not operate behind the picker.
            event.stopPropagation();
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              if (filtered.length) setIndex((active + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length);
            } else if (event.key === 'Enter' && event.target === searchRef.current) {
              event.preventDefault();
              if (!loading && filtered[active]) onPick(filtered[active]);
            }
          }}
          data-testid="library-link-picker"
        >
          <div className="flex items-center justify-between px-4 pt-4">
            <Dialog.Title className="font-semibold">Link to your library</Dialog.Title>
            <Dialog.Close className="rounded p-1 text-ink-soft hover:bg-elevated" aria-label="Close link picker"><X className="h-4 w-4" /></Dialog.Close>
          </div>
          <Dialog.Description className="px-4 pt-1 text-sm text-ink-soft">Choose a note, knowledge web, or timeline.</Dialog.Description>
          <div className="mx-4 my-3 flex items-center gap-2 rounded-lg border border-line bg-elevated px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-ink-soft" />
            <input ref={searchRef} value={query} onChange={event => { setQuery(event.target.value); setIndex(0); }}
              className="w-full bg-transparent text-sm outline-none" placeholder="Search your library…" aria-label="Search your library"
              role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls={listId}
              aria-activedescendant={!loading && filtered.length ? `${listId}-${active}` : undefined} />
          </div>
          {!!errors.length && <div role="alert" className="px-4 pb-2 text-sm text-red-400">
            Could not load: {errors.join(', ')}. <button type="button" className="underline" onClick={() => setAttempt(value => value + 1)}>Retry</button>
          </div>}
          {loading ? <p role="status" className="px-4 pb-4 text-sm text-ink-soft">Loading your library…</p> : (
            <div role="listbox" id={listId} aria-label="Library items" className="min-h-0 max-h-80 overflow-y-auto px-2 pb-2">
              {!filtered.length && <p className="px-2 py-5 text-sm text-ink-soft">{query ? 'No matching items.' : 'No items to link yet.'}</p>}
              {filtered.map((item, i) => {
                const Icon = item.private ? Lock : ICONS[item.kind];
                return <button type="button" role="option" aria-selected={i === active} id={`${listId}-${i}`} key={`${item.kind}:${item.id}`}
                  onClick={() => onPick(item)} onMouseMove={() => setIndex(i)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left ${i === active ? 'bg-violet-500/20' : 'hover:bg-elevated'}`}>
                  <Icon className="h-4 w-4 shrink-0 text-ink-soft" />
                  <span className="min-w-0"><span className="block truncate text-sm">{item.title}</span><span className="block text-xs text-ink-soft">{item.label}</span></span>
                </button>;
              })}
            </div>
          )}
          <p className="border-t border-line px-4 py-2 text-xs text-ink-faint">↑ ↓ to choose · Enter to insert · Esc to cancel</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default function LibraryLinkInsertHost({ editor }) {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (!editor) return undefined;
    const sync = () => setOpen(getSlashState(editor.state).panel?.kind === 'link');
    sync();
    editor.on('transaction', sync);
    return () => editor.off('transaction', sync);
  }, [editor]);
  if (!open || !editor) return null;
  return <LibraryLinkPicker
    onClose={() => closeSlashPanel(editor)}
    onRestoreFocus={() => { if (!editor.isDestroyed) editor.commands.focus(); }}
    onPick={item => {
      // Read the mapped insertion point, not the caret left behind by the modal.
      const panel = getSlashState(editor.state).panel;
      if (panel?.kind !== 'link' || editor.isDestroyed) return;
      editor.chain().insertContentAt(panel.pos, [
        { type: 'text', text: item.title, marks: [{ type: 'link', attrs: { href: libraryLinkHref(item) } }] },
        { type: 'text', text: ' ', marks: [] },
      ]).unsetLink().run();
      closeSlashPanel(editor);
    }}
  />;
}
