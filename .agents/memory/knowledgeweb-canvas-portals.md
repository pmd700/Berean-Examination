---
name: KnowledgeWeb canvas portals
description: Why popovers/pickers/tooltips over the KnowledgeWeb/MindView canvas must portal to document.body
---

Any floating UI (link/keyword pickers, hover tooltips, popovers) that should
appear over the KnowledgeWeb canvas must be rendered via
`ReactDOM.createPortal(..., document.body)` and positioned with viewport
coordinates (from the trigger's `getBoundingClientRect()`), NOT with
`position:absolute`/`fixed` inside an in-canvas container.

**Why:** the canvas content wrapper uses `transform: translate(...) scale(zoom)`.
A CSS transform on an ancestor makes descendant `position: fixed` resolve against
that transformed ancestor (not the viewport) and scales/offsets absolutely
positioned children — so an in-tree popover renders off-screen or effectively
invisible. Observed symptom: clicking the toolbar keyword/link buttons made the
screen "go black". The app's z-index ceiling is `z-[100000]`; portaled modals use it.

**How to apply:** when adding overlays anywhere under `src/pages/KnowledgeWeb.jsx`,
`src/pages/MindView.jsx`, or `src/components/editor/RichTextEditor.jsx` (and the
canvas card/section components), portal to `document.body` and compute a fixed
viewport position from the trigger's bounding rect.
