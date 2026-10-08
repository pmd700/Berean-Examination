const BLOCK_HTML_RE = /<\/?(?:p|div|details|summary|table|tbody|thead|tr|td|th|h[1-6]|ul|ol|li|blockquote|hr)\b/i;
const HEADING_RE = /^(#{1,4})[ \t]+(.+)$/;
const UNORDERED_RE = /^[ \t]*[-+*][ \t]+(.+)$/;
const ORDERED_RE = /^[ \t]*\d+[.)][ \t]+(.+)$/;
const QUOTE_RE = /^[ \t]*>[ \t]?(.*)$/;
const HR_RE = /^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/;

const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const renderInlineMarkdown = (value) => {
  let html = escapeHtml(value);
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  html = html.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');
  return html;
};

const lineStartsBlock = (line) => (
  HEADING_RE.test(line)
  || HR_RE.test(line)
  || UNORDERED_RE.test(line)
  || ORDERED_RE.test(line)
  || QUOTE_RE.test(line)
);

/**
 * Convert only newly pasted, block-shaped Markdown into rich HTML.
 * Existing rich HTML and ordinary prose deliberately return null so the
 * editor's normal paste/storage behavior remains untouched.
 */
export function markdownBlocksToHtml(value) {
  const text = String(value || '').replace(/\r\n?/g, '\n');
  if (!text.trim() || BLOCK_HTML_RE.test(text)) return null;

  const lines = text.split('\n');
  if (!lines.some(lineStartsBlock)) return null;

  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (HR_RE.test(line)) {
      blocks.push('<hr>');
      index += 1;
      continue;
    }

    const unordered = line.match(UNORDERED_RE);
    if (unordered) {
      const items = [];
      while (index < lines.length) {
        const match = lines[index].match(UNORDERED_RE);
        if (!match) break;
        items.push(`<li><p>${renderInlineMarkdown(match[1])}</p></li>`);
        index += 1;
      }
      blocks.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    const ordered = line.match(ORDERED_RE);
    if (ordered) {
      const items = [];
      while (index < lines.length) {
        const match = lines[index].match(ORDERED_RE);
        if (!match) break;
        items.push(`<li><p>${renderInlineMarkdown(match[1])}</p></li>`);
        index += 1;
      }
      blocks.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    const quote = line.match(QUOTE_RE);
    if (quote) {
      const quoteLines = [];
      while (index < lines.length) {
        const match = lines[index].match(QUOTE_RE);
        if (!match) break;
        quoteLines.push(match[1]);
        index += 1;
      }
      blocks.push(`<blockquote><p>${renderInlineMarkdown(quoteLines.join(' '))}</p></blockquote>`);
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (
      index < lines.length
      && lines[index].trim()
      && !lineStartsBlock(lines[index])
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`);
  }

  return blocks.join('');
}

export default markdownBlocksToHtml;
