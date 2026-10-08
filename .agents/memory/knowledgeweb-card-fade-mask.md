---
name: KnowledgeWeb card description fade mask
description: Why the card bottom-fade "spans full width" bug is a measurement bug, not a CSS mask-composite bug, and how to limit a fade to measured content width robustly.
---

# Limiting a CSS fade mask to measured tag-row width (CanvasCard)

The card description gets a bottom fade so overflow text trails off. Requirement: the
fade must cover ONLY the bottom-left tag-pill width — text to the RIGHT of the tags
stays fully visible, with no hard line.

## The mask technique is NOT the bug
Two mask layers — a vertical bottom-fade plus a horizontal `transparent→opaque` limit —
composited as a UNION render correctly with `mask-composite: add` (standard) +
`-webkit-mask-composite: source-over` (webkit). Union = visible wherever EITHER layer is
opaque, so the right side stays visible. `intersect`/`source-in` is the wrong operator
(fades the whole left column). Verified empirically in a throwaway static HTML page.

**Why this matters:** I burned multiple attempts suspecting the composite syntax. It was
a red herring. When a "limit-to-width" mask appears to fade full width, suspect the
measured width, not the compositing.

## The real failure mode: a fragile width measurement
Limiting the fade needs the first-row tag width. A fragile DOM measurement (absolute
`offsetTop < offsetHeight` filter, absolute `offsetLeft`) can silently measure 0 when the
offsetParent isn't what you assume → code falls into the no-tags full-width-fade branch →
the bug. `tagsWidth = 0` and `tagsWidth = ~full-width` both look identical on screen.

## How to apply (robust recipe)
- Isolate the first row with a RELATIVE comparison: `span.offsetTop <= spans[0].offsetTop + 1`
  (valid regardless of offsetParent), and measure widths as `(offsetLeft - baseLeft) + offsetWidth`.
- Seed `useState` with (and fall back to) a character-based estimate so the value is NEVER
  0 while tags exist — the limited-fade branch must key on `tags.length > 0`, never on
  `tagsWidth > 0` (which reintroduces the full-width fallback).
- Re-measure on geometry change with a `ResizeObserver` on the tag container: wrapping
  (hence first-row width) depends on card width (cards are resizable) and on late
  web-font (Rajdhani) reflow. A deps array of just the tag list goes stale on resize.
- `offset*` metrics are pre-transform layout px, so the canvas `transform: scale(zoom)`
  needs NO `/zoom` correction here (unlike `getBoundingClientRect`).
