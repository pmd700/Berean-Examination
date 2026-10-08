// One switch for every BEX interface and editor surface. Canvas renderers also
// import this value, so changing the app font later remains a one-line edit.
export const APP_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"'

export function installAppTypography(root = document.documentElement) {
  root.style.setProperty('--bex-app-font-family', APP_FONT_FAMILY)
}
