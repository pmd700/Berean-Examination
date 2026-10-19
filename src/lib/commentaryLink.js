// Shareable links to a Bible Study commentary card.
//
// A link carries the passage query, canonical Bible edition and annotation id.
// The route is local to BEX, so libraryLinks.js recognizes it and
// the editors open it in-app. The id is only a hint: the query alone still opens
// the passage if the annotation has since been deleted.

import { NASB1995_API_BIBLE_ID, NASB2020_API_BIBLE_ID } from '@shared/removedTranslations';

const ANNOTATION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const STUDY_VERSION = /^(?:API:)?[A-Za-z0-9_-]{1,50}$/;

/** "Matthew 16:18-19", or "Matthew 16:18" for a single verse. */
export function commentaryPassage(annotation) {
  const { book, chapter_number: chapter, start_verse: start, end_verse: end } = annotation || {};
  const verses = end != null && end !== start ? `${start}-${end}` : `${start}`;
  return `${book} ${chapter}:${verses}`;
}

export function commentaryVersionLabel(annotation, displayVersion) {
  const source = annotation?.version;
  if (source === `API:${NASB1995_API_BIBLE_ID}` || source === 'NASB1995') return 'NASB 1995';
  if (source === `API:${NASB2020_API_BIBLE_ID}` || source === 'NASB2020') return 'NASB 2020';
  return displayVersion || annotation?.display_version || source;
}

export const commentaryLinkLabel = (annotation, displayVersion) => {
  const version = commentaryVersionLabel(annotation, displayVersion);
  return `Commentary on ${commentaryPassage(annotation)}${version ? ` (${version})` : ''}`;
};

export function commentaryLinkHref(annotation, bibleId) {
  let href = `/Study?q=${encodeURIComponent(commentaryPassage(annotation))}`;
  const id = String(annotation?.id ?? '');
  if (ANNOTATION_ID.test(id)) href += `&annotation_id=${id}`;
  // Preserve the canonical source identity, not an abbreviation shared by
  // multiple editions. It also works when the note has since been deleted.
  const version = bibleId ? `API:${bibleId}` : annotation?.version;
  if (STUDY_VERSION.test(version || '')) href += `&version=${encodeURIComponent(version)}`;
  return href;
}

/** Reads the commentary target out of a tab path or query string, if it has one. */
export function parseCommentaryLinkTarget(pathOrSearch) {
  const text = String(pathOrSearch || '');
  const params = new URLSearchParams(text.includes('?') ? text.split('?')[1] : text);
  const annotationId = params.get('annotation_id') || '';
  if (!ANNOTATION_ID.test(annotationId)) return null;
  const version = params.get('version') || '';
  return { annotationId, query: (params.get('q') || '').trim(), ...(STUDY_VERSION.test(version) ? { version } : {}) };
}

/**
 * Copies "Commentary on <passage>" as a hyperlink (HTML) with a Markdown
 * fallback for plain-text targets. Must run synchronously inside the click
 * handler: the desktop app's clipboard policy only honours that.
 */
export function copyCommentaryLink(annotation, displayVersion, bibleId) {
  const label = commentaryLinkLabel(annotation, displayVersion);
  const href = commentaryLinkHref(annotation, bibleId);
  return copyHyperlink(label, href);
}

/** Shared synchronous rich-link copy for local library references. */
export function copyHyperlink(label, href) {
  const anchor = document.createElement('a');
  anchor.setAttribute('href', href);
  anchor.textContent = label;
  const markdownLabel = String(label).replace(/[\\[\]]/g, '\\$&');
  return writeClipboardPayload({ html: anchor.outerHTML, text: `[${markdownLabel}](${href})` });
}

/**
 * Copies everything shown inside a commentary card's body, as rich HTML plus
 * plain text. Reads the rendered element so what is copied is what is seen.
 */
export function copyCommentaryContent(element) {
  if (!element) return false;
  const html = element.innerHTML;
  const text = (element.innerText ?? element.textContent ?? '').trim();
  if (!text && !html.trim()) return false;
  return writeClipboardPayload({ html, text });
}

function writeClipboardPayload({ html, text }) {
  if (typeof document.execCommand !== 'function') return false;
  const focused = document.activeElement;
  const selection = window.getSelection();
  const ranges = Array.from({ length: selection?.rangeCount || 0 }, (_, i) => selection.getRangeAt(i).cloneRange());
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.setAttribute('aria-hidden', 'true');
  field.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
  document.body.appendChild(field);
  const onCopy = event => {
    if (!event.clipboardData) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    event.clipboardData.setData('text/html', html);
    event.clipboardData.setData('text/plain', text);
  };
  // Window capture runs before other open editors' document Copy handlers.
  window.addEventListener('copy', onCopy, true);
  try {
    field.focus({ preventScroll: true });
    field.select();
    return document.execCommand('copy');
  } finally {
    window.removeEventListener('copy', onCopy, true);
    field.remove();
    focused?.focus?.({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      ranges.forEach(range => selection.addRange(range));
    }
  }
}

/**
 * Raised when a commentary link is clicked. The workspace shell listens and
 * opens the passage in a new tab, setting `detail.handled`; where there is no
 * shell (tests, isolated views) the caller falls back to ordinary navigation.
 */
export const OPEN_COMMENTARY_TAB_EVENT = 'bex-open-commentary-tab';

const isDocumentScroller = pane => !pane || pane === document.scrollingElement
  || pane === document.documentElement || pane === document.body;

/** The scrollTop that vertically centers `target` in `pane` (top-aligns an oversized one). */
export function centeredScrollTop(target, pane) {
  const scroller = isDocumentScroller(pane) ? document.scrollingElement || document.documentElement : pane;
  const viewTop = isDocumentScroller(pane) ? 0 : scroller.getBoundingClientRect().top;
  const viewHeight = isDocumentScroller(pane) ? window.innerHeight : scroller.clientHeight;
  const box = target.getBoundingClientRect();
  const margin = 16;
  const offset = box.height > viewHeight - margin * 2
    ? box.top - (viewTop + margin)
    : box.top + box.height / 2 - (viewTop + viewHeight / 2);
  return Math.max(0, scroller.scrollTop + offset);
}

export const SCRIPTURE_WORKSPACE_CENTER_EVENT = 'scripture-workspace-center';

/**
 * Brings a commentary card into the middle of the screen once the reader has
 * rendered it. Cards appear after the passage loads and settle as they are
 * measured, so this keeps re-centering until the position stops moving — and
 * gives up the moment the user scrolls, taps or types.
 *
 * Returns a silent cancel function. `onDone` runs when the reveal finishes or
 * is interrupted, but not when cancelled.
 */
export function revealAnnotation(reader, annotationId, { preferCard = true, onDone } = {}) {
  const id = String(annotationId);
  if (!reader || !ANNOTATION_ID.test(id)) return () => {};
  const pane = reader.closest('.bex-tab-pane') || document.scrollingElement;
  const scroller = isDocumentScroller(pane) ? document.scrollingElement || document.documentElement : pane;
  const startedAt = performance.now();
  let frame = 0, cancelled = false, centeredAcross = false, settled = 0;

  const interactions = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
  const detach = () => interactions.forEach(type => window.removeEventListener(type, interrupt, true));
  const stop = () => { cancelled = true; cancelAnimationFrame(frame); detach(); };
  const finish = () => { if (cancelled) return; stop(); onDone?.(); };
  function interrupt() { finish(); }
  interactions.forEach(type => window.addEventListener(type, interrupt, { capture: true, passive: true }));

  const tick = () => {
    if (cancelled) return;
    const elapsed = performance.now() - startedAt;
    const card = reader.querySelector(`[data-annotation-card-id="${id}"]`);
    // Hover-style annotations have no card; fall back to the highlighted words,
    // but only once the card has had a fair chance to appear in gutter mode.
    const target = card || (!preferCard || elapsed > 3500
      ? reader.querySelector(`[data-annotation-ids~="${id}"]`) : null);
    if (target) {
      if (card && !centeredAcross) {
        centeredAcross = true;
        card.dispatchEvent(new CustomEvent(SCRIPTURE_WORKSPACE_CENTER_EVENT, { bubbles: true, detail: { target: card } }));
      }
      const before = scroller.scrollTop;
      const top = centeredScrollTop(target, pane);
      if (Math.abs(top - before) > 1) {
        if (typeof scroller.scrollTo === 'function') scroller.scrollTo({ top, behavior: 'instant' });
        else scroller.scrollTop = top;
      }
      settled = Math.abs(scroller.scrollTop - before) <= 1 ? settled + 1 : 0;
    }
    if ((target && settled >= 24) || elapsed > 6000) { finish(); return; }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => stop();
}
