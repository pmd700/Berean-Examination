import { getPageBody, getPageTitle, splitBookPages } from './bookModel';

// Only editor scaffolding counts as empty. Non-text objects (including an
// image, table, footnote or collapsed section) must retain deletion protection.
export function isBlankUntitledNote({ title = '', content = '' } = {}) {
  if (String(title).trim() && String(title).trim() !== 'Untitled Note') return false;
  return splitBookPages(content).every(page => {
    if (getPageTitle(page).trim()) return false;
    const document = new DOMParser().parseFromString(getPageBody(page), 'text/html');
    if (document.body.textContent.replace(/[\s\u200b\ufeff]/g, '')) return false;
    return [...document.body.querySelectorAll('*')].every(element =>
      ['P', 'BR', 'DIV', 'SPAN'].includes(element.tagName)
      && ![...element.attributes].some(attribute => attribute.name.startsWith('data-')));
  });
}
