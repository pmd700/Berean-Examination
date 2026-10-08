// Pure geometry helpers extracted from exportKnowledgeWebToPdf so they can be
// unit-tested without pulling in browser-only deps (modern-screenshot, jsPDF).
//
// These are the fix-points behind the "no double-counting" export bounds:
//   - Cards contribute their own width/height box.
//   - Canvas objects (sections, images, drawings, points) contribute one box
//     each using object-type-specific dimensions. (Legacy 'text' rows are
//     filtered out upstream in KnowledgeWeb when canvasObjects state is
//     populated, so they never reach this helper.)
//   - Connection reroute points contribute zero-area anchor boxes.
// If any of these grow a generic 240x160 fallback box for tiny anchors
// (routing points used to do this), the export bounds inflate and the
// rendered PDF/JPEG ends up with a mystery whitespace strip.

import { estimateSmartCardGeometry, getCardGeometrySignature } from './smartCardGeometry.js';

export function getObjectDimensions(obj) {
  if (obj.object_type === 'section') return { width: obj.width || 400, height: obj.height || 300 };
  if (obj.object_type === 'image') return { width: obj.width || 240, height: obj.height || 160 };
  if (obj.object_type === 'timegraph') return { width: obj.width || 240, height: obj.height || 150 };
  if (obj.object_type === 'text') return { width: obj.width || 240, height: obj.height || 60 };
  // Drawings store their padded bounding box in width/height. No fallback
  // size — a missing bbox would mean a corrupted row, not "default 240×60".
  if (obj.object_type === 'drawing') return { width: obj.width || 1, height: obj.height || 1 };
  if (obj.object_type === 'point') return { width: 16, height: 16, offsetX: -8, offsetY: -8 };
  return { width: obj.width || 240, height: obj.height || 160 };
}

function resolveCardGeometry(card, cardGeometries) {
  const measured = cardGeometries instanceof Map
    ? (cardGeometries.get(card.id) ?? cardGeometries.get(String(card.id)))
    : (cardGeometries?.[card.id] ?? cardGeometries?.[String(card.id)]);
  if (measured?.signature === getCardGeometrySignature(card)) return measured;
  return estimateSmartCardGeometry(card);
}

export function getExportBounds(cards = [], canvasObjects = [], connections = [], cardGeometries = {}) {
  const boxes = [
    ...cards.map((card) => {
      const geometry = resolveCardGeometry(card, cardGeometries);
      return {
        minX: card.x || 0,
        minY: card.y || 0,
        maxX: (card.x || 0) + geometry.width,
        maxY: (card.y || 0) + geometry.height,
      };
    }),
    ...canvasObjects.map((obj) => {
      const { width, height, offsetX = 0, offsetY = 0 } = getObjectDimensions(obj);
      const baseX = (obj.x || 0) + offsetX;
      const baseY = (obj.y || 0) + offsetY;
      return {
        minX: baseX,
        minY: baseY,
        maxX: baseX + width,
        maxY: baseY + height,
      };
    }),
  ];

  const reroutePoints = connections.flatMap((connection) => connection.reroute_points || []);
  reroutePoints.forEach((point) => {
    boxes.push({
      minX: point.x,
      minY: point.y,
      maxX: point.x,
      maxY: point.y,
    });
  });

  if (boxes.length === 0) {
    return { minX: 0, minY: 0, maxX: 1200, maxY: 800 };
  }

  return boxes.reduce((acc, box) => ({
    minX: Math.min(acc.minX, box.minX),
    minY: Math.min(acc.minY, box.minY),
    maxX: Math.max(acc.maxX, box.maxX),
    maxY: Math.max(acc.maxY, box.maxY),
  }), {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  });
}
