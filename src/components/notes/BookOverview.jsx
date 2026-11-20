import React from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Plus, Trash2, X } from 'lucide-react';
import NoteExportMenu from './NoteExportMenu';
import PageSnapshot from './PageSnapshot';
import { MAX_PAGES, footnoteOffsets, getPageTitle } from './bookModel';

let nextOverviewPageId = 0;

function makePageItem(page) {
  nextOverviewPageId += 1;
  return { id: `book-overview-page-${nextOverviewPageId}`, page };
}

function makePageItems(pages) {
  return pages.map(makePageItem);
}

/** Keep a card's drag identity through saves, reorders, and duplicate pages. */
function reconcilePageItems(current, pages) {
  if (
    current.length === pages.length
    && current.every((item, index) => item.page === pages[index])
  ) return current;

  const unused = [...current];
  return pages.map((page) => {
    const matchIndex = unused.findIndex(item => item.page === page);
    if (matchIndex < 0) return makePageItem(page);
    const [match] = unused.splice(matchIndex, 1);
    return match;
  });
}

function PageThumbnail({ page, offset = 0 }) {
  return (
    <>
      {/* Scaled down so a full page fits the card: the reader recognises a
          page by its shape, not by reading it. */}
      <div
        className="pointer-events-none absolute inset-0 origin-top-left scale-[0.34]"
        style={{ width: '294%', height: '294%' }}
      >
        <div className="px-5 py-4">
          <PageSnapshot html={page} offset={offset} showFoot={false} />
        </div>
      </div>
      <span className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[#0f111a] to-transparent" />
    </>
  );
}

function SortablePageCard({
  item,
  index,
  offset,
  isSelected,
  isCurrent,
  canReorder,
  onOpen,
  onToggle,
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: !canReorder });
  const pageTitle = getPageTitle(item.page).trim();

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: isDragging ? undefined : CSS.Transform.toString(transform),
        transition: transition || 'transform 220ms cubic-bezier(0.2, 0.82, 0.2, 1)',
        opacity: isDragging ? 0.28 : 1,
        zIndex: isDragging ? 20 : undefined,
        // Needed on the element that starts the drag, or touch scrolls instead.
        touchAction: canReorder ? 'none' : undefined,
      }}
      className={`min-w-0 ${canReorder ? 'cursor-grab active:cursor-grabbing' : ''}`}
      data-testid={`page-card-${index + 1}`}
      data-selected={isSelected ? 'true' : 'false'}
      data-dragging={isDragging ? 'true' : 'false'}
      aria-label={canReorder ? `Page ${index + 1}, drag to rearrange` : undefined}
      // The whole card is the handle. A page card is plainly an object on a
      // board, so picking it up and moving it needs no separate grip drawn on
      // top of it — and the pointer sensor only treats a press as a drag once
      // it has actually travelled, so a press that does not move still opens
      // the page underneath.
      {...attributes}
      {...listeners}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.965, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.965 }}
        transition={{ duration: 0.2, ease: [0.2, 0.82, 0.2, 1] }}
        className="flex flex-col gap-1.5"
      >
        <div
          className={`group/page relative aspect-[3/4] overflow-hidden rounded-lg border bg-[#0f111a] transition-[border-color,box-shadow] duration-200 ${
            isSelected
              ? 'border-violet-500 shadow-[0_0_0_1px_rgba(139,92,246,0.18)]'
              : isCurrent
                ? 'border-violet-500/40'
                : 'border-line hover:border-line-strong'
          }`}
        >
          <button
            type="button"
            onClick={() => onOpen(index)}
            className={`absolute inset-0 text-left ${canReorder ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
            title={`Go to page ${index + 1}`}
            data-testid={`button-page-open-${index + 1}`}
          >
            <PageThumbnail page={item.page} offset={offset} />
          </button>

          <button
            type="button"
            onClick={() => onToggle(item.id)}
            // Picking a page to delete or export should never be mistaken for
            // the start of a drag, so the press stops here.
            onPointerDown={(event) => event.stopPropagation()}
            aria-pressed={isSelected}
            aria-label={`Select page ${index + 1}`}
            className={`absolute right-2 top-2 grid h-5 w-5 place-items-center rounded border transition-all ${
              isSelected
                ? 'border-violet-400 bg-violet-500 text-white'
                : 'border-line-strong bg-[#0f111a]/85 text-transparent opacity-0 group-hover/page:opacity-100 focus:opacity-100'
            }`}
            data-testid={`checkbox-page-${index + 1}`}
          >
            <Check className="h-3 w-3" />
          </button>
        </div>

        <div className="flex min-w-0 items-baseline gap-1.5 px-0.5">
          <span className={`truncate text-xs font-medium ${isCurrent ? 'text-violet-300' : 'text-ink-soft'}`}>
            Page {index + 1}{pageTitle ? ` · ${pageTitle}` : ''}
          </span>
          {isCurrent && <span className="shrink-0 text-[10px] text-ink-soft">· open</span>}
        </div>
      </motion.div>
    </div>
  );
}

/**
 * Every page of the book at once, for the jobs that are painful one page at a
 * time: finding a page, arranging the book, throwing several away, or pulling
 * a few out to hand in.
 *
 * The cards are still renderings, not editors — a forty-page book opens here
 * instantly because nothing in it is editable while you are looking at it.
 */
export default function BookOverview({
  open,
  title,
  pages,
  pageIndex,
  onClose,
  onGoToPage,
  onAddPage,
  onMovePage,
  onDeletePages,
  onExportPages,
  exporting = false,
  exportNotice = null,
}) {
  const [items, setItems] = React.useState(() => makePageItems(pages));
  const [selected, setSelected] = React.useState(() => new Set());
  const [activeId, setActiveId] = React.useState(null);
  const offsets = React.useMemo(() => open ? footnoteOffsets(pages) : [], [open, pages]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  React.useEffect(() => {
    if(open)setItems(current => reconcilePageItems(current, pages));
  }, [open, pages]);

  // Reopening starts clean: a selection left over from last time would put the
  // delete button behind pages the user has since forgotten they picked.
  React.useEffect(() => {
    if (open) {
      setSelected(new Set());
      setActiveId(null);
    }
  }, [open]);

  // A page may be deleted by another control while the overview is mounted.
  React.useEffect(() => {
    const validIds = new Set(items.map(item => item.id));
    setSelected((current) => {
      const next = new Set([...current].filter(id => validIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [items]);

  React.useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      // The first Escape belongs to the keyboard/pointer drag. A second press
      // can close the overview once dnd-kit has restored the card.
      if (activeId) return;
      event.preventDefault();
      onClose?.();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [activeId, open, onClose]);

  const toggle = (id) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const chosen = React.useMemo(
    () => items.reduce((indices, item, index) => {
      if (selected.has(item.id)) indices.push(index);
      return indices;
    }, []),
    [items, selected],
  );
  const allSelected = items.length > 0 && chosen.length === items.length;
  const canAddPage = pages.length < MAX_PAGES;
  const canReorder = items.length > 1;
  const activeItem = items.find(item => item.id === activeId) || null;
  const activeIndex = activeItem ? items.indexOf(activeItem) : -1;

  const handleDragEnd = ({ active, over }) => {
    setActiveId(null);
    if (!over || active.id === over.id) return;
    const from = items.findIndex(item => item.id === active.id);
    const to = items.findIndex(item => item.id === over.id);
    if (from < 0 || to < 0 || from === to) return;
    setItems(arrayMove(items, from, to));
    onMovePage?.(from, to);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          // The workspace tabs deliberately stay above page-level overlays so
          // the reader can always leave the current tab. Start immediately
          // below that strip instead of letting it cover this header's actions.
          className="fixed bottom-0 left-0 right-0 z-[220] flex flex-col bg-[#070910]/95 backdrop-blur-sm"
          style={{ top: 'var(--bex-tabbar-height, 0px)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          data-testid="book-overview"
        >
          <div className="flex flex-wrap items-center gap-3 border-b border-line/70 px-5 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink">{title || 'Untitled Note'}</div>
              <div className="text-[11px] text-ink-soft">
                {pages.length} {pages.length === 1 ? 'page' : 'pages'}
                {chosen.length > 0 ? ` · ${chosen.length} selected` : ''}
                {canReorder ? ' · Drag pages to rearrange' : ''}
              </div>
              {exportNotice && <p role={exportNotice.error ? 'alert' : 'status'} className={`mt-1 max-w-lg text-xs ${exportNotice.error ? 'text-red-300' : exportNotice.saved ? 'text-emerald-300' : 'text-ink-soft'}`}>{exportNotice.message}</p>}
            </div>

            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                disabled={!canAddPage}
                onClick={() => onAddPage?.()}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-violet-500/35 bg-violet-500/10 px-2.5 text-xs text-violet-200 transition-colors hover:border-violet-400/55 hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                title={canAddPage ? 'Add a page to the end of this book' : `Maximum ${MAX_PAGES} pages`}
                data-testid="button-pages-add"
              >
                <Plus className="h-3.5 w-3.5" /> Add page
              </button>
              <button
                type="button"
                onClick={() => setSelected(allSelected ? new Set() : new Set(items.map(item => item.id)))}
                className="h-8 rounded-md border border-line px-2.5 text-xs text-ink-soft transition-colors hover:bg-white/[0.06] hover:text-white"
                data-testid="button-pages-select-all"
              >
                {allSelected ? 'Clear selection' : 'Select all'}
              </button>
              <NoteExportMenu
                disabled={chosen.length === 0}
                busy={exporting}
                label="Export selected pages"
                onExport={format => format === 'md' ? onExportPages?.(chosen) : onExportPages?.(chosen, format)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-xs text-ink-soft transition-colors hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                testId="button-pages-export"
              />
              <button
                type="button"
                disabled={chosen.length === 0}
                onClick={() => onDeletePages?.(chosen)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-red-900/50 px-2.5 text-xs text-red-300 transition-colors hover:bg-red-900/25 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                data-testid="button-pages-delete"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
              <button
                type="button"
                onClick={onClose}
                className="grid h-8 w-8 place-items-center rounded-md text-ink-soft transition-colors hover:bg-white/[0.07] hover:text-white"
                title="Close (Esc)"
                data-testid="button-pages-close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={({ active }) => setActiveId(active.id)}
              onDragCancel={() => setActiveId(null)}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={items.map(item => item.id)} strategy={rectSortingStrategy}>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-4">
                  <AnimatePresence initial={false}>
                    {items.map((item, index) => (
                      <SortablePageCard
                        key={item.id}
                        item={item}
                        index={index}
                        offset={offsets[index] || 0}
                        isSelected={selected.has(item.id)}
                        isCurrent={index === pageIndex}
                        canReorder={canReorder}
                        onOpen={onGoToPage}
                        onToggle={toggle}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              </SortableContext>

              <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.2, 0.82, 0.2, 1)' }}>
                {activeItem && (
                  <div className="pointer-events-none w-[220px] rotate-[1.5deg]">
                    <div className="relative aspect-[3/4] overflow-hidden rounded-lg border border-violet-400/70 bg-[#0f111a] shadow-[0_28px_65px_-20px_rgba(0,0,0,0.95),0_0_35px_rgba(139,92,246,0.2)]">
                      <PageThumbnail page={activeItem.page} offset={offsets[activeIndex] || 0} />
                    </div>
                    <div className="mt-2 truncate px-0.5 text-xs font-medium text-violet-200">
                      Page {activeIndex + 1}{getPageTitle(activeItem.page).trim() ? ` · ${getPageTitle(activeItem.page).trim()}` : ''}
                    </div>
                  </div>
                )}
              </DragOverlay>
            </DndContext>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
