export const LIBRARY_FOLDER_CATEGORIES = Object.freeze([
  'web',
  'note',
  'timeline',
  'study',
]);

const LIBRARY_FOLDER_CATEGORY_SET = new Set(LIBRARY_FOLDER_CATEGORIES);

export function normalizeLibraryFolderCategory(category) {
  const normalized = typeof category === 'string' ? category.trim().toLowerCase() : '';
  return LIBRARY_FOLDER_CATEGORY_SET.has(normalized) ? normalized : 'web';
}

export function libraryFolderCategory(folder) {
  return normalizeLibraryFolderCategory(folder?.category);
}

export function libraryFoldersForCategory(folders, category) {
  if (!Array.isArray(folders)) return [];
  const normalizedCategory = normalizeLibraryFolderCategory(category);
  return folders.filter((folder) => libraryFolderCategory(folder) === normalizedCategory);
}
