import { describe, it, expect, vi } from 'vitest';
import { persistApiStudyChapter, studyLocator, annotationHasContent } from '@/lib/studyPersistence';

function store(initial = []) {
  const records = structuredClone(initial);
  return {
    records,
    StudyChapter: {
      filter: vi.fn(async query => records.filter(record => Object.entries(query).every(([key, value]) => record[key] === value))),
      create: vi.fn(async value => { const record = { id: records.length + 10, ...value }; records.push(record); return record; }),
      update: vi.fn(async (id, patch) => { const record = records.find(record => record.id === id); Object.assign(record, patch); return record; }),
    },
  };
}
function chapter(numbers = [1], version = 'BSB') {
  return { id: 'search-ephemeral', book: 'Romans', chapter_number: numbers[0], version,
    blocks: numbers.map(number => ({ type: 'verse', verseNumber: 1, text: 'Paul, a servant',
      wjTokens: new Set([0]), studyLocator: { book: 'Romans', chapter_number: number } })),
  };
}

describe('API Scripture local study identity', () => {
  it('creates one durable parent across repeated and concurrent API searches', async () => {
    const entities = store();
    const views = await Promise.all([1, 2].map(() => persistApiStudyChapter(chapter(), 'edition-a', entities)));
    const reopened = await persistApiStudyChapter(chapter(), 'edition-a', entities);
    expect(entities.StudyChapter.create).toHaveBeenCalledTimes(1);
    expect(views[0].id).toBe(reopened.id);
    expect(reopened.id).not.toBe('search-ephemeral');
    expect(studyLocator(reopened)).toEqual({ book: 'Romans', chapter_number: 1, version: 'API:edition-a' });
    expect(reopened.version).toBe('BSB');
    expect(entities.records[0].raw_text).toBe('');
    expect(entities.records[0].blocks).toBeUndefined();
    expect(reopened.blocks[0].wjTokens).toEqual(new Set([0]));
  });

  it('adopts downloaded chapters without changing IDs, annotation locators, or personal data', async () => {
    const entities = store([{ id: 7, book: 'Romans', chapter_number: 1, version: 'BSB', raw_text: 'old text', notes: 'private notes', context: 'context', application: 'application', annotation_count: 3 }]);
    const view = await persistApiStudyChapter(chapter(), 'edition-a', entities);
    expect(view.id).toBe(7);
    expect(studyLocator(view).version).toBe('BSB');
    expect(entities.StudyChapter.create).not.toHaveBeenCalled();
    expect(entities.records[0]).toMatchObject({ raw_text: 'old text', notes: 'private notes', context: 'context', application: 'application', annotation_count: 3 });
  });

  it('keeps different API editions with the same abbreviation separate', async () => {
    const entities = store();
    const a = await persistApiStudyChapter(chapter(), 'edition-a', entities);
    const b = await persistApiStudyChapter(chapter(), 'edition-b', entities);
    expect(a.id).not.toBe(b.id);
    expect(a.version).toBe(b.version);
    expect(studyLocator(a).version).not.toBe(studyLocator(b).version);
  });

  it('updates a late catalog abbreviation without changing the durable locator or writing', async () => {
    const entities = store();
    const before = await persistApiStudyChapter(chapter([1], 'API'), 'edition-a', entities);
    entities.records[0].notes = 'Permanent writing';
    const after = await persistApiStudyChapter(chapter(), 'edition-a', entities);
    expect(after.id).toBe(before.id);
    expect(entities.records[0]).toMatchObject({ version: 'API:edition-a', display_version: 'BSB', notes: 'Permanent writing', raw_text: '' });
  });

  it('registers each chapter in a range and binds its verses to that chapter', async () => {
    const entities = store();
    const view = await persistApiStudyChapter(chapter([1, 2]), 'edition-a', entities);
    expect(view.study_chapters.map(record => record.chapter_number)).toEqual([1, 2]);
    expect(view.blocks.map(block => block.studyChapterId)).toEqual(view.study_chapters.map(record => record.id));
  });

  it('propagates a failed local write and allows a fresh retry', async () => {
    const entities = store();
    entities.StudyChapter.create.mockRejectedValueOnce(new Error('Vault unavailable'));
    await expect(persistApiStudyChapter(chapter(), 'edition-a', entities)).rejects.toThrow('Vault unavailable');
    expect((await persistApiStudyChapter(chapter(), 'edition-a', entities)).id).not.toBe('search-ephemeral');
  });

  it('rejects rich-text emptiness while accepting formatted writing and attachments', () => {
    expect(annotationHasContent('<p><br></p>')).toBe(false);
    expect(annotationHasContent('<p>&nbsp; </p>')).toBe(false);
    expect(annotationHasContent('<p><strong>Hello</strong></p>')).toBe(true);
    expect(annotationHasContent('<img src="local-image">')).toBe(true);
  });
});
