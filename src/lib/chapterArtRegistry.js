import { platformEntities } from '@/lib/platform/entities';

function requireDesktopMedia() {
  const desktop = typeof window === 'undefined' ? null : window.bexDesktop;
  if (!desktop?.isDesktop) {
    throw new Error('Chapter Art is available only inside the BEX desktop app.');
  }
  return desktop;
}

async function readCatalog() {
  const catalogs = await platformEntities.ChapterArtCatalog.list('-updated_date', 1);
  return catalogs[0] || null;
}

async function saveEntries(catalog, entries) {
  if (catalog) return platformEntities.ChapterArtCatalog.update(catalog.id, { entries });
  return platformEntities.ChapterArtCatalog.create({ entries });
}

function sameChapter(entry, book, chapterNumber) {
  return entry.book === book && entry.chapter_number === chapterNumber;
}

function defaultEntry(book, chapterNumber, media, fileName) {
  return {
    book,
    chapter_number: chapterNumber,
    cover_art_name: fileName || '',
    cover_art_opacity: 100,
    cover_art_scale: 100,
    cover_art_url: media.url,
    cover_art_x: 20,
    cover_art_y: 50,
    updated_date: new Date().toISOString(),
  };
}

async function saveImage(file) {
  if (!(file instanceof File)) throw new Error('Choose a valid image file.');
  const desktop = requireDesktopMedia();
  const result = await desktop.saveLocalImage({
    bytes: await file.arrayBuffer(),
    mimeType: file.type || '',
    name: file.name || '',
  });
  if (!result?.ok || !result.media?.url) {
    throw new Error(result?.error || 'BEX could not save that Chapter Art image.');
  }
  return result.media;
}

async function removeUnusedMedia(urls, remainingEntries) {
  const desktop = requireDesktopMedia();
  const remainingUrls = new Set(remainingEntries.map((entry) => entry.cover_art_url));
  for (const url of new Set(urls.filter(Boolean))) {
    if (remainingUrls.has(url)) continue;
    const result = await desktop.deleteLocalImage(url);
    if (!result?.ok && result?.code !== 'BEX_MEDIA_NOT_FOUND') {
      console.warn('[ChapterArt] Could not remove an unused encrypted image:', result?.error);
    }
  }
}

export async function listAllChapterArt() {
  const catalog = await readCatalog();
  return catalog?.entries || [];
}

export async function listRecentChapterArt(limit = 50) {
  const entries = await listAllChapterArt();
  return [...entries]
    .sort((left, right) => new Date(right.updated_date) - new Date(left.updated_date))
    .slice(0, limit);
}

export async function listBookChapterArt(book) {
  return (await listAllChapterArt()).filter((entry) => entry.book === book);
}

export async function setChapterArt(book, chapterNumber, file) {
  const media = await saveImage(file);
  const catalog = await readCatalog();
  const entries = catalog?.entries || [];
  const current = entries.find((entry) => sameChapter(entry, book, chapterNumber));
  const replacement = current
    ? { ...current, cover_art_url: media.url, updated_date: new Date().toISOString() }
    : defaultEntry(book, chapterNumber, media, file.name);
  const nextEntries = [
    ...entries.filter((entry) => !sameChapter(entry, book, chapterNumber)),
    replacement,
  ];
  try {
    await saveEntries(catalog, nextEntries);
  } catch (error) {
    await removeUnusedMedia([media.url], entries);
    throw error;
  }
  await removeUnusedMedia([current?.cover_art_url], nextEntries);
  return replacement;
}

export async function applyChapterArtToBook(book, chapterCount, file) {
  const media = await saveImage(file);
  const catalog = await readCatalog();
  const entries = catalog?.entries || [];
  const existingByChapter = new Map(
    entries.filter((entry) => entry.book === book)
      .map((entry) => [entry.chapter_number, entry]),
  );
  const now = new Date().toISOString();
  const replacements = Array.from({ length: chapterCount }, (_, index) => {
    const chapterNumber = index + 1;
    const current = existingByChapter.get(chapterNumber);
    return current
      ? { ...current, cover_art_url: media.url, updated_date: now }
      : { ...defaultEntry(book, chapterNumber, media, file.name), updated_date: now };
  });
  const nextEntries = [
    ...entries.filter((entry) => entry.book !== book),
    ...replacements,
  ];
  try {
    await saveEntries(catalog, nextEntries);
  } catch (error) {
    await removeUnusedMedia([media.url], entries);
    throw error;
  }
  await removeUnusedMedia(
    [...existingByChapter.values()].map((entry) => entry.cover_art_url),
    nextEntries,
  );
  return replacements;
}

export async function removeChapterArt(book, chapterNumber) {
  const catalog = await readCatalog();
  if (!catalog) return;
  const current = catalog.entries.find((entry) => sameChapter(entry, book, chapterNumber));
  if (!current) return;
  const nextEntries = catalog.entries.filter((entry) => !sameChapter(entry, book, chapterNumber));
  await saveEntries(catalog, nextEntries);
  await removeUnusedMedia([current.cover_art_url], nextEntries);
}

export async function removeBookChapterArt(book) {
  const catalog = await readCatalog();
  if (!catalog) return;
  const removed = catalog.entries.filter((entry) => entry.book === book);
  const nextEntries = catalog.entries.filter((entry) => entry.book !== book);
  await saveEntries(catalog, nextEntries);
  await removeUnusedMedia(removed.map((entry) => entry.cover_art_url), nextEntries);
}

async function updateEntry(book, chapterNumber, patch) {
  const catalog = await readCatalog();
  const current = catalog?.entries.find((entry) => sameChapter(entry, book, chapterNumber));
  if (!catalog || !current) throw new Error('That Chapter Art record no longer exists.');
  const updated = { ...current, ...patch, updated_date: new Date().toISOString() };
  const entries = catalog.entries.map((entry) => (
    sameChapter(entry, book, chapterNumber) ? updated : entry
  ));
  await saveEntries(catalog, entries);
  return updated;
}

export function updateChapterArtName(book, chapterNumber, name) {
  return updateEntry(book, chapterNumber, { cover_art_name: name });
}

export function updateChapterArtSettings(book, chapterNumber, settings) {
  return updateEntry(book, chapterNumber, settings);
}
