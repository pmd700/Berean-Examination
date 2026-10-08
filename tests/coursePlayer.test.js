import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampMediaTime,
  formatPlayerTime,
  lessonIsComplete,
  nextPlaybackRate,
  PLAYBACK_RATES,
} from '../src/features/courses/playerModel.js';

test('Course player formats short and long lesson times', () => {
  assert.equal(formatPlayerTime(0), '0:00');
  assert.equal(formatPlayerTime(65), '1:05');
  assert.equal(formatPlayerTime(3665), '1:01:05');
});

test('Course player clamps seeking inside the installed lesson', () => {
  assert.equal(clampMediaTime(-20, 300), 0);
  assert.equal(clampMediaTime(125.5, 300), 125.5);
  assert.equal(clampMediaTime(999, 300), 300);
});

test('Course player exposes useful offline playback speeds', () => {
  assert.deepEqual(PLAYBACK_RATES, [0.75, 1, 1.25, 1.5, 1.75, 2]);
  assert.equal(nextPlaybackRate(1), 1.25);
  assert.equal(nextPlaybackRate(2), 0.75);
});

test('Course completion tolerates the final two seconds without marking early progress complete', () => {
  assert.equal(lessonIsComplete(60, 120), false);
  assert.equal(lessonIsComplete(118, 120), true);
  assert.equal(lessonIsComplete(1, 120, true), true);
});
