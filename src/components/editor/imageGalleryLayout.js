// Use the images' actual proportions to choose a shared row height. Small sets
// stay compact; longer sets keep their horizontal scrolling strip.
export function galleryGeometry(width, ratios) {
  if (!ratios.length || width <= 0) return null;
  const visible = ratios.slice(0, width < 600 ? 2 : 3);
  const height = Math.max(1, Math.min(380, Math.max(180, width * 0.32), (width - (visible.length - 1) * 8) / visible.reduce((sum, ratio) => sum + ratio, 0)));
  const widths = ratios.map(ratio => height * ratio);
  return { height, widths, width: Math.min(width, widths.reduce((sum, value) => sum + value, 0) + (widths.length - 1) * 8) };
}

export function observeGalleryLayout(dom, contentDOM) {
  let frame = null, parent = null;
  const layout = () => {
    frame = null;
    if (!dom.isConnected) return;
    if (parent !== dom.parentElement) {
      resize.disconnect(); parent = dom.parentElement;
      if (parent) resize.observe(parent);
    }
    if (!parent) return;
    const style = getComputedStyle(parent);
    const width = parent.clientWidth - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0');
    const children = Array.from(contentDOM.children).filter(child => child instanceof HTMLElement && child.querySelector('img'));
    const ratios = children.map(child => {
      const img = child.querySelector('img');
      return img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
    });
    const geometry = galleryGeometry(width, ratios);
    if (!geometry) return;
    dom.style.width = `${geometry.width}px`;
    children.forEach((child, index) => { if (child instanceof HTMLElement) child.style.width = `${geometry.widths[index]}px`; });
  };
  const schedule = () => { if (frame === null) frame = requestAnimationFrame(layout); };
  const resize = new ResizeObserver(schedule);
  const mutation = new MutationObserver(schedule);
  mutation.observe(contentDOM, { childList: true, subtree: true });
  contentDOM.addEventListener('load', schedule, true);
  schedule();
  return () => { if (frame !== null) cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect(); contentDOM.removeEventListener('load', schedule, true); };
}
