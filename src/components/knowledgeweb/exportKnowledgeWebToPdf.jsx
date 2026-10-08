import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { getExportBounds, getObjectDimensions } from './exportBounds';

export { getExportBounds, getObjectDimensions };

// Knowledge Web export pipeline.
//
// We previously tried two more elaborate approaches:
//   1. modern-screenshot's foreignObject rasterizer over the whole canvas.
//      foreignObject re-runs layout on the cloned subtree, and rich HTML
//      inside `flex-1 min-h-0` items wraps at slightly different points
//      than live, producing the "doubled / overlapping description text"
//      and tag clipping the user kept reporting.
//   2. modern-screenshot for the stage + html2canvas snapshots of each
//      LIVE card swapped into the clone. This fixed wrap drift but the
//      live cards are inside a zoom-transformed canvas — the resulting
//      bitmaps were sized to the on-screen (zoomed) dimensions, which
//      didn't match the cloned card's intrinsic size, so cards rendered
//      tiny inside their full-size boxes.
//
// The right answer is much simpler: clone the canvas content into an
// off-screen stage at zoom=1, then ask html2canvas to render that stage
// in a single pass. html2canvas walks the live DOM and reads each text
// fragment's already-resolved geometry from the browser via Range APIs —
// it does not re-run text layout — so the export inherits exactly the
// wrap positions you see on screen. No per-card loops, no zoom math, no
// freeze hacks.

const EXPORT_PADDING = 120;
const MAX_EXPORT_PIXELS = 16_000_000;
const MAX_EXPORT_SCALE = 2;
const MIN_EXPORT_SCALE = 0.7;
const EXPORT_BACKGROUND = '#111827';
// jsPDF uses points internally; max page side is 14400pt (200 inches at 72dpi).
const JSPDF_MAX_PAGE_PT = 14400;

function sanitizeFileName(name = 'knowledge-web') {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'knowledge-web';
}

// html2canvas has three rendering limitations that visibly hurt the
// Knowledge Web export. Walk the cloned subtree once and neutralize each:
//
//   1. backdrop-filter is unsupported. Translucent card backgrounds that
//      relied on the blur for contrast lose legibility — we solidify any
//      rgba background of an element that used backdrop-filter.
//   2. inset box-shadow is not clipped to border-radius. Cards use
//      `inset 0 0 0 1px ${tint}` to draw a colored ring; html2canvas
//      paints the inset shadow as straight rectangular lines that look
//      like extra internal borders. Strip the inset segments only;
//      preserve any outer-shadow glow.
//   3. mask-image / -webkit-mask-image is unsupported. The description
//      box uses a bottom-fade mask; without support html2canvas can
//      produce a visible hard edge at the mask boundary. Drop the mask
//      and let the parent's overflow:hidden hard-clip instead — this
//      matches how every other static element in the export renders.
function neutralizeUnsupportedStyles(rootEl) {
  const all = rootEl.querySelectorAll('*');
  all.forEach((el) => {
    const computed = window.getComputedStyle(el);

    const bf = computed.backdropFilter || computed.webkitBackdropFilter;
    if (bf && bf !== 'none') {
      el.style.backdropFilter = 'none';
      el.style.webkitBackdropFilter = 'none';
      const bg = computed.backgroundColor;
      const m = bg && bg.match(/^rgba?\(([^)]+)\)$/);
      if (m) {
        const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
        if (parts.length === 4 && parts[3] < 1) {
          el.style.backgroundColor = `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})`;
        }
      }
    }

    const shadow = computed.boxShadow;
    if (shadow && shadow !== 'none' && shadow.includes('inset')) {
      // box-shadow segments are comma-separated, but commas inside rgb()/
      // rgba() must not split — use a regex that ignores commas inside
      // parens. Note: getComputedStyle serializes box-shadow with the
      // `inset` keyword at the END of each segment (e.g.
      // `rgb(124, 92, 183) 0px 0px 0px 1px inset`), so check `includes`
      // rather than `startsWith`.
      const outerOnly = shadow
        .split(/,(?![^()]*\))/)
        .map((s) => s.trim())
        .filter((s) => !/\binset\b/.test(s))
        .join(', ');
      el.style.boxShadow = outerOnly || 'none';
    }

    const mask = computed.maskImage || computed.webkitMaskImage;
    if (mask && mask !== 'none') {
      el.style.maskImage = 'none';
      el.style.webkitMaskImage = 'none';
    }
  });
}

// The description box uses `flex-1 min-h-0` so it fills the card's
// available vertical space, leaving the bottom of the description
// empty when the text is short. The tag pill sits BELOW the
// description in the flex column, so when the description is bigger
// than the text content the tag ends up pushed to the card's bottom
// with a visible gap above it — what the user kept calling "random
// head space above the tag." On the live canvas at small zoom that
// gap reads as tight; in a full-size export it looks huge.
//
// Move the tag pill up to sit flush below the description's last
// rendered text glyph.
//
// Why not shrink the description? Earlier attempts tried overriding
// `flex-1 min-h-0` with inline styles to collapse the description to
// its content height. That fights Tailwind's specificity, race
// conditions in cloned-subtree layout, and (crucially) fails for
// LONG descriptions where natural height >= flex-filled height — in
// that case the shrink has no effect and the tag pill keeps its old
// position. The "headspace above the tag" the user kept reporting is
// exactly this case: there's invisible empty space inside the
// description box (between the last visible/faded text line and the
// description's bottom edge) plus my fade overlay, and the tag sits
// below all of that.
//
// Using `transform: translateY` is bullet-proof: it visually moves
// the tag without touching layout, doesn't depend on any Tailwind
// override winning, and works whether the description is short or
// flex-filled. We measure where the description's text glyphs
// actually end via the Range API, compute the empty space between
// that and the description's bottom edge, and translate the tag up
// by exactly that amount so it sits flush against the text (still
// preserving the original `mt-1.5` 6px gap from layout).
function pullTagsUpToText(rootEl) {
  const previews = rootEl.querySelectorAll('.canvas-card-preview');
  // eslint-disable-next-line no-console
  console.log('[export-debug] pullTagsUpToText found', previews.length, 'previews');
  previews.forEach((preview, idx) => {
    // STEP 1: capture the flex-1 filled height as the upper bound.
    const flexFilledHeight = preview.offsetHeight;
    if (flexFilledHeight <= 0) {
      // eslint-disable-next-line no-console
      console.log('[export-debug]', idx, 'flexFilledHeight=0 SKIP');
      return;
    }

    // STEP 2: nuke the Tailwind classes that fight us, AND set inline
    // !important styles. Belt-and-suspenders. classList.remove kills
    // `.flex-1 { flex: 1 1 0% }` and `.min-h-0 { min-height: 0 }` at
    // the source, so there's no specificity battle to win.
    preview.classList.remove('flex-1', 'min-h-0');
    preview.style.setProperty('flex', '0 0 auto', 'important');
    preview.style.setProperty('height', 'auto', 'important');
    preview.style.setProperty('max-height', 'none', 'important');
    preview.style.setProperty('min-height', '0', 'important');

    // STEP 3: measure natural content height now that flex/min-h are gone.
    let naturalHeight = preview.offsetHeight;
    let textBottomFromTop = -1;
    try {
      const range = document.createRange();
      range.selectNodeContents(preview);
      const textRect = range.getBoundingClientRect();
      const previewRect = preview.getBoundingClientRect();
      textBottomFromTop = textRect.bottom - previewRect.top;
      if (textBottomFromTop > 0 && textBottomFromTop < naturalHeight) {
        naturalHeight = textBottomFromTop;
      }
    } catch { /* fall back to offsetHeight */ }

    // STEP 4: lock in min(natural, flex-filled).
    const SAFETY_PAD = 2;
    const target = Math.min(naturalHeight + SAFETY_PAD, flexFilledHeight);
    preview.style.setProperty('flex', `0 0 ${target}px`, 'important');
    preview.style.setProperty('height', `${target}px`, 'important');
    preview.style.setProperty('max-height', `${target}px`, 'important');

    // eslint-disable-next-line no-console
    console.log('[export-debug]', idx,
      'flexFilled=', flexFilledHeight,
      'natural=', naturalHeight,
      'textBottom=', textBottomFromTop,
      'target=', target,
      'finalOffsetHeight=', preview.offsetHeight);
  });
}

// The description box uses `mask-image: linear-gradient(...)` to fade
// its bottom 18px into the card background. html2canvas can't render
// mask-image, so without compensation the description ends in a hard
// mid-glyph cut and the tag pill below sits with a strip of clipped
// half-letters above it (the user's "random head space").
//
// Recreate the fade as a real DOM gradient overlay, but make the fade
// target match the card's actual rendered color rather than a hard-
// coded gray. Each card may carry a tag tint (baked into the card
// outer's background-image by bakeTintOverlays); fading to plain
// gray-800 produces a visibly different rectangle on tinted cards
// (the "legacy black band" the user kept reporting). Compute the
// effective color = page-bg ⨁ card-bg-color ⨁ first-tint-color so
// the fade terminates in the same color the surrounding card area
// already shows.
const PAGE_BG_RGB = [17, 24, 39]; // #111827 — Knowledge Web page bg

function parseColorString(str) {
  if (!str) return null;
  let m = str.match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/);
  if (m) {
    return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), m[4] ? parseFloat(m[4]) : 1];
  }
  m = str.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  if (m) {
    let hex = m[1];
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return [r, g, b, a];
  }
  return null;
}

function compositeOver(top, bottomRgb) {
  if (!top) return bottomRgb;
  const [r, g, b, a] = top;
  return [
    Math.round(r * a + bottomRgb[0] * (1 - a)),
    Math.round(g * a + bottomRgb[1] * (1 - a)),
    Math.round(b * a + bottomRgb[2] * (1 - a)),
  ];
}

function addBottomFadeOverlays(rootEl) {
  const previews = rootEl.querySelectorAll('.canvas-card-preview');
  previews.forEach((preview) => {
    // Walk up to the card outer — the first ancestor with a non-
    // transparent backgroundColor. After bakeTintOverlays this element
    // also carries the tint gradient in its inline `background` shorthand.
    let cardOuter = preview.parentElement;
    while (cardOuter && cardOuter !== rootEl) {
      const cs = window.getComputedStyle(cardOuter);
      const bg = cs.backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') break;
      cardOuter = cardOuter.parentElement;
    }

    let target = [...PAGE_BG_RGB];
    if (cardOuter) {
      const cs = window.getComputedStyle(cardOuter);
      const cardBg = parseColorString(cs.backgroundColor);
      target = compositeOver(cardBg, target);
      // The baked tint is a 135° linear gradient with two color stops
      // (start + end) — at the description's bottom-mid position the
      // effective tint is the AVERAGE of the two stops, not the first
      // one. Sampling only the start over-applies the tint and makes
      // the fade read as "more vibrant" than the card body. Average
      // every color stop the gradient string contains.
      const bgImg = cs.backgroundImage;
      if (bgImg && bgImg !== 'none') {
        const matches = Array.from(bgImg.matchAll(/rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}/g));
        const stops = matches.map((m) => parseColorString(m[0])).filter(Boolean);
        if (stops.length > 0) {
          const avg = stops.reduce(
            (acc, c) => [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2], acc[3] + c[3]],
            [0, 0, 0, 0],
          ).map((v) => v / stops.length);
          target = compositeOver(avg, target);
        }
      }
    }

    // Anchor the fade to where the TEXT actually ends, not the
    // description's flex-filled bottom. For long text that fills the
    // description these are the same point. For short text the fade
    // would otherwise float as a colored strip in empty card area
    // (well below the tag pill that pullTagsUpToText moved up). We
    // also skip the fade entirely when text fits comfortably with
    // room to spare — the live render's mask-image is invisible on
    // empty space, so the export should be too.
    let textBottomFromTop = preview.offsetHeight;
    let previewHeight = preview.offsetHeight;
    try {
      const range = document.createRange();
      range.selectNodeContents(preview);
      const textRect = range.getBoundingClientRect();
      const previewRect = preview.getBoundingClientRect();
      previewHeight = previewRect.height;
      textBottomFromTop = textRect.bottom - previewRect.top;
    } catch {
      // fall through with offsetHeight defaults
    }
    // Skip fade if text fits with more than 4px of slack — no visible
    // text would be touched by the fade and a floating colored strip
    // is exactly the artifact the user kept seeing.
    if (textBottomFromTop < previewHeight - 4) return;

    // Cap the fade at 90% alpha rather than 100%. The underlying card
    // bg has a 135° tint gradient that varies horizontally; a uniform
    // fully-opaque rectangle of our averaged color would still create
    // a visible boundary where the uniform fade meets the surrounding
    // gradient. Letting 10% of the underlying card show through at the
    // fade's bottom edge keeps the gradient continuity intact and
    // makes the fade visually disappear into the card.
    const FADE_HEIGHT = 18;
    const fadeTop = Math.max(0, Math.min(textBottomFromTop, previewHeight) - FADE_HEIGHT);
    const fade = document.createElement('div');
    Object.assign(fade.style, {
      position: 'absolute',
      left: '0',
      right: '0',
      top: `${fadeTop}px`,
      height: `${FADE_HEIGHT}px`,
      pointerEvents: 'none',
      background: `linear-gradient(to bottom, rgba(${target[0]}, ${target[1]}, ${target[2]}, 0) 0%, rgba(${target[0]}, ${target[1]}, ${target[2]}, 0.9) 100%)`,
    });
    preview.appendChild(fade);
  });
}

// Section titles (CanvasSection) combine Tailwind's `truncate`
// (`overflow:hidden; whitespace:nowrap; text-overflow:ellipsis`) with
// inline `lineHeight: 1.2`. html2canvas measures glyph rects via Range
// APIs and intersects them with the element's overflow rect; capital
// some font glyphs extend slightly above and below the line-box so
// the rasterized text gets sliced horizontally (the user's
// "SCIENCE ALONE?" with only top halves of letters). Strip
// overflow:hidden + whitespace:nowrap from the section title element
// in the cloned subtree, and bump line-height to 1.4 so glyphs have
// vertical room. The lock button to the right is `flex-shrink-0`, so
// removing the horizontal clip won't reflow siblings.
function unclipSectionTitles(rootEl) {
  // Section blocks live at the top of `[data-obj-id]` and house the
  // header at depth 2 (`outer > inner > header > title.truncate`).
  const sections = rootEl.querySelectorAll('[data-obj-id]');
  sections.forEach((sectionEl) => {
    const titles = sectionEl.querySelectorAll(':scope > div > div > .truncate');
    titles.forEach((el) => {
      el.style.overflow = 'visible';
      el.style.whiteSpace = 'nowrap';
      el.style.textOverflow = 'clip';
      el.style.lineHeight = '1.4';
    });
  });
}

// CanvasCard renders its tag-colored tint as an absolutely positioned
// child div with `inset:0; rounded-xl; linear-gradient(...)`. Visually
// it's supposed to fill the rounded interior of the card. In the live
// render that works because the overlay's rounded corners and the
// parent's rounded inner edge are blended away by anti-aliasing at
// screen DPI. In an html2canvas export at 1.4–2× the parent's border
// (1px solid) and the overlay's own rounded edge are rendered as
// distinct geometry, producing a visible hairline 1px inside the card
// border that reads as "an extra inner border".
//
// Eliminate the seam at the source: take each overlay's gradient,
// stack it on top of its parent's background color, and hide the
// overlay div. The gradient now lives inside the parent's own
// border-radius + overflow:hidden clip, so there is exactly one rounded
// boundary to render.
function bakeTintOverlays(rootEl) {
  const candidates = rootEl.querySelectorAll('div[style*="linear-gradient"]');
  candidates.forEach((overlay) => {
    const computed = window.getComputedStyle(overlay);
    if (computed.position !== 'absolute') return;
    const bg = computed.backgroundImage;
    if (!bg || !bg.includes('linear-gradient')) return;
    const parent = overlay.parentElement;
    if (!parent) return;
    const parentBg = window.getComputedStyle(parent).backgroundColor || 'transparent';
    parent.style.background = `${bg}, ${parentBg}`;
    overlay.style.display = 'none';
  });
}

async function waitForAssets(rootEl) {
  if (document.fonts?.ready) {
    try { await document.fonts.ready; } catch { /* ignore */ }
  }
  // Make sure every cloned <img> has decoded so we don't capture broken
  // image placeholders.
  const imgs = Array.from(rootEl.querySelectorAll('img'));
  await Promise.all(imgs.map((img) => {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    if (typeof img.decode === 'function') {
      return img.decode().catch(() => undefined);
    }
    return new Promise((resolve) => {
      img.onload = resolve;
      img.onerror = resolve;
    });
  }));
  // Two RAFs so the browser actually lays the cloned subtree out before we
  // hand it to html2canvas — text fragment geometry is read from the live
  // layout, so it must exist.
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  if (document.fonts?.ready) {
    try { await document.fonts.ready; } catch { /* ignore */ }
  }
}

async function renderCanvasBitmap({ canvasContentRef, cards, canvasObjects, connections, bounds: boundsOverride, padding }) {
  if (!canvasContentRef?.current) {
    throw new Error('Knowledge web content is not available for export.');
  }

  const bounds = boundsOverride || getExportBounds(cards, canvasObjects, connections);
  const pad = Number.isFinite(padding) ? padding : EXPORT_PADDING;
  const exportWidth = Math.ceil(bounds.maxX - bounds.minX + pad * 2);
  const exportHeight = Math.ceil(bounds.maxY - bounds.minY + pad * 2);
  const exportScale = Math.max(
    MIN_EXPORT_SCALE,
    Math.min(
      MAX_EXPORT_SCALE,
      Math.sqrt(MAX_EXPORT_PIXELS / Math.max(exportWidth * exportHeight, 1)),
    ),
  );

  // Off-screen stage that mirrors the canvas at zoom=1 (no transforms),
  // sized to the bounding box of every shape we want in the export.
  const exportStage = document.createElement('div');
  Object.assign(exportStage.style, {
    position: 'fixed',
    left: '-20000px',
    top: '0',
    width: `${exportWidth}px`,
    height: `${exportHeight}px`,
    overflow: 'hidden',
    background: EXPORT_BACKGROUND,
    pointerEvents: 'none',
    zIndex: '-1',
  });

  const clonedContent = canvasContentRef.current.cloneNode(true);
  Object.assign(clonedContent.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: `${exportWidth}px`,
    height: `${exportHeight}px`,
    transform: `translate(${pad - bounds.minX}px, ${pad - bounds.minY}px)`,
    transformOrigin: 'top left',
  });

  exportStage.appendChild(clonedContent);
  document.body.appendChild(exportStage);

  try {
    neutralizeUnsupportedStyles(exportStage);
    bakeTintOverlays(exportStage);
    unclipSectionTitles(exportStage);
    // Pull tag pills up to sit flush below the description's text
    // glyphs (eliminates the "headspace above the tag" the user kept
    // reporting). Order doesn't matter relative to addBottomFadeOverlays
    // — both functions read text bottom independently via Range API.
    pullTagsUpToText(exportStage);
    addBottomFadeOverlays(exportStage);
    await waitForAssets(exportStage);

    const renderedCanvas = await html2canvas(exportStage, {
      backgroundColor: EXPORT_BACKGROUND,
      width: exportWidth,
      height: exportHeight,
      windowWidth: exportWidth,
      windowHeight: exportHeight,
      scale: exportScale,
      useCORS: true,
      allowTaint: false,
      logging: false,
      // Skip interaction affordances that aren't part of the artifact.
      ignoreElements: (el) =>
        el.matches?.('button[aria-label="Resize card"]'),
    });

    return renderedCanvas;
  } finally {
    document.body.removeChild(exportStage);
  }
}

function buildTileCanvas(sourceCanvas, sx, sy, sw, sh) {
  const tile = document.createElement('canvas');
  tile.width = sw;
  tile.height = sh;
  const ctx = tile.getContext('2d');
  ctx.fillStyle = EXPORT_BACKGROUND;
  ctx.fillRect(0, 0, sw, sh);
  ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return tile;
}

function buildFileName(webTitle, fileNameSuffix, extension) {
  const base = sanitizeFileName(webTitle);
  const suffix = fileNameSuffix ? `-${sanitizeFileName(fileNameSuffix)}` : '';
  return `${base}${suffix}.${extension}`;
}

export default async function exportKnowledgeWebToPdf({
  canvasContentRef,
  cards,
  canvasObjects,
  connections,
  webTitle,
  bounds,
  fileNameSuffix,
  padding,
}) {
  const renderedCanvas = await renderCanvasBitmap({
    canvasContentRef, cards, canvasObjects, connections, bounds, padding,
  });

  const bitmapW = renderedCanvas.width;
  const bitmapH = renderedCanvas.height;

  // Default scale: 0.75 pt/px gives a sensible physical PDF size.
  const pointsPerPixel = 0.75;
  const pageWidthPt = bitmapW * pointsPerPixel;
  const pageHeightPt = bitmapH * pointsPerPixel;

  // Single-page path: bitmap fits within jsPDF's max page dimension.
  if (pageWidthPt <= JSPDF_MAX_PAGE_PT && pageHeightPt <= JSPDF_MAX_PAGE_PT) {
    const orientation = pageWidthPt >= pageHeightPt ? 'landscape' : 'portrait';
    const pdf = new jsPDF({
      orientation,
      unit: 'pt',
      format: [pageWidthPt, pageHeightPt],
      compress: true,
    });
    const imageData = renderedCanvas.toDataURL('image/jpeg', 0.92);
    pdf.addImage(imageData, 'JPEG', 0, 0, pageWidthPt, pageHeightPt, undefined, 'FAST');
    pdf.save(buildFileName(webTitle, fileNameSuffix, 'pdf'));
    return;
  }

  // Tiled fallback: bitmap exceeds jsPDF's max page dimension on at least
  // one axis. Slice into 2D tiles, each ≤ maxTilePx so the resulting PDF
  // page is ≤ 14400pt. Each page format matches its tile exactly — no
  // fixed-size pages and therefore no trailing whitespace. Aspect ratio is
  // preserved because every tile uses the same pointsPerPixel.
  const maxTilePx = Math.floor(JSPDF_MAX_PAGE_PT / pointsPerPixel);
  const cols = Math.ceil(bitmapW / maxTilePx);
  const rows = Math.ceil(bitmapH / maxTilePx);
  const tileW = Math.ceil(bitmapW / cols);
  const tileH = Math.ceil(bitmapH / rows);

  let pdf;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const sx = col * tileW;
      const sy = row * tileH;
      const sw = Math.min(tileW, bitmapW - sx);
      const sh = Math.min(tileH, bitmapH - sy);
      const tileCanvas = buildTileCanvas(renderedCanvas, sx, sy, sw, sh);
      const tileWidthPt = sw * pointsPerPixel;
      const tileHeightPt = sh * pointsPerPixel;
      const orientation = tileWidthPt >= tileHeightPt ? 'landscape' : 'portrait';
      const format = [tileWidthPt, tileHeightPt];
      if (!pdf) {
        pdf = new jsPDF({ orientation, unit: 'pt', format, compress: true });
      } else {
        pdf.addPage(format, orientation);
      }
      const tileData = tileCanvas.toDataURL('image/jpeg', 0.92);
      pdf.addImage(tileData, 'JPEG', 0, 0, tileWidthPt, tileHeightPt, undefined, 'FAST');
    }
  }
  pdf.save(buildFileName(webTitle, fileNameSuffix, 'pdf'));
}

export async function exportKnowledgeWebToJpeg({
  canvasContentRef,
  cards,
  canvasObjects,
  connections,
  webTitle,
  bounds,
  fileNameSuffix,
  padding,
  quality = 0.92,
}) {
  const renderedCanvas = await renderCanvasBitmap({
    canvasContentRef, cards, canvasObjects, connections, bounds, padding,
  });

  const dataUrl = renderedCanvas.toDataURL('image/jpeg', quality);
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = buildFileName(webTitle, fileNameSuffix, 'jpg');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// PNG export — lossless, so OCR / LLM vision tools can read fine detail
// even on dense webs where JPEG compression artifacts blur small text.
// File size will be substantially larger than the JPEG variant; that's
// the trade-off and the UI surfaces it.
export async function exportKnowledgeWebToPng({
  canvasContentRef,
  cards,
  canvasObjects,
  connections,
  webTitle,
  bounds,
  fileNameSuffix,
  padding,
}) {
  const renderedCanvas = await renderCanvasBitmap({
    canvasContentRef, cards, canvasObjects, connections, bounds, padding,
  });

  // Use toBlob + object URL instead of toDataURL for PNG — large
  // lossless bitmaps as base64 data URLs can blow past browser URL
  // length limits and also waste ~33% memory in encoding overhead.
  const blob = await new Promise((resolve, reject) => {
    renderedCanvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('Failed to encode PNG'));
    }, 'image/png');
  });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = buildFileName(webTitle, fileNameSuffix, 'png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    // Defer revoke so the browser has a chance to start the download.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}
