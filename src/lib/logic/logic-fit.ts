export type LogicFitController = {
  refresh: () => void;
  destroy: () => void;
};

export function observeLogicBlockFit(
  container: HTMLElement,
  surface: HTMLElement,
  minimumFontSize = 13,
): LogicFitController {
  let animationFrame = 0;
  let destroyed = false;

  const refresh = () => {
    if (destroyed) return;
    window.cancelAnimationFrame(animationFrame);
    animationFrame = window.requestAnimationFrame(() => {
      container.style.removeProperty('font-size');
      const style = window.getComputedStyle(container);
      // An inline formula is only as wide as its own content, so measure the
      // space it has to live in — the paragraph around it — instead.
      const host = style.display.startsWith('inline') ? container.parentElement : container;
      if (!host) return;
      const hostStyle = host === container ? style : window.getComputedStyle(host);
      const horizontalPadding = parseFloat(hostStyle.paddingLeft) + parseFloat(hostStyle.paddingRight);
      const availableWidth = Math.max(0, host.clientWidth - horizontalPadding);
      const naturalWidth = surface.scrollWidth;
      const baseFontSize = parseFloat(style.fontSize);

      if (!availableWidth || !naturalWidth || !baseFontSize || naturalWidth <= availableWidth) return;
      const fittedFontSize = Math.max(minimumFontSize, baseFontSize * (availableWidth / naturalWidth));
      container.style.fontSize = `${fittedFontSize.toFixed(2)}px`;
    });
  };

  const observer = new ResizeObserver(refresh);
  observer.observe(container);
  // Inline formulas don't resize with the column, so watch the column too.
  if (container.parentElement) observer.observe(container.parentElement);
  document.fonts?.ready.then(refresh).catch(() => undefined);
  refresh();

  return {
    refresh,
    destroy() {
      destroyed = true;
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
    },
  };
}
