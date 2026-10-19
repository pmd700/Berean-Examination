import { saveExportFile } from '@/lib/saveExportFile';
import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  BarChart3,
  Brain,
  Check,
  ChevronDown,
  Download,
  Folder,
  FolderPlus,
  GraduationCap,
  Loader2,
  LockKeyhole,
  Network,
  NotebookPen,
  Pencil,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { desktopClient } from '@/api/desktopClient';
import AiExportButton from '@/components/library/AiExportButton';
import UserSettings from '@/components/settings/UserSettings';
import useWebLibrary from '@/components/knowledgeweb/useWebLibrary';
import CreatePrivateWebModal from '@/components/knowledgeweb/CreatePrivateWebModal';
import { confirmDialog } from '@/components/ui/confirm-dialog';
import { useDecryptedWebName } from '@/lib/useDecryptedWebName';
import {
  TAB_KINDS,
  useCurrentWorkspaceTab,
  useIsActiveTab,
  useTabTitle,
  useWorkspaceTabs,
} from '@/lib/WorkspaceTabs';
import {
  createPageUrl,
  noteDeepLink,
  parseIdFromParam,
  timegraphDeepLink,
  webDeepLink,
} from '@/utils';
import {
  createTimegraph,
  deleteTimegraph,
  listTimegraphs,
  moveTimegraphToFolder,
  renameTimegraph,
} from '@/lib/timegraph/timegraphStore';
import { EXPORT_SCOPES, exportFileName, toJson } from '@/lib/timegraph/timegraphExport';
import TimelineGlyph from '@/components/timegraph/TimelineGlyph';
import Card3DTilt from '@/components/shaders/Card3DTilt';
import ScriptureSearch from '@/components/scripture/ScriptureSearch';
import { LibrarySpotlightSearch } from '@/components/search/GlobalSearch';
import { libraryFolderCategory, libraryFoldersForCategory } from '@/lib/libraryFolderCategory';
import { LIBRARY_ROOT_CONTAINER, folderContainerId } from '@/lib/libraryDragDrop';
import LibraryColumnDnd, {
  LibraryRootDropZone,
  useLibraryFolderDropzone,
} from '@/components/library/LibraryColumnDnd';
import {
  buildBereanKnowledgeWebPayload,
  sanitizeFileName,
} from '@/components/knowledgeweb/bereanFileFormat';
import { buildCurrentNoteExport, waitForNoteExportSaves } from '@/lib/exportNote';

const CATEGORIES = Object.freeze({
  web: {
    kind: TAB_KINDS.KNOWLEDGE_WEB,
    label: 'Knowledge Web',
    plural: 'Knowledge Webs',
    shortcut: 'W',
    prompt: 'Map an idea',
    icon: Network,
    accent: '#9b7cff',
    glow: 'rgba(139, 92, 246, 0.24)',
  },
  note: {
    kind: TAB_KINDS.NOTES,
    label: 'Note',
    plural: 'Notes',
    shortcut: 'N',
    prompt: 'Write freely',
    icon: NotebookPen,
    accent: '#e5bd48',
    glow: 'rgba(229, 189, 72, 0.2)',
  },
  timeline: {
    kind: TAB_KINDS.TIMELINE,
    label: 'Timeline',
    plural: 'Timelines',
    shortcut: 'T',
    prompt: 'Build a chronology',
    icon: TimelineGlyph,
    accent: '#63d6d0',
    glow: 'rgba(45, 212, 191, 0.2)',
  },

});

const CATEGORY_BY_SHORTCUT = Object.freeze({
  w: 'web',
  n: 'note',
  t: 'timeline',
});

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.isContentEditable
    || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
    || target.closest('[contenteditable="true"], [role="textbox"]'),
  );
}

function updatedTime(item) {
  const value = item?.updated_date || item?.created_date;
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function sortRecent(items) {
  return [...items].sort((a, b) => updatedTime(b) - updatedTime(a));
}

const LIBRARY_ITEM_ORDER_KEY = 'bex.library-home.item-order.v1';

function readSavedItemOrder() {
  if (typeof window === 'undefined') return {};
  try {
    const saved = JSON.parse(window.localStorage.getItem(LIBRARY_ITEM_ORDER_KEY) || '{}');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

function itemsInSavedOrder(items, savedIds = []) {
  const recent = sortRecent(items);
  if (!Array.isArray(savedIds) || savedIds.length === 0) return recent;
  const byId = new Map(recent.map((item) => [String(item.id), item]));
  const ordered = savedIds.flatMap((id) => {
    const item = byId.get(String(id));
    if (!item) return [];
    byId.delete(String(id));
    return [item];
  });
  return [...ordered, ...byId.values()];
}

function itemOrderScope(category, folderId = null) {
  return folderId == null ? `${category}:root` : `${category}:folder:${folderId}`;
}

function sameWorkspaceTarget(tab, kind, path) {
  if (!tab || tab.kind !== kind) return false;
  if ([TAB_KINDS.KNOWLEDGE_WEB, TAB_KINDS.NOTES, TAB_KINDS.TIMELINE].includes(kind)) {
    const left = parseIdFromParam(tab.path);
    const right = parseIdFromParam(path);
    return left != null && right != null && String(left) === String(right);
  }
  return tab.path === path;
}

function tabMatchesLibraryItem(tab, category, item) {
  if (!tab || !item) return false;
  if (category === 'web') return sameWorkspaceTarget(tab, TAB_KINDS.KNOWLEDGE_WEB, webDeepLink(item.id, item.title));
  if (category === 'note') return sameWorkspaceTarget(tab, TAB_KINDS.NOTES, noteDeepLink(item.id, item.title));
  if (category === 'timeline') return sameWorkspaceTarget(tab, TAB_KINDS.TIMELINE, timegraphDeepLink(item.id, item.title));
  return false;
}

function FolderDialog({ request, onClose, onSubmit, busy }) {
  const [name, setName] = React.useState('');
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    if (!request) return;
    setName(request.folder?.name || '');
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [request]);

  if (!request) return null;
  const editing = request.mode === 'rename';

  return (
    <motion.div
      className="fixed inset-0 z-[100000] grid place-items-center bg-black/65 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={onClose}
      data-testid="library-folder-dialog"
    >
      <motion.form
        initial={{ opacity: 0, y: 12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 520, damping: 34 }}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          const clean = name.trim();
          if (clean) onSubmit(clean);
        }}
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-white/10 bg-[#10141d] shadow-[0_30px_100px_rgba(0,0,0,0.72)]"
      >
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-500/15 text-violet-200">
            <FolderPlus className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-slate-100">{editing ? 'Rename folder' : 'Create folder'}</h2>
            <p className="text-[10.5px] text-slate-500">
              This folder belongs to {CATEGORIES[request.category || libraryFolderCategory(request.folder)].plural}.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-500 hover:bg-white/5 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">
          <input
            ref={inputRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Folder name"
            className="h-11 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-violet-400/60"
            data-testid="library-folder-name"
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-white/[0.06] px-4 py-3">
          <button type="button" onClick={onClose} className="h-9 rounded-lg px-3 text-xs text-slate-400 hover:bg-white/5 hover:text-white">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-violet-500 px-4 text-xs font-semibold text-white transition hover:bg-violet-400 disabled:opacity-40"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {editing ? 'Save' : 'Create'}
          </button>
        </div>
      </motion.form>
    </motion.div>
  );
}

function InlineItemRename({ initialValue, busy, onCancel, onSubmit }) {
  const [name, setName] = React.useState(initialValue);
  const inputRef = React.useRef(null);
  const cancelledRef = React.useRef(false);

  React.useEffect(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  return (
    <motion.form
      initial={{ opacity: 0, scaleX: 0.97 }}
      animate={{ opacity: 1, scaleX: 1 }}
      className="relative min-w-0 flex-1 py-1.5 pl-3 pr-2"
      onSubmit={(event) => {
        event.preventDefault();
        inputRef.current?.blur();
      }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      data-testid="library-inline-rename"
    >
      <input
        ref={inputRef}
        value={name}
        readOnly={busy}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => {
          if (cancelledRef.current || busy) return;
          const clean = name.trim();
          if (!clean || clean === initialValue) onCancel();
          else void onSubmit(clean);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          cancelledRef.current = true;
          onCancel();
        }}
        className="h-8 w-full rounded-lg border border-violet-400/55 bg-violet-400/[0.07] px-2 text-[12.5px] font-medium text-slate-100 outline-none shadow-[0_0_0_3px_rgba(139,92,246,0.08)] selection:bg-violet-400/35"
        aria-label="Rename item"
        data-testid="library-inline-rename-input"
      />
      {busy && <Loader2 className="absolute right-4 top-3.5 h-3.5 w-3.5 animate-spin text-violet-300" />}
    </motion.form>
  );
}

function ItemContextMenu({ menu, onClose, onRename, onDelete, onExport }) {
  React.useEffect(() => {
    if (!menu) return undefined;
    const close = () => onClose();
    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('blur', close);
    };
  }, [menu, onClose]);

  if (!menu) return null;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: -3 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className="fixed z-[100001] w-40 overflow-hidden rounded-xl border border-white/10 bg-[#121722] p-1.5 shadow-2xl"
      style={{
        left: Math.max(8, Math.min(menu.x, window.innerWidth - 176)),
        top: Math.max(8, Math.min(menu.y, window.innerHeight - 148)),
      }}
      onPointerDown={(event) => event.stopPropagation()}
      data-testid="library-item-context-menu"
    >
      <button type="button" onClick={onRename} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-slate-300 hover:bg-white/5"><Pencil className="h-3.5 w-3.5" /> Rename</button>
      <button type="button" onClick={onExport} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-slate-300 hover:bg-white/5"><Download className="h-3.5 w-3.5" /> Export</button>
      <button type="button" onClick={onDelete} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-red-300 hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
    </motion.div>
  );
}

function ExportCompleteNotice({ notice }) {
  if (!notice) return null;

  return (
    <motion.div
      key={notice.id}
      initial={{ opacity: 0, y: -18, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 520, damping: 30 }}
      className="pointer-events-none absolute left-1/2 top-16 z-[100002] w-[min(22rem,calc(100%-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl border border-emerald-300/20 bg-[#121922]/95 px-4 py-3 shadow-[0_24px_80px_-24px_rgba(52,211,153,0.55)] backdrop-blur-xl"
      data-testid="library-export-complete"
      role="status"
      aria-live="polite"
    >
      <span className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/80 to-transparent" />
      <div className="flex items-center gap-3">
        <motion.span
          initial={{ scale: 0, rotate: -24 }}
          animate={{ scale: [0, 1.18, 1], rotate: [-24, 8, 0] }}
          transition={{ duration: 0.46, times: [0, 0.7, 1], ease: 'easeOut' }}
          className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-400 text-[#07110e] shadow-[0_0_28px_rgba(52,211,153,0.35)]"
        >
          <Check className="h-5 w-5 stroke-[3]" />
          {[0, 90, 180, 270].map((rotation) => (
            <span
              key={rotation}
              style={{ transform: `translate(-50%, -18px) rotate(${rotation}deg)` }}
              className="absolute left-1/2 top-1/2 origin-[50%_18px]"
            >
              <motion.span
                initial={{ opacity: 0, scaleY: 0 }}
                animate={{ opacity: [0, 0.85, 0], scaleY: [0, 1, 0] }}
                transition={{ duration: 0.55, delay: 0.13 }}
                className="block h-2 w-px origin-bottom bg-emerald-200"
              />
            </span>
          ))}
        </motion.span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold tracking-wide text-slate-100">Export complete</span>
          <span className="mt-0.5 block truncate text-[11px] text-slate-400">{notice.detail}</span>
        </span>
      </div>
      <motion.span
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        transition={{ duration: 2.4, ease: 'linear' }}
        className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-gradient-to-r from-emerald-400 via-teal-300 to-violet-400"
      />
    </motion.div>
  );
}

function plainItemTitle(category, item) {
  if (item.__displayTitle) return item.__displayTitle;
  if (category === 'web') return item.title || 'Untitled Web';
  if (category === 'note') return item.title || 'Untitled Note';
  if (category === 'timeline') return item.title || 'Unnamed timeline';
  return item.title || `${item.book || 'Bible Study'} ${item.chapter_number || ''}`.trim();
}

const NOOP = () => {};

function itemSelectionKey(category, itemId) {
  return `${category}:${itemId}`;
}

function LibraryItem({ category, item, onOpen, selected, onToggleSelection, onContextMenu, renaming, renameValue, renameBusy, onRenameCancel, onRenameSubmit }) {
  const privateName = useDecryptedWebName(category === 'web' ? item : null);
  const displayTitle = category === 'web' && item.is_private
    ? (privateName || 'Private Knowledge Web')
    : plainItemTitle(category, item);
  const detail = item.is_private ? 'Encrypted locally' : '';

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 7 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
      className="flex min-h-11 items-center rounded-xl border border-white/[0.055] bg-white/[0.025] px-2.5 transition-colors hover:border-white/10 hover:bg-white/[0.055]"
      data-testid={`library-item-${category}-${item.id}`}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu(category, { ...item, __displayTitle: displayTitle }, event.clientX, event.clientY);
      }}
    >
      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onToggleSelection(category, item.id)}
        className={`ml-1 grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border transition ${selected ? 'border-violet-400 bg-violet-500 text-white' : 'border-slate-600 text-transparent hover:border-slate-400'}`}
        aria-label={`${selected ? 'Deselect' : 'Select'} item`}
        data-testid={`library-select-${category}-${item.id}`}
      >
        <Check className="h-3 w-3" />
      </button>
      {renaming ? (
        <InlineItemRename
          initialValue={renameValue || displayTitle}
          busy={renameBusy}
          onCancel={onRenameCancel}
          onSubmit={onRenameSubmit}
        />
      ) : (
        <button
          type="button"
          onClick={() => onOpen(item)}
          className="flex min-w-0 flex-1 self-stretch items-center py-2 pl-3 pr-2 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-medium text-slate-200">{displayTitle}</span>
            {detail && <span className="block truncate text-[9.5px] text-slate-600">{detail}</span>}
          </span>
        </button>
      )}
    </motion.div>
  );
}

function SortableLibraryItem({ item, ...props }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: String(item.id), disabled: props.renaming });

  return (
    <div
      ref={setNodeRef}
      style={{
        // The row being dragged stays put as a dimmed placeholder; the copy that
        // follows the pointer is the DragOverlay, which is rendered outside the
        // folder's clipping box so it can be carried between folders.
        transform: isDragging ? undefined : CSS.Transform.toString(transform),
        transition: transition || 'transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        opacity: isDragging ? 0.32 : 1,
      }}
      className="relative cursor-grab touch-pan-y select-none rounded-xl outline-none active:cursor-grabbing"
      data-testid={`library-sortable-${props.category}-${item.id}`}
      data-dragging={isDragging ? 'true' : 'false'}
      {...attributes}
      {...listeners}
    >
      <div className="rounded-xl transition-[transform,opacity,box-shadow] duration-150">
        <LibraryItem item={item} {...props} />
      </div>
    </div>
  );
}

function SortableLibraryList({ items, category, selectedItems, renameRequest, ...itemProps }) {
  const itemIds = React.useMemo(() => items.map((item) => String(item.id)), [items]);

  return (
    <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <SortableLibraryItem
            key={item.id}
            item={item}
            category={category}
            selected={selectedItems.has(`${category}:${item.id}`)}
            renaming={renameRequest?.category === category && String(renameRequest.item.id) === String(item.id)}
            renameValue={renameRequest?.name}
            {...itemProps}
          />
        ))}
      </AnimatePresence>
    </SortableContext>
  );
}

function FolderSection({ category, folder, items, collapsed, onToggle, onOpen, onRename, onDelete, selectedItems, onToggleSelection, onContextMenu, renameRequest, renameBusy, onRenameCancel, onRenameSubmit }) {
  const { setNodeRef, dragging, isTarget } = useLibraryFolderDropzone(folder.id);

  return (
    <motion.section
      ref={setNodeRef}
      layout="position"
      data-testid={`library-dropzone-${category}-${folder.id}`}
      data-drop-target={isTarget ? 'true' : 'false'}
      className={`overflow-hidden rounded-xl border bg-black/[0.09] transition-colors ${
        isTarget
          ? 'border-violet-400/55 bg-violet-500/[0.08] shadow-[0_0_0_1px_rgba(167,139,250,0.25)]'
          : 'border-white/[0.045]'
      }`}
    >
      <div className="group/folder flex h-9 items-center gap-2 px-2.5">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <motion.span animate={{ rotate: collapsed ? -90 : 0 }} transition={{ duration: 0.16 }}>
            <ChevronDown className="h-3.5 w-3.5 text-slate-600" />
          </motion.span>
          <Folder className="h-3.5 w-3.5 text-slate-500" />
          <span className="truncate text-[11px] font-medium text-slate-400">{folder.name}</span>
          {isTarget ? (
            <span className="ml-auto shrink-0 text-[9px] font-medium uppercase tracking-[0.1em] text-violet-300">Drop here</span>
          ) : (
            <span className="ml-auto text-[9px] tabular-nums text-slate-700">{items.length}</span>
          )}
        </button>
        <button type="button" onClick={() => onRename(folder)} className="rounded p-1 text-slate-700 opacity-0 hover:bg-white/5 hover:text-slate-300 group-hover/folder:opacity-100" aria-label="Rename folder">
          <Pencil className="h-3 w-3" />
        </button>
        <button type="button" onClick={() => onDelete(folder)} className="rounded p-1 text-slate-700 opacity-0 hover:bg-red-500/10 hover:text-red-300 group-hover/folder:opacity-100" aria-label="Delete folder">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="space-y-1.5 border-t border-white/[0.04] p-1.5">
              {items.length ? (
                <SortableLibraryList
                  items={items}
                  category={category}
                  onOpen={onOpen}
                  selectedItems={selectedItems}
                  onToggleSelection={onToggleSelection}
                  onContextMenu={onContextMenu}
                  renameRequest={renameRequest}
                  renameBusy={renameBusy}
                  onRenameCancel={onRenameCancel}
                  onRenameSubmit={onRenameSubmit}
                />
              ) : (
                <p className={`grid place-items-center rounded-lg px-2 text-[10px] text-slate-700 transition-colors ${dragging ? 'min-h-11 border border-dashed border-white/[0.08]' : 'py-2'}`}>
                  {isTarget ? 'Drop to file it here' : 'Empty folder'}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

function CategoryColumn({ category, items, folders, busy, onCreate, onCreateFolder, onCreatePrivate, onOpen, collapsed, onToggleFolder, onRenameFolder, onDeleteFolder, selectedItems, onToggleSelection, onContextMenu, renameRequest, renameBusy, onRenameCancel, onRenameSubmit, itemOrder, onReorderItems, onMoveItem, onRevealFolder }) {
  const config = CATEGORIES[category];
  const folderIds = React.useMemo(() => new Set(folders.map((folder) => String(folder.id))), [folders]);
  const rootScope = itemOrderScope(category);
  const unfiled = itemsInSavedOrder(items.filter((item) => (
    item.folder_id == null || !folderIds.has(String(item.folder_id))
  )), itemOrder[rootScope]);
  const folderBuckets = folders.map((folder) => ({
    folder,
    items: itemsInSavedOrder(
      items.filter((item) => String(item.folder_id) === String(folder.id)),
      itemOrder[itemOrderScope(category, folder.id)],
    ),
  }));

  // The single description of every list a row can be dropped into, shared by
  // the highlight and by the drop planner.
  const containers = [
    { id: LIBRARY_ROOT_CONTAINER, folderId: null, scope: rootScope, items: unfiled },
    ...folderBuckets.map(({ folder, items: filed }) => ({
      id: folderContainerId(folder.id),
      folderId: folder.id,
      scope: itemOrderScope(category, folder.id),
      items: filed,
    })),
  ];

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col"
      data-testid={`library-column-${category}`}
    >
      <Card3DTilt
        appearance="transparent"
        glowColor={config.glow}
        glowSize={220}
        glowFalloff={56}
        maxTiltDeg={7}
        className="h-44 shrink-0 sm:h-48 xl:h-52"
        innerClassName="h-full"
        tiltClassName="overflow-hidden rounded-2xl"
      >
        <motion.button
          type="button"
          onClick={onCreate}
          disabled={busy}
          whileTap={{ scale: 0.985 }}
          transition={{ type: 'spring', stiffness: 480, damping: 30 }}
          className="group relative flex h-full w-full flex-col justify-between overflow-hidden rounded-2xl border border-white/[0.09] bg-[#151a24] p-5 text-left shadow-[0_18px_46px_-28px_rgba(0,0,0,0.9)] disabled:opacity-60"
          style={{ boxShadow: `0 20px 70px -42px ${config.glow}` }}
          data-testid={`library-create-${category}`}
        >
          <span className="absolute inset-x-0 top-0 h-px opacity-80" style={{ background: `linear-gradient(90deg, transparent, ${config.accent}, transparent)` }} />
          <span className="flex w-full items-start justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Create with {config.shortcut}</span>
            {busy && <Loader2 className="h-4 w-4 animate-spin" style={{ color: config.accent }} />}
          </span>
          <span className="relative flex items-end">
            <span>
              <config.icon className="h-14 w-14 opacity-80 transition duration-300 group-hover:opacity-100 sm:h-16 sm:w-16" style={{ color: config.accent }} />
              <span className="mt-3 block text-xs font-medium" style={{ color: config.accent }}>{config.prompt}</span>
            </span>
          </span>
        </motion.button>
      </Card3DTilt>

      <div className="flex h-10 shrink-0 items-center gap-1.5 px-1">
        <span className="mr-auto truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          {config.plural} <span className="ml-1 text-slate-700">{items.length}</span>
        </span>
        {category === 'web' && (
          <button type="button" onClick={onCreatePrivate} className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-[10px] text-slate-600 transition hover:bg-white/[0.05] hover:text-violet-200" title="Create an encrypted Knowledge Web">
            <LockKeyhole className="h-3.5 w-3.5" /> Private
          </button>
        )}
        <button type="button" onClick={onCreateFolder} className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-[10px] text-slate-600 transition hover:bg-white/[0.05] hover:text-slate-200" title="Create folder">
          <FolderPlus className="h-3.5 w-3.5" /> Folder
        </button>
      </div>

      <div className="space-y-1.5 pb-5 pr-1">
        <LibraryColumnDnd
          containers={containers}
          category={category}
          onReorder={onReorderItems}
          onMoveItem={onMoveItem}
          onDropIntoFolder={onRevealFolder}
          renderDragPreview={(item) => (
            <LibraryItem
              category={category}
              item={item}
              selected={false}
              onOpen={NOOP}
              onToggleSelection={NOOP}
              onContextMenu={NOOP}
              renaming={false}
              renameBusy={false}
              onRenameCancel={NOOP}
              onRenameSubmit={NOOP}
            />
          )}
        >
          <LibraryRootDropZone>
            <SortableLibraryList
              items={unfiled}
              category={category}
              onOpen={onOpen}
              selectedItems={selectedItems}
              onToggleSelection={onToggleSelection}
              onContextMenu={onContextMenu}
              renameRequest={renameRequest}
              renameBusy={renameBusy}
              onRenameCancel={onRenameCancel}
              onRenameSubmit={onRenameSubmit}
            />
          </LibraryRootDropZone>

          <div className="space-y-1.5 pt-1.5">
            {folderBuckets.map(({ folder, items: filed }) => (
              <FolderSection
                key={folder.id}
                category={category}
                folder={folder}
                items={filed}
                collapsed={collapsed.has(`${category}:${folder.id}`)}
                onToggle={() => onToggleFolder(category, folder.id)}
                onOpen={onOpen}
                onRename={onRenameFolder}
                onDelete={onDeleteFolder}
                selectedItems={selectedItems}
                onToggleSelection={onToggleSelection}
                onContextMenu={onContextMenu}
                renameRequest={renameRequest}
                renameBusy={renameBusy}
                onRenameCancel={onRenameCancel}
                onRenameSubmit={onRenameSubmit}
              />
            ))}
          </div>
        </LibraryColumnDnd>

        {!items.length && !folders.length && (
          <div className="grid min-h-24 place-items-center rounded-xl border border-dashed border-white/[0.055] text-center">
            <p className="px-4 text-[10.5px] text-slate-700">Nothing here yet.</p>
          </div>
        )}
      </div>
    </motion.section>
  );
}

export default function LibraryHome() {
  const currentTab = useCurrentWorkspaceTab();
  const isActiveTab = useIsActiveTab();
  const { tabs, updateTab, selectTab, closeTab } = useWorkspaceTabs();
  const library = useWebLibrary();
  const [timelines, setTimelines] = React.useState([]);
  const [loadingSecondary, setLoadingSecondary] = React.useState(true);
  const [creating, setCreating] = React.useState(null);
  const [folderRequest, setFolderRequest] = React.useState(null);
  const [folderBusy, setFolderBusy] = React.useState(false);
  const [renameRequest, setRenameRequest] = React.useState(null);
  const [renameBusy, setRenameBusy] = React.useState(false);
  const [contextMenu, setContextMenu] = React.useState(null);
  const [selectedItems, setSelectedItems] = React.useState(() => new Set());
  const [massBusy, setMassBusy] = React.useState(false);
  const [exportNotice, setExportNotice] = React.useState(null);
  const [collapsed, setCollapsed] = React.useState(() => new Set());
  const [itemOrder, setItemOrder] = React.useState(readSavedItemOrder);
  const initializedFolderKeys = React.useRef(new Set());
  const exportNoticeTimer = React.useRef(null);

  useTabTitle('New tab');

  React.useEffect(() => () => {
    if (exportNoticeTimer.current) window.clearTimeout(exportNoticeTimer.current);
  }, []);

  const announceExportComplete = React.useCallback((detail) => {
    if (exportNoticeTimer.current) window.clearTimeout(exportNoticeTimer.current);
    setExportNotice({ id: Date.now(), detail });
    exportNoticeTimer.current = window.setTimeout(() => setExportNotice(null), 2400);
  }, []);

  const refreshSecondary = React.useCallback(async () => {
    try {
      const graphs = await listTimegraphs().catch(() => []);
      setTimelines(Array.isArray(graphs) ? graphs : []);
    } finally {
      setLoadingSecondary(false);
    }
  }, []);

  React.useEffect(() => {
    if (!isActiveTab) return;
    library.refresh();
    refreshSecondary();
  }, [isActiveTab, library.refresh, refreshSecondary]);

  React.useEffect(() => {
    if (!library.loaded || !library.folders.length) return;
    setCollapsed((current) => {
      const next = new Set(current);
      let changed = false;
      library.folders.forEach((folder) => {
        const key = `${libraryFolderCategory(folder)}:${folder.id}`;
        if (initializedFolderKeys.current.has(key)) return;
        initializedFolderKeys.current.add(key);
        next.add(key);
        changed = true;
      });
      return changed ? next : current;
    });
  }, [library.folders, library.loaded]);

  const adoptCurrentTab = React.useCallback((kind, path, title, { allowDuplicate = false } = {}) => {
    // Choosing a library item from New tab is one of the two intentional ways
    // to open a duplicate view. Utility navigation still reuses an existing
    // matching tab so ordinary clicks cannot create accidental clutter.
    if (!allowDuplicate) {
      const alreadyOpen = tabs.find((tab) => tab.id !== currentTab?.id && sameWorkspaceTarget(tab, kind, path));
      if (alreadyOpen) {
        if (currentTab && tabs.length > 1) closeTab(currentTab.id);
        selectTab(alreadyOpen.id);
        return;
      }
    }
    if (currentTab) updateTab(currentTab.id, { kind, path, title });
  }, [closeTab, currentTab, selectTab, tabs, updateTab]);

  const openItem = React.useCallback((category, item, titleOverride) => {
    if (category === 'web') {
      adoptCurrentTab(TAB_KINDS.KNOWLEDGE_WEB, webDeepLink(item.id, titleOverride || item.title), titleOverride || item.title || 'Knowledge Web', { allowDuplicate: true });
    } else if (category === 'note') {
      adoptCurrentTab(TAB_KINDS.NOTES, noteDeepLink(item.id, item.title), item.title || 'Untitled Note', { allowDuplicate: true });
    } else if (category === 'timeline') {
      adoptCurrentTab(TAB_KINDS.TIMELINE, timegraphDeepLink(item.id, item.title), item.title || 'Unnamed timeline', { allowDuplicate: true });

    }
  }, [adoptCurrentTab]);

  const createItem = async (category) => {
    if (creating) return;
    setCreating(category);
    try {
      if (category === 'web') {
        const record = await library.createWeb('Untitled Web');
        openItem(category, record);
      } else if (category === 'note') {
        const record = await library.createNote();
        if (record) openItem(category, record);
      } else if (category === 'timeline') {
        const record = await createTimegraph({ title: '' });
        setTimelines((current) => [record, ...current]);
        openItem(category, record);
      }
    } catch (error) {
      toast.error(error?.message || `BEX could not create that ${CATEGORIES[category].label}.`);
    } finally {
      setCreating(null);
    }
  };

  const createItemRef = React.useRef(createItem);
  createItemRef.current = createItem;

  React.useEffect(() => {
    if (!isActiveTab) return undefined;

    const handleCreateShortcut = (event) => {
      if (
        event.defaultPrevented
        || event.metaKey
        || event.ctrlKey
        || event.altKey
        || event.shiftKey
        || event.repeat
        || creating
        || folderRequest
        || library.showCreatePrivateModal
        || isEditableTarget(event.target)
      ) return;

      const category = CATEGORY_BY_SHORTCUT[event.key.toLowerCase()];
      if (!category) return;
      event.preventDefault();
      void createItemRef.current(category);
    };

    window.addEventListener('keydown', handleCreateShortcut);
    return () => window.removeEventListener('keydown', handleCreateShortcut);
  }, [creating, folderRequest, isActiveTab, library.showCreatePrivateModal]);

  const buildItemExport = async (category, item) => {
    if (category === 'web') {
      if (item.is_private) throw new Error('Unlock private Knowledge Webs before exporting them.');
      const [cards, connections, canvasObjects] = await Promise.all([
        desktopClient.entities.WebCard.filter({ web_id: item.id }),
        desktopClient.entities.WebConnection.filter({ web_id: item.id }),
        desktopClient.entities.CanvasObject.filter({ web_id: item.id }),
      ]);
      const payload = buildBereanKnowledgeWebPayload({ web: item, cards, connections, canvasObjects });
      return {
        fileName: `${sanitizeFileName(item.title || 'knowledge-web')}.berean`,
        content: JSON.stringify(payload, null, 2),
        type: 'application/octet-stream',
      };
    }
    if (category === 'note') {
      // The library row is a cached list snapshot. Its content can predate an
      // autosave in another mounted tab, even after that save has completed.
      return buildCurrentNoteExport(item.id);
    }
    if (category === 'timeline') {
      return {
        fileName: exportFileName(item.title, 'json', EXPORT_SCOPES.ALL),
        content: toJson(item),
        type: 'application/json;charset=utf-8',
      };
    }
    throw new Error('Unsupported library category.');
  };

  const exportItem = async (category, item) => {
    const artifact = await buildItemExport(category, item);
    const result = await saveExportFile(new Blob([artifact.content], { type: artifact.type }), artifact.fileName);
    return { ...artifact, ...result };
  };

  const itemCollections = React.useMemo(() => ({
    web: library.webs,
    note: library.notes,
    timeline: timelines,
  }), [library.notes, library.webs, timelines]);

  const selectedRecords = React.useMemo(() => Array.from(selectedItems).flatMap((key) => {
    const [category, rawId] = key.split(':');
    const item = itemCollections[category]?.find((candidate) => String(candidate.id) === rawId);
    return item ? [{ category, item }] : [];
  }), [itemCollections, selectedItems]);

  const toggleItemSelection = React.useCallback((category, itemId) => {
    const key = itemSelectionKey(category, itemId);
    setSelectedItems((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const clearExportedSelections = React.useCallback((records) => {
    setSelectedItems((current) => {
      const next = new Set(current);
      records.forEach(({ category, item }) => next.delete(itemSelectionKey(category, item.id)));
      return next;
    });
  }, []);

  const renameItem = async (category, item, name) => {
    if (category === 'web') await library.renameWeb(item.id, name);
    else if (category === 'note') await library.renameNote(item.id, name);
    else if (category === 'timeline') {
      const updated = await renameTimegraph(item.id, name);
      setTimelines((current) => current.map((graph) => graph.id === item.id ? { ...graph, ...updated } : graph));

    }
  };

  const saveItemRename = async (name) => {
    if (!renameRequest) return;
    setRenameBusy(true);
    try {
      await renameItem(renameRequest.category, renameRequest.item, name);
      const pathForRenamedItem = renameRequest.category === 'web'
        ? webDeepLink(renameRequest.item.id, name)
        : renameRequest.category === 'note'
          ? noteDeepLink(renameRequest.item.id, name)
          : renameRequest.category === 'timeline'
            ? timegraphDeepLink(renameRequest.item.id, name)
            : null;
      tabs.filter((tab) => tabMatchesLibraryItem(tab, renameRequest.category, renameRequest.item)).forEach((tab) => {
        updateTab(tab.id, { title: name, ...(pathForRenamedItem ? { path: pathForRenamedItem } : {}) });
      });
      setRenameRequest(null);
    } catch (error) {
      toast.error(error?.message || 'BEX could not rename that item.');
    } finally {
      setRenameBusy(false);
    }
  };

  const deleteItemRecord = async (category, item) => {
    if (category === 'web') await library.deleteWeb(item.id);
    else if (category === 'note') await library.deleteNote(item.id);
    else if (category === 'timeline') {
      await deleteTimegraph(item.id);
      setTimelines((current) => current.filter((graph) => graph.id !== item.id));

    }
  };

  const deleteItems = async (records) => {
    if (!records.length) return;
    const confirmed = await confirmDialog({
      title: records.length === 1 ? `Delete “${plainItemTitle(records[0].category, records[0].item)}”?` : `Delete ${records.length} selected items?`,
      description: records.length === 1 ? 'This cannot be undone.' : 'Every selected item will be permanently deleted. This cannot be undone.',
      confirmText: records.length === 1 ? 'Delete' : `Delete ${records.length} items`,
      tone: 'danger',
    });
    if (!confirmed) return;
    setMassBusy(true);
    try {
      for (const record of records) await deleteItemRecord(record.category, record.item);
      records.forEach((record) => {
        tabs.filter((tab) => tabMatchesLibraryItem(tab, record.category, record.item)).forEach((tab) => closeTab(tab.id));
      });
      setSelectedItems(new Set());
      toast.success(records.length === 1 ? 'Deleted.' : `${records.length} items deleted.`);
    } catch (error) {
      toast.error(error?.message || 'BEX could not delete every selected item.');
      await Promise.all([library.refresh(), refreshSecondary()]);
    } finally {
      setMassBusy(false);
    }
  };

  const exportItems = async (records) => {
    if (!records.length) return;
    setMassBusy(true);
    try {
      // Let editor debounces start and finish before reading records for either
      // a single-file export or a selected-items ZIP. Failed saves block export.
      await waitForNoteExportSaves();
      if (records.length === 1) {
        const artifact = await exportItem(records[0].category, records[0].item);
        if (artifact.status !== 'saved') return;
        clearExportedSelections(records);
        announceExportComplete(artifact.fileName);
        return;
      }
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      const failures = [];
      const successfulRecords = [];
      const usedNames = new Map();
      let completed = 0;
      for (const record of records) {
        try {
          const artifact = await buildItemExport(record.category, record.item);
          const count = usedNames.get(artifact.fileName) || 0;
          usedNames.set(artifact.fileName, count + 1);
          const dot = artifact.fileName.lastIndexOf('.');
          const uniqueName = count === 0
            ? artifact.fileName
            : `${artifact.fileName.slice(0, dot)}-${count + 1}${artifact.fileName.slice(dot)}`;
          zip.file(uniqueName, artifact.content);
          successfulRecords.push(record);
          completed += 1;
        } catch (error) {
          failures.push(`${plainItemTitle(record.category, record.item)}: ${error?.message || 'Could not export.'}`);
        }
      }
      if (!completed) throw new Error(failures[0] || 'BEX could not export the selected items.');
      if (failures.length) zip.file('export-errors.txt', failures.join('\n'));
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      const date = new Date().toISOString().slice(0, 10);
      const result = await saveExportFile(blob, `bex-selected-items-${date}.zip`);
      if (result.status !== 'saved') return;
      clearExportedSelections(successfulRecords);
      announceExportComplete(failures.length
        ? `${completed} exported · ${failures.length} still selected for retry`
        : `${completed} items packaged into one file`);
    } catch (error) {
      toast.error(error?.message || 'BEX could not export the selected items.');
    } finally {
      setMassBusy(false);
    }
  };

  const openItemContextMenu = React.useCallback((category, item, x, y) => {
    setContextMenu({ category, item, x, y });
  }, []);

  const saveFolder = async (name) => {
    setFolderBusy(true);
    try {
      if (folderRequest?.mode === 'rename') await library.renameFolder(folderRequest.folder.id, name);
      else await library.createFolder(name, folderRequest?.category || 'web');
      setFolderRequest(null);
    } catch (error) {
      toast.error(error?.message || 'BEX could not save that folder.');
    } finally {
      setFolderBusy(false);
    }
  };

  const deleteFolder = async (folder) => {
    const confirmed = await confirmDialog({
      title: `Delete “${folder.name}”?`,
      description: 'The folder will be removed. Its contents stay safe and return to the main library.',
      confirmText: 'Delete folder',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      await library.deleteFolder(folder.id);
      setTimelines((current) => current.map((item) => item.folder_id === folder.id ? { ...item, folder_id: null } : item));
    } catch (error) {
      toast.error(error?.message || 'BEX could not delete that folder.');
    }
  };

  const toggleFolder = (category, folderId) => {
    const key = `${category}:${folderId}`;
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const revealFolder = React.useCallback((category, folderId) => {
    // Land a row inside a collapsed folder and it would simply vanish, so the
    // folder it went into opens to show it.
    setCollapsed((current) => {
      const key = `${category}:${folderId}`;
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }, []);

  const moveItemToFolder = React.useCallback(async (category, item, folderId) => {
    const target = folderId == null ? null : folderId;
    try {
      if (category === 'web') {
        await library.moveWebToFolder(item.id, target);
      } else if (category === 'note') {
        await library.moveNoteToFolder(item.id, target);
      } else if (category === 'timeline') {
        const updated = await moveTimegraphToFolder(item.id, target);
        setTimelines((current) => current.map((entry) => (
          String(entry.id) === String(item.id) ? { ...entry, ...updated } : entry
        )));

      }
    } catch (error) {
      toast.error(error?.message || 'BEX could not move that item.');
      // The row is already drawn in its new home, so pull the truth back.
      library.refresh();
      refreshSecondary();
    }
  }, [library, refreshSecondary]);

  const reorderLibraryItems = React.useCallback((scope, orderedIds) => {
    setItemOrder((current) => {
      const next = { ...current, [scope]: orderedIds.map(String) };
      try {
        window.localStorage.setItem(LIBRARY_ITEM_ORDER_KEY, JSON.stringify(next));
      } catch {
        // Reordering still works for this session if browser storage is unavailable.
      }
      return next;
    });
  }, []);

  const openUtility = (kind, path, title) => adoptCurrentTab(kind, path, title);
  const loading = !library.loaded || loadingSecondary;

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[#0b0f16]" data-testid="library-home">
      <header className="relative z-50 flex min-h-12 shrink-0 flex-wrap items-center gap-3 py-1.5 border-b border-white/[0.055] px-4 sm:px-6">
        <div className="grid min-w-0 basis-full grid-cols-1 gap-3 lg:basis-0 lg:flex-1 sm:grid-cols-2" data-testid="library-search-bars">
          <LibrarySpotlightSearch />
          <ScriptureSearch />
        </div>
        <AiExportButton />
        <nav className="flex items-center gap-1" aria-label="Other BEX workspaces">
          <UserSettings active={isActiveTab} />
          <button onClick={() => openUtility(TAB_KINDS.COURSES, createPageUrl('Courses'), 'Courses')} className="grid h-8 w-8 place-items-center rounded-lg text-slate-600 hover:bg-white/5 hover:text-emerald-300" title="Courses"><GraduationCap className="h-4 w-4" /></button>
          <button onClick={() => openUtility(TAB_KINDS.STATS, createPageUrl('Stats'), 'Stats')} className="grid h-8 w-8 place-items-center rounded-lg text-slate-600 hover:bg-white/5 hover:text-sky-300" title="Stats" aria-label="Open Stats"><BarChart3 className="h-4 w-4" /></button>
          <button onClick={() => openUtility(TAB_KINDS.AI_SECOND_BRAIN, createPageUrl('BrainChat'), 'AI Second Brain')} className="grid h-8 w-8 place-items-center rounded-lg text-slate-600 hover:bg-white/5 hover:text-violet-300" title="AI Second Brain"><Brain className="h-4 w-4" /></button>
          <button onClick={() => openUtility(TAB_KINDS.KEYWORDS, createPageUrl('Keywords'), 'Keywords')} className="grid h-8 w-8 place-items-center rounded-lg text-slate-600 hover:bg-white/5 hover:text-amber-300" title="Keywords"><Tag className="h-4 w-4" /></button>
        </nav>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-5 sm:py-5">
        <div className="bex-library-columns mx-auto grid max-w-[1780px] grid-cols-1 items-start gap-4 md:grid-cols-3">
          {Object.keys(CATEGORIES).map((category) => (
            <CategoryColumn
              key={category}
              category={category}
              items={category === 'web' ? library.webs : category === 'note' ? library.notes : timelines}
              folders={libraryFoldersForCategory(library.folders, category)}
              busy={creating === category}
              onCreate={() => createItem(category)}
              onCreateFolder={() => setFolderRequest({ mode: 'create', category })}
              onCreatePrivate={() => library.openCreatePrivate('')}
              onOpen={(item) => openItem(category, item)}
              collapsed={collapsed}
              onToggleFolder={toggleFolder}
              onRenameFolder={(folder) => setFolderRequest({ mode: 'rename', category, folder })}
              onDeleteFolder={deleteFolder}
              selectedItems={selectedItems}
              onToggleSelection={toggleItemSelection}
              onContextMenu={openItemContextMenu}
              renameRequest={renameRequest}
              renameBusy={renameBusy}
              onRenameCancel={() => setRenameRequest(null)}
              onRenameSubmit={saveItemRename}
              itemOrder={itemOrder}
              onReorderItems={reorderLibraryItems}
              onMoveItem={moveItemToFolder}
              onRevealFolder={revealFolder}
            />
          ))}
        </div>
      </main>

      <AnimatePresence>
        {exportNotice && <ExportCompleteNotice notice={exportNotice} />}
      </AnimatePresence>

      <AnimatePresence>
        {selectedRecords.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            className="absolute bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-white/10 bg-[#141925]/95 p-2 pl-4 shadow-2xl backdrop-blur-xl"
            data-testid="library-mass-actions"
          >
            <span className="mr-1 text-xs font-semibold text-slate-300">{selectedRecords.length} selected</span>
            <button type="button" disabled={massBusy} onClick={() => exportItems(selectedRecords)} className="inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"><Download className="h-4 w-4" /> Export</button>
            <button type="button" disabled={massBusy} onClick={() => deleteItems(selectedRecords)} className="inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-40"><Trash2 className="h-4 w-4" /> Delete</button>
            <button type="button" onClick={() => setSelectedItems(new Set())} className="grid h-9 w-9 place-items-center rounded-xl text-slate-500 hover:bg-white/5 hover:text-white" aria-label="Clear selection"><X className="h-4 w-4" /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {loading && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-[#0b0f16]/50 backdrop-blur-[2px]">
          <Loader2 className="h-5 w-5 animate-spin text-violet-300" />
        </div>
      )}

      <AnimatePresence>
        {folderRequest && (
          <FolderDialog
            request={folderRequest}
            onClose={() => !folderBusy && setFolderRequest(null)}
            onSubmit={saveFolder}
            busy={folderBusy}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {contextMenu && (
          <ItemContextMenu
            menu={contextMenu}
            onClose={() => setContextMenu(null)}
            onRename={() => {
              setRenameRequest({ ...contextMenu, name: plainItemTitle(contextMenu.category, contextMenu.item) });
              setContextMenu(null);
            }}
            onExport={() => {
              void exportItems([{ category: contextMenu.category, item: contextMenu.item }]);
              setContextMenu(null);
            }}
            onDelete={() => {
              void deleteItems([{ category: contextMenu.category, item: contextMenu.item }]);
              setContextMenu(null);
            }}
          />
        )}
      </AnimatePresence>

      <CreatePrivateWebModal
        open={library.showCreatePrivateModal}
        onClose={library.closeCreatePrivate}
        busy={library.createPrivateBusy}
        initialName={library.createPrivateInitialName}
        onCreate={async (payload) => {
          const record = await library.createPrivateWeb(payload);
          if (record) openItem('web', record, payload.plainName);
        }}
      />
    </div>
  );
}
