export const TOOLTIP_SHORTCUT_REQUEST = 'bex:request-tooltip';

/**
 * Give the note the user is writing in first refusal on Cmd/Ctrl+T.
 *
 * ⌘T is already the new-tab shortcut, and the tab bar listens in the window's
 * capture phase — so an editor-level binding would never see the key. Rather
 * than reordering listeners, the tab bar asks first: an opted-in note editor
 * with a live selection cancels the request and raises a tooltip, and a new tab
 * opens only when nobody claims it. Pressing ⌘T with nothing selected therefore
 * still opens a tab, exactly as before.
 *
 * Mirrors requestLocalFindShortcut in ./localFindShortcut.js.
 */
export function requestTooltipShortcut() {
  if (typeof window === 'undefined') return false;
  const request = new CustomEvent(TOOLTIP_SHORTCUT_REQUEST, { cancelable: true });
  return !window.dispatchEvent(request);
}
