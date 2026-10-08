import React from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import {
  LIBRARY_ROOT_CONTAINER,
  folderContainerId,
  planLibraryDrop,
  resolveDropContainer,
} from '@/lib/libraryDragDrop';

/**
 * The drag context for one library column.
 *
 * A column is not one list: it is the unfiled list plus one list per folder. It
 * used to be one drag context *per list*, which is why a row could be reordered
 * but never carried into a folder — the folder simply did not exist as far as
 * the drag was concerned. One context now spans the whole column, every list in
 * it is a drop target, and `planLibraryDrop` reads the result.
 *
 * A column deliberately stops at its own category. A note cannot become a
 * Knowledge Web, so there is no context spanning two columns.
 */

/** What the drag is doing right now, so the list being aimed at can light up. */
const LibraryDragStateContext = React.createContext({ dragging: false, dropContainerId: null });

export function useLibraryDragState() {
  return React.useContext(LibraryDragStateContext);
}

export default function LibraryColumnDnd({
  containers,
  category,
  onReorder,
  onMoveItem,
  onDropIntoFolder,
  renderDragPreview,
  children,
}) {
  const sensors = useSensors(
    // Short of this distance the press is a click: rows open on click, and a
    // drag that started on every mousedown would make them unopenable.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [activeItem, setActiveItem] = React.useState(null);
  const [dropContainerId, setDropContainerId] = React.useState(null);

  // Read inside handlers that dnd-kit holds for the life of a drag, so a
  // re-render mid-drag cannot leave them planning against a stale column.
  const containersRef = React.useRef(containers);
  containersRef.current = containers;

  const detectCollisions = React.useCallback((args) => {
    // The pointer decides first: a collapsed folder is a 36px strip, and
    // nearest-centre would hand the drop to a tall neighbouring list instead.
    const byPointer = pointerWithin(args);
    if (byPointer.length) return byPointer;
    // Otherwise the row itself has to be touching a list. Nearest-centre would
    // also answer here, but it always answers — release the drag out in the
    // empty page below the column and it would file the row into whichever
    // folder happened to be closest.
    return rectIntersection(args);
  }, []);

  const handleDragStart = React.useCallback(({ active }) => {
    const found = containersRef.current
      .flatMap((container) => container.items)
      .find((item) => String(item.id) === String(active.id));
    setActiveItem(found || null);
    setDropContainerId(null);
  }, []);

  const handleDragOver = React.useCallback(({ over }) => {
    const container = resolveDropContainer(containersRef.current, over?.id);
    setDropContainerId(container ? container.id : null);
  }, []);

  const handleDragCancel = React.useCallback(() => {
    setActiveItem(null);
    setDropContainerId(null);
  }, []);

  const handleDragEnd = React.useCallback(({ active, over }) => {
    setActiveItem(null);
    setDropContainerId(null);

    const plan = planLibraryDrop(containersRef.current, active?.id, over?.id);
    if (!plan) return;

    if (plan.type === 'reorder') {
      onReorder(plan.scope, plan.orderedIds);
      return;
    }

    // Both lists are written: leaving the row in the list it came from means it
    // is remembered in two places, and reappears in the old one on reload.
    onReorder(plan.fromScope, plan.fromOrderedIds);
    onReorder(plan.toScope, plan.toOrderedIds);
    onMoveItem(category, plan.item, plan.folderId);
    if (plan.folderId != null) onDropIntoFolder?.(category, plan.folderId);
  }, [category, onMoveItem, onReorder, onDropIntoFolder]);

  const dragState = React.useMemo(
    () => ({ dragging: Boolean(activeItem), dropContainerId }),
    [activeItem, dropContainerId],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={detectCollisions}
      modifiers={[restrictToVerticalAxis]}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
    >
      <LibraryDragStateContext.Provider value={dragState}>
        {children}
      </LibraryDragStateContext.Provider>
      {/* The row that follows the pointer is rendered here rather than in place:
          a folder clips its contents so it can animate open, and a row dragged
          out of one would be cut off at the folder's edge. */}
      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }}>
        {activeItem && (
          <div className="pointer-events-none w-full rounded-xl shadow-[0_22px_55px_-20px_rgba(0,0,0,0.95)]">
            {renderDragPreview?.(activeItem)}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/** The unfiled list — the target that takes a row back out of a folder. */
export function LibraryRootDropZone({ children }) {
  const { dragging, dropContainerId } = useLibraryDragState();
  const { setNodeRef } = useDroppable({ id: LIBRARY_ROOT_CONTAINER });
  const isTarget = dropContainerId === LIBRARY_ROOT_CONTAINER;

  return (
    <div
      ref={setNodeRef}
      data-testid="library-dropzone-root"
      data-drop-target={isTarget ? 'true' : 'false'}
      className={`space-y-1.5 rounded-xl border transition-colors ${
        // With every row filed away this list is empty, and an empty div is not
        // a target you can aim at — so it holds a row's height while dragging.
        dragging ? 'min-h-12 border-dashed p-1' : 'border-transparent'
      } ${isTarget ? 'border-violet-400/45 bg-violet-500/[0.07]' : dragging ? 'border-white/[0.07]' : ''}`}
    >
      {children}
    </div>
  );
}

/** Registers a folder as a drop target and reports when the drop is aimed at it. */
export function useLibraryFolderDropzone(folderId) {
  const containerId = folderContainerId(folderId);
  const { dragging, dropContainerId } = useLibraryDragState();
  const { setNodeRef } = useDroppable({ id: containerId });
  return { setNodeRef, dragging, isTarget: dropContainerId === containerId };
}
