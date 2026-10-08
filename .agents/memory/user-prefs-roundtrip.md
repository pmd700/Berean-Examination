---
name: User preference round-trip & nav refresh
description: How arbitrary user preference flags persist into users.metadata and how the auth context must be refreshed for nav/gated UI to react.
---

Arbitrary user-preference fields (e.g. `mind_view_enabled`) are NOT columns — they
flow through `base44.auth.updateMe({...})` → `PUT /api/auth/me`, where unknown keys
land in `users.metadata` via the `...rest` spread, then come back **flattened to
top-level** alongside the real columns. `GET /api/auth/user` flattens the same way
(`...meta`). So a new boolean pref needs no schema change — just send it and read it
off the user object.

**Why this matters / the gotcha:** UI that gates on such a flag must read it from a
source that actually re-fetches after a save. `AccountCenter.checkAuth()` does
`authUser || base44.auth.me()`, which prefers the **stale** auth-context user and does
NOT pull fresh metadata. After saving settings, call the context's `checkAppState()`
(re-fetches `/api/auth/user` and `setUser`) — not `checkAuth()` — so gated nav (e.g.
`RadialMenuCluster` reading `useAuth().user.<flag>`) updates without a reload.

**How to apply:** when adding a preference that toggles navigation or any component
reading `useAuth().user`, wire the settings `onUpdate` to `checkAppState()` and keep
the local page state in sync via a `useEffect([authUser])`.
