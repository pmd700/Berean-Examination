/**
 * Longest tab label before it gets cut. Tabs also `truncate` in CSS, but that
 * only reacts to the available width — this keeps a very long document name from
 * eating a whole tab's worth of space when there is room to spare.
 */
export const TAB_TITLE_MAX = 28;

/** Cuts a long document name back to a word boundary and adds an ellipsis. */
export function formatTabTitle(title, max = TAB_TITLE_MAX) {
  const clean = String(title ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  // Prefer breaking on a word, but not so early that the label stops being
  // recognisable — a single long first word is better cut mid-word.
  const stem = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${stem.replace(/[\s,;:.–—-]+$/, '')}…`;
}
