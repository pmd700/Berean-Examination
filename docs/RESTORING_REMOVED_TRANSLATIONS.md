# Restoring the legally-removed translations (developer guide)

> This document explains **how to re-enable** the three Bible translations that
> were removed for legal/copyright compliance. It contains **no verse text** of
> any kind. Do not paste scripture into this file.

## What was removed and why

To comply with copyright/licensing constraints, the **verse text** of three
translations was deleted from every persisted location and made unreachable in
the UI and API:

- **NLT** — New Living Translation
- **NASB1995** — New American Standard Bible (1995)
- **NASB2020** — New American Standard Bible (2020)

The other translations (**ESV, LSV, BSB, KJV**) were **not** touched.

Only the *text* was removed. Database-free parsers, renderers, and the
reintegration path are intentionally **preserved**. The retired PostgreSQL
schema and import pipeline are not part of the offline desktop app.

## The single source of truth: `shared/removedTranslations.ts`

Everything keys off one small module:

- `REMOVED_TRANSLATIONS` — the list of removed translation codes.
- `isRemovedTranslation(version)` — case-insensitive membership check.
- `REMOVED_TRANSLATION_MESSAGE` — the user-facing notice
  ("Temporarily removed from the app for legal compliance.").

This switch is consulted by:

- **Local study screen** — `src/pages/Study.jsx` checks the shared removal list
  before attempting any local lookup or future online request.
- **Frontend** — `src/pages/Study.jsx` shows the versions locked/struck/disabled
  in the picker, blocks fetches, and renders a neutral banner instead of text.
- **Docs page** — `src/components/licenses/sourceLicensesData.jsx` flags each one
  `legallyRemoved: true`; `SourceLicenseSection.jsx` renders it dimmed/struck/lock.

## How to restore one (or all) translations

Once you have the legal right to serve the text again:

1. **Re-enable the switch.** In `shared/removedTranslations.ts`, remove the code(s)
   you are restoring from `REMOVED_TRANSLATIONS`. This re-opens the picker and
   documentation styling only. It does not install or fetch any verse text.

2. **(Plain-text translations: NLT, NASB1995)** Re-establish the source the app
   reads from:
   - NLT requires a licensed provider inside optional Online Mode; it must remain
     blocked offline and must never be silently bundled.
   - NASB1995 parsing is preserved in
     `src/lib/bible-import/plainTextParsers.ts`. With written permission, build
     a local packaged reader around that parser and add a focused legal gate.

3. **(Rich translation: NASB2020)** The database-free EPUB archive and rich
   segment parsers are preserved under `src/lib/bible-import`. With written
   permission, build a licensed local package reader around those parsers.

4. Restoration always means loading a fresh, legally obtained source. Never
   recover copyrighted text from an old database, cache, dump, or backup.

5. Run `npm run bible-parser:proof`, `npm run epub-archive:proof`, and
   `npm run epub-parser:proof`, then add source-specific legal and display tests.

6. Restart BEX and verify the licensed source with Wi-Fi off when it is local.

## Test fixtures

The three parser proofs use **synthetic, invented** content to exercise source
formats, archive ordering, verse numbers, note markers, footnote asides, italics,
and small-caps divine names. Keep fixtures synthetic—never paste copyrighted
scripture into tests.
