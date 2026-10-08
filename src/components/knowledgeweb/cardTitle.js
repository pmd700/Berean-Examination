export const LEGACY_DEFAULT_CARD_TITLE = 'New Card';

export function normalizeCardTitle(title) {
  if (typeof title !== 'string') return '';
  return title.trim() === LEGACY_DEFAULT_CARD_TITLE ? '' : title;
}

export function displayCardTitle(title) {
  return normalizeCardTitle(title).trim() || 'Untitled';
}
