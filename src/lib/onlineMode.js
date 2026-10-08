export const ONLINE_MODE_ENABLED = false;

const ONLINE_ONLY_TRANSLATIONS = new Set(['ESV']);

export const ONLINE_MODE_REQUIRED_MESSAGE = 'Requires Online Mode';

export function isOnlineOnlyTranslation(version) {
  return typeof version === 'string'
    && ONLINE_ONLY_TRANSLATIONS.has(version.trim().toUpperCase());
}

export function isOnlineTranslationAvailable(version) {
  return !isOnlineOnlyTranslation(version) || ONLINE_MODE_ENABLED;
}
