const TEXT_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial'

// Canvas and DOM surfaces must make the same platform choice. Keep the bundled
// fallback on Windows/Linux, but never override Apple's artwork on a Mac.
export function getAppFontFamily(platform = globalThis.navigator?.platform || '') {
  const emojiFonts = /mac|iphone|ipad|ipod/i.test(platform)
    ? '"Apple Color Emoji", "BEX Color Emoji", "Segoe UI Emoji"'
    : '"BEX Color Emoji", "Segoe UI Emoji", "Apple Color Emoji"'
  return `${TEXT_FONT_FAMILY}, ${emojiFonts}, sans-serif`
}

export const APP_FONT_FAMILY = getAppFontFamily()

export function installAppTypography(root = document.documentElement) {
  root.style.setProperty('--bex-app-font-family', APP_FONT_FAMILY)
}
