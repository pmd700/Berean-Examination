import { segmentsToPlainText } from '@shared/bibleSegments';

// Use reading data instead of DOM text, which also contains UI and note markers.
export function formatScriptureCopy(chapter, { blocks = [], richVerses = null } = {}) {
  const sources = chapter.study_chapters || [chapter];
  const verses = richVerses
    ? richVerses.filter(verse => !verse.heading && verse.verse != null).map(verse => ({
        verseNumber: verse.verse,
        text: segmentsToPlainText(verse.segments || []),
      }))
    : blocks.filter(block => block.type === 'verse');

  const passages = [];
  for (const verse of verses) {
    const source = sources.find(item => item.id === verse.studyChapterId) || chapter;
    const book = verse.studyLocator?.book || source.book;
    const chapterNumber = verse.studyLocator?.chapter_number || source.chapter_number;
    const text = String(verse.text || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const verseNumber = Number(verse.verseNumber);
    const edition = source.api_bible_id || source.version || chapter.version;
    const previous = passages.at(-1);
    // Build ranges from the verses actually displayed, never from the query:
    // incomplete loading and missing verses must not imply a complete range.
    if (previous && previous.book === book && previous.chapterNumber === chapterNumber
      && previous.edition === edition && verseNumber === previous.end + 1) {
      previous.end = verseNumber;
      previous.lines.push(text);
    } else {
      passages.push({ book, chapterNumber, edition, start: verseNumber, end: verseNumber, lines: [text] });
    }
  }

  return passages.map(({ book, chapterNumber, start, end, lines }) =>
    `${book} ${chapterNumber}:${start}${end === start ? '' : `-${end}`}\n${lines.join('\n')}`
  ).join('\n\n');
}
