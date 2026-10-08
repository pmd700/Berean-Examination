/**
 * When may an incoming `content` prop replace what is in the editor?
 *
 * The editor is a controlled-ish component: `content` goes down, `onChange` goes
 * up, and the parent usually round-trips it through React state and a debounced
 * save. That round trip means a prop can arrive describing an *older* document
 * than the one on screen. Applying it is silent data loss — the sentence being
 * typed disappears and the caret jumps to the top, with nothing to undo.
 *
 * The old rule was a single check, `editor.isFocused`, which is not a safe signal
 * in this app: it has been seen lagging behind real DOM focus, and a whole-block
 * marquee selection *deliberately* blurs the editor while the user is still
 * editing. Either case reads as "nobody is editing".
 *
 * The rule lives here, apart from React and the DOM, because it is the part with
 * the branches — deciding whether the editor is focused is thin glue by
 * comparison, and the cost of getting *this* wrong is losing someone's writing.
 */

export const SYNC_DECISION = Object.freeze({
  /** Nothing to do: the editor already shows this. */
  ALREADY_CURRENT: 'already-current',
  /** The user is in the editor; the prop is not ours to apply. */
  BUSY: 'busy',
  /** The editor holds edits the parent has not seen; the prop is stale. */
  UNACKNOWLEDGED: 'unacknowledged',
  /** Safe to load. */
  APPLY: 'apply',
});

/**
 * @param {object}  state
 * @param {string}  state.incoming     the `content` prop just received
 * @param {string}  state.current      the editor's current HTML
 * @param {?string} state.lastEmitted  last HTML this editor sent up, or null if
 *                                     the user has not edited yet
 * @param {boolean} state.isEditing    whether the user is working in it now
 * @returns {string} one of SYNC_DECISION
 */
export function decideContentSync({ incoming, current, lastEmitted, isEditing }) {
  const next = incoming ?? '';

  // Identical documents: nothing to apply, and no reason to disturb the caret.
  if (next === current) return SYNC_DECISION.ALREADY_CURRENT;

  // Before the user has typed anything there is nothing to protect, so an early
  // load — content arriving from the database after mount — must still apply.
  if (lastEmitted === null || lastEmitted === undefined) {
    return isEditing ? SYNC_DECISION.BUSY : SYNC_DECISION.APPLY;
  }

  // The editor has moved on from what the parent last heard about, so this prop
  // cannot be describing the user's latest state.
  if (current !== lastEmitted) return SYNC_DECISION.UNACKNOWLEDGED;

  // In step with the parent, but the user is still in the editor: a document
  // swapped underneath a live caret is the exact failure this guards.
  if (isEditing) return SYNC_DECISION.BUSY;

  // Idle, in step, and genuinely different — a real document change, such as
  // switching Knowledge Web cards, which reuses this editor without remounting.
  return SYNC_DECISION.APPLY;
}

export function shouldApplyExternalContent(state) {
  return decideContentSync(state) === SYNC_DECISION.APPLY;
}

export default shouldApplyExternalContent;
