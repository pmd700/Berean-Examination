#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/.cache/bex-tauri-target}"
STAGE="$HOME/.cache/bex-mac-bundle"
APP="$STAGE/BEX.app"
DMG="$HOME/Desktop/BEX.dmg"
VERSION="$(node -e "console.log(require('$ROOT/src-tauri/tauri.conf.json').version)")"

echo "→ Building BEX v${VERSION} Rust + Tauri v2 release binary (cache: $TARGET_DIR)..."
(cd "$ROOT/src-tauri" && CARGO_TARGET_DIR="$TARGET_DIR" cargo build --release)

BIN="$TARGET_DIR/release/bex-tauri"
if [ ! -f "$BIN" ]; then
  echo "ERROR: Missing compiled binary at $BIN" >&2
  exit 1
fi

echo "→ Assembling native macOS BEX.app bundle (v${VERSION})..."
rm -rf "$STAGE"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/attached_assets/bibles"

cp "$BIN" "$APP/Contents/MacOS/BEX"
chmod +x "$APP/Contents/MacOS/BEX"

# Bundle AppIcon + offline Bible library (19 JSON + LSV)
cp "$ROOT/src-tauri/icons/icon.icns" "$APP/Contents/Resources/AppIcon.icns"
cp "$ROOT/attached_assets/bibles/"*.json "$APP/Contents/Resources/attached_assets/bibles/"
cp "$ROOT/attached_assets/lsv_1775867344760.txt" "$APP/Contents/Resources/attached_assets/"

# Bundle MAM Hebrew corpus if present
MAM_SRC="$ROOT/Implementation plans/sources/mam-parsed/plus"
if [ -d "$MAM_SRC" ]; then
  mkdir -p "$APP/Contents/Resources/mam-parsed/plus"
  cp "$MAM_SRC/"*.json "$APP/Contents/Resources/mam-parsed/plus/" 2>/dev/null || true
fi

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>BEX</string>
  <key>CFBundleExecutable</key>
  <string>BEX</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIdentifier</key>
  <string>org.bereanexamination.bex</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>BEX</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${VERSION}</string>
  <key>CFBundleVersion</key>
  <string>${VERSION}</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>CFBundleDocumentTypes</key>
  <array>
    <dict>
      <key>CFBundleTypeName</key>
      <string>BEX Brain Transplant</string>
      <key>CFBundleTypeExtensions</key>
      <array>
        <string>bexbrain</string>
      </array>
      <key>CFBundleTypeRole</key>
      <string>Editor</string>
    </dict>
    <dict>
      <key>CFBundleTypeName</key>
      <string>Berean Knowledge Web</string>
      <key>CFBundleTypeExtensions</key>
      <array>
        <string>berean</string>
      </array>
      <key>CFBundleTypeRole</key>
      <string>Editor</string>
    </dict>
  </array>
</dict>
</plist>
PLIST

codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true

echo "→ Creating drag-to-Applications DMG at $DMG..."
DMG_STAGE="$(mktemp -d)"
cp -R "$APP" "$DMG_STAGE/BEX.app"
ln -s /Applications "$DMG_STAGE/Applications"
rm -f "$DMG"
sync
sleep 1
for attempt in 1 2 3; do
  if hdiutil create -volname "BEX — Berean Examination" -srcfolder "$DMG_STAGE" -ov -format UDZO "$DMG" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
rm -rf "$DMG_STAGE"

if [ "${1:-}" = "--install" ]; then
  echo "→ Installing BEX.app into /Applications/BEX.app..."
  rm -rf "/Applications/BEX.app"
  cp -R "$APP" "/Applications/BEX.app"
fi

echo "✓ Done!"
du -sh "$APP" "$DMG"
ls -lh "$APP/Contents/MacOS/BEX" "$DMG"
