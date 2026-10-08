import { downloadFile, sanitizeFileName } from '../knowledgeweb/bereanFileFormat';
import { htmlToMarkdown } from '../knowledgeweb/markdownFileFormat';
import {
  extractFootnotes,
  footnoteOffsets,
  getPageBody,
  getPageTitle,
  numberFootnotesInHtml,
} from './bookModel';

// See TAG_ATTRIBUTES in bookModel: an annotation body sits in an attribute and
// keeps its angle brackets, so a tag has to be matched a quoted run at a time.
const TAG_ATTRIBUTES = '(?:"[^"]*"|[^>"])*';
const FOOTNOTE_MARKER = new RegExp(`<sup\\b(${TAG_ATTRIBUTES})>(\\d+)</sup>`, 'gi');
const TOOLTIP_SPAN = new RegExp(`<span\\b(${TAG_ATTRIBUTES})>([\\s\\S]*?)</span>`, 'gi');

function decodeAttribute(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function attributeValue(attributes, name) {
  const match = new RegExp(`${name}="([^"]*)"`, 'i').exec(attributes);
  return match ? match[1] : '';
}

/** Collapse a rich-text body down to a single Markdown line for an aside. */
function inlineMarkdown(html) {
  return htmlToMarkdown(html)
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * One page as Markdown, with its annotations carried across rather than dropped.
 *
 * Footnotes become real Markdown footnote references, so a page exported for a
 * paper keeps its numbering and its notes. Tooltips have no standing Markdown
 * equivalent — they are an aside attached to a phrase — so they become Pandoc's
 * inline footnote, which is the closest thing and still readable as plain text
 * anywhere that does not understand it.
 */
export function pageToMarkdown(html, offset = 0) {
  const pageBody = getPageBody(html);
  const footnotes = extractFootnotes(pageBody, offset);
  let body = numberFootnotesInHtml(pageBody, offset);

  body = body.replace(FOOTNOTE_MARKER, (whole, attributes, number) => (
    /\bdata-footnote-id="/i.test(attributes) ? `[^${number}]` : whole
  ));
  body = body.replace(TOOLTIP_SPAN, (whole, attributes, inner) => {
    if (!/\bdata-tooltip-id="/i.test(attributes)) return whole;
    const aside = inlineMarkdown(decodeAttribute(attributeValue(attributes, 'data-tooltip-text')));
    return aside ? `${inner}^[${aside}]` : inner;
  });

  const lines = [htmlToMarkdown(body).trim()];
  if (footnotes.length > 0) {
    lines.push('');
    footnotes.forEach((footnote) => {
      lines.push(`[^${footnote.number}]: ${inlineMarkdown(footnote.text)}`);
    });
  }
  return lines.join('\n').trim();
}

/**
 * The selected pages of a book as one Markdown document.
 *
 * Pages keep their real numbers rather than being renumbered 1..n, because an
 * export of pages 4, 5 and 9 is a reference back into the book it came from.
 */
export function buildPagesMarkdown({ title, pages, indices }) {
  const list = Array.isArray(pages) && pages.length ? pages : [''];
  const offsets = footnoteOffsets(list);
  const chosen = (Array.isArray(indices) && indices.length
    ? [...new Set(indices)]
    : list.map((_, index) => index)
  )
    .filter(index => Number.isInteger(index) && index >= 0 && index < list.length)
    .sort((left, right) => left - right);

  const heading = String(title || 'Untitled Note').trim() || 'Untitled Note';
  const parts = [`# ${heading}`, ''];

  chosen.forEach((index, position) => {
    if (list.length > 1) {
      const pageTitle = getPageTitle(list[index], `Page ${index + 1}`).trim() || `Page ${index + 1}`;
      parts.push(`## ${pageTitle}`, '');
    }
    parts.push(pageToMarkdown(list[index], offsets[index] || 0));
    if (position < chosen.length - 1) parts.push('', '---', '');
  });

  return `${parts.join('\n').replace(/\n{4,}/g, '\n\n\n').trim()}\n`;
}

/** Hand the selected pages to the user as a Markdown file. */
export function exportPagesToMarkdown({ title, pages, indices }) {
  const text = buildPagesMarkdown({ title, pages, indices });
  const many = Array.isArray(indices) && indices.length > 1;
  const one = Array.isArray(indices) && indices.length === 1 ? `-page-${indices[0] + 1}` : '';
  const suffix = many ? '-pages' : one;
  downloadFile(
    new Blob([text], { type: 'text/markdown' }),
    `${sanitizeFileName(title || 'note')}${suffix}.md`,
  );
  return text;
}
