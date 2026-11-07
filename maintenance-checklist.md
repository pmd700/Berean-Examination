# BEX maintenance — 2026-11-07

This is an execution record, not a claim of complete Excel parity or a zero-defect codebase. Preserve the video/course pathway, dormant authoring/playback machinery, source attribution, encryption, canonical IDs and offline behavior.

## Recovery and baseline

- [x] Checkpoint all existing app changes: `7453e89`; isolated branch `codex/maintenance-2026-11-07`.
- [x] Verified independent recovery copy outside Git: `/Users/davidmartinez/Desktop/BEX-maintenance-recovery-2026-11-07-78bf9e36`.
- [x] Recovery: SQLite online snapshot, portable DELETE journal, integrity check, 459 SHA-256-verified files; identical backup-history files deduplicated only inside the recovery copy (~301 MB physical). Live Vault was not cleaned or migrated.
- [x] Initial baseline: 976 DOM tests passed; production build passed; lint had 11 unused imports; typecheck had 688 diagnostics.

## Review and implemented changes

- [x] Renderer/router: retain all 16 registered pages, load feature modules on first use, retain per-tab state and pane-local failure/loading boundaries.
- [x] Diagram loading: import Mermaid on demand, initialize once, discard obsolete work and permit retry after loading failure.
- [x] Shared editor: empty/background comment sidebars stop frame polling; viewport reading space still responds to resize.
- [x] Annotation collection: comments, tooltips and footnotes reuse immutable document identity; selection/draft metadata and numbering remain live.
- [x] Knowledge Web: extract keyboard ownership into a tested hook; inactive tabs cannot consume clipboard/tool/undo keys or delete their retained selections.
- [x] Canvas lifecycle: cancel animations on unmount; clear stale zoom targets after gesture interruptions while preserving rapid button chaining.
- [x] Tooling/UI contracts: remove 11 unused imports, align the @shared alias, add precise shared UI prop/ref annotations without changing their executable AST.
- [x] Native proof harnesses: derive current schema expectation from the migration list; historical migration-specific assertions remain explicit.
- [x] Test contracts: retain page-surface marquee bounds and keyboard/editor safeguards after extracting the handler; use a consistent animation clock in jsdom.
- [x] Preservation review: no course/video/Studio production modules, Bible assets, fonts, licenses, user content, dependency versions or schemas removed/changed by cleanup.
- [x] Reproducible checks: `npm run check:core`, `npm run check:native`, `npm run measure:renderer`; `npm run typecheck` remains an explicit separate gate.

## Measurements

Initial app static JavaScript imports: 5,133,894 → 590,952 bytes; gzip 1,519,737 → 189,701 bytes (~88% less). Including the LibraryHome route and all its static dependencies: 860,632 raw / 281,847 gzip bytes (~83% / 81% less than the former eager startup). Lazy features still ship and remain available. These figures describe dependency payload, not full installed size, startup latency or process memory; dist remains about 46 MB. Studio's CSS is unchanged; shared-chunk redistribution slightly changes its JS byte count.

A 100-caret-transaction fixture performs one annotation collection instead of 101. Empty comment sidebars queue zero recurring animation frames. These are deterministic work-count checks, not invented CPU/memory percentages.

## Verification status

- `npm run check:core`: PASS — global lint, 1,004 DOM tests across 102 files, all 762 top-level Node/TypeScript tests, and both production renderer builds.
- `npm run typecheck`: still FAILS with 325 pre-existing diagnostics, down from 688; no suppression directives, checkJs weakening or dependency upgrades. Shared UI changes were checked for identical executable AST.
- Native entity, attachment, backup/restore, Scripture Study, timeline, course install/playback, privacy and spreadsheet proofs: PASS. The isolated built-app startup/route proof also passes; all ten native gates pass.
- Node tests now run consistently from the project root with test aliases, automatic JSX transform and an explicit raw-asset loader that reads real bundled notices. Old source-string checks were aligned with deliberate existing behavior (multi-block formatting, four modalities, API-only editions) and the new lazy boundaries; production behavior was not changed to satisfy obsolete assertions.
- Build output remains about 46 MB; dependencies, assets and future course/video code still ship. Faster startup dependency loading is not a claim of a smaller full installation.

Native checks use disposable libraries/profiles. The production startup smoke test uses an ephemeral, harness-only activation trust root with the unchanged signature verifier and real production main/preload/IPC. It verifies Library → Stats → Library → Courses → Library, deferred chunk requests, zero external requests and zero renderer errors; profile/library/report are deleted afterward. Production activation security is unchanged. Its obsolete tracked machine-specific report was removed and ignored; reports now live in temporary directories.

Local review/rollback commits: `8210695` (deferred loading and measurement), `1435ef9` (editor/canvas lifecycle and keyboard ownership). Tooling, test harnesses, types and this record are saved in a separate final maintenance commit. Changes have not been pushed to GitHub.

## Architecture boundaries

- Pages compose features; extracted hooks own focused interaction policies. Avoid a wholesale folder migration that would combine path changes with behavior changes.
- Shared TipTap machinery continues serving notes, cards, timelines and commentary; workspace-specific selection/keyboard rules stay explicit.
- Renderer → desktopClient/IPC → encrypted entity/media services remains the persistence boundary. No new data format or database migration is introduced.
- Course Studio remains a separate renderer/desktop entry point; Courses stays registered. Dormant video/course and optional AI/sync intentions are retained.

## Follow-up work requiring its own measured changes

- [ ] Complete the remaining legacy type contracts (platform globals, optional component props, tuple return inference, DOM/CSS narrowing and entity shapes); never hide them with checkJs changes or suppression directives.
- [ ] Measure cold/warm startup latency and process-memory behavior across realistic library sizes before claiming improvements to those metrics.
- [ ] Review annotation popover and pointer-layer hidden-tab ownership with dedicated interaction tests before changing their behavior.
- [ ] Profile large-graph geometry/connection work, spreadsheet dependency invalidation and search hydration before adding caches/workers/indexes.
- [ ] Perform fresh-Mac installation/activation/recovery verification; existing isolated native tests do not establish cross-Mac portability.

## Rollback

The checkpoint contains the complete pre-maintenance source, including spreadsheets. Revert only maintenance commits on this branch to recover application behavior, preserving subsequent user work. No schema downgrade or automatic restoration of old personal data is part of code rollback. Keep recovery material private and use BEX's supported restore workflow if data recovery is ever necessary; do not overwrite a live SQLite database.
