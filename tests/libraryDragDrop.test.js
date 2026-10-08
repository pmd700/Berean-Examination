import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIBRARY_ROOT_CONTAINER,
  findItemContainer,
  folderContainerId,
  isLibraryContainerId,
  planLibraryDrop,
  resolveDropContainer,
} from '../src/lib/libraryDragDrop.js';

/**
 * Dropping a library row.
 *
 * Every list in a category column now shares one drag context, so the id the
 * pointer finished over is ambiguous on its own: it can be a sibling row, a row
 * inside a different folder, or a folder with nothing in it. These pin down the
 * reading of each case, and in particular that a cross-folder drop rewrites the
 * ordering of BOTH lists — the bug that would otherwise only show on reload.
 */

const item = (id) => ({ id, title: `Item ${id}` });

function columns() {
  return [
    {
      id: LIBRARY_ROOT_CONTAINER,
      folderId: null,
      scope: 'note:root',
      items: [item(1), item(2), item(3)],
    },
    {
      id: folderContainerId(7),
      folderId: 7,
      scope: 'note:folder:7',
      items: [item(10), item(11)],
    },
    {
      id: folderContainerId(8),
      folderId: 8,
      scope: 'note:folder:8',
      items: [],
    },
  ];
}

describe('library container ids', () => {
  it('tells a container id apart from a row id', () => {
    assert.equal(isLibraryContainerId(LIBRARY_ROOT_CONTAINER), true);
    assert.equal(isLibraryContainerId(folderContainerId(7)), true);
    // Row ids are entity ids, which is what everything else in `over.id` is.
    assert.equal(isLibraryContainerId('42'), false);
    assert.equal(isLibraryContainerId(42), false);
    assert.equal(isLibraryContainerId(null), false);
  });

  it('finds the list a row lives in, by string or number', () => {
    assert.equal(findItemContainer(columns(), 2).scope, 'note:root');
    assert.equal(findItemContainer(columns(), '11').scope, 'note:folder:7');
    assert.equal(findItemContainer(columns(), 999), null);
  });

  it('resolves a hovered row to its list, and a hovered folder to itself', () => {
    assert.equal(resolveDropContainer(columns(), '10').folderId, 7);
    assert.equal(resolveDropContainer(columns(), folderContainerId(8)).folderId, 8);
    assert.equal(resolveDropContainer(columns(), null), null);
  });
});

describe('planning a library drop', () => {
  it('reorders when a row stays in its own list', () => {
    const plan = planLibraryDrop(columns(), 1, 3);
    assert.equal(plan.type, 'reorder');
    assert.equal(plan.scope, 'note:root');
    assert.deepEqual(plan.orderedIds, ['2', '3', '1']);
  });

  it('does nothing when a row is dropped on itself', () => {
    assert.equal(planLibraryDrop(columns(), 2, 2), null);
  });

  it('does nothing without a drop target', () => {
    assert.equal(planLibraryDrop(columns(), 2, null), null);
    assert.equal(planLibraryDrop(columns(), null, 2), null);
  });

  it('files a row into the folder whose header it was dropped on', () => {
    const plan = planLibraryDrop(columns(), 2, folderContainerId(7));
    assert.equal(plan.type, 'move');
    assert.equal(plan.folderId, 7);
    assert.equal(plan.fromFolderId, null);
    assert.equal(plan.itemId, '2');
    assert.equal(plan.item.title, 'Item 2');
  });

  it('rewrites the order of both lists on a cross-folder drop', () => {
    // Only writing the destination leaves the row listed in its old folder too,
    // which reappears the moment the saved order is read back.
    const plan = planLibraryDrop(columns(), 2, folderContainerId(7));
    assert.equal(plan.fromScope, 'note:root');
    assert.deepEqual(plan.fromOrderedIds, ['1', '3']);
    assert.equal(plan.toScope, 'note:folder:7');
    assert.deepEqual(plan.toOrderedIds, ['10', '11', '2']);
  });

  it('drops a row into the slot of the row it landed on', () => {
    const plan = planLibraryDrop(columns(), 3, 11);
    assert.equal(plan.folderId, 7);
    assert.deepEqual(plan.toOrderedIds, ['10', '3', '11']);
  });

  it('takes a row back out of a folder when dropped on the unfiled list', () => {
    const plan = planLibraryDrop(columns(), 10, LIBRARY_ROOT_CONTAINER);
    assert.equal(plan.type, 'move');
    assert.equal(plan.folderId, null);
    assert.equal(plan.fromFolderId, 7);
    assert.deepEqual(plan.fromOrderedIds, ['11']);
    assert.deepEqual(plan.toOrderedIds, ['1', '2', '3', '10']);
  });

  it('moves a row straight from one folder to another', () => {
    const plan = planLibraryDrop(columns(), 11, folderContainerId(8));
    assert.equal(plan.folderId, 8);
    assert.deepEqual(plan.fromOrderedIds, ['10']);
    assert.deepEqual(plan.toOrderedIds, ['11']);
  });

  it('accepts a drop on an empty folder', () => {
    const plan = planLibraryDrop(columns(), 1, folderContainerId(8));
    assert.equal(plan.folderId, 8);
    assert.deepEqual(plan.toOrderedIds, ['1']);
  });

  it('ignores a drag whose row is no longer in the library', () => {
    assert.equal(planLibraryDrop(columns(), 999, folderContainerId(7)), null);
  });

  it('ignores a drop on something that is not a list', () => {
    assert.equal(planLibraryDrop(columns(), 1, 'container:folder:404'), null);
    assert.equal(planLibraryDrop(columns(), 1, 999), null);
  });
});
