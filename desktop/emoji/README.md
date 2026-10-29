# Local Apple emoji compatibility

BEX keeps the renderer sandbox and context isolation enabled. On Macs where
Apple Color Emoji reports available but paints no pixels, `installAppTypography`
requests a compatibility font through a fixed, trusted-main-frame IPC handler.
Healthy Macs continue using the system font directly; Windows/Linux keep the
existing bundled Noto style.

`font.cjs` repackages this Mac's installed 64px `sbix` PNG artwork into standard
OpenType `CBDT`/`CBLC` tables. `shape.js` asks AppKit to shape the public Unicode
sequence list, and the generator translates that mapping into `GSUB` ligatures
and multiple substitutions. This preserves skin tones, flags, keycaps, ZWJ
sequences, and two-piece mixed-tone artwork. Text remains original Unicode,
including in the editor, clipboard, exports, SVG, and canvas; no image nodes or
saved-document transformations are involved.

The bitmap baseline uses the source font's typographic descender proportion,
so emoji are centered with adjacent text instead of floating above the line.
Cache format version 2 invalidates the earlier baseline. The regression proof
compares actual emoji/text ink centers at 12, 16, 24, 36, 72, and 144 pixels in
normal and bold text, including the 😋 and 😜 faces from the reported issue.

The generated font is approximately 20 MB and cached once in the app's
`userData/Emoji` directory, outside Vault. A system font update invalidates it;
older generated cache files are removed after successful regeneration. Apple
font data is read from `/System/Library/Fonts/Apple Color Emoji.ttc` on the user's
Mac. It is never shipped, put in Git, uploaded, or added to backups. Python and
Xcode are not runtime dependencies. The helper invokes only local AppKit APIs;
it does not automate applications, require Accessibility permissions, disable
Lockdown Mode, or change OS security settings.

If the native helper is unavailable, the bundled Noto font supplies visible
emoji. Startup waits at most five seconds for the native conversion; a later
successful load updates the same font family. No cloud service is involved.

During a development hot update, the running Electron preload may predate the
font handler. The renderer can then load a prepared local Apple font from
`node_modules/.cache/bex-native-emoji/compatible.ttf` on its same-origin
loopback Vite server. Prepare it with
`node tools/prepare-native-emoji-cache.cjs`; the alias shares the generated
cache file's storage using a hard link. This path is development-only and
git-ignored, and no Apple font is copied into production build assets. A normal
interface refresh can apply the fix to an older running desktop process.

`sequences.json` contains the code point sequences from Unicode 17.0's
`emoji-test.txt`, including qualified and unqualified forms. Copyright
1991–2026 Unicode, Inc.; see `UNICODE-LICENSE.txt`.

References:

- [Unicode 17 emoji data](https://unicode.org/Public/17.0.0/emoji/emoji-test.txt)
- [OpenType sbix](https://learn.microsoft.com/en-us/typography/opentype/spec/sbix)
- [OpenType CBDT](https://learn.microsoft.com/en-us/typography/opentype/spec/cbdt)
- [OpenType CBLC](https://learn.microsoft.com/en-us/typography/opentype/spec/cblc)
- [Chromium's Lockdown Mode emoji issue](https://issues.chromium.org/issues/403993360)

Checks: `node --test tests/emojiFont.test.cjs tests/globalTypography.test.js`,
`node tools/run-emoji-rendering-proof.cjs`, and the same native proof with
`--windows-fallback`. The native proof checks actual painted pixels in the
shared editor's headings, normal/bold/italic text, SVG, and canvas; checks the
Apple family and combined glyph shaping on Mac; and exercises the production
sandboxed preload and unchanged clipboard Unicode.
Run it with `--legacy-preload` to prove the same Apple artwork renders with
the old desktop preload via the prepared loopback font asset. Every Mac sample
is checked for the Apple font family as well as visible pixels.
