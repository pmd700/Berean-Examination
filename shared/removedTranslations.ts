/**
 * Single source of truth for Bible translations that have been temporarily
 * removed from the app for legal / copyright-compliance reasons.
 *
 * The verse TEXT for these translations is absent from local sources, caches,
 * endpoints, and test fixtures. Database-free parsers and renderers are kept
 * only for a future legally licensed source. To re-enable a translation:
 *
 *   1. Remove its code from `REMOVED_TRANSLATIONS` below.
 *   2. Add a legally reviewed local package or guarded Online Mode provider.
 *   3. Run the parser, legal-policy, and display proofs before release.
 *
 * The visible Study and licensing screens share this gate.
 */

export const REMOVED_TRANSLATIONS = ["NLT", "NASB1995", "NASB2020"] as const;

export type RemovedTranslation = (typeof REMOVED_TRANSLATIONS)[number];

const REMOVED_SET = new Set<string>(REMOVED_TRANSLATIONS.map((t) => t.toUpperCase()));

/** True when a version code refers to a translation removed for legal compliance. */
export function isRemovedTranslation(version?: string | null): boolean {
  if (!version) return false;
  return REMOVED_SET.has(version.toUpperCase());
}

/** User-facing message shown wherever a removed translation is surfaced. */
export const REMOVED_TRANSLATION_MESSAGE =
  "Temporarily removed from the app for legal compliance.";
