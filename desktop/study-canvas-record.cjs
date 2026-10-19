'use strict';

const TYPES = new Set(['card', 'drawing', 'section', 'image', 'timegraph', 'point', 'web_link']);
function invalid(message) { const error = new Error(message); error.code = 'BEX_ENTITY_INVALID'; throw error; }
function endpoint(value) {
  if (!value || typeof value !== 'object') invalid('A study connection needs two saved endpoints.');
  if (value.kind === 'verse') {
    if (typeof value.book !== 'string' || !/^(?:[1-3] )?[a-z]+(?: [a-z]+)*$/i.test(value.book) || value.book.length > 40
      || !Number.isSafeInteger(value.chapter) || value.chapter < 1 || value.chapter > 150
      || !Number.isSafeInteger(value.verse) || value.verse < 1 || value.verse > 176) invalid('The connected verse reference is invalid.');
    return { kind: 'verse', book: value.book.trim().toLowerCase(), chapter: value.chapter, verse: value.verse };
  }
  if (!['object', 'annotation'].includes(value.kind) || !Number.isSafeInteger(value.id) || value.id < 1) invalid('The study connection endpoint is invalid.');
  return { kind: value.kind, id: value.id };
}
function validateStudyCanvasRecord(type, payload, exists) {
  if (type === 'StudyConnection') {
    payload.from = endpoint(payload.from); payload.to = endpoint(payload.to);
    if (JSON.stringify(payload.from) === JSON.stringify(payload.to)) invalid('Connect two different items.');
    for (const value of [payload.from, payload.to]) {
      if (value.kind !== 'verse' && !exists(value.kind === 'object' ? 'StudyCanvasObject' : 'Annotation', value.id)) invalid('The connected study item no longer exists.');
    }
    if (payload.style != null && !['curvy', 'straight'].includes(payload.style)) invalid('The study connection style is invalid.');
    if (payload.label != null && (typeof payload.label !== 'string' || payload.label.length > 1000)) invalid('The connection label is too long.');
  } else {
    if (!TYPES.has(payload.object_type)) invalid('Unknown Chapter Study canvas item.');
    for (const field of ['x', 'y']) if (!Number.isFinite(payload[field])) invalid('The study item position is invalid.');
    for (const field of ['width', 'height']) if (payload[field] != null && (!Number.isFinite(payload[field]) || payload[field] <= 0 || payload[field] > 1000000)) invalid('The study item size is invalid.');
    if (payload.object_type === 'drawing') {
      let stroke;
      try { stroke = JSON.parse(payload.strokes_data); } catch { invalid('The study drawing is invalid.'); }
      if (!Array.isArray(stroke.points) || !stroke.points.length || stroke.points.length > 20000
        || stroke.points.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite))) invalid('The study drawing points are invalid.');
    }
    if (payload.object_type === 'image' && (typeof payload.image_url !== 'string' || !payload.image_url.startsWith('bex-media://'))) invalid('Study images must use protected local Media.');
    for (const [field, entity] of [['timegraph_id', 'Timegraph'], ['link_web_id', 'KnowledgeWeb']]) {
      if (payload[field] != null && (!Number.isSafeInteger(payload[field]) || !exists(entity, payload[field]))) invalid('The linked library item no longer exists.');
    }
    if ((payload.object_type === 'timegraph' && payload.timegraph_id == null) || (payload.object_type === 'web_link' && payload.link_web_id == null)) invalid('Choose the library item to place on the study canvas.');
  }
  return payload;
}
module.exports = { validateStudyCanvasRecord };
