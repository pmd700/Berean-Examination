import { noteDeepLink, webDeepLink, timegraphDeepLink } from '@/utils';

export const LIBRARY_LINK_TYPES = Object.freeze([
  { kind: 'note', entity: 'MindNote', label: 'Note', fallback: 'Untitled note' },
  { kind: 'web', entity: 'KnowledgeWeb', label: 'Knowledge web', fallback: 'Untitled knowledge web' },
  { kind: 'timeline', entity: 'Timegraph', label: 'Timeline', fallback: 'Untitled timeline' },
]);

/** Identity is a kind plus a record id, never the current title. Future section,
 * card and event targets can extend this one URL builder with an anchor. Plain
 * hrefs already survive the editor's HTML, Markdown, clipboard and save paths. */
export function libraryLinkHref({ kind, id }) {
  if (!/^[1-9]\d*$/.test(String(id))) throw new Error('Invalid library item id');
  const build = { note: noteDeepLink, web: webDeepLink, timeline: timegraphDeepLink }[kind];
  if (!build) throw new Error('Unknown library link kind');
  return build(id);
}

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
  return /^\/(?:notes|knowledge-webs|timegraphs)\/(?:[a-z0-9-]*-)?[1-9]\d*(?:[?#][^\s]*)?$/.test(path)
    ? path : null;
}

export function followLibraryLink(event, navigate) {
  const anchor = event.target?.closest?.('a[href]');
  const path = libraryLinkPath(anchor?.getAttribute('href'));
  if (!path) return false;
  event.preventDefault();
  event.stopPropagation();
  navigate(path);
  return true;
}
