# Attachment viewers

Reviewed for BEX on October 10, 2026. Files are imported into the encrypted local vault. A note stores the canonical `bex-media://library/file-<UUIDv4>.<extension>` reference and file metadata; viewers never fetch arbitrary note-supplied remote URLs. Compact filename icons are the default. PDF thumbnails, inline audio controls, and video first-frame previews are opt-in note presentation choices.

## Existing engines and compatibility

- PDF rendering uses [React-PDF 10.5.0](https://github.com/wojtekmaj/react-pdf/tree/v10.5.0), the latest 10.x release, wrapping Mozilla PDF.js. Its [package manifest](https://github.com/wojtekmaj/react-pdf/blob/v10.5.0/packages/react-pdf/package.json) accepts React 18 and pins `pdfjs-dist` to **5.4.296**. React-PDF 11 requires React 19, so adopting it would require a separate app migration. BEX supplies navigation, zoom, and a password form around the existing renderer.
- Audio and video use Chromium's native HTML media controls, decoder pipeline, keyboard interaction, seek, volume, and video fullscreen support. BEX already ships this engine through Electron; no custom media decoder or streaming engine is introduced. See [Chromium audio/video implementation](https://www.chromium.org/audio-video/) and the [HTML media element specification](https://html.spec.whatwg.org/multipage/media.html).
- Browser-supported codecs depend on Electron's Chromium build and the container/codec combination. A media error leaves the **Open in default app** action available. Files outside PDF/audio/video go to the default app automatically.

## Local assets and licensing

React-PDF is MIT-licensed; PDF.js is Apache-2.0-licensed. Both allow application use and redistribution subject to their notices. Their unmodified installed packages supply the actual code and license texts. `tools/vite-pdf-assets.mjs` emits both top-level license texts plus the packaged licenses/notices in the standard-font and WASM folders into `dist/pdf-assets/`; these resources are also served locally during development. Chromium/Electron's existing distribution notices continue to apply to native media playback. Primary license sources: [React-PDF MIT license](https://github.com/wojtekmaj/react-pdf/blob/v10.5.0/LICENSE), [PDF.js Apache license](https://github.com/mozilla/pdf.js/blob/master/LICENSE), and [Electron license](https://github.com/electron/electron/blob/main/LICENSE).

The worker uses React-PDF's documented local `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)` integration. Vite bundles that exact worker with the renderer. CMaps, standard fonts, and JPEG 2000 WASM resources are copied from the same installed PDF.js package. This avoids a CDN, upload, third-party viewer service, or network dependency when opening a vault file. See [React-PDF worker and rendering-resource documentation](https://github.com/wojtekmaj/react-pdf/tree/v10.5.0#configure-pdfjs-worker).

## Security controls

- Renderer viewers accept only canonical vault URLs; the main-process media protocol performs authoritative path, origin, vault-lock, encryption, range, and MIME validation. No external PDF URL, file-system path, `iframe`, or embedded HTML document is rendered.
- PDF text is selectable, but annotation layers and interactive PDF forms are disabled. BEX never creates PDF.js's scripting manager, executes document actions, or honors PDF links. `isEvalSupported: false` is also supplied to PDF.js.
- The [2024 Mozilla advisory](https://github.com/mozilla/pdf.js/security/advisories/GHSA-wgrm-67xf-hhpq) affected versions through 4.1.392 and was patched in 4.2.67. The [July 2026 Mozilla advisory](https://github.com/mozilla/pdf.js/security/advisories/GHSA-hq66-cqwq-w95j) describes versions starting at 5.6.83, with a patch in 6.2.108 and disabling document scripting as a workaround. The pinned 5.4.296 version is outside both stated affected ranges. This is a current advisory check, not a guarantee against future vulnerabilities; review upstream advisories when updating.
- Media never autoplays. Closing the dialog stops playback and releases its media source. Vault-lock notifications immediately remove previews and close the viewer. Newly mounted previews check the current vault status before displaying media, so closing a viewer during lock cannot remount its preview.
- The OS action passes only the vault reference to `bexDesktop.openLocalFile`. The main process decrypts to its controlled temporary export directory and asks the operating system to open that copy. Files opened by a separate application remain governed by that application's behavior.

## Verification

`tests/dom/attachmentViewer.test.jsx` checks supported-type classification, rejection of remote/malformed URLs, PDF navigation/zoom/security options, opt-in first-page thumbnails and media controls, media/PDF failure states, default-app fallback, password handling, and vault-lock teardown. These tests mock the rendering engine and do not establish actual decoding; the separate Electron proof uses the real PDF worker and valid audio/video fixtures. A production Vite build verifies the bundled worker and local rendering assets.

## Vault and note behavior

Typing `/file` opens BEX's native multiple-file picker. Imports copy the selected files into the current library; moving or deleting the original source afterwards does not affect the attachment. The default note block is an icon and filename. Its options menu offers **Show preview** for PDFs, audio, and video, and retains that choice in the note. Clicking those formats opens the in-app viewer. Other formats open directly in their default system application.

Vault copies use generated UUID names under `Media/Documents`, `Media/Audio`, `Media/Video`, `Media/Images`, or `Media/Files`. File names and MIME metadata are encrypted inside each attachment header, and file contents use authenticated 1 MB chunks so seeking does not require loading a whole video into memory. The per-file import limit is 2 GB. Existing image imports, clipboard screenshots, and drawing/chapter artwork use `Media/Images`; their older URLs continue working after migration. Existing course packages retain their established organization under `Courses`.

Removing an attachment from a note keeps its encrypted vault copy available for undo and other references. The OS action creates a private temporary viewing copy; changes made in another app are not automatically imported into the vault. Temporary viewing copies are cleared on vault lock, library switch, app shutdown, and next startup. Executables and scripts may be stored as attachments but BEX refuses to launch them.

Local database backups now have a matching encrypted `<backup>.media` companion folder with ciphertext integrity checks. Keep that companion with its database backup. Restore recovers missing or corrupted media together with the note database; failed or interrupted replacements preserve the previous media through a recovery journal. Legacy database-only backups remain valid and retain the library's current media. The proof command is `npm run attachment:proof`; it uses a disposable vault and never edits the user's library. It verifies 18 native checks across two Electron launches, with external application launches safely stubbed.
