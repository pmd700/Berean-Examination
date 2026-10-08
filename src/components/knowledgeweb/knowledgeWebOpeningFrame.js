// A web may become active before its SQLite rows finish loading. Only frame
// the canvas when the requested, active, and loaded web ids all agree.
export function canFrameOpenedWeb(pendingWebId, activeWebId, loadedCanvasWebId) {
  return pendingWebId != null
    && pendingWebId === activeWebId
    && loadedCanvasWebId === activeWebId;
}
