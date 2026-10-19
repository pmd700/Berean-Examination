/**
 * Single source of truth for Bible translations that have been temporarily
 * removed from the app for legal / copyright-compliance reasons.
 *
 * These translations are not bundled. NASB 1995 can now be read through the
 * user's authorized API.Bible edition; its old downloaded source stays retired.
 * Keep the source check so an API license never re-enables an old local body.
 *
 * The visible Study and licensing screens share this gate.
 */

export const REMOVED_TRANSLATIONS = ["NLT", "NASB1995", "NASB2020"] as const;

export type RemovedTranslation = (typeof REMOVED_TRANSLATIONS)[number];

// Confirmed against the configured API catalog. The NASB abbreviation alone
// identifies the 2020 edition in that catalog, not the 1995 update.
export const NASB1995_API_BIBLE_ID = 'b8ee27bcd1cae43a-01';
export const NASB2020_API_BIBLE_ID = 'a761ca71e0b3ddcf-01';
export const NBLA_API_BIBLE_ID = 'ce11b813f9a27e20-01';

// NLT can be switched back on at any time: restore it to the API.Bible plan
// and remove 'NLT' from this set. Authorized API reading then resumes; the old
// bundled NLT source remains retired and personal writing is never removed.
const PLAN_DISABLED_TRANSLATIONS = new Set<string>(['NLT']);

export function isTranslationRemovedFromPlan(version?: string | null): boolean {
  return PLAN_DISABLED_TRANSLATIONS.has(String(version || '').toUpperCase());
}

const REMOVED_SET = new Set<string>(REMOVED_TRANSLATIONS.map((t) => t.toUpperCase()));

/** True when a version code refers to a translation removed for legal compliance. */
export function isRemovedTranslation(version?: string | null, source?: {
  scripture_source?: string;
  api_bible_id?: string;
  storage_version?: string;
}): boolean {
  if (!version) return false;
  if (isTranslationRemovedFromPlan(version)) return true;
  if (version.toUpperCase() === 'NLT' && source?.api_bible_id
    && (source.scripture_source === 'api' || source.storage_version === `API:${source.api_bible_id}`)) return false;
  if (version.toUpperCase() === 'NASB1995' && source?.api_bible_id === NASB1995_API_BIBLE_ID
    && (source.scripture_source === 'api' || source.storage_version === `API:${NASB1995_API_BIBLE_ID}`)) return false;
  return REMOVED_SET.has(version.toUpperCase());
}

/** User-facing message shown wherever a removed translation is surfaced. */
export const REMOVED_TRANSLATION_MESSAGE =
  "Temporarily removed from the app for legal compliance.";

export function getRemovedTranslationMessage(version?: string | null): string {
  return isTranslationRemovedFromPlan(version)
    ? 'Temporarily removed from plan.' : REMOVED_TRANSLATION_MESSAGE;
}
