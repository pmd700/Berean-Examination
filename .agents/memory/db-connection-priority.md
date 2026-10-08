---
name: DB connection priority (Neon vs Berean)
description: Which DATABASE URL the app and drizzle actually use in this Repl
---

The app (`server/db.ts`) and `drizzle.config.ts` resolve the DB URL in this order:
`Neon_connection_string` → `BEREAN_DATABASE_URL` → `DATABASE_URL`.

In this Repl **all three are set**. `Neon_connection_string` wins, pointing at a
Neon host (`ep-...-pooler...neon.tech`). `BEREAN_DATABASE_URL` and the
Replit-managed `DATABASE_URL` both point at a *different* host (`helium`).

**Why:** `replit.md` says the override is `BEREAN_DATABASE_URL` — that is **stale**.
Schema changes, `drizzle-kit push`, and any verification query must target
`Neon_connection_string`, or you will "successfully" push/verify against the wrong
database and see empty results on the live one.

**How to apply:** When verifying schema with a raw `pg` script, connect with
`process.env.Neon_connection_string`. No `db:push` npm script exists — use
`npx drizzle-kit push --force`.
