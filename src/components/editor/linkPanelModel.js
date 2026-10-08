export const LINK_PANEL_SIZE = Object.freeze({ width: 380, height: 156 });

const finite = (value, fallback = 0) => (
  Number.isFinite(Number(value)) ? Number(value) : fallback
);

/**
 * Place the link editor beside its text while keeping the whole panel visible.
 * It prefers below the link, flips above near the bottom edge, and clamps its
 * left edge rather than drifting into either side of the viewport.
 */
export function positionLinkPanel(
  anchorRect,
  viewport,
  panel = LINK_PANEL_SIZE,
  { gap = 8, margin = 12 } = {},
) {
  const viewportWidth = Math.max(0, finite(viewport?.width));
  const viewportHeight = Math.max(0, finite(viewport?.height));
  const panelWidth = Math.min(Math.max(0, finite(panel?.width)), Math.max(0, viewportWidth - margin * 2));
  const panelHeight = Math.min(Math.max(0, finite(panel?.height)), Math.max(0, viewportHeight - margin * 2));

  const anchorLeft = finite(anchorRect?.left, margin);
  const anchorTop = finite(anchorRect?.top, margin);
  const anchorBottom = finite(anchorRect?.bottom, anchorTop);
  const maxLeft = Math.max(margin, viewportWidth - panelWidth - margin);
  const maxTop = Math.max(margin, viewportHeight - panelHeight - margin);
  const left = Math.min(Math.max(margin, anchorLeft), maxLeft);

  const below = anchorBottom + gap;
  const above = anchorTop - panelHeight - gap;
  const preferredTop = below + panelHeight <= viewportHeight - margin
    ? below
    : above;
  const top = Math.min(Math.max(margin, preferredTop), maxTop);

  return { left, top };
}

