---
name: Rich Bible rendering (segments)
description: How NASB2020 rich-text rendering works and the invariants future translations/edits must preserve.
---

# Rich Bible rendering (segment-based)

## Status (since 2026-06-10): NLT/NASB1995/NASB2020 TEXT removed for legal compliance
All verse TEXT for NLT, NASB1995, NASB2020 has been purged from every persisted
location (DB rows, source assets, local/external backups, fixtures) and every
serving path now returns a neutral "Temporarily removed from the app for legal
compliance." response. The central switch is `shared/removedTranslations.ts`
(`isRemovedTranslation`, `REMOVED_TRANSLATION_MESSAGE`); both the Express routes and
the legacy `base44/functions` (`fetchNasb1995Chapter`, `fetchBibleChapter`'s NLT
branch) are gated. **Parsers, schema, segment renderer, and the reintegration path
were deliberately preserved** — the invariants below still govern any future
re-import. See `docs/RESTORING_REMOVED_TRANSLATIONS.md`. So: `bible_rich_verses` is
empty and `bible_verses` holds only BSB/LSV; do not assume removed-translation text
is live.

NASB2020 verses are stored as ordered rich-text **segments** in `bible_rich_verses`
(separate from `bible_verses`, which holds BSB/LSV plain text). When present, the
admin-gated endpoint `fetchNasb2020RichChapter` returns
`{ ok, text, verses:[{verse, segments, heading, startsParagraph, plainText}] }`.
The frontend renders from `segments` (paragraph-flow, superscript verse numbers,
footnote markers) but persists the reconstructed `text` ("### heading" + "~N
plainText" lines) as `study_chapters.raw_text` for highlight token indexing / AI /
copy / search.

## The token-alignment invariant (do NOT break)
`buildSegmentLayout(segments).tokens` MUST be byte-for-byte identical to
`plainText.split(/(\s+)/)`, and footnote-marker segments MUST contribute **zero**
tokens.

**Why:** `TextHighlight`/`Annotation` rows store `start/end_token_index` keyed off
`plainText.split(/(\s+)/)`. If the segment renderer's token stream diverges, every
stored highlight/annotation lands on the wrong word. Zero-width markers are what
let the "Show NASB textual notes" toggle hide/show markers without shifting a
single index.

**How to apply:** any change to the parser (`server/epubBibleParser.ts`), the
segment engine (`shared/bibleSegments.ts`), or how `plainText` is derived must keep
this parity. `tests/verifyRichAlignment.ts` (needs `BEREAN_DATABASE_URL`) checks it
on real DB rows; `tests/epubBibleParser.test.ts` checks it on fixtures. Run both.

## raw_text auto-refresh ⇒ highlight reset is mandatory
Opening a NASB2020 chapter auto-refreshes its `raw_text` to the canonical complete
text (the old `.txt` source was incomplete with different tokenization). Therefore
pre-existing NASB2020 highlights/annotations stored against the OLD tokenization
WILL misalign and must be reset whenever the source is swapped — this is not
optional, it is coupled to the refresh.

## Rendering split
`isRichView = version==='NASB2020' && richVerses?.length`. Only NASB2020 uses the
segment renderer (`src/components/bible/{RichChapterView,SegmentRenderer,FootnotePopover}.jsx`);
all other translations stay on the legacy badge/row `parseChapter` path. Keep that
guard if adding rich support for more translations — adapt plain text into simple
segment arrays rather than forking the renderer.
