// Scripture is fetched remotely; study records and personal writing stay local.
// A display abbreviation is not an edition identity. Keep the database locator
// separate so older downloaded chapters retain their links and new API editions
// cannot share annotations merely because their abbreviations match.
export function studyLocator(chapter) {
  return { book: chapter.book, chapter_number: chapter.chapter_number, version: chapter.storage_version || chapter.version };
}

export function studyView(record) {
  return {
    ...record,
    storage_version: record.storage_version || record.version,
    version: record.display_version || record.version,
    ...(record.blocks ? { blocks: record.blocks.map(block => ({
      ...block,
      ...(Array.isArray(block.wjTokens) || block.wjTokens instanceof Set ? { wjTokens: new Set(block.wjTokens) } : {}),
    })) } : {}),
  };
}

export function isApiStudyRecord(record) {
  return (record?.storage_version || record?.version || '').startsWith('API:');
}

// Scope identity locks to the entity client/vault, rather than sharing records
// between unrelated stores (including a vault replaced while a read is pending).
const chapterLocks = new WeakMap();

async function ensureChapter(source, bibleId, entities) {
  const locator = { book: source.book, chapter_number: source.chapter_number };
  const records = await entities.StudyChapter.filter(locator);
  let record = records.find(item => item.api_bible_id === bibleId);
  if (!record) {
    // Adopt the matching downloaded edition without replacing its text, private
    // chapter fields, ID, or the locator used by existing annotations.
    const legacy = records.find(item => item.version === source.version && !item.api_bible_id);
    if (legacy) record = await entities.StudyChapter.update(legacy.id, { api_bible_id: bibleId, display_version: source.version });
  }
  if (!record) {
    const version = `API:${bibleId}`;
    record = await entities.StudyChapter.create({
      ...locator, version, display_version: source.version, api_bible_id: bibleId,
      title: `${source.book} ${source.chapter_number}`, scripture_source: 'api', raw_text: '',
      annotation_count: 0, notes: '', context: '', application: '',
    });
  }
  // Upgrade existing API parents created by older renderers without touching
  // downloaded chapters or their personal fields. The desktop also enforces this.
  if (isApiStudyRecord(record) && (record.raw_text || record.blocks)) {
    record = await entities.StudyChapter.update(record.id, { raw_text: '', blocks: null, scripture_source: 'api' });
  }
  if (isApiStudyRecord(record) && source.version !== 'API' && record.display_version !== source.version) {
    record = await entities.StudyChapter.update(record.id, { display_version: source.version });
  }
  return studyView(record);
}

export async function persistApiStudyChapter(assembled, bibleId, entities) {
  const sources = new Map();
  for (const block of assembled.blocks) {
    const locator = block.studyLocator || { book: assembled.book, chapter_number: assembled.chapter_number };
    const key = `${locator.book}:${locator.chapter_number}`;
    if (!sources.has(key)) sources.set(key, { ...locator, version: assembled.version, blocks: [] });
    if (block.studyLocator) sources.get(key).blocks.push(block);
    else if (sources.size === 1) sources.get(key).blocks.push(block);
  }
  if (!assembled.blocks.some(block => block.type === 'verse')) throw new Error('No scripture text was retrieved. Please retry the search.');
  const chapters = [];
  for (const source of sources.values()) {
    if (!source.blocks.some(block => block.type === 'verse')) continue;
    const key = `${bibleId}:${source.book}:${source.chapter_number}`;
    let pendingChapters = chapterLocks.get(entities.StudyChapter);
    if (!pendingChapters) { pendingChapters = new Map(); chapterLocks.set(entities.StudyChapter, pendingChapters); }
    let operation = pendingChapters.get(key);
    if (!operation) {
      operation = ensureChapter(source, bibleId, entities).finally(() => pendingChapters.delete(key));
      pendingChapters.set(key, operation);
    }
    chapters.push(await operation);
  }
  const first = chapters[0];
  return {
    ...first, ...assembled, id: first.id, storage_version: first.storage_version,
    notes: first.notes || '', context: first.context || '', application: first.application || '',
    api_bible_id: bibleId, study_chapters: chapters,
    blocks: assembled.blocks.map(block => ({ ...block, studyChapterId: chapters.find(chapter =>
      chapter.book === (block.studyLocator?.book || assembled.book) && chapter.chapter_number === (block.studyLocator?.chapter_number || assembled.chapter_number))?.id })),
  };
}

export function annotationHasContent(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  return Boolean(doc.body.textContent?.trim() || doc.body.querySelector('img, video, audio, [data-file-attachment]'));
}
