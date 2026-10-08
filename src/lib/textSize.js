export const DEFAULT_TEXT_SIZE = 3;

// Chapter Study's established five stops are 14, 16, 18, 20 and 24px. Other
// writing surfaces keep their own level-three baseline, then move through the
// exact same proportions so choosing a size feels identical everywhere.
const SCRIPTURE_SIZE_PX = Object.freeze([14, 16, 18, 20, 24]);

export function normalizeTextSize(value, fallback = DEFAULT_TEXT_SIZE) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(5, Math.round(number)));
}

export function getTextSizeScale(value = DEFAULT_TEXT_SIZE) {
  const size = normalizeTextSize(value);
  return SCRIPTURE_SIZE_PX[size - 1] / SCRIPTURE_SIZE_PX[DEFAULT_TEXT_SIZE - 1];
}

export function scaleTextPixels(basePixels, value = DEFAULT_TEXT_SIZE) {
  return Number((Number(basePixels) * getTextSizeScale(value)).toFixed(3));
}

/** Install concrete pixel tokens so every renderer can share the preference. */
export function applyTextSizeVariables(root, value = DEFAULT_TEXT_SIZE) {
  if (!root?.style?.setProperty) return;
  const scale = getTextSizeScale(value);
  root.style.setProperty('--bex-content-text-scale', String(scale));
  root.style.setProperty('--bex-editor-text-size', `${scaleTextPixels(16, value)}px`);
  root.style.setProperty('--bex-nested-editor-text-size', `${scaleTextPixels(12, value)}px`);
  root.style.setProperty('--bex-note-title-size', `${scaleTextPixels(36, value)}px`);
  root.style.setProperty('--bex-annotation-text-size', `${scaleTextPixels(12.5, value)}px`);
  root.style.setProperty('--bex-timeline-field-text-size', `${scaleTextPixels(12.5, value)}px`);
  root.style.setProperty('--bex-timegraph-tick-text-size', `${scaleTextPixels(11, value)}px`);
  root.style.setProperty('--bex-timegraph-focus-text-size', `${scaleTextPixels(9.5, value)}px`);
  root.style.setProperty('--bex-timegraph-clock-text-size', `${scaleTextPixels(8.5, value)}px`);
  root.style.setProperty('--bex-timegraph-readout-text-size', `${scaleTextPixels(12, value)}px`);
  root.style.setProperty('--bex-timegraph-empty-text-size', `${scaleTextPixels(12.5, value)}px`);
}
