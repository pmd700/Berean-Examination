const TEXT_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial'

// Canvas and DOM surfaces must make the same platform choice. Keep the bundled
// fallback on Windows/Linux, but never override Apple's artwork on a Mac.
export function getAppFontFamily(platform = globalThis.navigator?.platform || '', nativeEmojiAvailable = true) {
  const emojiFonts = /mac|iphone|ipad|ipod/i.test(platform)
    ? nativeEmojiAvailable
      ? '"Apple Color Emoji", "BEX Color Emoji", "Segoe UI Emoji"'
      : '"BEX Native Apple Emoji", "BEX Color Emoji", "Apple Color Emoji", "Segoe UI Emoji"'
    : '"BEX Color Emoji", "Segoe UI Emoji", "Apple Color Emoji"'
  return `${TEXT_FONT_FAMILY}, ${emojiFonts}, sans-serif`
}

export let APP_FONT_FAMILY = getAppFontFamily()

// Font discovery alone reports success for the invisible Apple font. Check
// actual painted pixels, then use locally derived Apple artwork when needed.
export function nativeEmojiPaints(doc = document) {
  try {
    const canvas = doc.createElement('canvas')
    canvas.width = 96; canvas.height = 96
    const context = canvas.getContext('2d', { willReadFrequently: true })
    context.font = '48px "Apple Color Emoji"'
    context.fillText('😀', 8, 65)
    const pixels = context.getImageData(0, 0, 96, 96).data
    let painted = 0
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index]) painted += 1
    return painted > 100
  } catch { return false }
}

async function loadCompatibleEmoji(doc) {
  const api = globalThis.bexDesktop || globalThis.bexCourseStudio
  try {
    let bytes
    try {
      const result = await api?.getNativeEmojiFont?.()
      if (result?.ok) bytes = result.bytes
    } catch { /* An older main process may not yet expose the handler. */ }
    if (!bytes?.byteLength && import.meta.env?.DEV && globalThis.location?.protocol === 'http:'
      && globalThis.location?.hostname === '127.0.0.1') {
      // An older Electron process has no new IPC handler until restarted.
      // Its dev server can still serve the prepared, git-ignored local cache.
      // Vite never includes this development-only file in a production build.
      const response = await fetch('/node_modules/.cache/bex-native-emoji/compatible.ttf', {
        mode: 'same-origin', cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(20000),
      })
      if (response.ok && response.headers.get('content-type') === 'font/ttf') bytes = await response.arrayBuffer()
    }
    if (!bytes?.byteLength) return
    const face = new FontFace('BEX Native Apple Emoji', bytes, { weight: '100 900', style: 'normal' })
    await face.load()
    doc.fonts.add(face)
    // A late completion after the startup timeout still refreshes SVG/canvas
    // consumers without replacing Unicode text with image nodes.
    globalThis.dispatchEvent?.(new Event('resize'))
  } catch { /* The bundled offline fallback remains visible. */ }
}

export async function installAppTypography(root = document.documentElement) {
  const doc = root.ownerDocument || document
  const platform = globalThis.navigator?.platform || ''
  const needsCompatibility = /mac/i.test(platform) && !nativeEmojiPaints(doc)
  APP_FONT_FAMILY = getAppFontFamily(platform, !needsCompatibility)
  root.style.setProperty('--bex-app-font-family', APP_FONT_FAMILY)
  if (!needsCompatibility) return
  // Never hold app startup indefinitely if the local helper is unavailable.
  let timeout
  await Promise.race([
    loadCompatibleEmoji(doc),
    new Promise(resolve => { timeout = setTimeout(resolve, 5000) }),
  ])
  clearTimeout(timeout)
  try { await doc.fonts.load('36px "BEX Color Emoji"') } catch { /* Font failure must never prevent app startup. */ }
}
