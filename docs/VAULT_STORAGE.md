# Vault storage and backup retention

## Storage investigation — October 19, 2026

The size problem was backup accumulation, not excessive note, image, or PDF storage. The live library uses about 39 MB including the live SQLite database/WAL and encrypted media. Before maintenance, the whole Vault occupied approximately 1.42 GB: 234 database restore points, 29 full media snapshots, and 468 leftover SQLite verification sidecars accounted for nearly all of the difference.

A read-only inventory found 50 notes/books, 14 Knowledge Webs, 389 cards, 311 web connections, 56 canvas objects, 2 timelines, 22 commentaries, 37 highlights, 50 study-parent records, and 8 web folders. Their encrypted entity payloads total about 2.44 MB; the largest encrypted record is 441,312 bytes. These are aggregate sizes/counts, not exported study content. Imported media contributes about 32.6 MB. Courses, Imports, and Exports folders were empty at inspection. Backup history must not be included in the iPhone sync payload.

The database passed `PRAGMA quick_check`. Maintenance used read-only access to the live database, and before/after fingerprints of every database row and every live media file matched. No note, screenshot, PDF, relationship, or encryption key was rewritten. This does not compact or vacuum the running user's database or delete unreferenced media by assumption.

## Recovery archive created before cleanup

The real Vault contains `Backups/Archives/Before-storage-optimization-2026-10-19.tar.xz` (91,604,268 bytes). It preserves all pre-cleanup backup history and a consistent live database snapshot with the live media. All 1,337 archived files were streamed back and verified against their SHA-256/size manifest before maintenance removed any old regular restore points. The archive contains the existing encrypted database/media bytes; archive compression itself is not an additional encryption layer. Preserve the existing vault unlock/recovery credentials.

The complete archive is intentionally kept inside the measured Vault size. It is not uploaded to GitHub or to the cloud. Archive folders are excluded from automatic pruning.

To retrieve an older restore point, extract this archive **outside the working Vault**. Select the desired `Vault/Backups/BEX-...bex-backup.db` and its matching `.db.media` directory if present, and copy only that pair back into the current Vault's `Backups` folder. Use BEX's normal Restore control, which makes an emergency backup first. Do not extract the archive over the working Vault or replace a live `berean.db` while BEX is running. A complete emergency recovery can instead reconstruct a separate Library from the archived `Vault/Database` and `Vault/Media`; verify that separate Library before replacing anything.

## Ongoing behavior

`desktop/backup-storage.cjs` maintains a bounded collection after a new backup has passed database checks and its media companion is published:

- The three newest restore points.
- One newest restore point in each of the last seven UTC calendar days.
- One newest restore point in each of the last four UTC calendar weeks.
- One newest restore point in each of the last six UTC calendar months.

These sets overlap; the normal upper bound is 20 restore points, rather than 234 and growing. The newly verified backup, a backup currently selected for Restore, and future-dated backups are protected even when this temporarily exceeds the normal bound. Unknown files, symlinks, Archives, and unrecognized names are never retention candidates. Older regular restore points eventually expire; the pre-optimization archive remains available separately. Sync and backup are different functions, and neither is unlimited revision history.

Repeated media bytes are hard-linked between verified backup snapshots only. Each snapshot retains its existing manifest and normal restore paths. Live `Media` files remain independent, so editing/deleting a live attachment does not rewrite a historical backup. BEX treats backup snapshots as immutable; do not edit their media files manually. Filesystems that do not support hard links retain safe separate copies instead. Deleting one snapshot does not delete media still referenced by another snapshot.

New backup databases use SQLite DELETE journal mode rather than leaving WAL-mode `.partial-wal` and `.partial-shm` files. Cleanup removes only recognized orphan verification sidecars whose partial database is absent and whose WAL is empty. Nonempty WAL files and active partial databases are retained. A failed storage optimization defers maintenance and leaves the completed new backup available.

The current maintenance retained 13 regular restore points, plus the complete archived history. The Vault's allocated directory size fell from 1,391,360 KiB to 206,260 KiB (approximately 1.42 GB to 211 MB, an 85% reduction), including the recovery archive. This is the directory's allocated-size measurement; APFS cloning, hard-link accounting, and Finder's logical-size display can produce different totals. No claim is made that every reported duplicate byte was a distinct physical disk block before cleanup.

The automatic behavior takes effect when the desktop process next starts with the updated code. A frontend refresh alone does not reload already running Node modules.

## Verification

- `node --test tests/backupStorage.test.cjs tests/shutdownBackup.test.cjs`: rolling retention, UTC periods, unknown/future files, backup-only media deduplication, corruption rejection, manifest validity, protected Restore targets, and empty-sidecar cleanup.
- `node tools/run-local-backup-proof.cjs`: actual encrypted database backup/reopen/restore, emergency snapshot, corruption rejection, rollback, and interrupted-restore recovery; new snapshots must not leave partial SQLite files and must use DELETE journal mode.
- `node tools/run-local-attachment-proof.cjs`: real Electron encrypted screenshot/file persistence, exact file bytes, media backup/restore, lock enforcement, and temporary plaintext-copy cleanup across two launches.
- Production build and scoped lint. All real library maintenance was preceded by the independently verified archive; tests use disposable libraries.

## Remaining mobile preflight work

The active data is substantially below the proposed relay's initial 500 MB database allowance. That is a size observation, not deployment approval: encrypted transport overhead, protocol history, asset chunking, provider terms, and long-term growth must still be measured. The phone model, iOS version, and phone Lockdown Mode setting have not been supplied. Schema/dependency coverage and the actual-device feasibility tests in the main rollout plan remain open.
