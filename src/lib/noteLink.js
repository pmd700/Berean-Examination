import { noteDeepLink } from '@/utils';
import { copyHyperlink } from '@/lib/commentaryLink';

/** Page numbers are one-based in URLs, matching the existing note router. */
export function noteLinkHref(note, pageIndex = 0) {
  if (!/^[1-9]\d*$/.test(String(note?.id)) || !Number.isSafeInteger(pageIndex) || pageIndex < 0) throw new Error('Invalid note link');
  return `${noteDeepLink(note.id, note.title)}?page=${pageIndex + 1}`;
}

export function copyNoteLink(note, pageIndex = 0, pageTitle = '') {
  const title = String(note.title || '').trim() || 'Untitled Note';
  const label = pageIndex === 0 ? title : `${title} — ${pageTitle.trim() || `Page ${pageIndex + 1}`}`;
  return copyHyperlink(label, noteLinkHref(note, pageIndex));
}
