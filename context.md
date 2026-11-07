# BEX context — AI handoff

Updated 2026-11-06. Read `read.me` for launch commands, architecture and safeguards.
Dates below are day-level timestamps from Git, project records or this conversation; request dates are not proof of implementation. “Recorded” means documented in the old project files; “verified” means checked in this work history. No earlier completion date is invented.

- [Recorded plan] Video Courses and separate Course Studio use signed manifests and local playback to avoid making learner data depend on hosted services — 2026-08-01.
- [Git baseline] Local-first Electron BEX provides encrypted SQLite, offline activation, owner privacy, Knowledge Webs and Bible Study without mandatory cloud login — 2026-10-08.
- [Recorded complete] Larger block handles, `/link`, `/quote` and list Backspace behavior make note organization and formatting more predictable — 2026-10-08.
- [Recorded complete] Timeline New Event uses today's local date and reveals the new event despite filters — 2026-10-08.
- [Recorded complete] Five-second note deletion confirmation protects against accidental editor deletion — 2026-10-08.
- [Recorded complete] Persistent text pointers, note pinch zoom, copy feedback and book Index navigation improve long-note workflows — 2026-10-08.
- [Git milestone] API.Bible reader groundwork introduced protected desktop credentials and edition-aware Scripture reading — 2026-10-08.
- [Recorded complete] Encrypted attachments and local PDF/audio/video viewers keep imported study material available offline — 2026-10-10.
- [Recorded complete] NASB 1995 API restoration uses its exact licensed edition without restoring retired downloaded Scripture — 2026-10-12.
- [Requested; later bundled in workflow commit] Compact auto-growing commentary, icon actions, translation-aware links, movable handles and separate note text sizing improve Study readability — 2026-10-13 to 2026-10-19.
- [Requested; later bundled in workflow commit] Bible verse-number sizing, fully visible commentary and editor-scoped Study marquee selection address reading/editing regressions — 2026-10-13 to 2026-10-19.
- [Requested; later bundled in workflow commit] Timeline compact/expanded/fullscreen editing gives descriptions useful space rather than blank padding — 2026-10-13 to 2026-10-19.
- [Requested; later bundled in workflow commit] Notebook page picking and remembered page/resume location prevent returning to page one — 2026-10-14 to 2026-10-19.
- [Verified feature] Single-file AI export combines notes, timelines, keywords, existing Knowledge Web Markdown and commentary IDs into explicit readable relationships — 2026-10-14 request; committed 2026-10-19.
- [Recorded removal] AI export replaced Mass Backup's UI and dedicated archive/IPC machinery while preserving normal Vault backup/restore — 2026-10-19 commit.
- [Requested; later bundled in workflow commit] Commentary corner resizing and unbounded pan/pinch canvas separate movement from resizing — 2026-10-14 to 2026-10-19.
- [Requested; later bundled in workflow commit] Translation favorites, a larger translation picker, adjacent font sliders and new-tab motion improve everyday navigation — 2026-10-14 to 2026-10-19.
- [Requested; later bundled in workflow commit] Partial toggle copying, granular nested marquee selection, quote boundaries and text drops into toggles address shared-editor regressions — 2026-10-14 to 2026-10-19.
- [Recorded feature] Study reuses all ten web canvas tools and stores permanent verse/commentary/object connections even when a passage leaves the screen — 2026-10-14 request; recorded by 2026-10-19.
- [Recorded feature] Study Cmd+F searches the page while Cmd+Shift+F opens global search outside editors and creates footnotes inside editors — 2026-10-15 request; recorded by 2026-10-19.
- [Requested; later bundled in workflow commit] Note deep links and remembered timeline viewport let users resume precise work locations — 2026-10-15 to 2026-10-19.
- [Requested] Study highlighting reliability was reported for repair, but this handoff does not establish a separate verified completion date — 2026-10-17.
- [Verified maintenance] Vault backup retention and backup-only deduplication reduced measured storage from about 1.42 GB to 211 MB while preserving live data and a recovery archive — 2026-10-19.
- [Approved plan; incomplete] A separate iPhone PWA and encrypted cloud mailbox should synchronize the entire logical Vault without requiring the Mac to stay awake — 2026-10-19.
- [Partial code only] `shared/sync/` contains unwired, unverified sync groundwork; no mobile installation, pairing or cloud relay is established — observed by 2026-10-27.
- [Verified fix] Native Apple emoji compatibility preserves Unicode and macOS artwork even when the system font paints blank, with visible fallback elsewhere — 2026-10-21.
- [Verified fix] Emoji baseline alignment and old-preload compatibility keep native artwork visible and aligned across text sizes — 2026-10-21.
- [Verified fix] Study footer links again navigate to the existing Feedback and Sources pages through the router — 2026-10-24.
- [Verified feature] Offline software notices include Electron/Chromium/runtime/npm licenses only on Sources & Licenses — 2026-10-24.
- [Verified feature] Shared Cmd+Shift+F footnotes work in card/timeline editors while existing footnotes edit inline — 2026-10-27.
- [Verified fix] Footnote read/edit layout stays aligned with a comfortable left inset — 2026-10-27.
- [Verified feature] Escape flushes saves and closes the whole Knowledge Web card while refresh restores its selected card and editor size — 2026-10-27.
- [Verified fix] Section titles, edges and resize controls take click priority over crossing connection lines while interior connections stay usable — 2026-10-27.
- [Verified fix] Each newly created footnote mounts with its own blank draft instead of inheriting a previous citation — 2026-10-27.
- [Verified adjustment] Notes gained about nine percent more text width through an 880px page cap and slightly smaller desktop padding — 2026-10-27.
- [Verified Git sync] All 72 changed files were committed verbatim as `23d4bac` and pushed to private `pmd700/Berean-Examination` main — 2026-10-28.
- [Documentation consolidation] The original 25 Markdown files were replaced by this history and `read.me`, retaining source notices and Mac setup guidance — 2026-10-28.

- [Implemented] Spreadsheets became a fourth library modality with virtualized cells, basic formulas, multi-sheet workbooks, formatting, resizing, sort/filter, frozen panes, dropdowns and summaries — 2026-11-06.
- [Verified] XLSX/CSV import/export preserves supported values/formulas/styles with original Excel package parts retained, tested with 1,024 rows and an independent workbook reader — 2026-11-06.
- [Verified] Spreadsheet Vault payloads use sparse cells and compression before authenticated encryption, with reopen/backup checks and save-aware refresh — 2026-11-06.
- [Implemented] Spreadsheet cell links, global search, AI export and per-tab view metadata connect workbooks to the rest of BEX — 2026-11-06.
- [Limitation] VBA blobs are retained for macro-enabled export but VBA execution and full Excel feature parity are not implemented — 2026-11-06.

- [Verified upgrades] Spreadsheet edge-drag previews, typing caret, overflow/wrap/clip, borders/presets, fast tooltips, alignments, popup comments, blank-paste erasing, rigid sticky scrolling and subtle selection tint improve everyday editing — 2026-11-06.
- [Verified calculations] Excel table references, legacy-import repair and 108 function names support live research formulas, matching all 1,077 supplied workbook calculations and preserving native table exports — 2026-11-06.

## Interpretation

Requests and historical checklists are context, not acceptance tests; inspect the current code before promising behavior. Source is in Git, private Vault data is separate, and neither a successful build nor this document proves clean-Mac installation or iPhone readiness. Earlier revisions of the removed documents remain in Git at `23d4bac`.
