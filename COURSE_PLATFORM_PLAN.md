# BEX Course Platform Plan

**Status:** In progress  
**Date:** 2026-08-01  
**Purpose:** Build a safe, offline-first course publishing system that David can operate from his Mac.

## Current Checkpoint

- **Completed:** Added ordered HTTPS mirror addresses to each object in the signed Course catalog and built the provider-neutral web byte reader that GitHub Releases will use. Mirror order is protected by David's existing catalog signature. Only safe HTTPS addresses without embedded passwords or fragments are accepted. Every response must be an exact byte-range response with the expected total size. BEX can pause, persist its exact byte position, reopen, skip an unavailable source, continue through another source, verify the finished SHA-256 fingerprint, and activate the SQLite course only after verification.
- **Result:** Four focused download proofs pass: ordinary pause/restart, storage and damage safety, signed mirror validation, and resume-through-a-different-mirror. The mirror proof paused at 65,536 bytes, reopened at byte 65,536, found the first source unavailable, continued from the second source, reproduced the exact original file, and activated once. A live read-only GitHub proof skipped a deliberately missing release asset and fetched exactly bytes 0–99 from a real working GitHub Release asset. The complete Course Studio export/sign/catalog/rollback/playback proof still passes, focused lint and syntax checks pass, and the production build passes with only the already-known bundle-size warnings.
- **Next exact action:** Create or choose a dedicated public GitHub repository for BEX course releases, then connect BEX to its small signed Stable catalog URL with a last-known-good local cache. Do not upload a real course yet; publish only a tiny disposable signed catalog and file for the first end-to-end proof.
- **Why it matters:** BEX can now safely read course bytes from GitHub, but it still discovers courses only through the local test-catalog folder. The next step replaces that manual folder connection with the real public GitHub catalog while keeping the app usable offline from its last verified copy.
- **Blockers:** David must authorize creating or selecting the public GitHub course repository before anything can be published externally. Course release files will be publicly downloadable. GitHub may throttle excessive bandwidth. The optional private-signing-key backup remains deferred.
- **Date:** 2026-08-01

## 1. Product Decision

Build two desktop experiences:

1. **BEX** — the customer app. It discovers available courses while Online Mode is enabled, downloads chosen courses, verifies them, installs them, and plays them offline.
2. **BEX Course Studio** — a separate private app used only by David. It creates courses, modules, lessons, descriptions, artwork, captions, and versions; validates the material; and publishes updates.

Both apps will use a shared, versioned course-package specification and shared validation code. Course Studio should live in the same source repository at first so the shared rules stay synchronized, but it must have its own app entry point and its own private build. It must never be included in customer releases.

This separation keeps publishing credentials and private signing keys completely out of the customer app.

## 2. What “Permanent Project Files” Means

Video files must not be committed to Git or placed inside every BEX installer. A course may be about 20 GB, which would make source control, app builds, downloads, notarization, and updates painfully large and fragile.

For this project, “permanent” means:

- David keeps the editable source videos and Course Studio project on his own backed-up storage.
- Published video objects are immutable: once published, that exact file is never silently replaced.
- The publishing service keeps versioned course manifests and content objects.
- BEX downloads a verified local copy into the learner’s Berean Library.
- A corrected course is published as a new version instead of modifying an old version in place.

Application updates and course updates remain separate. A spelling correction or new video must not require a new installer.

## 3. High-Level Flow

### David’s publishing flow

1. Open Course Studio.
2. Create or open a course.
3. Add modules and lessons and drag them into order.
4. Add each lesson’s title, description, video, poster, captions, transcript, and optional attachments.
5. Preview the course exactly as a learner will see it.
6. Run validation. Course Studio checks missing files, duplicate IDs, unsupported video, ordering, sizes, and required metadata.
7. Choose a version number and write short release notes.
8. Course Studio fingerprints every file and uploads only files that are not already present.
9. Course Studio creates and cryptographically signs the course manifest.
10. Course Studio publishes the new catalog entry atomically so learners never see a half-uploaded update.

### Learner update flow

1. BEX remains fully usable offline.
2. When Online Mode is enabled, BEX may fetch the small signed course catalog.
3. BEX shows available courses or updates and their download sizes.
4. The learner explicitly chooses what to download. A 20 GB course is never downloaded unexpectedly.
5. Downloads can pause, resume, survive restarts, and recover from network loss.
6. BEX verifies the signature, exact size, and fingerprint of every downloaded file.
7. BEX activates the new version in one safe switch only after the entire update is valid.
8. Playback then works without Internet access.

## 4. Course Manifest v1

The manifest is a small JSON document describing one immutable course version. It is the contract between Course Studio and BEX.

It must include:

- manifest format version
- stable course ID
- course version
- title, description, author, artwork, and language
- publication date and release notes
- minimum compatible BEX version
- ordered modules
- ordered lessons within each module
- lesson title, description, duration, and media references
- optional poster, captions, transcript, and attachments
- every asset’s content fingerprint, exact byte size, media type, and storage path
- total download size
- content-protection information, when enabled
- David’s digital signature

Stable IDs must not be based on titles. Renaming “Introduction” must not erase a learner’s progress or notes.

The manifest is immutable after publication. Any change creates a new course version.

## 5. Local Berean Library Layout

Recommended layout:

~~~text
Berean Library/
  Courses/
    objects/
      sha256/
        ab/
          <full-content-fingerprint>
    manifests/
      <course-id>/
        <version>.json
    installed/
      <course-id>/
        active.json
    staging/
      <course-id>/
        <version>/
    cache/
~~~

Files are stored by their fingerprints. If two course versions use the same large video, BEX stores it only once. The active pointer selects the installed version. New downloads stay under staging until verified, so a failed update cannot damage the currently working course.

The database stores searchable records and user activity; it does not store large video blobs.

## 6. SQLite Design

Migration 14 now provides the local course foundation. Before real packages are installed, Course Manifest v1 must be formalized and proven against these tables so later Course Studio and downloader work share one contract.

Published course records:

- course catalog
- course versions
- course modules
- course lessons
- course assets
- course installations

Private learner records:

- course progress
- course notes
- course bookmarks
- course Knowledge Web links

Published metadata is verified by David’s signature. Personal progress, notes, bookmarks, and Knowledge Web links are encrypted using the existing library privacy system.

All multi-record installs and updates use database transactions. Either the whole course version becomes active, or none of it does.

## 7. Video Playback Architecture

Start with one deliberately boring, reliable format:

- MP4 container
- H.264 video
- AAC audio
- web-optimized file layout for fast seeking

BEX now has a dedicated BEX-only course-media path that supports byte ranges and never loads a complete multi-gigabyte video into memory. The learner sees BEX's own player controls rather than the browser's default MP4 controls. Playback, seeking, pause, volume, speed, fullscreen, Picture in Picture, keyboard controls, locally packaged captions, and resume progress all work without Internet access.

The existing small-image media system is not suitable for course video because it currently handles whole files. Course video receives a separate streaming implementation.

Course Studio may later prepare adaptive HLS/fMP4 versions for multiple quality levels, but that is not required for the first reliable release.

## 8. Course File Integrity, Not Video Encryption

Course videos remain ordinary MP4 files. They do not need privacy encryption, an encrypted backup, or a special streaming-encryption format. BEX verifies David's signed manifest plus every file's exact size and fingerprint before installation, which protects learners from damaged or altered course packages without pretending to provide DRM.

The course-publishing signing key remains separate from the activation signing key and stays only in David's protected macOS Keychain. BEX contains only the public verification key. This signature proves that a course came from David; it does not hide the video.

Private learner-created information such as progress remains protected by the existing library privacy system. That is separate from the published course media.

## 9. Course Studio Experience

Course Studio should feel like a small professional editor, not an admin webpage.

### Main screens

- **Course Library:** drafts, published courses, versions, and update status
- **Course Outline:** module and lesson tree with drag-to-reorder
- **Lesson Editor:** title, description, video, poster, captions, transcript, and attachments
- **Preview:** the learner’s real course screen using the same renderer as BEX
- **Validation:** clear problems and exact fixes
- **Publish:** version, release notes, size, upload progress, and final confirmation
- **History:** immutable published versions and the ability to restore a previous catalog pointer

### Media boundary

David creates and edits videos outside BEX Course Studio, then selects the finished files from his Mac. Course Studio manages titles, descriptions, thumbnails, captions, module and lesson ordering, preview, validation, packaging, and publishing. It does not record, trim, transcode as a creative editor, add effects, mix audio, or replace tools such as OBS, DaVinci Resolve, or CapCut. Any required compatibility conversion must be an explicit publishing check, never a hidden video-editing workflow.

### Safety behavior

- autosave local drafts
- never modify source videos
- warn before removing a lesson that already exists in a published version
- calculate required upload size before publishing
- resume interrupted uploads
- prevent publication until all required checks pass
- display exactly what will change
- keep a local signed copy of every published manifest

## 10. Free Multi-Source Distribution

Use public immutable release files and peer-to-peer delivery rather than a paid cloud database, storage bucket, or CDN. No single host is trusted or required: the signed catalog may list GitHub Releases, an eligible Internet Archive copy, and a BitTorrent source for the same bytes.

Remote structure:

~~~text
catalog/
  stable.json
  beta.json
manifests/
  <course-id>/<version>.json
objects/
  sha256/<fingerprint>
~~~

Large objects are immutable and cacheable. Only the small signed catalog pointer changes. This makes updates fast, minimizes duplicate uploads, and allows safe rollback.

Course Studio holds David's publishing token in macOS Keychain. BEX receives only public read-only locations and can never upload, replace, or publish content. If a host limits individual file size, Course Studio splits the object into numbered immutable pieces and the learner app verifies and reassembles them locally.

## 11. Update Channels

Support two channels:

- **Beta:** David tests a published course update on his own activated BEX installation.
- **Stable:** learners see the approved version.

Promoting from Beta to Stable changes only the signed catalog. It does not re-upload 20 GB of media.

BEX checks course updates only when Online Mode is enabled or when the learner explicitly presses “Check for course updates.” Downloading is always an explicit choice.

## 12. Failure and Recovery Rules

BEX must handle:

- insufficient disk space before downloading
- interrupted or slow connections
- app restart during download
- corrupted or incomplete files
- invalid signatures
- incompatible course versions
- missing external drives
- playback failure for one asset
- rollback to the previous installed version
- safe cleanup of unreferenced objects

Cleanup must use reference counts and a confirmation-safe process. It must never delete a video that an installed course version still uses.

## 13. Phased Delivery

### Phase 1 — Shared contract and local vertical slice

- define Course Manifest v1
- add strict validation and malformed-manifest tests
- add SQLite course tables
- create one tiny local fixture course
- build a minimal Courses screen
- prove module ordering, lesson playback, seeking, progress saving, notes, restart, and offline use

**Exit gate:** a sample course works completely offline after restart and does not load a full video into memory.

### Phase 2 — Private Course Studio

- separate private desktop entry point
- create/edit courses, modules, lessons, and descriptions
- add media, artwork, captions, and transcripts
- drag-to-reorder
- autosave drafts
- preview using BEX’s real course renderer
- export a complete course package to a local folder

**Exit gate:** David can create and revise a course without editing source code.

### Phase 3 — Signing and local publishing simulation

- create the separate content-signing key in macOS Keychain
- sign manifests
- put only the public verification key in BEX
- simulate remote storage with a local publish folder
- prove tampered manifests and media are rejected
- prove atomic install and rollback

**Exit gate:** BEX accepts only complete, authentic course versions created by David.

### Phase 4 — Free multi-source publishing and resumable delivery

- add multiple ordered sources per signed course object
- publish small signed catalogs and eligible course objects as immutable GitHub Release assets
- optionally mirror publicly and non-commercially distributed courses on Internet Archive
- add BitTorrent as a resilient fallback, with learner seeding strictly opt-in
- keep David's publishing token only in macOS Keychain
- split any object larger than a host's asset limit and verify/reassemble it locally
- add signed catalog publication
- add resumable learner downloads
- add Beta and Stable channels
- add disk-space and bandwidth protections

**Exit gate:** a test course can publish from David’s Mac, download to a clean BEX installation, survive interruption, and play offline.

### Phase 5 — Production hardening

- accessibility and keyboard controls
- captions and playback-speed controls
- download management
- update release notes
- uninstall/cleanup with accurate space recovery
- crash recovery
- macOS and Windows codec testing
- legal review for any transcoding tools and media libraries

**Exit gate:** the system passes large-file, offline, restart, corruption, rollback, and cross-platform acceptance tests.

## 14. Decisions That Can Wait

These choices are not blockers for the local course system:

- whether Internet Archive's public/non-commercial terms fit the final course offering
- whether learners will be invited to opt into peer-to-peer seeding
- whether adaptive quality is needed in the first public version
- exact content-encryption key delivery
- whether all learners receive all courses or future course-specific entitlements exist
- Windows publishing workflow

Recommended defaults:

- separate private Course Studio
- one repository with shared course-format code
- MP4/H.264/AAC for the first playback milestone
- signed immutable manifests
- content-addressed storage
- manual course downloads
- catalog checks only during Online Mode
- vendor-neutral local implementation before paying for hosting

## 15. Explicit Non-Goals

- Do not store videos in SQLite.
- Do not commit videos to Git.
- Do not bundle the full course library into the BEX installer.
- Do not put upload credentials in the learner app.
- Do not use a cloud database for learner progress or notes.
- Do not require Internet to watch an installed course.
- Do not silently auto-download multi-gigabyte updates.
- Do not mutate an already published course version.
- Do not reuse the whole-file image loader for video.
- Do not couple activation with recovery of private learner data.
- Do not encrypt ordinary course videos or their backups.
- Do not turn Course Studio into a video recorder or video editor.

## 16. Free Distribution Decision

The permanent operating-cost target for course hosting and delivery is **$0**. Cloudflare R2, Backblaze B2, Amazon S3, and Oracle's small free allowance are not the base architecture because a 20 GB course exceeds or exhausts their permanent free storage.

Use three interchangeable layers:

1. **GitHub Releases:** the small signed catalog and versioned release assets. Keep every asset below GitHub's 2 GiB limit. Treat it as a convenient mirror, not an unlimited guaranteed CDN.
2. **Internet Archive:** a free public mirror only when David owns all required rights and the material is being made publicly and non-commercially available, or after written permission for a different use.
3. **BitTorrent:** a no-hosting-bill fallback seeded by David's Mac and optionally by learners who explicitly opt in. Never silently upload from a learner's computer.

Every source serves identical immutable bytes. The signed catalog declares the expected SHA-256 fingerprint and ordered mirrors. BEX may switch sources while resuming, but it must never activate a course until the complete object passes verification.

Primary sources reviewed on 2026-08-01:

- [GitHub release limits](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)
- [GitHub Acceptable Use Policies](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies)
- [Internet Archive rights and free hosting conditions](https://archivesupport.zendesk.com/hc/en-us/articles/360014759692-Rights)
- [Internet Archive upload limits](https://archivesupport.zendesk.com/hc/en-us/articles/360016700691-Uploading-Troubleshooting)
- [Internet Archive BitTorrents](https://archivesupport.zendesk.com/hc/en-us/articles/360004715251-Archive-BitTorrents)
- [BitTorrent protocol](https://www.bittorrent.org/beps/bep_0003.html)

## 17. Next Exact Action

Create or select a dedicated public GitHub repository for BEX course releases. Add a read-only GitHub Stable-catalog connection to BEX that downloads a signed catalog, rejects any invalid signature or unsafe address, writes only a last-known-good verified cache, and continues showing that cache while offline. Prove the full path with one tiny disposable signed catalog and file before uploading any real course video.
