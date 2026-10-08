export const COPY_FEEDBACK_EVENT = 'bex:copy-feedback';

/**
 * Say whether a copy actually reached the clipboard.
 *
 * Copying in this app happens in more than one way. A caret selection is copied
 * by the browser itself; a whole-block selection has no caret, so the editor
 * writes to the clipboard through the async Clipboard API; cards are copied into
 * an in-app buffer that never touches the system clipboard at all. When one of
 * those quietly fails there is nothing on screen to say so, and the copy is only
 * discovered to be missing at the moment of pasting — by which time it is not
 * obvious which step went wrong.
 *
 * Announcing the outcome is what makes the difference visible. Success and
 * failure both report, because a confirmation that only ever appears when things
 * work tells you nothing on the occasion you actually needed it.
 */
export function announceCopy(message = 'Copied') {
  dispatch({ ok: true, message });
}

export function announceCopyFailed(message = 'Copy failed') {
  dispatch({ ok: false, message });
}

function dispatch(detail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(COPY_FEEDBACK_EVENT, { detail }));
}
