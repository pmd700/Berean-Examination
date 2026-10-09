# New feature rollout: API.Bible Scripture Search

Research date: October 7, 2026  
Implementation date: October 8, 2026  
Project: BEX — `/Users/davidmartinez/Desktop/BEX`  
Provider: [API.Bible documentation](https://docs.api.bible/)  
Status: Phase A (API Contract Verification) and Phase B (Reading Foundation) completed. Next step: Phase C (Two-version comparison, outlines, and chapter navigation).

## Current implementation progress (Updated October 8, 2026)

- **Phase A (API Contract Verification) — COMPLETED**:
  - Successfully decrypted the stored API key in the Electron desktop environment.
  - Confirmed active API access to **251 total Bibles**, including **40 English editions** (e.g., Berean Standard Bible `BSB`, King James Version `KJV`, `NASB`, `NLT`, `ASV`, `WEB`, etc.).
  - Verified CloudFront responses return HTTP 200 without rate-limit quota headers, confirming that request usage must be tracked locally via device ledger.
  - Validated structured `content-type=json` schema, `fumsToken` format in `meta`, and confirmed `wj` (words of Jesus) markup in KJV (`MAT.5.3`).
  - Tested and confirmed all 6 content requests for the sample query (`Jn1:1-3, mark 5:1,3-4, revelation 2-3, 4:4`).

- **Phase B (Reading Foundation) — COMPLETED**:
  - **Desktop Backend**:
    - `desktop/scripture-settings.cjs`: Added `getKey()` and `getFingerprint()` methods.
    - `desktop/scripture-cache.cjs`: Implemented bounded cache (24h catalog, 7d book maps, 14d passages/verses, max 499 verses/Bible with LRU eviction).
    - `desktop/scripture-usage.cjs`: Implemented local device request ledger partitioned by key fingerprint.
    - `desktop/scripture-api.cjs`: Created native fetch adapter for `https://rest.api.bible/v1`, AbortController cancellation per `requestId`, deduplication, error redaction, and usage recording.
    - `desktop/scripture-ipc.cjs` & `desktop/preload.cjs`: Wired guarded IPC channels (`scripture:get-catalog`, `scripture:get-books`, `scripture:fetch-content`, `scripture:search-words`, `scripture:cancel-request`, `scripture:get-usage`).
  - **Scripture Reference Parser**:
    - `src/lib/scriptureReferences.js`: Implemented mixed-reference parser supporting complex ranges, chapter inheritance, single-chapter books (`Jude 5`), cross-chapter spans, and standard USFM mappings.
  - **Renderer Client**:
    - `src/lib/scriptureClient.js`: Implemented IPC caller with bounded concurrency (max 2 parallel requests) and progress callbacks.
  - **Routing & Tabs**:
    - `src/lib/WorkspaceTabs.jsx` & `src/components/tabs/TabWorkspace.jsx`: Added `TAB_KINDS.SCRIPTURE`, default title mapping, deep link mapping, and `/ScriptureReader` route.
  - **Scripture Reader Interface**:
    - `src/pages/ScriptureReader.jsx`: Built dedicated full-workspace reader with search bar, Bible version selector, Words of Jesus toggle, text size control (16–30px), usage badge, progress indicator, skeleton loading, and attribution footer.
    - `src/components/scripture/ScriptureContentRenderer.jsx`: Built allowlisted structured JSON renderer for paragraphs, section titles, poetry (`q1`/`q2`), verse superscripts, words of Jesus (`wj`), and translated additions (`add`).
    - `src/components/scripture/scriptureReader.css`: Scoped typography with Noto Serif styling and red-letter styles.
    - `src/components/scripture/ScriptureSearch.jsx`: Connected search submission to `/ScriptureReader?q=...` route navigation.
  - **Test Suite**:
    - Verified all 24 unit tests (`node --test tests/scriptureSettings.test.cjs tests/scriptureApi.test.cjs tests/scriptureReferences.test.cjs tests/workspacePickerRetirement.test.js tests/workspaceNavigation.test.js`) and all 18 DOM tests (`vitest`).
    - Production build (`npm run build`) succeeded with zero errors.

- **Next step — Phase C (Precision & Convenience)**:
  - 1. Add chapter outline & section navigation (`GET /bibles/{bibleId}/chapters/{chapterId}/sections`).
  - 2. Implement two-version parallel comparison (`parallels` parameter or side-by-side columns).
  - 3. Add Next / Previous chapter navigation buttons in the reader toolbar.

## The decision

We can build a dedicated Scripture reader with an animated entrance, a searchable translation selector, mixed-reference search, formatted passages, and useful loading and usage feedback. Red letters are possible where the selected edition supplies words-of-Jesus markup. An exact monthly account balance is not yet established by the public API documentation.

In this plan, “API alone” means **API.Bible is the only Scripture data provider**. Animations, fonts, parsing, and loading screens are BEX interface work; the API does not draw them. They need no additional Bible service. Features requiring unavailable Scripture data or an undocumented API capability are marked **REJECTED** beside their idea number.

The subscription tier and licensed Bible catalog are unknown. I reviewed public documentation and BEX's existing integration files, but did not make authenticated Scripture requests. “Supported” below means documented capability; translation-specific behavior still needs a small integration check during implementation.

## Where this fits in BEX

The current Home page already contains `ScriptureSearch`. It securely saves a key but submission currently reports that search is coming next. The desktop side has encrypted key storage and trusted-page IPC checks; it does not yet provide Scripture retrieval.

There is also a provider mismatch: the setup card currently links to “Free Use Bible API” at `bible.helloao.org`, although its input refers to API.Bible. The rollout will change this card's identity and documentation link to API.Bible. A saved-key indicator will mean “saved”; successful catalog retrieval will establish “connected.”

BEX already includes Framer Motion, React Router, Radix controls, and a workspace-tab system. The new page will use those facilities. The existing shared Bible search helper only handles simpler references and strips hyphens during normalization; it must not become the mixed-reference parser unchanged.

## 1. Animated transition into a full-screen Bible search page — SUPPORTED

**What it will feel like:** Press Enter on Home and the search field moves into a compact reader toolbar while a full-width reading workspace appears beneath it. The query remains visible throughout the transition.

**Implementation plan:**

1. Trim the input and perform local syntax checks. Empty input stays on Home. Enter during IME composition does not submit; repeated Enter does not start duplicate requests.
2. Navigate the current workspace tab to a dedicated `/ScriptureReader` route. Add a Scripture tab kind, title, and path mapping so restoring a session recognizes it correctly. Use BEX's tab navigation rather than creating another browser window.
3. Put a transition host above the Home/reader route boundary. Capture the search field's starting bounds before navigation and animate an inert visual copy to the reader toolbar over **320 ms**, using position/scale and opacity. Mount the real reader immediately, then remove the copy. This avoids depending on two routed inputs remaining mounted together.
4. Fade the reading area in over approximately **180 ms**. Keep the entrance restrained: no continuous particles across the reading text and no repeated animation when changing a version or retrying a request.
5. Begin retrieval alongside navigation. The animation completes on time even if the API is slow; the page then uses the loading behavior in idea 7.
6. With reduced motion enabled, use a short opacity transition of at most **100 ms**, with no travel or zoom. Move keyboard focus to the reader's search field after the transition. A visible Back control returns to Home and restores the query, focus, and tab identity.

“Full-screen” means the full available **BEX workspace**. BEX's tab bar stays accessible. Enter will not force macOS into its separate full-screen mode.

**Acceptance:** One Enter opens one reader view; keyboard focus survives navigation; reduced motion works; a slow response never leaves the app stuck halfway through the animation.

## 2. Exact typography — SUPPORTED

**Scripture reading face: Noto Serif.** Package local WOFF2 assets for regular 400, italic 400, and semibold 600, together with their font license. Noto's relevant font project uses the SIL Open Font License. API.Bible's own Scripture stylesheet also names Noto Serif; the final BEX layout will use scoped styles rather than adopt the entire demo theme. [Noto project](https://github.com/notofonts/latin-greek-cyrillic), [official Scripture stylesheet](https://raw.githubusercontent.com/americanbible/scripture-styles/master/dist/css/scripture-styles.css).

**Exact proposed settings:**

- Scripture paragraphs: Noto Serif, **20 px**, weight 400, line height **1.7**, maximum line width **68ch**.
- Narrow layouts: **18 px** body text with the same line-height ratio.
- Passage headings: Noto Serif, **26 px**, weight 600.
- Footnote text: **16 px**. Verse numbers: **12 px** in the interface font, with adequate contrast.
- Search, dropdowns, buttons, usage, and status text: keep BEX's current system interface stack, beginning with `-apple-system` and `BlinkMacSystemFont`; on the user's Mac this follows the system interface font.
- Reader text-size control: **16–30 px**, saved as a Scripture-reader preference. It does not change app zoom or other pages' typography.

Create a reader-scoped font token and explicitly style its text descendants, because BEX currently has global font rules. Do not change the global app font token. Preserve italics, poetry indentation, and language direction from the content. For scripts outside the packaged font's coverage, use a suitable script-specific fallback; Noto Serif is not a promise of complete coverage for every API language.

**Acceptance:** The chosen reading face loads locally without a Google Fonts request, verse numbers remain readable, and Notes and other BEX pages keep their existing fonts.

## 3. Bible versions — SUPPORTED, subject to the key's access

Use a **searchable dropdown/combobox**, not a long native select. Each entry shows the edition name, abbreviation, and language. Favorites appear first, followed by other available editions; a language filter keeps the list manageable.

API.Bible exposes the key's Bible catalog through `GET /bibles`. Full details include language and edition information; the exact Bible ID identifies the publication to request. Availability is determined by the account's access, so the UI will not promise that a particular commercial translation is included. [Bibles guide](https://docs.api.bible/guides/bibles/).

**Implementation plan:**

1. Fetch `/bibles?include-full-details=true` after the first connection. Cache catalog metadata for **24 hours** as a BEX design choice, and provide explicit Refresh.
2. Build the combobox with existing Radix/cmdk components: type to filter locally, arrow keys to move, Enter to select, Escape to close. Typing in this dropdown makes no API calls.
3. Persist the selected **Bible ID**, favorites, and language filter. Never use an abbreviation as a unique identifier.
4. If no edition is selected, ask for a choice inside the reader, with the user's language shown first. Do not quietly choose a theologically or commercially preferred translation.
5. On a version change, keep the query, request the equivalent content, and retain the reading location where it can be mapped. Label any retained text with its actual edition while loading; never show old text under the new edition's label.
6. If access is removed or a book is unavailable, explain that locally and offer available choices. Do not silently substitute a different Bible.

Translation numbering can differ. Store the response's edition-specific IDs and original verse IDs where supplied; use API.Bible's original-ID support when mapping between editions. Preserve returned verse spans instead of assuming one displayed number always corresponds to one separately retrievable verse. [Referencing verses](https://docs.api.bible/resources/referencing-verses/).

**Acceptance:** Favorites persist, inaccessible editions are not offered as usable, switching translations preserves the intended reference, and an edition with a different canon is handled using its own metadata.

## 4. Powerful mixed-reference and keyword search — SUPPORTED with a BEX parser

The exact example will be supported:

**`Jn1:1-3, mark 5:1,3-4, revelation 2-3, 4:4`**

It means:

- John 1:1–3.
- Mark 5:1.
- Mark 5:3–4; verse 2 is not part of the requested range.
- Revelation chapters 2 and 3.
- Revelation 4:4; the book is inherited from the preceding clause.

### Reference mode

BEX will tokenize and interpret the expression locally, producing typed book/chapter/verse selections before requesting content. It will not depend on the API's free-text search guessing the meaning of the entire string.

The parser will:

- Recognize aliases such as John, Jn, JHN, Mark, Mk, and Revelation, case-insensitively. Support omitted spaces (`Jn1:1`), numbered books (`1 John`, `1Jn`), ordinary hyphens, and en dashes.
- Preserve range punctuation. Reuse applicable aliases from the existing helper without changing that helper's behavior for other BEX features.
- Treat a colon as a chapter/verse boundary. In `Mark 5:1,3-4`, subsequent bare numbers inherit chapter 5 as verse selections. In `Revelation 2-3, 4:4`, the explicit colon starts a new chapter/verse selection in Revelation.
- Accept semicolons as clear clause separators and recognize when a new book name resets context.
- Support cross-chapter ranges such as `John 3:16-4:2`, and explicitly named cross-book endpoints when both books exist in the selected edition.
- Show a local “Interpreted as” preview before or alongside submission. Ambiguous shorthand gets an explicit interpretation or a correction prompt rather than silently retrieving the wrong passage. Single-chapter books receive a clear expanded preview, such as `Jude 5` → `Jude 1:5`.
- Validate books and chapters against the selected Bible's metadata, not a hardcoded 66-book list. Validate verse boundaries using cached verse metadata or a targeted metadata request when needed. Invalid references do not quietly become keyword searches.
- Keep the user's order. Deduplicate network retrieval for repeated selections without losing their requested grouping.

Load the selected edition's book/chapter map with `/bibles/{bibleId}/books?include-chapters=true`; obtain detailed verse lists only for chapters that need them. [Books guide](https://docs.api.bible/guides/books/), [verses guide](https://docs.api.bible/guides/verses/).

### Exact retrieval plan for the example

With edition metadata already available and no content cached, schedule these **six content requests**, excluding any additional boundary validation:

1. Passage `JHN.1.1-JHN.1.3`.
2. Verse `MRK.5.1`.
3. Passage `MRK.5.3-MRK.5.4`.
4. Chapter `REV.2`.
5. Chapter `REV.3`.
6. Verse `REV.4.4`.

Present five groups, with the two Revelation chapters together. Use the verse, passage, and chapter endpoints according to the selection type. Full chapters can supply context and next/previous navigation. [Chapters guide](https://docs.api.bible/guides/chapters/).

The passage endpoint documents a **200-verse maximum per response** and can return a shortened range in its `id`. Larger selections must be divided into bounded requests, and returned coverage must be checked before declaring completion. This is separate from the provider's caching guidance. [Passages guide](https://docs.api.bible/guides/passages/).

BEX will initially fetch at most **10 content units per submission** and offer “Load more” for the remaining units; that is an app safeguard, not an API limit. The example fits in one batch. Keep a maximum of two content requests in flight across reader tabs, reuse matching in-flight work, and render each completed group independently.

Some editions intentionally return a merged verse span even for a single verse. Preserve and label the actual returned span. Thus Mark 5:2 must not be added by BEX's parser, but if the publisher supplies an inseparable span containing it, the UI must explain that rather than cutting or inventing a verse boundary. [API FAQ](https://docs.api.bible/common-questions/).

### Keyword mode

When input is ordinary text rather than a reference, use `/bibles/{bibleId}/search`. The documented search supports multiple terms in one verse, wildcards, fuzzy matching, passage-range filtering, sorting, and pagination. It does not establish an AI semantic-search contract. Search-result text is unformatted, so opening a result fetches formatted content for the reader. [Search guide](https://docs.api.bible/guides/search/).

The UI will expose:

- **References / Words** mode, with automatic detection and a visible override.
- Scope: whole selected Bible, a selected book, or selected passage ranges.
- Sort: relevance or biblical order; reverse order as an advanced option.
- Typo tolerance: off or on. Start with exact matching; offer a tolerant retry after no results instead of doubling every search automatically.
- **20 results per page**, with an explicit Load more button. Do not prefetch every result page.

Autocomplete for book names, reference interpretation, and saved searches runs locally. Scripture keyword search runs only on submission, not on every keystroke. Quotation marks and Boolean expressions will not be advertised as guaranteed operators unless a documented contract and integration checks establish them.

**Acceptance:** The supplied example produces the exact intended selections; missing verses, ambiguous abbreviations, overlaps, cross-chapter ranges, unavailable books, and truncated responses receive deliberate handling. One failed group does not discard successful groups.

## 5. Red-letter text — SUPPORTED WHERE THE EDITION PROVIDES MARKUP

The research does not justify rejecting this feature outright. API.Bible supports formatted Scripture, its official stylesheet includes the `wj` class, and the Scripture markup standard identifies `wj` as words of Jesus. This establishes a rendering route, but does not prove that every accessible translation includes those marks. [Content formats](https://docs.api.bible/resources/content-output-formats/), [Scripture styling](https://docs.api.bible/resources/scripture-styling/), [words-of-Jesus marker](https://docs.usfm.bible/usfm/3.1.2/char/features/wj.html).

**Implementation plan:**

1. Request structured content and render nested character styles without flattening them into plain text. Map supplied `wj` spans to a reader style.
2. Add “Red letters” to reader preferences, initially enabled for marked content. Turning it off returns those spans to ordinary text color and makes no API request.
3. Use separate accessible light/dark red colors. The official stylesheet does not itself guarantee red presentation for `wj`; BEX must explicitly apply the desired style.
4. Color only the marked words, including when a verse mixes narration and speech. Never color an entire verse merely because it contains a quotation.
5. Treat capability as “observed” or “not yet established.” An unmarked chapter does not prove the entire translation lacks red letters. If needed, show “This passage contains no words-of-Jesus markup.” Confirm at least one marked payload before presenting an edition as verified.

### 5a. Guaranteed red letters in every translation — REJECTED

API.Bible alone cannot guarantee markup that an edition does not provide. We will not guess from quotation marks, use an AI model to identify speakers, or silently import a second provider's red-letter dataset.

## 6. Usage limit meter — SUPPORTED WITH EXPLICIT LIMITATIONS

Use a small meter in the toolbar; expand it for details. Distinguish **provider-reported remaining requests** from **locally recorded requests**.

The official SDK documents `X-RateLimit-Remaining` and warns that reset-header semantics need verification against a live response. That is evidence for a provider-backed remaining value, not proof that the value always describes the monthly subscription allowance. [Official SDK documentation](https://www.npmjs.com/package/%40americanbible/api-bible-sdk).

Current public documentation lists Starter at **5,000 calls/month**, Pro at **150,000 calls/month**, and Enterprise with custom limits. Legacy arrangements may differ. The billing cycle follows the subscription anniversary rather than necessarily the first of the month. Do not infer the user's plan from these defaults. [Rate limiting](https://docs.api.bible/quick-start/rate-limiting/), [legacy users](https://docs.api.bible/resources/legacy-users-faq/), [billing cycle](https://care.api.bible/article/393-understanding-your-api-bible-billing-cycle).

**Implementation plan:**

1. Read rate-limit headers on responses already being made; do not spend extra calls polling usage.
2. Show a fresh remaining value with its last-updated time. Label its window only after its meaning is verified. If the header lacks an established window, say “API-reported remaining” rather than “monthly requests left.”
3. Store a persistent request ledger in the desktop process, partitioned by the configured key's local fingerprint. Record every dispatched attempt, including retries. Record status and timing without storing the key or full search text in logs.
4. Label that ledger “Requests from this device.” It is an estimate of consumption: failed or cancelled requests may still be chargeable, and a locally counted attempt is not a provider billing receipt.
5. Enable a monthly progress bar only with a confirmed allowance and cycle start/reset. A manually established starting balance remains an estimate if other devices use the key. Unknown limits remain unknown, never an invented 0% or 100%.
6. Use quiet notices at **80%** and **95%** of a verified/configured allowance. A zero or exhausted provider allowance stops automatic retries and offers the account dashboard. Subscription and overage settings are not changed by the reader.
7. Show useful request economics: a fresh execution of the sample reference costs six content requests; a fully valid content-cache hit makes zero new content requests. Metadata checks, retries, and required view reporting are identified separately.

### 6a. Exact account-wide monthly balance and reset, automatically synchronized everywhere — REJECTED for the initial rollout

I found no documented public account-usage endpoint establishing all those values. The dashboard documents official usage monitoring; the remaining-request header alone does not establish every billing field. If live verification proves a reliable monthly contract, the meter can be promoted from qualified/estimated to provider-confirmed. Until then it must not claim exactness. [Usage monitoring](https://care.api.bible/article/407-how-to-monitor-your-usage).

## 7. Loading screen for a slow API — SUPPORTED

Use a reading-page skeleton and individual passage placeholders, rather than blocking the whole application behind a spinner.

**Implementation plan and timing:**

- **Immediately:** show the reader shell, submitted query, version, and Cancel. Start the entrance animation independently of retrieval.
- **After 150 ms:** reveal paragraph skeletons if content is still pending. Avoid a flashing loader for a fast cache hit.
- **After 3 seconds:** show “API.Bible is taking longer than usual.” Keep controls usable.
- **As groups finish:** replace their skeletons in the original request order. Show real progress such as “2 of 6 requests completed”; never fabricate a time-based percentage.
- **At 20 seconds for a search batch:** stop pending work and keep completed results. Offer Retry for failed or unfinished groups.

Use an **8-second per-attempt timeout**, at most **one retry** for a retryable request, and a separate 20-second batch abort deadline. Honor `Retry-After` on 429 responses only when the wait fits that deadline. Confirmed quota exhaustion is not retried. Do not retry bad input, invalid credentials, or unavailable-edition errors. These are proposed BEX limits, not API service guarantees. [Error guide](https://docs.api.bible/quick-start/errors/).

Every search gets a request ID. Starting a replacement search cancels the old one and ignores late responses. Cancellation must reach the desktop request controller. Shared work is aborted only when no reader still needs it. Changing font size, red-letter preference, or opening a dropdown never restarts content retrieval.

Offline, show still-valid cached content with its age when permitted, or a concise connection message when no usable cached copy exists. A loading failure must not erase the query, switch the selected Bible, or return the user to Home.

**Acceptance:** Check fast, slow, offline, cancelled, partial-failure, 401/403, and 429 cases in the real desktop app. None may leave an indefinite spinner or display an old response as the latest search.

## Additional ways to use the API

### 8. Chapter outline, context, and publisher formatting — SUPPORTED

Add a collapsible outline alongside the reader, using section titles and verse boundaries returned for that edition. Selecting a heading scrolls to already loaded content or retrieves only the selected section. “Read in context” opens the surrounding chapter; Previous and Next use returned navigation metadata.

Preserve prose paragraphs, poetry lines, indentation, supplied headings, and character styles in a shared renderer. Do not turn every verse into a separate paragraph when the publisher supplied a continuous reading layout. If sections are absent, offer chapter navigation without inventing headings. [Sections guide](https://docs.api.bible/guides/sections/).

### 9. Two-version comparison — SUPPORTED, subject to access

Add a Compare button that opens a second version selector. On wide screens, display two columns; on narrow screens, switch between labeled panes. Start with two editions so the reader stays usable.

Use the documented `parallels` parameter where the selected content endpoint supports it. Validate the returned parallel structure and each edition's availability; fall back to two bounded requests if necessary. Align using original verse IDs where available, keeping merged or missing spans visible. Each edition gets its own attribution and red-letter capability state. Do not promise identical verse numbering or a fixed billing discount from a combined response. [Passage parameters](https://docs.api.bible/guides/passages/), [integration patterns](https://care.api.bible/article/411-common-integration-patterns).

### 10. Footnotes and supplied cross-references — SUPPORTED WHERE INCLUDED

Request notes in formatted reading responses and make their markers keyboard-accessible. A small popover shows the note; choosing a recognized Scripture reference opens a preview through the same parser and retrieval path.

Keep note IDs unique per passage and comparison column. Preserve the edition's exact note text. This is access to publisher-supplied material, not a promise of a complete commentary or cross-reference database. The reader's note visibility toggle can be local because the initial reading response includes notes. [Verse content options](https://docs.api.bible/guides/verses/).

### 11. Saved searches, reference bookmarks, and selective copy — SUPPORTED AS LOCAL FEATURES

Store reference selections, Bible IDs, labels, and reading positions locally. A bookmark reopens the reference and obtains permitted current content; it is not an unlimited permanent copy of a copyrighted passage. Keep search history on this device with a Clear history control.

Offer “Copy selected verses” with the actual reference, edition, and required attribution. Preserve textual wording and enforce the selected edition's applicable quotation/export restrictions before enabling export. These features can stay inside Scripture Reader without changing BEX's Notes or Knowledge Webs.

### 12. Chapter audio and verse following — CONDITIONAL

Offer an audio control only where the account's available text edition links to an accessible audio Bible. Retrieve chapter audio on demand. Playback URLs can expire; some recordings include verse timecodes. Availability of audio and timecodes must be checked independently. [Audio guide](https://docs.api.bible/guides/audio-bibles/).

Use an ephemeral playback file where the provider's guidance and edition license permit it, obtaining it promptly from the signed URL. Discard it according to that license and never offer permanent downloads by default. Refresh the URL when needed. Highlight the active verse only when usable timecodes exist; otherwise provide ordinary chapter playback. This belongs after the text-reader rollout and its reporting/licensing checks.

### 13. A daily passage from the user's saved references — SUPPORTED AS A LOCAL FEATURE

Let the user opt into a rotating list of their own reference bookmarks. BEX selects today's reference locally and fetches that passage only when the feature is opened, reusing valid cache. There is no need for a second Scripture provider or a background API polling job.

Present this as “From your reading list,” not an API-provided devotional or divinely selected verse. The local schedule and selection are BEX features; no undocumented “verse of the day” endpoint is assumed.

### 14. AI theological answers or semantic research search — REJECTED

The documented search contract does not supply an LLM, theological reasoning, source evaluation, or guaranteed concept retrieval for prompts such as “find passages contrasting covenant obligation and personal conscience.” That would require a separate model/index and a separate product decision. It will not be presented as a capability of this API.

### 15. A complete interlinear, Strong's concordance, and morphology engine — REJECTED

The reviewed endpoints do not establish universal word-level alignment, Strong's identifiers, lemma parsing, or morphology across editions. Access to an original-language Bible is not equivalent to those datasets. Existing BEX study resources are outside this API-only rollout.

### 16. Every commercial Bible unlocked by entering a key — REJECTED

A key only grants its licensed access. No hidden fallback, alternate provider, or bypass will be used to fill unavailable editions. The version selector is populated from the accessible catalog.

### 17. A permanent offline download of every Bible — REJECTED

The API and its documented cache/licensing constraints do not justify an unrestricted local mirror. The plan supports bounded temporary caching and reference bookmarks. Any edition-specific offline right would need to be established separately before designing a download feature.

## Retrieval, storage, and rendering design

### Desktop request boundary

Keep authenticated requests in Electron's **main process**. Extend the existing encrypted Scripture settings with an internal-only key accessor, and extend the guarded IPC surface with specific operations for catalog, metadata, content, search, cancellation, and usage status. The renderer receives typed content/results, never the saved key.

Use a small native-fetch adapter, with the base URL restricted to `https://rest.api.bible/v1` and the documented `api-key` header. Keep FUMS reporting separate. Reject arbitrary renderer-supplied URLs and authenticated redirects, and redact credential-bearing errors. Validate Bible IDs, references, pagination, and option values before sending a request. The authentication guide establishes the request header and current REST base. [Authentication](https://docs.api.bible/quick-start/authentication/).

The main process owns the request queue, cancellation controllers, cache, and usage ledger, so two open tabs do not create two unrelated quota counters. A request signature includes Bible ID, reference/query, output format, formatting flags, pagination, and comparison IDs. Share identical in-flight work while maintaining each tab's own selection and loading state.

Use `content-type=json` for reading, with titles, verse numbers, verse spans, and notes requested where supported. Build an allowlisted React renderer for paragraph, text, verse, and character-style nodes. Preserve unknown textual content conservatively while ignoring unsafe/unsupported presentation attributes. Confirm the actual JSON shape in the initial payload check; if an edition requires HTML handling, pass it through a strict sanitizer before rendering. Never execute response-provided JavaScript or treat plain search snippets as richly marked Scripture.

### Endpoint map

All paths below are GET requests beneath the REST base above. Parameters are passed as encoded values, not assembled from unchecked input.

- Available editions: `/bibles`, with `include-full-details=true`.
- Book/chapter map: `/bibles/{bibleId}/books`, with `include-chapters=true`.
- Verse-boundary metadata when needed: `/bibles/{bibleId}/chapters/{chapterId}/verses`.
- Single verse: `/bibles/{bibleId}/verses/{verseId}`.
- Contiguous range: `/bibles/{bibleId}/passages/{passageId}`.
- Whole chapter/context: `/bibles/{bibleId}/chapters/{chapterId}`.
- Words search: `/bibles/{bibleId}/search`, with `query`, `limit=20`, `offset`, and the chosen supported scope/sort/fuzziness options.
- Outline: `/bibles/{bibleId}/chapters/{chapterId}/sections`; section content uses `/bibles/{bibleId}/sections/{sectionId}`.
- Optional audio: `/audio-bibles/{audioBibleId}/chapters/{chapterId}`, using an actual accessible audio Bible ID from the catalog.

The reading request profile is JSON with notes, titles, verse numbers, and verse spans enabled; chapter numbers can remain off because BEX supplies a chapter heading. Search responses use their own result schema. Original-ID lookup is enabled only when resolving an original verse ID, not indiscriminately for every displayed reference. The resource guides linked in the feature sections define these operations.

### Cache that saves calls without becoming a Bible mirror

Proposed defaults:

- Bible catalog: 24-hour freshness; explicit refresh available.
- Book/chapter structure: seven-day freshness, refreshed after an edition/access change.
- Scripture response cache: evict or refresh on demand after **14 days**, sooner if the specific license requires it.
- Persistent Scripture capacity: at most **499 distinct verses per Bible**, counting retained search snippets and passage/chapter bundles together. This is a deliberately conservative BEX limit, not a claim that the provider defines its overall cache allowance that way.
- Evict least-recently-used complete bundles, retaining their formatting and attribution together. If a bundle's span cannot be counted reliably, do not persist it.
- Avoid a second unbounded text cache in the renderer or tab-session storage. Store restored tab references, not serialized Scripture bodies.
- Replacing/removing the key clears associated cached licensed content and capability state; retain personal reference bookmarks separately.

The API FAQ requests fewer than 500 consecutive cached verses. Current caching guidance requires refresh within 30 days and recommends 14 days or less. Expired copies are removed and refetched when needed; there is no background “refresh the whole Bible” job. [API FAQ](https://docs.api.bible/common-questions/), [caching guidance](https://care.api.bible/article/401-caching-content).

### Attribution and view reporting

Keep each edition's supplied copyright and required information with its content, visible in the reading view and available in edition details. Confirm translation-specific terms before enabling copying, audio retention, or other export features. Access and permitted use are separate checks. [Licensing policies](https://care.api.bible/article/396-licensing-policies-quick-reference).

API.Bible requires FUMS view reporting for web apps and explicitly identifies a mobile-only exemption. The documentation does not clearly classify Electron desktop apps, so the rollout must not assume an exemption. The default plan includes reporting; confirm the desktop classification before release. [Fair Use guide](https://docs.api.bible/resources/fair-use/).

Retain `meta.fumsToken` with retrieved content and use the documented manual reporting endpoint, `https://fums.api.bible/f3`, with locally generated device/session identifiers. Report actual visible content, including permitted cache views; do not count every React render or hidden-tab mount as a view. Do not send the API key, email, or search text to that endpoint. Request usage and content-view reporting remain distinct measurements. Audio reporting needs its documented listen behavior verified before audio ships.

Resolve any conflict with BEX's network/privacy controls before enabling this integration. A local key does not make Scripture retrieval or required reporting an offline operation. If deferred reporting for offline cached views is needed, confirm its permitted behavior rather than inventing a reporting exemption.

## Proposed implementation locations

These are planned changes, not files created by this research task:

- `src/components/scripture/ScriptureSearch.jsx`: correct provider identity and replace the submission placeholder with reader navigation.
- `src/pages/ScriptureReader.jsx`: the dedicated page, query state, and reader controls.
- `src/components/scripture/`: separate transition, version combobox, passage renderer, loading/error, and usage components, plus reader-scoped styles and licensed font assets.
- `src/lib/scriptureReferences.js`: the new reference tokenizer, parser, and interpretation model; do not change the shared simple parser's contract.
- `src/lib/scriptureClient.js`: narrow renderer-to-desktop calls and request-ID coordination.
- `src/components/tabs/TabWorkspace.jsx` and `src/lib/WorkspaceTabs.jsx`: an explicit reader route, tab kind/title, navigation, and restore behavior. The existing generated page registry is not a file to hand-edit; use the explicit route table for this addition unless the actual generator is established.
- `desktop/scripture-settings.cjs`: internal key retrieval while retaining encrypted storage.
- `desktop/scripture-ipc.cjs` and `desktop/preload.cjs`: guarded retrieval/cancellation/usage operations alongside the existing setup operations.
- `desktop/scripture-api.cjs`, `desktop/scripture-cache.cjs`, and `desktop/scripture-usage.cjs`: main-process request adapter, bounded storage, and ledger. Connect them at existing desktop initialization.

Keep this implementation inside Scripture Search/Reader and the minimum shared routing hooks. Existing Notes, Knowledge Webs, local Bible study content, and other provider integrations do not need redesigning.

## Rollout order and release checks

### Phase A — Establish the real API contract

During implementation, use the saved key through the desktop process to inspect the accessible catalog and a small number of targeted responses. Establish:

- Which editions the account actually permits and which plan/billing cycle applies.
- One ordinary passage, one passage with notes/poetry, and a candidate Gospel passage with `wj` markup.
- The exact structured-content schema, attribution fields, original verse IDs, and FUMS token shape.
- Actual remaining/reset headers and their meaning; missing fields keep the usage UI qualified.
- Desktop reporting obligations and edition-specific cache/copy/audio permissions.

Do not retrieve entire books to discover capabilities. A positive example proves a capability for that edition; one absent marker does not prove universal absence.

### Phase B — Ship the reading foundation

Implement provider correction, main-process retrieval, reference parser, dedicated tab route, version selection, scoped Noto Serif typography, safe formatted rendering, loading/cancellation, attribution, and reporting. At this point the complete sample query must work end to end.

### Phase C — Add precision and convenience

Add observed red-letter rendering, the qualified usage meter, keyword filters/pagination, outlines, and two-version comparison. Enable each conditional feature only after its payload behavior is verified. Add local bookmarks and selected-copy behavior after the edition's terms are applied.

### Phase D — Optional extensions

Add licensed chapter audio and the saved-list daily passage only after the text reader is stable. No permanent-download or semantic-AI feature is included in this rollout.

### Required acceptance checks

1. The exact supplied search produces the five intended presentation groups and six content units, with no invented omission, verse, or chapter.
2. Alias, punctuation, ambiguous input, single-chapter books, cross-chapter ranges, and translation-specific canon/numbering cases behave as specified.
3. Ranges exceeding 200 verses never silently appear complete when the API returned a shorter range.
4. Red letters affect only actual marked spans; an edition without observed marks is not misrepresented.
5. Version switching and quick repeated searches cannot attach old text to a new version/query label.
6. Cache hits, retries, cancellation, parallel tabs, app restarts, and key changes produce honest usage/cache behavior.
7. The reader works with keyboard navigation, reduced motion, readable light/dark contrast, and right-to-left content when selected.
8. Slow API responses, quota exhaustion, authentication failures, partial results, and offline cache misses have finite, recoverable states.
9. API keys never appear in renderer state, URLs, logs, exports, or error messages.
10. Copyright, required information, and view reporting work with real responses, including cached and comparison views.
11. The actual Electron workflow is checked after restart: Home → Enter → reader → version change → Back → restored tab. Component tests alone are insufficient evidence for desktop routing, IPC, fonts, and animation.

## Documentation differences to handle deliberately

- **REST base:** current authentication and resource guides use `rest.api.bible/v1`; some examples elsewhere use other hosts/versions. The adapter will use the current documented base and verify responses before expanding access.
- **Usage:** do not copy legacy daily-quota assumptions into a monthly-plan meter, or assume a reset header is a monthly timestamp.
- **Range versus cache limits:** the 200-verse passage-response limit and the fewer-than-500-consecutive-verse caching guidance concern different things.
- **Cache timing:** 14 days is the recommended refresh interval; 30 days is the published outer refresh requirement, subject to stricter edition terms. The proposed cache uses the shorter interval.
- **Red letters:** a `wj` styling hook is evidence of representable markup, not a guarantee of marked text in every edition or red coloring in the default stylesheet.
- **Reporting metadata:** current Fair Use guidance uses `fumsToken`, while some response examples retain older JavaScript-related fields. Validate what is actually returned; never evaluate returned scripts.

This document records the implementation decisions and their verification gates. The research task created this plan only; it did not connect an account, consume an API allowance, or implement the proposed features.
