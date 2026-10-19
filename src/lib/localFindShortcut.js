export const LOCAL_FIND_SHORTCUT_REQUEST = 'bex:request-local-find';
export const PAGE_FIND_SHORTCUT_REQUEST = 'bex:request-page-find';

/** A reader can claim page find before an embedded editor or global search. */
export function requestPageFindShortcut({ close = false } = {}) {
  if (typeof window === 'undefined') return false;
  return !window.dispatchEvent(new CustomEvent(PAGE_FIND_SHORTCUT_REQUEST, { cancelable: true, detail: { close } }));
}

/**
 * Give the active long-form editor first refusal on Cmd/Ctrl+F.
 *
 * Window capture listeners run before document/editor listeners, so relying on
 * propagation order can open both local and global search. A cancelable event
 * makes ownership explicit: an opted-in TEXT_EDITOR_MACHINERY prevents the request,
 * and the global search opens only when no editor claims it.
 */
export function requestLocalFindShortcut() {
  if (typeof window === 'undefined') return false;
  const request = new CustomEvent(LOCAL_FIND_SHORTCUT_REQUEST, {
    cancelable: true,
  });
  return !window.dispatchEvent(request);
}
