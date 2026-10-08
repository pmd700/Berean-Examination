---
name: pages.config.js is NOT auto-generated here
description: How to register a new page route in this base44 React app
---

`src/pages.config.js` carries a header comment claiming it is AUTO-GENERATED and
"do not edit manually", but **there is no live generator** in this repo (no vite
plugin in `vite.config.js`, nothing writes it). Adding a file under `src/pages/`
does NOT register a route on its own.

**How to apply:** To add a page route, manually edit `src/pages.config.js`: add the
`import X from './pages/X'` and a `"X": X` entry in the `PAGES` object (keep the
existing alphabetical order). Routing uses `react-router-dom`; `createPageUrl(name)`
= `'/' + name.replace(/ /g,'-')`. Add nav entries in
`src/components/navigation/RadialMenuCluster.jsx` (`menuItems` array).
