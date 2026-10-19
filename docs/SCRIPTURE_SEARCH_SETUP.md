# BEX implementation plan and checklist

Updated: 8 October 2026. Implementation checkout: `/Users/davidmartinez/Desktop/BEX`.

This document covers the features and corrections discussed in this chat, including the earlier note zoom, copy feedback, and Index requests. It preserves the scripture setup notes below. It is a record and a plan; unchecked future features are not implemented by writing this document.

- **[x] Completed:** implemented in the current checkout, or supplied in this document for documentation/asset requests.
- **[ ] Remaining:** explicitly deferred functionality, next-stage implementation work, or outstanding verification.
- **Superseded:** an earlier design was implemented and then replaced at the user's request. It is recorded as completed history, not as a feature to bring back.
- Automated tests and code inspection are distinguished from physical-device verification.

## 1. Editor block handles

- [x] Make the six-dot grab handle larger and easier to see.
- [x] Enlarge its purple hover/grab area: the current handle is 28 × 30 px with 4 px dots.
- [x] Preserve block dragging and the existing block-type menu.

Implementation: `src/index.css`, `src/components/editor/BlockDragExtension.js`, and `src/components/editor/TEXT_EDITOR_MACHINERY.jsx`.

## 2. Timeline “New event” uses today's exact date

- [x] Create a new event with the device's current local year, month, and day, with exact date precision.
- [x] Read the date each time New event is pressed, rather than storing today's date at startup.
- [x] Select the new event and center the timeline on its date.
- [x] Make the new event visible when the current filters would exclude it.
- [x] Use the operating system's local date and timezone; no location permission or GPS is required.
- [x] Cover timezone boundaries, year rollover, leap day, and daylight-saving transitions with date tests.

Implementation: `src/lib/timegraph/timegraphDate.js`, `src/lib/timegraph/timegraphModel.js`, and `src/components/timegraph/TimegraphEditor.jsx`. Checks: `tests/timegraphToday.test.js` and `tests/dom/timegraphNewEvent.test.jsx`.

## 3. /Link across the library

- [x] Add **Link** to the slash-command menu and make it searchable with `/link`.
- [x] Open a searchable picker for Notes, Knowledge Webs, and Timelines.
- [x] Insert the selected item's title as a navigable library link.
- [x] Use record identity and item kind for destinations, so a title is not the stored identity.
- [x] Support keyboard selection, cancellation, empty results, loading errors, and retry.
- [x] Preserve saved links through the editor's HTML and supported copy/export paths.
- [x] Keep the URL builder ready to extend with precise destinations later.
- [ ] Add links to a specific passage, block, or place inside a note.
- [ ] Add links to a specific node/card inside a Knowledge Web.
- [ ] Add links to a specific event inside a Timeline.

The three precise-destination features were explicitly deferred by the user. Their next stage needs persistent destination identities, picker UI for those identities, and navigation that reveals the destination.

Implementation: `src/components/editor/slashCommands.js`, `src/components/editor/LibraryLinkInsertHost.jsx`, `src/lib/libraryLinks.js`, and `src/components/navigation/LibraryLinkBoundary.jsx`. Checks: `tests/dom/libraryLinks.test.jsx`.

## 4. /Quote

- [x] Add **Quote** to the slash-command menu.
- [x] Convert the current paragraph to the same blockquote used by the existing menu.
- [x] Remove the command text during conversion and retain the paragraph's content and formatting.
- [x] Preserve the **Quote** option in the six-dot block menu.

Implementation: `src/components/editor/slashCommands.js` and `src/components/editor/TEXT_EDITOR_MACHINERY.jsx`. Checks: `tests/dom/slashQuote.test.jsx`.

## 5. Backspace at bullets and numbered items

- [x] At the start of an item's text, remove the list marker first instead of consuming the space above it.
- [x] Preserve the text, bold/italic formatting, and adjacent quote content.
- [x] On the next Backspace, join the resulting paragraph to the preceding text instead of recreating a bullet or numbered item.
- [x] Preserve sensible behavior for nested lists, later paragraphs inside an item, selected text, and ordinary character deletion.
- [x] Handle pasted list content and list-exit boundaries without accidentally creating a new numbered item.

Expected sequence: list item → ordinary paragraph → merged preceding text. The second Backspace must not produce a duplicate item.

Implementation: `src/components/editor/ListBackspaceExtension.js` and `src/components/editor/ListExitBoundaryExtension.js`. Checks: `tests/dom/listBackspace.test.jsx`, `tests/dom/listExitBoundaries.test.jsx`, and `tools/run-list-backspace-proof.cjs`.

## 6. Five-second note deletion countdown

- [x] When deleting a note from its editor, require a full five-second wait.
- [x] Display the countdown and smoothly reveal the Delete button when the wait finishes.
- [x] Guard the action itself, including keyboard confirmation, so the countdown cannot be bypassed.
- [x] Keep cancellation available during the wait.
- [x] Leave deletion from Library Home without this five-second delay.

Implementation: `src/components/ui/confirm-dialog.jsx` and `src/components/knowledgeweb/NoteEditorPanel.jsx`. Checks: `tests/dom/confirmCountdown.test.jsx`.

## 7. Pointers

### Creation, persistence, and cancellation

- [x] Select source text and press **Cmd+P** to start pointer mode.
- [x] Show a small, nonblocking prompt asking for the target text.
- [x] Select target text or whole text blocks and press **Cmd+P** again to complete the pointer.
- [x] Enable this interaction for notes without hijacking the shortcut in unrelated editors.
- [x] Attach pointer identities to text marks so connections follow edits rather than relying on saved character offsets.
- [x] Preserve pointer data through saved HTML and supported rich-note backups.
- [x] Support undo/redo, cancellation with Escape, and cleanup when an endpoint is deleted.
- [x] Avoid duplicate connections, overlapping endpoints, and repeated shortcuts from held keys.

### Line routing and scroll stability

- [x] Use a subtle gutter line for distant passages.
- [x] Use a direct diagonal connection for nearby lines.
- [x] Use a curved bounce connection for passages on the same line.
- [x] Choose the left or right gutter by the shortest combined distance from the endpoints; right-side passages can route through the right gutter.
- [x] Keep the line rigidly attached to the text while scrolling, without a lagging viewport overlay.
- [x] Recalculate routing after text layout changes, resizing, zooming, font/image loading, and dropdown transitions.
- [x] Connect dropdown endpoints directly at their disclosure triangles instead of below their titles.

### Navigation and quick removal

- [x] Clicking a line smoothly navigates to its exact target.
- [x] Reveal necessary nested dropdowns before completing the scroll.
- [x] Keep manual dropdown closing under the user's control.
- [x] Provide controls to navigate to either endpoint and remove a connection.
- [x] Clicking/selecting an arrow and pressing **Backspace** deletes the connection without deleting the connected text.
- [x] Make connection removal undoable.

Implementation: `src/components/editor/PointerExtension.js`, `PointerLayer.jsx`, `pointerModel.js`, `pointers.css`, and `spotlightJourney.js`. Checks: `tests/dom/pointers.test.jsx` and `tools/run-pointer-proof.cjs`.

## 8. Echo Copy

**Feature name: Echo Copy.** Its defining behavior is the user's placeholder example: the visible note stays unchanged, but a copied placeholder becomes the linked passage.

- [x] Add the small check-mark toggle to the pointer controls and name it **Echo Copy**.
- [x] Make expansion opt-in for each connection.
- [x] Replace the placeholder in the clipboard snapshot with the current linked passage, preserving its rich formatting and paragraph structure.
- [x] Leave the note's on-screen text and stored content unchanged.
- [x] Apply expansion to supported selection/block copying and the full-page **Copy** button, in both HTML and plain text.
- [x] Persist the setting and support undoing the toggle.
- [x] Prevent recursive expansion cycles and conflicting overlapping placeholders.
- [x] Avoid expanding an incomplete/partial placeholder selection.

Implementation detail: the existing pointer model stores the initiating placeholder as the source and the linked passage as the target. Echo Copy replaces the placeholder with that passage; this matches the supplied copy/paste example even when informal source/target wording is reversed.

Implementation: `src/components/editor/pointerClipboard.js`, `PointerExtension.js`, `PointerLayer.jsx`, `BlockDragExtension.js`, and `src/components/notes/copyNotePage.js`. Checks: the **Echo Copy** cases in `tests/dom/pointers.test.jsx`.

## 9. Note zoom and full-page copying

- [x] Add view-only note zoom, separate from the existing text-size slider.
- [x] Support Chromium/Electron trackpad pinch events and two-touch pinch handling, preserve the focal point, clamp zoom to 50–300%, and reset it when switching notes.
- [x] Add the top-left **Copy** button for the entire current page, including its title and offscreen content.
- [x] Supply both HTML and plain-text clipboard content, including enabled Echo Copy expansion.
- [x] Keep copy confirmation as plain, transparent text near the top left, slightly below the Copy button.
- [x] Avoid confirmation overlap, click interception, and stacked duplicate messages.
- [ ] Verify zoom with actual trackpad and touchscreen gestures. Automated event tests passed; physical gestures have not been confirmed in this record.

Implementation: `src/components/notes/useNoteZoom.js`, `copyNotePage.js`, `src/components/knowledgeweb/NoteEditorPanel.jsx`, and `src/components/utils/CopyConfirmation.jsx`. Checks: `tests/dom/noteZoom.test.jsx` and `tests/dom/copyConfirmation.test.jsx`.

## 10. Traditional Book Index and clickable entries

- [x] Use the name **Index** in the note UI.
- [x] Present alphabetical groups in a traditional column layout with indented subentries.
- [x] Display page references/ranges and distinguish primary discussion pages with bold numbers.
- [x] Support topic search, curated entries, primary references, and see-also entries.
- [x] Preserve curated entries when saving/reopening notes and remap references when pages move.
- [x] Make entry text and page references clickable.
- [x] Flip to the correct page, reveal required dropdowns, and smoothly navigate to the actual heading/passage.
- [x] Keep ordinary entry text's color, underline, and font weight unchanged when making it clickable.

Implementation: `src/components/notes/BookIndex.jsx`, `bookIndexModel.js`, `BookSurface.jsx`, and `src/components/knowledgeweb/NoteEditorPanel.jsx`. Checks: `tests/dom/bookIndex.test.jsx` and `tools/run-index-navigation-proof.cjs`.

## 11. Editing while Cmd+F is open

- [x] Allow clicking in the note to place the caret while Find remains open.
- [x] Allow typing, rich paste, and undo in temporarily revealed dropdown content.
- [x] Keep content editable after deleting the last visible search match.
- [x] Recount matches after edits without stealing the caret or automatically scrolling to another result.
- [x] Reveal/scroll to another match only on explicit Find navigation, and preserve manual dropdown closing until the next explicit navigation.

Implementation: `src/components/editor/findInEditor.js`, `EditorFindBar.jsx`, and `CollapsibleToggleExtension.js`. Checks: `tests/dom/findDropdowns.test.jsx` and `tools/run-find-editing-proof.cjs`.

## 12. Scripture Search — foundation completed

### Home layout and locked entry

- [x] Review API.Bible documentation as the basis for the future integration; retain the relevant references below.
- [x] Remove the **Choose a chapter** creation tile and Bible Studies column from Library Home.
- [x] Let Knowledge Webs, Notes, and Timelines occupy the available space in three columns.
- [x] Retire the old new-study chapter-picker entry path and restore obsolete picker tabs to Library Home.
- [x] Preserve existing saved study records and their routes.
- [x] Add a second scripture field beside the existing library search field.
- [x] Show the locked label **“unlock scripture reading here”** until a key is saved.
- [x] Keep animated glow, mist, and particles on the locked header pill, with reduced-motion support.
- [x] Open a dedicated API-key popup instead of asking for the key inside the header pill.
- [x] Keep automatic startup checks quiet when an older running main process lacks a new handler.

### Minimal API-key popup — final design

- [x] Replace the square book icon with the supplied **Free Use Bible API** logo.
- [x] Link **Free Use Bible API** to `https://bible.helloao.org/docs/?ref=faith.tools`.
- [x] Keep this website as a placeholder link; the planned provider remains API.Bible.
- [x] Remove **“BEX · SCRIPTURE”**, **“Unlock scripture reading”**, and **“Bring your API.Bible key. Make room for the Word.”** from the popup.
- [x] Remove the backdrop's black fade/dimming and blur.
- [x] Enlarge the card to 600 px on desktop, with responsive sizing and reachable controls on short screens.
- [x] Keep mouse-controlled 3D tilt and return the card to rest when the pointer leaves.
- [x] Remove the popup's cursor glow, liquid mist, and particles entirely, following the final request to **“just keep the tilt.”**
- [x] Preserve keyboard focus, Enter submission, Escape dismissal, discarded drafts, and safe busy states.

### Protected setup and restart

- [x] Mask the key while entering it and store it encrypted using Electron's protected storage.
- [x] Keep credentials outside the note/library vault and backups.
- [x] Expose configuration status rather than the saved key to the renderer.
- [x] Allow replacement/removal without revealing the saved key.
- [x] Show a friendly recovery message when an explicit save needs a newer desktop process.
- [x] Add **Restart BEX** to that recovery state.
- [x] Wait for pending/debounced entity saves before restarting and refuse restart after unresolved save failures.
- [x] Fully quit and relaunch Electron in a new process, preserving startup arguments and working directory.
- [x] Run the existing close-time backup, database shutdown, and service cleanup during restart.
- [x] Verify restart and setup using an isolated Electron fixture with temporary credentials rather than the user's vault.

Implementation: `src/components/scripture/ScriptureSearch.jsx`, `scriptureSearch.css`, `src/components/shaders/Card3DTilt.jsx`, `src/lib/scriptureSetup.js`, `restartBex.js`, `desktop/scripture-settings.cjs`, `scripture-ipc.cjs`, `app-restart-ipc.cjs`, `main.cjs`, and `preload.cjs`.

### Scripture Search — next stage, not implemented

The user explicitly requested the foundation first and deferred the actual searching/reading setup. These are the next-stage tasks for that feature, not claims about current behavior.

- [ ] Authenticate/validate a saved key against API.Bible instead of only validating and storing its local input.
- [ ] Load available Bible/translation metadata and provide translation selection.
- [ ] Connect the scripture field to real API.Bible reference/text search.
- [ ] Display search results and open the selected passage in a scripture reading UI.
- [ ] Retrieve actual passage content; section-list metadata alone does not implement reading.
- [ ] Handle translations without section support and ordinary loading, empty-result, invalid-key, and network-error states.
- [ ] Keep API requests in the desktop main process and preserve the key's existing protection.
- [ ] Verify real authenticated search and reading end to end with an authorized API key, including applicable attribution/licensing requirements.

Exact reader layout and detailed search behavior still need the user's next-stage specification. Saving a key currently does **not** authenticate it, request scripture, return results, or start Online Mode.

## 13. Earlier popup designs — completed and superseded

These changes are recorded for completeness. They must not be mistaken for pending requests.

- [x] Initially show **“paste your api key here”** in a glowing locked header field; later replace its text with **“unlock scripture reading here”** and move entry into a popup.
- [x] Build the initial premium popup with scripture headings and a book/key icon; later replace it with the requested minimal logo/link presentation.
- [x] Add animated/randomized liquid cursor mist and particles to the tiltable popup.
- [x] Move that effect behind text/controls, reduce it to 40% opacity, and keep the disabled Save button opaque.
- [x] Subsequently remove that popup effect entirely at the user's request. **Current state: tilt only.** Header-pill effects remain separate.

## 14. App description and logo

- [x] Include a three-sentence description using specific feature names.
- [x] Identify and link the app's existing logo file: [BEX logo](../public/logo.png), used by the activation/privacy UI. This is separate from the Free Use Bible API logo.

BEX organizes study in Notes, Knowledge Webs, and Timegraphs, with /Link connecting material across the library.
Pointers connect passages visually, Echo Copy expands linked placeholders in copied text, and the Book Index opens the relevant page and section.
Scripture Search currently provides secure API-key setup through the “unlock scripture reading here” pill, with scripture search and reading planned for the next stage.

## 15. Verification status and remaining checks

### Current audit, 8 October 2026

- [x] Inspect the current implementation rather than relying only on earlier completion messages.
- [x] Run the 13 focused DOM suites below: **113 tests passed**.
- [x] Run the seven Node suites below: **29 of 30 tests passed**; the sole failure is identified separately.
- [x] Record that the isolated native Scripture Search proof passed in the preceding implementation work, including tilt without popup glow and a full-process restart.
- [x] Record that the preceding implementation's production build and changed-file lint checks passed.
- [ ] Update the outdated source-text assertion in `tests/workspaceNavigation.test.js:60`. It expects a literal `className="… z-20"` on Card3DTilt, while the shared component now chooses its glow layer conditionally. This is a test mismatch; the native popup tilt-only proof passed.
- [ ] Complete the actual-device pinch verification described in section 9.
- [ ] Complete future precise library linking and live scripture integration after the user specifies the next-stage behavior.

The DOM run emitted React `act(...)` warnings while passing. These are test-environment warnings, not a claim that every physical interaction has been checked. No new native proofs or production build were rerun for this documentation-only audit.

DOM checks:

```sh
npm run test:dom -- \
  tests/dom/slashQuote.test.jsx \
  tests/dom/libraryLinks.test.jsx \
  tests/dom/confirmCountdown.test.jsx \
  tests/dom/timegraphNewEvent.test.jsx \
  tests/dom/timegraphDescription.test.jsx \
  tests/dom/listBackspace.test.jsx \
  tests/dom/listExitBoundaries.test.jsx \
  tests/dom/pointers.test.jsx \
  tests/dom/bookIndex.test.jsx \
  tests/dom/findDropdowns.test.jsx \
  tests/dom/noteZoom.test.jsx \
  tests/dom/copyConfirmation.test.jsx \
  tests/dom/scriptureSearch.test.jsx
```

Node checks:

```sh
node --test \
  tests/timegraphToday.test.js \
  tests/scriptureSettings.test.cjs \
  tests/appRestart.test.cjs \
  tests/shutdownBackup.test.cjs \
  tests/localEntitySaveBarrier.test.js \
  tests/workspacePickerRetirement.test.js \
  tests/workspaceNavigation.test.js
```

Audit logs: `/tmp/bex-plan-checks.log` and `/tmp/bex-plan-node-checks.log`.

Native proof tools available for focused follow-up: `tools/run-pointer-proof.cjs`, `run-list-backspace-proof.cjs`, `run-index-navigation-proof.cjs`, `run-find-editing-proof.cjs`, `run-zoom-controls-proof.cjs`, and `run-scripture-setup-proof.cjs`. The existence of a proof tool alone is not a record of it passing in this audit.

## Scripture setup architecture and reference notes

Library Home has three columns (Knowledge Webs, Notes and Timelines) and a second header field for scripture. Without a saved credential, the glowing pill says “unlock scripture reading here”. Clicking it opens a centered API-key dialog; Enter or Save API key saves the masked key. Once configured, the key button opens the same dialog for replacement or removal. Dismissing the dialog discards the draft and returns focus to the pill. This first stage saves setup only: it does not authenticate the key, start Online Mode, request Bible content or return search results.

The locked pill has two drifting mist layers, four moving wisps and sixteen floating light particles, with a static glow when reduced motion is enabled. A failed automatic startup check leaves the pill quietly locked. If the renderer has updated ahead of an already-running desktop process, submitting a key explains that BEX needs one restart; raw Electron transport errors are never shown.

The enlarged popup has a transparent backdrop without dimming or blur. It reuses the home cards' mouse-driven tilt without a cursor glow or particles. Other cards keep their existing glow. The popup stays inside small viewports and disables tilt for touch or reduced motion. It uses the supplied Free Use Bible API logo and links its title to `https://bible.helloao.org/docs/?ref=faith.tools` through BEX's existing external-link bridge. This is a placeholder link only; it does not change the planned API.Bible provider or send the key to that website.

The recovery message includes a **Restart BEX** button. Before restarting, the renderer waits for debounced entity saves and refuses to close after an unresolved save failure. A trusted main-frame IPC request schedules Electron `app.relaunch()` once, then calls normal `app.quit()` so the existing close-time backup, database close and service cleanup run. The new process preserves the current executable, arguments and working directory; it is not a page reload. An older process that predates this IPC handler needs one initial normal quit/reopen to load the desktop update.

Restart behavior follows [Electron's relaunch API](https://www.electronjs.org/docs/latest/api/app#apprelaunchoptions). The popup's earlier liquid-glow design is superseded; it is not part of the active UI.

The desktop main process saves the key with Electron safeStorage in `scripture-credentials.json` under installation userData, outside the vault and exports. The renderer can read only the configured status and submit a replacement or removal. No plaintext fallback is allowed. Old `/Study?new=1` picker tabs become Library Home tabs; saved chapter links and study history remain readable, and no study data is deleted.

## API.Bible references for the next stage

- [Authentication](https://docs.api.bible/quick-start/authentication/): requests use `https://rest.api.bible/v1` and the `api-key` header. Keep future requests in the desktop main process.
- [Book sections](https://docs.api.bible/guides/sections/): `GET /bibles/{bibleId}/books/{bookId}/sections` lists section metadata, not verse content. Not every Bible supports sections.
- [Search](https://docs.api.bible/guides/search/): scripture search is scoped to a Bible ID. Translation selection, requests, results and reading are deferred to the next feature stage.

Checks: `node --test tests/scriptureSettings.test.cjs tests/workspacePickerRetirement.test.js tests/workspaceNavigation.test.js`, `npm run test:dom -- tests/dom/scriptureSearch.test.jsx tests/dom/workspaceTabIdentity.test.jsx`, and `node tools/run-scripture-setup-proof.cjs`. The native proof uses temporary credentials and offline fixture records, never the user's vault.
