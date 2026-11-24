#!/usr/bin/env bash
set -euo pipefail

# Builds, signs, installs locally, and publishes a signed GitHub Release for BEX
# so installed copies of BEX.app auto-update automatically via Tauri v2 updater.
#
# Usage:
#   bash tools/release-mac.sh "Optional release notes"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NOTES="${1:-Bug fixes and performance improvements.}"
KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.tauri/bex.key}"
STAGE="$HOME/.cache/bex-mac-bundle"
RELEASE_DIR="$HOME/.cache/bex-release-artifacts"
REPO="pmd700/Berean-Examination"

if [ ! -f "$KEY_PATH" ]; then
  echo "ERROR: Missing Tauri signing key at $KEY_PATH" >&2
  exit 1
fi

VERSION="$(node -e "console.log(require('$ROOT/src-tauri/tauri.conf.json').version)")"
TAG="v${VERSION}"
ARCH="$(uname -m)"
if [ "$ARCH" = "arm64" ]; then
  PLATFORM="darwin-aarch64"
  TAR_NAME="BEX_aarch64.app.tar.gz"
else
  PLATFORM="darwin-x86_64"
  TAR_NAME="BEX_x64.app.tar.gz"
fi

echo "→ Building frontend + native macOS bundle for ${TAG} (${PLATFORM})..."
(cd "$ROOT" && npm run build)
pkill -f "/Applications/BEX.app" 2>/dev/null || true
bash "$ROOT/tools/package-mac-dmg.sh" --install

rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

TAR_PATH="$RELEASE_DIR/$TAR_NAME"
echo "→ Creating updater archive $TAR_NAME..."
tar -C "$STAGE" -czf "$TAR_PATH" BEX.app

echo "→ Signing updater archive with $KEY_PATH..."
npx --yes @tauri-apps/cli@2 signer sign "$TAR_PATH" --private-key-path "$KEY_PATH" >/dev/null
SIG_PATH="${TAR_PATH}.sig"
if [ ! -f "$SIG_PATH" ]; then
  echo "ERROR: Signature file was not generated at $SIG_PATH" >&2
  exit 1
fi
SIGNATURE="$(tr -d '\r\n' < "$SIG_PATH")"
PUB_DATE="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${TAG}/${TAR_NAME}"

LATEST_JSON="$RELEASE_DIR/latest.json"
node -e "
const manifest = {
  version: process.argv[1],
  notes: process.argv[2],
  pub_date: process.argv[3],
  platforms: {
    [process.argv[4]]: {
      signature: process.argv[5],
      url: process.argv[6],
    },
  },
};
require('fs').writeFileSync(process.argv[7], JSON.stringify(manifest, null, 2) + '\n');
" "$VERSION" "$NOTES" "$PUB_DATE" "$PLATFORM" "$SIGNATURE" "$DOWNLOAD_URL" "$LATEST_JSON"

cp "$HOME/Desktop/BEX.dmg" "$RELEASE_DIR/BEX-${TAG}.dmg"

echo "→ Publishing GitHub Release ${TAG} to ${REPO}..."
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release upload "$TAG" \
    "$TAR_PATH" \
    "$SIG_PATH" \
    "$LATEST_JSON" \
    "$RELEASE_DIR/BEX-${TAG}.dmg" \
    --repo "$REPO" \
    --clobber
  gh release edit "$TAG" --repo "$REPO" --notes "$NOTES" --latest
else
  gh release create "$TAG" \
    "$TAR_PATH" \
    "$SIG_PATH" \
    "$LATEST_JSON" \
    "$RELEASE_DIR/BEX-${TAG}.dmg" \
    --repo "$REPO" \
    --title "BEX ${TAG}" \
    --notes "$NOTES" \
    --latest
fi

echo "✓ Released BEX ${TAG}!"
echo "  Updater manifest: https://github.com/${REPO}/releases/latest/download/latest.json"
