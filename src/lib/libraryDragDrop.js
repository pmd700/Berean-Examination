/**
 * Where a dragged library row lands.
 *
 * The library column is not one flat list: it is the unfiled list plus one list
 * per folder, all stacked in the same drag context. dnd-kit only tells us which
 * id the pointer finished over — that id may be another row, or it may be a
 * whole container — so the decision of "reorder here" versus "move into that
 * folder" is made here, away from React, where it can be tested directly.
 *
 * Containers are described as `{ id, folderId, scope, items }`. `scope` is the
 * key the saved manual ordering is stored under; `folderId` is null for the
 * unfiled list.
 */

export const LIBRARY_ROOT_CONTAINER = 'container:root';
const FOLDER_CONTAINER_PREFIX = 'container:folder:';

export function folderContainerId(folderId) {
  return `${FOLDER_CONTAINER_PREFIX}${folderId}`;
}

export function isLibraryContainerId(id) {
  const key = String(id ?? '');
  return key === LIBRARY_ROOT_CONTAINER || key.startsWith(FOLDER_CONTAINER_PREFIX);
}

function containerIds(container) {
  return (container?.items || []).map((item) => String(item.id));
}

/** The container holding a row, or null when the id is not a row we know. */
export function findItemContainer(containers, itemId) {
  const key = String(itemId ?? '');
  if (!key) return null;
  return (containers || []).find((container) => containerIds(container).includes(key)) || null;
}

/**
 * The container a drop over `overId` belongs to — the container itself when the
 * pointer is over empty folder space, otherwise the container of the row under
 * the pointer. Used both to plan the drop and to highlight the target mid-drag.
 */
export function resolveDropContainer(containers, overId) {
  if (overId == null) return null;
  const key = String(overId);
  if (isLibraryContainerId(key)) {
    return (containers || []).find((container) => container.id === key) || null;
  }
  return findItemContainer(containers, key);
}

function moveWithin(ids, from, to) {
  const next = [...ids];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

/**
 * The whole drop, decided in one place.
 *
 * Returns null when nothing should happen, a `reorder` when the row stayed in
 * its own list, or a `move` carrying both the new parent folder and the new
 * ordering of the list it left and the list it joined — a cross-list drop has
 * to write all three or the row reappears in the wrong place on reload.
 */
export function planLibraryDrop(containers, activeId, overId) {
  if (activeId == null || overId == null) return null;
  const active = String(activeId);
  const over = String(overId);

  const from = findItemContainer(containers, active);
  const to = resolveDropContainer(containers, over);
  if (!from || !to) return null;

  const fromIds = containerIds(from);

  if (from.id === to.id) {
    if (active === over) return null;
    const oldIndex = fromIds.indexOf(active);
    const newIndex = fromIds.indexOf(over);
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return null;
    return { type: 'reorder', scope: from.scope, orderedIds: moveWithin(fromIds, oldIndex, newIndex) };
  }

  const item = (from.items || []).find((entry) => String(entry.id) === active);
  if (!item) return null;

  // Dropping on the container rather than a row appends; dropping on a row
  // takes that row's place, which is where the gap opened up during the drag.
  const toIds = containerIds(to).filter((id) => id !== active);
  const overIndex = toIds.indexOf(over);
  const insertAt = overIndex < 0 ? toIds.length : overIndex;

  return {
    type: 'move',
    item,
    itemId: active,
    folderId: to.folderId ?? null,
    fromFolderId: from.folderId ?? null,
    fromScope: from.scope,
    fromOrderedIds: fromIds.filter((id) => id !== active),
    toScope: to.scope,
    toOrderedIds: [...toIds.slice(0, insertAt), active, ...toIds.slice(insertAt)],
  };
}
