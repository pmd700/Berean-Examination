import { displayCardTitle } from './cardTitle.js';

export function richTextToPlainText(value = '') {
  const source = String(value || '');
  if (!source.trim()) return '';

  if (typeof document !== 'undefined') {
    const container = document.createElement('div');
    container.innerHTML = source;
    return (container.innerText || container.textContent || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  return source
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|h[1-6]|li|blockquote|pre|tr|details)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildCardClipboardText({ title = '', description = '' } = {}) {
  const readableTitle = displayCardTitle(title);
  const readableDescription = richTextToPlainText(description);
  return readableDescription
    ? `${readableTitle}\n\n${readableDescription}`
    : readableTitle;
}
