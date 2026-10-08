---
name: Berean DB connection resolution
description: Which env var the Berean app's DB actually resolves to, and the trap that two of them point at different live databases.
---

# Berean DB connection resolution

`server/db.ts` resolves the connection string as
`Neon_connection_string || BEREAN_DATABASE_URL || DATABASE_URL`.

**The trap:** `Neon_connection_string` and `BEREAN_DATABASE_URL` are NOT the same
database in this environment — they point at *different* live Postgres instances.
The running server (and migrations via `runDataMigrations` at startup) use
`Neon_connection_string`. `BEREAN_DATABASE_URL` is a separate, stale DB.

**Why this matters:** if you verify schema/data with an ad-hoc `pg` client, you
MUST use the same precedence (`Neon_connection_string` first), or you'll query the
wrong DB and see stale/old schema even though the migration log said "Applied".

**How to apply:** for any direct DB inspection of the Berean study/brain tables,
connect with `process.env.Neon_connection_string || process.env.BEREAN_DATABASE_URL`.
Note `Neon_connection_string` is not always listed in the visible secrets but is
present in the environment.
