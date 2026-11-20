import { expect, it } from 'vitest';
import { galleryGeometry } from '@/components/editor/imageGalleryLayout';
it('keeps portrait pairs compact and side by side at their natural proportions', () => {
  const layout = galleryGeometry(1500, [0.5, 0.6]);
  expect(layout.height).toBe(380);
  expect(layout.widths).toEqual([190, 228]);
  expect(layout.width).toBe(426);
});
it('sizes mixed portraits and landscapes proportionally to the same row height', () => {
  const ratios = [0.5, 1.8, 1, 2];
  const layout = galleryGeometry(970, ratios);
  ratios.forEach((ratio, index) => expect(layout.widths[index] / layout.height).toBeCloseTo(ratio));
  expect(layout.width).toBe(970);
  expect(layout.widths.reduce((sum, width) => sum + width, 0)).toBeGreaterThan(970);
});
it('fits two complete images in narrow panes and keeps panoramic images uncropped', () => {
  for (const ratios of [[0.5, 0.6], [1.8, 1.8, 1.8], [5, 0.5]]) {
    const layout = galleryGeometry(330, ratios);
    expect(layout.width).toBeLessThanOrEqual(330);
    expect(layout.widths[0] + layout.widths[1] + 8).toBeLessThanOrEqual(330.01);
    ratios.forEach((ratio, index) => expect(layout.widths[index] / layout.height).toBeCloseTo(ratio));
  }
});
