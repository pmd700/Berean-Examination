---
name: ResizeObserver-loop crash on the 3D card (Card3DTilt / HolographicShader)
description: Why the Select Chapter 3D card threw "not an error object" and the real fix
---

# "an exception occurred but the error was not an error object" = benign ResizeObserver loop

Replit's dev error overlay reports a `window` `error` event whose `error` property
is NULL as: "an uncaught exception occurred but the error was not an error object"
(no stack). The canonical source of a null-error window event is the browser's
benign **"ResizeObserver loop completed with undelivered notifications"** (older:
"loop limit exceeded"). It fires when a ResizeObserver callback synchronously
changes layout/size that feeds back into the same observer tick.

**Where it bit us:** `Card3DTilt` wraps content in a `perspective` + `preserve-3d`
container with a WebGL backdrop (`HolographicShader`). The shader's ResizeObserver
called `resize()` synchronously (which writes `canvas.width/height`). Combined with
the 3D ancestor + interaction-driven relayout, this tripped the RO loop on ANY
interaction with the card (hover, clicking Version/Book). It was NOT the Radix
Select `position` (that earlier guess was wrong — large popper dropdowns were a red
herring; the small Version select crashed too).

**Fixes applied (two layers):**
1. Source fix — defer the RO callback's work with `requestAnimationFrame` so it
   can't feed back synchronously. Same pattern already used in `MindView.jsx`'s
   canvas-size observer. Any new ResizeObserver in this codebase MUST defer via rAF.
2. Global safety net — `src/main.jsx` adds a capture-phase `window` 'error'
   listener that `stopImmediatePropagation()` + `preventDefault()` ONLY for messages
   starting with "ResizeObserver loop". Everything else propagates untouched.

**Why:** these RO-loop notifications are benign by spec; the only harm is the dev
overlay misreporting them as a crash.

**How to diagnose next time:** "not an error object" + no stack + fires on
interaction/relayout → suspect a synchronous ResizeObserver callback. grep for
`new ResizeObserver` and ensure each defers with rAF.
