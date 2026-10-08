# Berean Examination

Berean Examination is a local-first Electron desktop workspace for serious Bible study. The offline application does not require an email address, Internet account, hosted database, or licensing server.

## Current desktop foundation

- User-chosen Berean Library folder with remembered location and recovery when it moves.
- Offline machine-bound activation signed by David's separate private tool.
- One local owner stored in encrypted SQLite.
- Automatic macOS protected-storage unlock with an optional local PIN and recovery code.
- Local Knowledge Web, Second Brain, Bible Study, Asset Library, and Chapter Art records.
- Bundled BSB and LSV text plus bundled MAM Hebrew for Old Testament Interlinear Mode.
- ESV and KJV reserved for a future optional Online Mode; their API code is dormant.
- Encrypted internal backup and rollback-safe restore proofs.

Activation authorizes the installation. It does not identify the owner, unlock private study data, or replace the optional PIN/recovery system.

## Development commands

```bash
npm run desktop:dev
npm run build
npm run desktop:built
```

Focused verification:

```bash
npm run entity:route-proof
npm run entity:proof
npm run study:proof
npm run privacy:proof
npm run backup:proof
npm run asset:proof
npm run chapter-art:proof
npm run local-mam:proof
npm run online-mode:proof
```

## Storage boundary

Private records live in encrypted SQLite inside the selected Berean Library. Protected images live in its `Media` folder. Internal backups are restricted to its `Backups` folder. The application should not depend on Auth0, Replit login, Neon, PostgreSQL, or Base44 cloud services.

## Dormant Online Mode

The preserved future AI interfaces and provider helpers live under `src/ai-spine`. Nothing there is imported by Offline Mode. Any future Online Mode must be optional, visibly enabled by the owner, and unable to become a requirement for ordinary local use.

## Known unfinished release work

- Rename and simplify the remaining Base44-era local compatibility layer after its callers are verified.
- Finish password-protected portable `.berean` files and whole-library Media handling.
- Build the local video-course foundation.
- Resolve the recorded typecheck/lint/test backlog.
- Create and test the macOS `.dmg`, then validate Windows separately.

See `vision.md` for product intent and `MIGRATION_PLAN.md` for the current checkpoint and next exact action.
