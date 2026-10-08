import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTextSizeVariables,
  getTextSizeScale,
  normalizeTextSize,
  scaleTextPixels,
} from '../src/lib/textSize.js';

describe('shared text size preference', () => {
  it('uses Chapter Study\'s existing five relative stops', () => {
    assert.equal(getTextSizeScale(1), 14 / 18);
    assert.equal(getTextSizeScale(2), 16 / 18);
    assert.equal(getTextSizeScale(3), 1);
    assert.equal(getTextSizeScale(4), 20 / 18);
    assert.equal(getTextSizeScale(5), 24 / 18);
  });

  it('keeps malformed values inside the five-stop control', () => {
    assert.equal(normalizeTextSize('4'), 4);
    assert.equal(normalizeTextSize(-9), 1);
    assert.equal(normalizeTextSize(99), 5);
    assert.equal(normalizeTextSize('nope'), 3);
  });

  it('installs concrete shared renderer tokens without changing level three', () => {
    const values = new Map();
    const root = { style: { setProperty: (key, value) => values.set(key, value) } };
    applyTextSizeVariables(root, 3);
    assert.equal(values.get('--bex-editor-text-size'), '16px');
    assert.equal(values.get('--bex-nested-editor-text-size'), '12px');
    assert.equal(values.get('--bex-note-title-size'), '36px');
    assert.equal(values.get('--bex-timeline-field-text-size'), '12.5px');
    assert.equal(scaleTextPixels(16, 5), 21.333);
  });
});
