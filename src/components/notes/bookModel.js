/**
 * Books: a note that has been split into pages.
 *
 * A book is not a new record type. It is an ordinary MindNote whose `content`
 * carries page-break sentinels, so every existing consumer — global search, the
 * markdown backup round-trip, restore, the sidebar — keeps working untouched and
 * no database migration is needed. Splitting on read and joining on write is the
 * whole storage layer.
 *
 * The sentinel is an HTML comment because TipTap never emits one, which makes
 * the split unambiguous: no document can accidentally contain a page break.
 */

export const PAGE_BREAK = '<!--bex-page-break-->';

// A page title belongs to the page, not to the MindNote record. Keeping it in
// the page markup means books remain ordinary notes (and need no migration),
// while the title is removed before TipTap sees the page body. URI encoding
// keeps arbitrary title text from accidentally closing the HTML comment.
const PAGE_TITLE = /^<!--bex-page-title:([^>]*)-->/;

export function hasPageTitle(page) {
  return PAGE_TITLE.test(typeof page === 'string' ? page : '');
}

/** How many pages a book may hold before the UI stops offering to add more. */
export const MAX_PAGES = 500;

/**
 * A note's stored content as an array of page bodies.
 *
 * Always returns at least one page: an empty note is page one of a book nobody
 * has written yet, which is what lets the cut line appear on every note.
 */
export function splitBookPages(content) {
  const text = typeof content === 'string' ? content : '';
  const pages = text.split(PAGE_BREAK);
  return pages.length > 0 ? pages : [''];
}

/** The inverse of splitBookPages — what actually gets saved. */
export function joinBookPages(pages) {
  if (!Array.isArray(pages) || pages.length === 0) return '';
  return pages.map(page => (typeof page === 'string' ? page : '')).join(PAGE_BREAK);
}

/** The title stored on one page, or a caller-provided legacy fallback. */
export function getPageTitle(page, fallback = '') {
  const source = typeof page === 'string' ? page : '';
  const match = PAGE_TITLE.exec(source);
  if (!match) return String(fallback || '');
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return String(fallback || '');
  }
}

/** The rich-text body only; page bookkeeping must never enter the editor. */
export function getPageBody(page) {
  const source = typeof page === 'string' ? page : '';
  return source.replace(PAGE_TITLE, '');
}

/** Give a page its own title without changing its rich-text body. */
export function setPageTitle(page, title) {
  const body = getPageBody(page);
  return `<!--bex-page-title:${encodeURIComponent(String(title || ''))}-->${body}`;
}

/** A note is a book once it has been split at least once. */
export function isBook(pages) {
  return Array.isArray(pages) && pages.length > 1;
}

/**
 * Footnotes on a page, counted straight from the saved HTML.
 *
 * Numbering runs continuously through the whole book the way a printed one
 * does, but only one page is ever mounted in an editor. Counting from the
 * markup lets a page know what number to start at without instantiating the
 * pages before it.
 */
export function countFootnotes(html) {
  if (typeof html !== 'string' || !html) return 0;
  return (html.match(/data-footnote-id="/g) || []).length;
}

/**
 * The number the first footnote on each page carries, minus one — i.e. how many
 * footnotes precede that page. Feeding this to the editor's numbering plugin is
 * what makes page three continue at 12 instead of restarting at 1.
 */
export function footnoteOffsets(pages) {
  const offsets = [];
  let running = 0;
  splitBookPages(joinBookPages(pages)).forEach((page) => {
    offsets.push(running);
    running += countFootnotes(page);
  });
  return offsets;
}

/** Add a blank page directly after `index`, and say where the caret should land. */
export function insertPageAfter(pages, index) {
  const current = Array.isArray(pages) && pages.length ? [...pages] : [''];
  if (current.length >= MAX_PAGES) return { pages: current, index: Math.min(index, current.length - 1) };
  const at = Math.max(0, Math.min(Number(index) || 0, current.length - 1));
  current.splice(at + 1, 0, '');
  return { pages: current, index: at + 1 };
}

/**
 * Drop the selected pages.
 *
 * A book always keeps at least one page — deleting everything would leave the
 * note with no document to edit, so the last survivor is emptied instead. The
 * returned index is where the reader should end up: as close to where they were
 * as the shortened book allows.
 */
export function removePages(pages, indices, currentIndex = 0) {
  const current = Array.isArray(pages) && pages.length ? [...pages] : [''];
  const doomed = new Set(
    (Array.isArray(indices) ? indices : [])
      .map(value => Number(value))
      .filter(value => Number.isInteger(value) && value >= 0 && value < current.length),
  );
  if (doomed.size === 0) return { pages: current, index: currentIndex, removed: 0 };

  const kept = current.filter((_, index) => !doomed.has(index));
  if (kept.length === 0) return { pages: [''], index: 0, removed: current.length };

  // Land on the page that took the place of the first one deleted, so the
  // reader keeps their position in the book rather than being sent to page one.
  const removedBefore = [...doomed].filter(index => index < currentIndex).length;
  const nextIndex = Math.max(0, Math.min(currentIndex - removedBefore, kept.length - 1));
  return { pages: kept, index: nextIndex, removed: doomed.size };
}

/** Replace one page's body, leaving the rest of the book alone. */
export function replacePage(pages, index, content) {
  const current = Array.isArray(pages) && pages.length ? pages : [''];
  if (!Number.isInteger(index) || index < 0 || index >= current.length) return current;
  // Returning the very same array when nothing moved is what lets the page
  // editor's own echo be recognised and skipped instead of round-tripping.
  if (current[index] === content) return current;
  const next = [...current];
  next[index] = typeof content === 'string' ? content : '';
  return next;
}

/** Replace one page's editor body while preserving that page's own title. */
export function replacePageBody(pages, index, content) {
  const current = Array.isArray(pages) && pages.length ? pages : [''];
  if (!Number.isInteger(index) || index < 0 || index >= current.length) return current;
  const source = typeof current[index] === 'string' ? current[index] : '';
  const titlePrefix = PAGE_TITLE.exec(source)?.[0] || '';
  const nextPage = `${titlePrefix}${typeof content === 'string' ? content : ''}`;
  if (source === nextPage) return current;
  const next = [...current];
  next[index] = nextPage;
  return next;
}

/** Move a page to a new position, for drag-reordering in the overview. */
export function movePage(pages, from, to) {
  const current = Array.isArray(pages) && pages.length ? [...pages] : [''];
  if (!Number.isInteger(from) || from < 0 || from >= current.length) return current;
  const target = Math.max(0, Math.min(Number(to) || 0, current.length - 1));
  if (target === from) return current;
  const [moved] = current.splice(from, 1);
  current.splice(target, 0, moved);
  return current;
}

/**
 * Keep the open page open when another page is moved around it.
 *
 * Page positions are also the reader's navigation state. Moving page one to
 * page four must therefore move the reader with it if page one was open, and
 * shift the reader by one if the dragged page merely crossed their position.
 */
export function pageIndexAfterMove(currentIndex, from, to, pageCount) {
  const length = Math.max(1, Number(pageCount) || 1);
  const current = Math.max(0, Math.min(Number(currentIndex) || 0, length - 1));
  if (!Number.isInteger(from) || from < 0 || from >= length) return current;
  const target = Math.max(0, Math.min(Number(to) || 0, length - 1));
  if (from === target) return current;
  if (current === from) return target;
  if (from < current && target >= current) return current - 1;
  if (from > current && target <= current) return current + 1;
  return current;
}

/**
 * The attribute list of one tag.
 *
 * A footnote body is stored in an attribute, and HTML attribute serialization
 * escapes only `&` and `"` — never `<` or `>`. So a footnote reading
 * `<p>Bauckham, 122.</p>` is written into the markup with its angle brackets
 * intact, and a naive `[^>]*` would cut the tag short at the first one. Matching
 * quoted runs whole is what keeps that from happening.
 */
const TAG_ATTRIBUTES = '(?:"[^"]*"|[^>"])*';

const FOOTNOTE_TAG = new RegExp(`<sup\\b(${TAG_ATTRIBUTES})>(?:</sup>)?`, 'gi');

/** Only our own markers, never a superscript the writer typed themselves. */
function isFootnoteTag(attributes) {
  return /\bdata-footnote-id="/i.test(attributes);
}

function attributeValue(attributes, name) {
  const match = new RegExp(`${name}="([^"]*)"`, 'i').exec(attributes);
  return match ? match[1] : '';
}

/** Undo the escaping an attribute value picked up on its way into the markup. */
function decodeAttribute(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * The footnotes carried by a page's saved HTML, in reading order and numbered.
 *
 * The live editor derives this from its document, but a page that is not open in
 * an editor — the sheet mid-turn, a card in the overview, a page being exported
 * — only has the markup. Reading it here keeps those three in step with the
 * editor's own numbering instead of inventing a second scheme.
 */
export function extractFootnotes(html, offset = 0) {
  const source = typeof html === 'string' ? html : '';
  const pattern = new RegExp(FOOTNOTE_TAG.source, 'gi');
  const found = [];
  let match = pattern.exec(source);
  while (match) {
    if (isFootnoteTag(match[1])) {
      found.push({
        id: attributeValue(match[1], 'data-footnote-id'),
        text: decodeAttribute(attributeValue(match[1], 'data-footnote-text')),
        number: offset + found.length + 1,
      });
    }
    match = pattern.exec(source);
  }
  return found;
}

/**
 * Write the resolved number into each footnote marker.
 *
 * Nothing in the document stores a footnote's number — the editor paints it on
 * from document order. Anywhere the editor is not doing the painting, the number
 * has to be baked in instead, which is what this does.
 */
const TOOLTIP_SPAN = new RegExp(`<span\\b(${TAG_ATTRIBUTES})>([\\s\\S]*?)</span>`, 'gi');

/**
 * Put the tooltip badge into saved markup.
 *
 * In the editor the ⓘ is a decoration, which exists only while an editor is
 * running. A page rendered read-only — the sheet turning over, a card in the
 * overview — has no editor, so the badge has to be written into the markup or a
 * page would visibly shed its markers the moment it started to turn.
 *
 * One badge per tooltip, after the last run of the phrase: a mark broken up by
 * bold is several spans, and badging each of them would show three ⓘ where the
 * editor shows one.
 */
export function markTooltipsInHtml(html) {
  const source = typeof html === 'string' ? html : '';
  const pattern = new RegExp(TOOLTIP_SPAN.source, 'gi');

  // Where each tooltip's final run ends, so only that one is badged.
  const lastEnd = new Map();
  let match = pattern.exec(source);
  while (match) {
    const id = attributeValue(match[1], 'data-tooltip-id');
    if (id) lastEnd.set(id, match.index + match[0].length);
    match = pattern.exec(source);
  }
  if (lastEnd.size === 0) return source;

  const badgeAt = new Set(lastEnd.values());
  const badge = '<span class="bex-tooltip-badge" aria-hidden="true"></span>';

  let result = '';
  let cursor = 0;
  [...badgeAt].sort((left, right) => left - right).forEach((position) => {
    result += source.slice(cursor, position) + badge;
    cursor = position;
  });
  return result + source.slice(cursor);
}

export function numberFootnotesInHtml(html, offset = 0) {
  const source = typeof html === 'string' ? html : '';
  let index = 0;
  return source.replace(new RegExp(FOOTNOTE_TAG.source, 'gi'), (whole, attributes) => {
    if (!isFootnoteTag(attributes)) return whole;
    index += 1;
    const number = offset + index;
    const cleaned = attributes.replace(/\sdata-footnote-number="[^"]*"/gi, '');
    return `<sup${cleaned} data-footnote-number="${number}">${number}</sup>`;
  });
}
