import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import LibraryColumnDnd, {
  LibraryRootDropZone,
  useLibraryFolderDropzone,
} from '@/components/library/LibraryColumnDnd';
import { LIBRARY_ROOT_CONTAINER, folderContainerId } from '@/lib/libraryDragDrop';

/**
 * A row actually being dragged into a folder.
 *
 * tests/libraryDragDrop.test.js proves the decision; this proves the wiring —
 * that the folder is registered as a drop target at all, which is exactly what
 * was missing before. Each list used to own its own DndContext, so a row could
 * be reordered but the folder below it was not part of the same drag and could
 * never receive anything.
 *
 * jsdom lays nothing out, so every rect is stubbed from the fixture below.
 * dnd-kit reads rects to decide what the pointer is over, and with the jsdom
 * default of all-zeroes every collision test would answer "nothing".
 */

const ROW_HEIGHT = 44;
const LANE = { left: 0, width: 300 };

// One column: two unfiled rows stacked from y=0, then a folder at y=120.
const GEOMETRY = {
  [LIBRARY_ROOT_CONTAINER]: { top: 0, height: 100 },
  'row-1': { top: 0, height: ROW_HEIGHT },
  'row-2': { top: 50, height: ROW_HEIGHT },
  [folderContainerId('f1')]: { top: 120, height: 40 },
};

function rectFor(key) {
  const box = GEOMETRY[key];
  if (!box) return null;
  return {
    x: LANE.left,
    y: box.top,
    left: LANE.left,
    top: box.top,
    right: LANE.left + LANE.width,
    bottom: box.top + box.height,
    width: LANE.width,
    height: box.height,
  };
}

function Row({ id, label }) {
  const { attributes, listeners, setNodeRef } = useSortable({ id });
  return (
    <div ref={setNodeRef} data-testid={`row-${id}`} {...attributes} {...listeners}>
      {label}
    </div>
  );
}

function FolderZone({ folderId, children }) {
  const { setNodeRef, isTarget, dragging } = useLibraryFolderDropzone(folderId);
  return (
    <section
      ref={setNodeRef}
      data-testid={`folder-${folderId}`}
      data-drop-target={isTarget ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
    >
      {children}
    </section>
  );
}

function Column({ containers, onReorder, onMoveItem, onDropIntoFolder }) {
  const rootItems = containers[0].items;
  const folderItems = containers[1].items;
  return (
    <LibraryColumnDnd
      containers={containers}
      category="note"
      onReorder={onReorder}
      onMoveItem={onMoveItem}
      onDropIntoFolder={onDropIntoFolder}
      renderDragPreview={(item) => <div data-testid="drag-preview">{item.title}</div>}
    >
      <LibraryRootDropZone>
        <SortableContext items={rootItems.map((i) => String(i.id))} strategy={verticalListSortingStrategy}>
          {rootItems.map((item) => <Row key={item.id} id={String(item.id)} label={item.title} />)}
        </SortableContext>
      </LibraryRootDropZone>
      <FolderZone folderId="f1">
        <SortableContext items={folderItems.map((i) => String(i.id))} strategy={verticalListSortingStrategy}>
          {folderItems.map((item) => <Row key={item.id} id={String(item.id)} label={item.title} />)}
        </SortableContext>
      </FolderZone>
    </LibraryColumnDnd>
  );
}

function makeContainers() {
  return [
    {
      id: LIBRARY_ROOT_CONTAINER,
      folderId: null,
      scope: 'note:root',
      items: [{ id: 'row-1', title: 'Romans 9 notes' }, { id: 'row-2', title: 'Baptism' }],
    },
    { id: folderContainerId('f1'), folderId: 'f1', scope: 'note:folder:f1', items: [] },
  ];
}

/**
 * Teaches jsdom where things are.
 *
 * dnd-kit finds its droppables by walking the DOM nodes it was handed, so the
 * rect is looked up from the test id each node carries.
 */
function stubLayout() {
  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    const testId = this.getAttribute?.('data-testid') || '';
    const key = testId === 'library-dropzone-root'
      ? LIBRARY_ROOT_CONTAINER
      : testId.startsWith('folder-')
        ? folderContainerId(testId.slice('folder-'.length))
        : testId.startsWith('row-')
          ? testId.slice('row-'.length)
          : null;
    return { ...(rectFor(key) || { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }), toJSON() {} };
  };
}

function pointerEvent(type, { x, y }) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  // dnd-kit's PointerSensor reads these off the event, and jsdom's MouseEvent
  // has no PointerEvent fields of its own.
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'isPrimary', { value: true });
  return event;
}

async function dragRowTo(rowTestId, target) {
  const row = screen.getByTestId(rowTestId);
  const start = rectFor(rowTestId.slice('row-'.length));
  const from = { x: 20, y: start.top + start.height / 2 };

  await act(async () => {
    row.dispatchEvent(pointerEvent('pointerdown', from));
  });
  // Past the 6px activation distance, which is what stops a click opening a drag.
  await act(async () => {
    document.dispatchEvent(pointerEvent('pointermove', { x: from.x, y: from.y + 12 }));
  });
  await act(async () => {
    document.dispatchEvent(pointerEvent('pointermove', target));
  });
  return {
    async drop() {
      await act(async () => {
        document.dispatchEvent(pointerEvent('pointerup', target));
      });
    },
  };
}

const overFolder = { x: 20, y: 140 };
const overRoot = { x: 20, y: 60 };

let originalRect;

beforeEach(() => {
  originalRect = Element.prototype.getBoundingClientRect;
  stubLayout();
  return () => { Element.prototype.getBoundingClientRect = originalRect; };
});

describe('dragging a library row into a folder', () => {
  it('registers the folder as a drop target', () => {
    render(<Column containers={makeContainers()} onReorder={vi.fn()} onMoveItem={vi.fn()} onDropIntoFolder={vi.fn()} />);
    // The whole point: before this change there was no droppable here at all.
    expect(screen.getByTestId('folder-f1')).toBeTruthy();
    expect(screen.getByTestId('library-dropzone-root')).toBeTruthy();
  });

  it('highlights the folder while the row is held over it', async () => {
    render(<Column containers={makeContainers()} onReorder={vi.fn()} onMoveItem={vi.fn()} onDropIntoFolder={vi.fn()} />);
    const drag = await dragRowTo('row-row-1', overFolder);

    expect(screen.getByTestId('folder-f1').dataset.dropTarget).toBe('true');
    expect(screen.getByTestId('library-dropzone-root').dataset.dropTarget).toBe('false');

    await drag.drop();
    expect(screen.getByTestId('folder-f1').dataset.dropTarget).toBe('false');
  });

  it('shows the dragged row following the pointer', async () => {
    render(<Column containers={makeContainers()} onReorder={vi.fn()} onMoveItem={vi.fn()} onDropIntoFolder={vi.fn()} />);
    const drag = await dragRowTo('row-row-1', overFolder);
    // Rendered outside the folder, which clips its own contents.
    expect(screen.getByTestId('drag-preview').textContent).toBe('Romans 9 notes');
    await drag.drop();
    expect(screen.queryByTestId('drag-preview')).toBeNull();
  });

  it('files the row into the folder on drop', async () => {
    const onMoveItem = vi.fn();
    const onReorder = vi.fn();
    const onDropIntoFolder = vi.fn();
    render(<Column containers={makeContainers()} onReorder={onReorder} onMoveItem={onMoveItem} onDropIntoFolder={onDropIntoFolder} />);

    const drag = await dragRowTo('row-row-1', overFolder);
    await drag.drop();

    expect(onMoveItem).toHaveBeenCalledTimes(1);
    const [category, item, folderId] = onMoveItem.mock.calls[0];
    expect(category).toBe('note');
    expect(item.title).toBe('Romans 9 notes');
    expect(folderId).toBe('f1');

    // Both lists are rewritten, or the row is remembered in its old one too.
    expect(onReorder).toHaveBeenCalledWith('note:root', ['row-2']);
    expect(onReorder).toHaveBeenCalledWith('note:folder:f1', ['row-1']);

    // A collapsed folder would otherwise swallow the row without a trace.
    expect(onDropIntoFolder).toHaveBeenCalledWith('note', 'f1');
  });

  it('takes a row back out of a folder', async () => {
    const containers = makeContainers();
    containers[0].items = [{ id: 'row-2', title: 'Baptism' }];
    containers[1].items = [{ id: 'row-1', title: 'Romans 9 notes' }];
    // The filed row now sits where the folder is.
    GEOMETRY['row-1'] = { top: 120, height: ROW_HEIGHT };
    GEOMETRY['row-2'] = { top: 0, height: ROW_HEIGHT };

    const onMoveItem = vi.fn();
    const onDropIntoFolder = vi.fn();
    render(<Column containers={containers} onReorder={vi.fn()} onMoveItem={onMoveItem} onDropIntoFolder={onDropIntoFolder} />);

    const drag = await dragRowTo('row-row-1', overRoot);
    await drag.drop();

    expect(onMoveItem).toHaveBeenCalledWith('note', expect.objectContaining({ id: 'row-1' }), null);
    // Nothing to reveal: it went back to the main library.
    expect(onDropIntoFolder).not.toHaveBeenCalled();

    GEOMETRY['row-1'] = { top: 0, height: ROW_HEIGHT };
    GEOMETRY['row-2'] = { top: 50, height: ROW_HEIGHT };
  });

  it('still reorders within a list without moving anything', async () => {
    const onReorder = vi.fn();
    const onMoveItem = vi.fn();
    render(<Column containers={makeContainers()} onReorder={onReorder} onMoveItem={onMoveItem} />);

    const drag = await dragRowTo('row-row-1', { x: 20, y: 72 });
    await drag.drop();

    expect(onMoveItem).not.toHaveBeenCalled();
    expect(onReorder).toHaveBeenCalledWith('note:root', ['row-2', 'row-1']);
  });

  it('does nothing when the drag is released over nothing', async () => {
    const onReorder = vi.fn();
    const onMoveItem = vi.fn();
    render(<Column containers={makeContainers()} onReorder={onReorder} onMoveItem={onMoveItem} />);

    const drag = await dragRowTo('row-row-1', { x: 20, y: 900 });
    await drag.drop();

    expect(onMoveItem).not.toHaveBeenCalled();
    expect(onReorder).not.toHaveBeenCalled();
  });
});
