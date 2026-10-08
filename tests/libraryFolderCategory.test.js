import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  libraryFolderCategory,
  libraryFoldersForCategory,
  normalizeLibraryFolderCategory,
} from '../src/lib/libraryFolderCategory.js';

describe('library folder ownership', () => {
  test('older folders without a category remain Knowledge Web folders', () => {
    assert.equal(libraryFolderCategory({ id: 1, name: 'Existing folder' }), 'web');
    assert.equal(normalizeLibraryFolderCategory('unknown'), 'web');
  });

  test('each folder appears in exactly its own category', () => {
    const folders = [
      { id: 1, name: 'Existing folder' },
      { id: 2, name: 'Notes', category: 'note' },
      { id: 3, name: 'Timeline', category: 'timeline' },
      { id: 4, name: 'Study', category: 'study' },
    ];

    assert.deepEqual(libraryFoldersForCategory(folders, 'web').map(({ id }) => id), [1]);
    assert.deepEqual(libraryFoldersForCategory(folders, 'note').map(({ id }) => id), [2]);
    assert.deepEqual(libraryFoldersForCategory(folders, 'timeline').map(({ id }) => id), [3]);
    assert.deepEqual(libraryFoldersForCategory(folders, 'study').map(({ id }) => id), [4]);
  });
});
