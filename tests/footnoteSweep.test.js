import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SWEEP_FADE_MS,
  SWEEP_HOLD_MS,
  sweepLifetimeMs,
  sweepTimings,
} from '../src/components/editor/footnoteSweep.js';

describe('the footnote landing sweep', () => {
  it('has nothing to sweep across an empty footnote', () => {
    assert.deepEqual(sweepTimings(0), []);
  });

  it('gives a one-line footnote the whole run', () => {
    const [only] = sweepTimings(1, { totalMs: 900 });
    assert.equal(only.delayMs, 0);
    assert.equal(only.durationMs, 900);
  });

  it('slows at the start and quickens towards the end', () => {
    const timings = sweepTimings(5);
    const durations = timings.map(timing => timing.durationMs);
    for (let index = 1; index < durations.length; index += 1) {
      assert.ok(
        durations[index] < durations[index - 1],
        `line ${index + 1} (${durations[index]}ms) should be quicker than line ${index} (${durations[index - 1]}ms)`,
      );
    }
  });

  it('runs the lines one after another, never at once', () => {
    const timings = sweepTimings(4);
    timings.forEach((timing, index) => {
      if (index === 0) { assert.equal(timing.delayMs, 0); return; }
      const previous = timings[index - 1];
      assert.equal(timing.delayMs, previous.delayMs + previous.durationMs);
    });
  });

  it('keeps a long footnote inside its budget instead of sweeping for seconds', () => {
    const timings = sweepTimings(40, { totalMs: 900 });
    const total = timings.reduce((sum, timing) => sum + timing.durationMs, 0);
    assert.equal(timings.length, 40);
    assert.ok(total <= 910, `40 lines swept for ${total}ms`);
  });

  it('holds for seven seconds before it fades', () => {
    const lifetime = sweepLifetimeMs(3, { totalMs: 900 });
    assert.ok(lifetime >= 900 + SWEEP_HOLD_MS + SWEEP_FADE_MS - 5);
    assert.ok(lifetime <= 900 + SWEEP_HOLD_MS + SWEEP_FADE_MS + 5);
  });
});
