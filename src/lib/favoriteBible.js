import { usePersistentPreference } from './usePersistentPreference';
import { isTranslationRemovedFromPlan, NASB2020_API_BIBLE_ID } from '../../shared/removedTranslations';

export const FAVORITE_BIBLE_KEY = 'scripture_favorite_bible';
export const DEFAULT_BIBLE_ID = '317e03834065a236-01';

export function normalizeFavoriteBible(value) {
  if (!value || typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value.id)
    || isTranslationRemovedFromPlan(value.abbreviation) || value.id.toLowerCase() === 'nasb2020') return null;
  return { id: value.id, abbreviation: String(value.abbreviation || '').slice(0, 50), name: String(value.name || '').slice(0, 300), language: value.language };
}

export function readInitialBibleId() {
  try {
    const favorite = normalizeFavoriteBible(JSON.parse(localStorage.getItem(FAVORITE_BIBLE_KEY) || 'null'));
    if (favorite) return favorite.id;
    const previous = localStorage.getItem('bex_scripture_selected_bible_id');
    return previous?.toLowerCase() === 'nasb2020' ? NASB2020_API_BIBLE_ID : previous || DEFAULT_BIBLE_ID;
  } catch { return DEFAULT_BIBLE_ID; }
}

export function useFavoriteBible() {
  const [stored, update, ready] = usePersistentPreference(FAVORITE_BIBLE_KEY, null);
  const favorite = normalizeFavoriteBible(stored);
  return /** @type {[any, (bible: any) => void, boolean]} */ ([favorite, bible => update(normalizeFavoriteBible(bible)), ready]);
}
