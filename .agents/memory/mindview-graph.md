---
name: Mind View force-graph
description: How the dependency-free Mind View graph is built and tuned, and why preview screenshots can't show it.
---

# Mind View force-graph (`src/pages/MindView.jsx`)

Dependency-free SVG spring-electrical layout on a `requestAnimationFrame` loop with a cooling `alpha` (no d3/cytoscape in the project).

## Live force tuning is via refs, not constants
The three user-tunable forces (repel strength, link distance, spread/center) are seeded from module-level defaults but driven **live through refs** (`repelRef`/`linkDistRef`/`centerRef`) read inside the sim loop. Slider `onChange` updates state → effect mirrors to ref + `reheat()`.
**Why:** reading the sliders from refs lets changes take effect mid-simulation without tearing down/recreating the rAF loop (which `startSim`'s `useCallback` dep on `graph` would otherwise force). Keep new tunables on this same pattern.

## Auth gating blocks preview screenshots
MindView redirects unauthenticated users to `/KeyEntry`, and `/api/mind-view` is `isAuthenticated`-gated (401 unauth). An `app_preview` screenshot of `/MindView` therefore shows the access-key/login screen, not the graph. Verify via build + workflow health + code review; full visual check needs a logged-in session.

## Per-frame lookups must be O(1)
Edge rendering resolves the target node's radius every frame; use the `nodeByKey` memo, never `graph.nodes.find(...)` inside the edge map (that's O(E·N) on top of the O(N²) sim).
