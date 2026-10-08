---
name: KnowledgeWeb loadWeb concurrency race
description: Why switching webs flickers on cold start and the last-writer-wins token pattern that fixes it.
---

# KnowledgeWeb loadWeb stale-write race

Switching between two Knowledge Webs caused the canvas to "flicker violently"
between both webs' content, calming only after a few seconds — and ONLY right
after app startup, never deep in a workflow.

## Root cause
`loadWeb` in `src/pages/KnowledgeWeb.jsx` is an async function with no
concurrency guard. It sets the active web synchronously, then `await`s three
entity fetches and unconditionally calls `setCards/setConnections/setCanvasObjects`.
During the slow cold-start (Neon) load, the sidebar is interactive while
`loading=true`, so the user can launch a second `loadWeb` before the first
finishes. The two fetches resolve in arbitrary order and each paints its web's
data over the other → flicker. It settles once all in-flight fetches drain
("calms by waiting"). Warm loads deep in a session are too fast to overlap, so
it's startup-specific.

**Why:** un-cancellable concurrent async loads with unconditional state writes
are last-to-resolve-wins, not last-requested-wins.

## Fix (last-writer-wins token)
- `loadSeqRef` (a `useRef(0)`) stamped/incremented at the start of every
  `loadWeb`; also mirror `activeWebIdRef.current = webId` synchronously (the
  effect that syncs the ref from state commits a tick too late).
- After the `await Promise.all`, bail before any setter if
  `loadSeq !== loadSeqRef.current || activeWebIdRef.current !== webId`. Same
  guard inside the independent `CardPlacement.then`.
- Wrap the `Promise.all` in try/catch: a superseded fetch that REJECTS skips the
  resolve-path guard, so swallow it (only log if the load still owns the canvas).
  Without this, a rejected stale load can become an unhandled rejection and, at
  startup, abort the auth-load effect before `setLoading(false)` → app stuck on
  the loading screen.

## How to apply
Any time an async loader writes shared UI state and can be re-invoked before it
finishes (web/note/document switching here), use a monotonic token + live ref
compare instead of trusting the order fetches resolve in. The URL→selection
effect is only an amplifier — it should compare against `activeWebIdRef.current`
/`websRef.current` (live), not its stale eslint-disabled closure values.
