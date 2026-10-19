# Restoring the legally-removed translations (developer guide)

> This document explains **how to re-enable** the three Bible translations that
> were removed for legal/copyright compliance. It contains **no verse text** of
> any kind. Do not paste scripture into this file.

## NASB 1995 API restoration — October 12, 2026

NASB 1995 is available through the existing guarded API.Bible reader when the
configured key has access to edition `b8ee27bcd1cae43a-01`. This exact edition
was confirmed against the live catalog and Romans 3 response. The API's `NASB`
abbreviation refers to the separate 2020 edition and must not be substituted.

The Study removal check now accepts this API source. Older NASB 1995 study
links fetch fresh scripture through that edition while retaining their IDs,
personal writing, and annotation locators. API bodies remain in the bounded
session cache and ephemeral reader view; new study parents store metadata and
personal writing only. The footer retains the copyright supplied by the API,
with a NASB 1995 notice as fallback, plus Lockman and API.Bible links.

This does not reinstate the retired downloaded NASB 1995 package. NLT and the
retired local NASB 2020 source retain their existing removal status. The sections
below document the original local-source removal and restoration path.

The removal message is already present in the first tracked commit, `19ffc59`,
dated October 8, 2026 at 18:56:43 -05:00. Its creation before that commit cannot
be determined from the available Git history.

## What was removed and why (historical)

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

## Publisher footnotes — October 13, 2026

API reading requests already use `include-notes=true`, as documented in the [API.Bible passage guide](https://docs.api.bible/guides/passages/). The converter now retains each returned note's exact character offset, including leading whitespace normalization, and the reader inserts its marker at that position without changing scripture token indices or clipboard text. Publisher italics in JSON note bodies are retained.

Live verification of Matthew 16:17–20 found no note nodes in the authorized NASB 1995 edition (`b8ee27bcd1cae43a-01`) in JSON or HTML. A full Matthew 16 chapter request and a request without verse wrappers also contained no notes. NASB 2020 (`a761ca71e0b3ddcf-01`) returned eight notes for the passage. NASB 1995 supports the same inline rendering if its API feed supplies notes; notes from another edition are not substituted. The absence of 1995 notes is an upstream content limitation, not a reader visibility setting.
