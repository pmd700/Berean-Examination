import { parsePreparedText } from '../components/utils/chapterParser';
import {
  assertStudyMaterialExportAllowed,
  getStudyExportRightsNotice,
} from './bibleStudyExportPolicy';

export function buildStudyChapterMarkdown({ chapter, annotations = [] }) {
  if (!chapter) throw new Error('A Bible Study chapter is required for export.');
  assertStudyMaterialExportAllowed(chapter);

  let content = `Title: ${chapter.title || `${chapter.book} ${chapter.chapter_number}`}\n`;
  content += `Version: ${chapter.version}\n`;

  const rightsNotice = getStudyExportRightsNotice(chapter);
  if (rightsNotice) content += `\nTranslation rights notice:\n${rightsNotice}\n`;
  content += '\n';

  if (chapter.context) content += `[Context]\n${chapter.context}\n\n`;
  if (chapter.application) content += `[Application]\n${chapter.application}\n\n`;
  if (chapter.notes) content += `[Notes]\n${chapter.notes}\n\n`;

  content += '[Text]\n';

  const blocks = parsePreparedText(chapter.raw_text || '');
  const annotationsByVerse = {};
  for (const annotation of annotations) {
    if (!annotationsByVerse[annotation.start_verse]) {
      annotationsByVerse[annotation.start_verse] = [];
    }
    annotationsByVerse[annotation.start_verse].push(annotation);
  }

  for (const block of blocks) {
    if (block.type === 'header') {
      content += `### ${block.text}\n`;
      continue;
    }
    if (block.type !== 'verse') continue;

    content += `~${block.verseNumber} ${block.text}\n`;
    for (const annotation of annotationsByVerse[block.verseNumber] || []) {
      if (!annotation.selected_text) continue;
      content += `  | ${annotation.selected_text}\n`;
      for (const line of String(annotation.content || '').split('\n')) {
        content += `    ${line}\n`;
      }
    }
  }

  return content;
}
