---
name: cyber-bg clobbers fixed positioning
description: Why a page using `fixed inset-0 cyber-bg` with all-absolute children collapses to a blank/black screen.
---

# `.cyber-bg` overrides `position` and can blank a full-screen page

`.cyber-bg` is defined in a runtime `<style>` block inside `src/Layout.jsx` (not in `index.css`). That block is injected into the DOM after the Tailwind stylesheet, so `.cyber-bg { position: relative }` WINS over Tailwind's `.fixed { position: fixed }` (equal specificity, later source order).

**Symptom:** a page whose root is `fixed inset-0 cyber-bg` and whose children are ALL absolutely positioned (header/panel/svg/legend) renders as a fully black screen — the root collapses to height 0 because it's actually `relative`, and every child is taken out of flow, so nothing forces height. The body's dark background is all you see. (This is exactly how MindView broke.)

**Why it hid:** pages like KeyEntry also use `cyber-bg` but rely on `min-h-screen` + normal-flow content, so the position override is harmless there. The bug only bites a page that depends on `fixed` for its height. MindView is auth-gated, so `app_preview` screenshots show `/KeyEntry`, not the bug.

**Fix used:** force real fixed positioning with an inline style on the root (`style={{ position:'fixed', top:0,right:0,bottom:0,left:0 }}`) — inline styles beat any stylesheet rule regardless of load order. Keeps the `cyber-bg` dot texture.

**How to apply:** any new full-viewport page that combines `cyber-bg` with `fixed`/`absolute` positioning must set position via inline style (or avoid `cyber-bg` on the positioned root), or it will collapse to black.
