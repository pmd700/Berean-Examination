import { noteDeepLink, webDeepLink, timegraphDeepLink, spreadsheetDeepLink } from '@/utils';
import { OPEN_COMMENTARY_TAB_EVENT } from '@/lib/commentaryLink';

export const LIBRARY_LINK_TYPES = Object.freeze([
  { kind: 'spreadsheet', entity: 'Spreadsheet', label: 'Spreadsheet', fallback: 'Untitled spreadsheet' },
  { kind: 'note', entity: 'MindNote', label: 'Note', fallback: 'Untitled note' },
  { kind: 'web', entity: 'KnowledgeWeb', label: 'Knowledge web', fallback: 'Untitled knowledge web' },
  { kind: 'timeline', entity: 'Timegraph', label: 'Timeline', fallback: 'Untitled timeline' },
]);

/** Identity is a kind plus a record id, never the current title. Future section,
 * card and event targets can extend this one URL builder with an anchor. Plain
 * hrefs already survive the editor's HTML, Markdown, clipboard and save paths. */
export function libraryLinkHref({ kind, id }) {
  if (!/^[1-9]\d*$/.test(String(id))) throw new Error('Invalid library item id');
  const build = { note: noteDeepLink, web: webDeepLink, timeline: timegraphDeepLink, spreadsheet: spreadsheetDeepLink }[kind];
  if (!build) throw new Error('Unknown library link kind');
  return build(id);
}

// A Bible Study commentary link: the passage query plus the annotation to bring
// into view. Deliberately strict so only links BEX itself generates qualify.
const STUDY_COMMENTARY_PATH = /^\/Study\?q=[^\s&#]+(?:&annotation_id=[A-Za-z0-9_-]{1,64})?(?:&version=(?:API%3[Aa])?[A-Za-z0-9_-]{1,50})?$/;

/** Recognize only local BEX document routes, never similarly named websites. */
export function libraryLinkPath(href, base = globalThis.location?.href) {
  if (typeof href !== 'string') return null;
  let path = href;
  if (!href.startsWith('/') || href.startsWith('//')) {
    try {
      const url = new URL(href);
      const local = new URL(base);
      if (url.origin !== local.origin || url.protocol !== local.protocol) return null;
      path = `${url.pathname}${url.search}${url.hash}`;
    } catch { return null; }
  }
  return /^\/(?:notes|knowledge-webs|timegraphs|spreadsheets)\/(?:[a-z0-9-]*-)?[1-9]\d*(?:[?#][^\s]*)?$/.test(path)
    || STUDY_COMMENTARY_PATH.test(path)
    ? path : null;
}

export function followLibraryLink(event, navigate) {
  const anchor = event.target?.closest?.('a[href]');
  const path = libraryLinkPath(anchor?.getAttribute('href'));
  if (!path) return false;
  event.preventDefault();
  event.stopPropagation();
  if (STUDY_COMMENTARY_PATH.test(path)) {
    // Commentary opens beside the current work, never over it.
    const detail = { path, title: anchor.textContent?.trim() || '', handled: false };
    window.dispatchEvent(new CustomEvent(OPEN_COMMENTARY_TAB_EVENT, { detail }));
    if (!detail.handled) navigate(path);
    return true;
  }
  navigate(path);
  return true;
}
