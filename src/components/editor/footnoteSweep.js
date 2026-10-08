/**
 * The footnote landing animation.
 *
 * Jumping to a footnote and simply parking the caret there is easy to miss, so
 * arriving sweeps a highlight across the note line by line — deliberately at
 * first, then quickening, the way an eye actually drops onto a reference. The
 * sweep covers only the footnote it belongs to, so a long multi-line note lights
 * up line one, then two, then three, and stops before the next footnote starts.
 *
 * The timings live here, apart from the DOM, so the ramp itself can be tested.
 */

/** How long the finished highlight sits before it fades. */
export const SWEEP_HOLD_MS = 7000;

/** The fade that retires it. */
export const SWEEP_FADE_MS = 620;

const DEFAULTS = Object.freeze({
  totalMs: 900,
  // Above 1 the first lines take a bigger share than the last ones. This is the
  // whole "slow in, fast out" feel; at 1 the sweep would be perfectly linear.
  ramp: 1.35,
  minDurationMs: 55,
});

/**
 * When each line's wipe starts and how long it runs.
 *
 * Weights fall off across the lines, so early lines hold the eye and later ones
 * snap past. Every line still gets `minDurationMs` — without a floor a long
 * footnote's final lines would flash by too fast to read as a sweep at all —
 * and the whole run is then rescaled to land back on `totalMs`.
 */
export function sweepTimings(lineCount, options = {}) {
  const { totalMs, ramp, minDurationMs } = { ...DEFAULTS, ...options };
  const lines = Math.max(0, Math.floor(Number(lineCount) || 0));
  if (lines === 0) return [];

  const weights = Array.from({ length: lines }, (_, index) => (lines - index) ** ramp);
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);

  const raw = weights.map(weight => Math.max(minDurationMs, (weight / weightTotal) * totalMs));

  // The floor can push the run past its budget on a long footnote. Scale back
  // down rather than letting a 30-line note sweep for four seconds — on a very
  // long note the budget wins and the floor is what gives way.
  const rawTotal = raw.reduce((sum, duration) => sum + duration, 0);
  const scale = rawTotal > totalMs ? totalMs / rawTotal : 1;

  // Round the running total rather than each line, so forty roundings cannot
  // add up to a sweep that overruns its budget.
  const timings = [];
  let exactElapsed = 0;
  let roundedElapsed = 0;
  raw.forEach((duration) => {
    exactElapsed += duration * scale;
    const nextRounded = Math.round(exactElapsed);
    timings.push({ delayMs: roundedElapsed, durationMs: nextRounded - roundedElapsed });
    roundedElapsed = nextRounded;
  });
  return timings;
}

/** When the whole sweep — reveal, hold, fade — is finally done. */
export function sweepLifetimeMs(lineCount, options = {}) {
  const timings = sweepTimings(lineCount, options);
  const last = timings[timings.length - 1];
  const revealEnd = last ? last.delayMs + last.durationMs : 0;
  return revealEnd + SWEEP_HOLD_MS + SWEEP_FADE_MS;
}

/**
 * One box per rendered line of an element's text, in element-local coordinates.
 *
 * Client rects come from the text itself rather than the element box, which is
 * what makes the highlight hug a ragged last line instead of painting a rectangle
 * over the whole paragraph. Rects on the same baseline are merged so a line
 * broken up by bold or a link still sweeps as a single line.
 */
export function lineBoxesForElement(element) {
  if (!element || typeof document === 'undefined' || typeof document.createRange !== 'function') return [];

  const range = document.createRange();
  range.selectNodeContents(element);
  const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0);
  range.detach?.();
  if (rects.length === 0) return [];

  const origin = element.getBoundingClientRect();
  const lines = [];
  rects.forEach((rect) => {
    const top = rect.top - origin.top;
    const left = rect.left - origin.left;
    // Same line if the boxes overlap vertically by most of their height —
    // superscripts and inline images sit slightly off the baseline.
    const current = lines[lines.length - 1];
    const sameLine = current && Math.abs(current.top - top) < Math.max(4, rect.height * 0.6);
    if (sameLine) {
      current.left = Math.min(current.left, left);
      current.right = Math.max(current.right, left + rect.width);
      current.top = Math.min(current.top, top);
      current.bottom = Math.max(current.bottom, top + rect.height);
      return;
    }
    lines.push({ top, left, right: left + rect.width, bottom: top + rect.height });
  });

  return lines.map(line => ({
    top: line.top,
    left: line.left,
    width: Math.max(0, line.right - line.left),
    height: Math.max(0, line.bottom - line.top),
  }));
}
