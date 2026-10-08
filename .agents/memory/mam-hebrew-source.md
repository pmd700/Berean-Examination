---
name: MAM Hebrew source (Tanakh)
description: How MAM "plus" Wikisource JSON is parsed into plain cantillated RTL verse text, and the OT-only/file-map constraints.
---

# MAM (Miqra according to the Masorah) — Hebrew Tanakh source

The MAM data lives at `data/sources/mam-parsed/plus/*.json` (committed). It is the
Hebrew Wikisource Masoretic text, license **CC-BY-SA 4.0**
(https://creativecommons.org/licenses/by-sa/4.0/). Read-only, Old-Testament only.

## "plus" JSON shape
`book39s[0].chapters["<ch>"]["<verse>"]` is an **array of paragraph-lines**; each
line is an array mixing plain Hebrew **strings** with **template objects**
`{tmpl_name, tmpl_params}`. To get readable text you must walk the tree and
flatten only the text-bearing pieces.

## Extraction rules (the non-obvious part)
- Plain strings = real text; concatenate in order.
- **Metadata templates carry NO text and must be dropped** — their params hold
  book/chapter/verse identifiers and will leak garbage (e.g. `משליא…` at the start
  of Proverbs 1:1) if you fall through to the generic param walk:
  `מ:ספר חדש` (new book), `מ:פסוק` (verse marker), `מ:פרק` (chapter), `מ:תת ספר חדש`.
- `מ:לגרמיה*` (legarmeih/paseq) → render as ` ׀ `.
- `ר<digit>` (resh+digit) = poetic spacing markers → space.
- `מ:דחי` (ga'ya variant) → use param `"1"` (contextual full word).
- `מ:אות-מיוחדת-במילה` (special letter in word) → param `"2"` holds the assembled full word; param `"1"` is the broken-up pieces (don't recurse it or you double-count).
- `מ:אות…` (single special letter) → param `"1"`.
- `נוסח` (version/text wrapper) → recurse param `"1"`.
- Generic fallback: prefer a string param `"2"`, else param `"1"`.

**Why:** a naive "collect all strings" walk both double-counts variant words and
injects book/verse identifier params into the verse text. Verified output against
Genesis 1:1, Psalms 23:1, Proverbs 1:1 / 30:1, Ecclesiastes 1:1.

## Book-file map (incl. combined files)
`server/mam.ts` maps English OT book name → `{file, index}`. Most books are
single-file (`index: 0`). **Combined files hold multiple sub-books under several
`book39s` entries and ARE supported** by selecting `book39s[index]`:
Samuel (`BA`: 0=1Sam, 1=2Sam), Kings (`BC`: 0/1), Chronicles (`FC`: 0/1),
Ezra-Nehemiah (`FA`: 0=Ezra, 1=Nehemiah), the 12 Minor Prophets
(`CA`: 0..11 = Hosea..Malachi).
- **Sub-book-name leak:** inside combined files, chapter 1 verse 1 prepends a
  sub-book heading via `מ:רווח*` (spacing/heading) templates → must be treated as
  a space, not text, or the sub-book name leaks into the verse (seen in 12-prophets).

## UXLC / Leningrad Codex — no data
The OT source dropdown offers **UXLC** and **MAM**, but UXLC has **no data in the
project** (no table/file; `HebrewSourceVerse`/`GreekSourceVerse` are NOT in
`ENTITY_API_MAP` → noop entity → empty). Selecting UXLC degrades to a clean
"not available yet" message. **MAM is the only working OT Hebrew source.**

## Wiring (unified interlinear system)
- Server: `getMamChapter(book, chapter)` in `server/mam.ts` (lazy load + per-book in-memory cache), exposed via the `fetchMamChapter` case in the `/api/functions/:name` handler.
- Client: MAM is **one option inside the single interlinear Source Text dropdown**
  (not a separate UI). `useInterlinearChapter` is the unified hook: `selectedSource`
  + `resolveInterlinearSource()` pick the effective source (NT→SBLGNT, OT→UXLC|MAM,
  default MAM). MAM via `fetchMamChapter`; UXLC/SBLGNT via DB entities. Renders via
  `InterlinearVerse` with `isRtl` for Hebrew. "Individual Words" mode tokenizes into
  clickable RTL word popovers (lemma/gloss/morphology/Strong's = "Not available yet").
