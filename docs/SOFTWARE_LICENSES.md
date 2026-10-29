# Software notices in BEX

The application displays these notices only at **Sources & Licenses**. No
notices, warnings, or dialogs were added to Study, notes, timelines, or other
working screens.

## Bundled files

`tools/vite-license-assets.mjs` generates these files locally for development
and emits the same files into production `dist/licenses/`:

- `manifest.json`: Electron components, complete runtime license texts, one
  npm license block per selected license type, package lists, copyright lines,
  original declarations, selected alternatives, and review flags.
- `LICENSES.chromium.html`: a byte-for-byte copy of
  `node_modules/electron/dist/LICENSES.chromium.html`. Its SHA-256 and size are
  recorded in the manifest. It is referenced as a separate local file, never
  inlined into JavaScript or the page's HTML. A sandboxed viewer and a download
  link are available on the licenses page.
- `npm-original-notices.txt`: the complete original package LICENSE, COPYING,
  COPYRIGHT and NOTICE files, deduplicated by file location per package, plus
  notices found in embedded components and upstream supplements. The grouped
  display does **not** replace or strip package-specific license variations.

The generator makes no network requests. Notices ship with the app and work
offline. They are application assets, not Vault records or backups.

## Inventory scope and maintenance

The inventory includes all **installed production dependencies and transitive
dependencies** from `package-lock.json`, even if unused code is tree-shaken,
plus packages discovered in either Vite renderer bundle. Development-only
tooling is excluded unless its code is actually bundled. Optional binaries for
other operating systems/CPUs that are not installed are excluded. Versions must
match the lockfile. Build errors surface unsupported license expressions or
license types so dependency changes cannot silently acquire an arbitrary label.

The initial inventory has 638 installed production packages and 12 selected npm
license types. Counts are generated, not hard-coded in the application.

Run `npm run build` after dependency changes, then inspect
`dist/licenses/manifest.json` and its `issues` array. Rebuild **on the target
platform** when preparing a Windows or Linux distribution so the optional
package inventory and original Chromium file come from that platform's
Electron installation. Include the entire generated `dist/licenses/` folder
alongside the renderer assets in any packaged release.

Verification:

```sh
node --test tests/softwareLicenses.test.mjs
npx vitest run --config vitest.config.js tests/dom/softwareLicenses.test.jsx tests/dom/studyFooterNavigation.test.jsx
npm run build
```

## Exact Electron runtime

This inventory targets installed **Electron 43.2.0** / **Node.js 24.18.0**.
The Electron MIT notice is read directly from the installed package. Node.js's
full license, including its bundled third-party notices, and FFmpeg's complete
notice including LGPL-2.1 are extracted from that exact distribution's Chromium
credits. OpenSSL's Apache-2.0 text is from the matching Node release.

`tools/license-sources/provenance.json` records immutable upstream source URLs
and SHA-256 hashes for supplemental texts. Electron's version-pinned `DEPS`
file is retained as evidence of its Node, nan, Squirrel.Mac, Mantle and
ReactiveObjC revisions. Before changing Electron, refresh the source files from
the new tag's pinned dependencies, update their hashes and the expected runtime
versions, and rerun the checks. A version mismatch fails the build rather than
publishing the previous release's notices.

Upstream corrections to the requested license labels:

- **Squirrel.Mac is MIT**, including the version bundled by Electron 43.2.0.
  Its original MIT text is retained rather than substituting the requested
  Apache-2.0 label.
- **Mantle's pinned license is MIT with a separate two-condition Proton
  notice**, rather than a standalone standard BSD-2-Clause license. The
  complete original file preserves both notices.
- **OpenSSL in this Node version is Apache-2.0**. The old OpenSSL/SSLeay dual
  notice is not substituted for the actual current license.

FFmpeg's source-availability note points to
[Electron v43.2.0](https://github.com/electron/electron/releases/tag/v43.2.0),
its exact `DEPS` and its release-specific build instructions. BEX uses the
unmodified dynamically linked FFmpeg library supplied with Electron. If BEX
later distributes a modified runtime, the matching source/patch/build materials
and source-availability arrangements must be reviewed again; the note alone is
not a substitute for satisfying distribution obligations.

## npm choices and review flags

The license page groups by **selected individual license type**, so an AND
combination appears in both applicable lists. Original declarations are retained.

- JSZip 3.10.1 declares `(MIT OR GPL-3.0-or-later)`; BEX records **MIT** as its
  selected option. Its GPL alternative is still flagged for review, and the
  complete upstream dual-license notice is preserved. No AGPL declaration was
  found in this inventory. This is a scan of declarations, not a legal opinion.
- DOMPurify's Apache-2.0 option is selected from `(MPL-2.0 OR Apache-2.0)`.
- Pako requires both MIT and Zlib. Its zlib subdirectory's README contains an
  additional notice, which is included along with its top-level MIT text.
- Victory Vendor requires MIT and ISC; its embedded D3 notices are retained.
- `react-leaflet` and `@react-leaflet/core` use **Hippocratic-2.1**, which
  includes additional use conditions. These are flagged separately from GPL.
- A few published packages omit a complete license/copyright file. The
  generator retains their SPDX declaration and author metadata, includes the
  selected full license type, and flags missing original attribution for review
  rather than inventing an owner/year. Missing notices were retrieved from
  pinned upstream releases where available; those copies and their provenance
  are checked in. Current unresolved originals: `dlv@1.1.3`,
  `eastasianwidth@0.2.0`, and `react-remove-scroll-bar@2.3.8`.

Existing Bible source permissions, fonts and KaTeX notices remain on the same
dedicated page. This change does not revise Bible licensing or export policy.
