'use strict';

const { separateApiStudyRecord } = require('./api-study-record.cjs');
const { validateStudyCanvasRecord } = require('./study-canvas-record.cjs');
const { encodeSpreadsheetPayload, decodeSpreadsheetPayload } = require('./spreadsheet-storage.cjs');

const { MAX_IMAGE_BYTES, parseMediaUrl } = require('./local-media.cjs');

const MAX_ENTITY_BYTES = 2 * 1024 * 1024;
const MAX_VERSION_BYTES = 32 * 1024 * 1024;
const MAX_FILTER_FIELDS = 24;
const MAX_REORDER_RECORDS = 5000;
const MAX_IMPORT_RECORDS_PER_GROUP = 10000;
const MAX_IMPORT_TOTAL_RECORDS = 25000;
const ALLOWED_BRAIN_SOURCE_TYPES = new Set([
  'article',
  'book',
  'crm',
  'journal',
  'meeting',
  'note',
  'other',
  'podcast',
  'scripture',
  'tweet',
  'youtube',
]);
const LSV_SPECIAL_SECTIONS = new Set(['Copyright', 'Preface', 'Introduction']);
const STUDY_ENTITY_TYPES = new Set([
  'Annotation',
  'DailyActivity',
  'Drawing',
  'Keyword',
  'StudyChapter',
  'TextHighlight',
]);
const SYSTEM_FIELDS = new Set([
  'id',
  'user_id',
  'created_at',
  'created_date',
  'updated_at',
  'updated_date',
]);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const ENTITY_CONFIG = Object.freeze({
  Asset: Object.freeze({
    immutableFields: Object.freeze(['mime_type', 'size', 'url']),
    table: 'local_assets',
  }),
  Annotation: Object.freeze({
    immutableFields: Object.freeze(['book', 'chapter_number', 'version']),
    table: 'local_annotations',
  }),
  StudyCanvasObject: Object.freeze({ table: 'local_study_canvas_objects', maxBytes: MAX_VERSION_BYTES }),
  StudyConnection: Object.freeze({ table: 'local_study_connections' }),
  BrainSource: Object.freeze({
    immutableFields: Object.freeze(['processed_at', 'processing_status', 'raw_text']),
    table: 'local_brain_sources',
  }),
  ChapterArtCatalog: Object.freeze({
    table: 'local_chapter_art_catalogs',
  }),
  KnowledgeWeb: Object.freeze({
    containerField: 'folder_id',
    containerTable: 'local_web_folders',
    newAtTop: true,
    orderField: 'sort_order',
    table: 'local_knowledge_webs',
  }),
  WebFolder: Object.freeze({
    newAtTop: true,
    orderField: 'sort_order',
    table: 'local_web_folders',
  }),
  MindNote: Object.freeze({
    containerField: 'folder_id',
    containerTable: 'local_web_folders',
    newAtTop: true,
    orderField: 'sort_order',
    table: 'local_mind_notes',
  }),
  MindLink: Object.freeze({
    immutableFields: Object.freeze(['from_type', 'from_id', 'to_type', 'to_id']),
    table: 'local_mind_links',
  }),
  WebVersion: Object.freeze({
    listOmitFields: Object.freeze(['snapshot']),
    maxBytes: MAX_VERSION_BYTES,
    parentTable: 'local_knowledge_webs',
    scopeField: 'web_id',
    table: 'local_web_versions',
  }),
  WebCard: Object.freeze({
    parentTable: 'local_knowledge_webs',
    scopeField: 'web_id',
    table: 'local_web_cards',
  }),
  WebConnection: Object.freeze({
    parentTable: 'local_knowledge_webs',
    scopeField: 'web_id',
    table: 'local_web_connections',
  }),
  CanvasObject: Object.freeze({
    parentTable: 'local_knowledge_webs',
    scopeField: 'web_id',
    table: 'local_canvas_objects',
  }),
  DailyActivity: Object.freeze({
    immutableFields: Object.freeze(['date']),
    table: 'local_daily_activities',
  }),
  Drawing: Object.freeze({
    immutableFields: Object.freeze(['annotation_id']),
    maxBytes: MAX_VERSION_BYTES,
    table: 'local_drawings',
  }),
  Keyword: Object.freeze({
    table: 'local_keywords',
  }),
  StudyChapter: Object.freeze({
    containerField: 'folder_id',
    containerTable: 'local_web_folders',
    immutableFields: Object.freeze(['book', 'chapter_number', 'version']),
    table: 'local_study_chapters',
  }),
  Timegraph: Object.freeze({
    // A Timegraph carries every one of its events in a single payload, so it
    // needs the larger ceiling; 20,000 events would blow past MAX_ENTITY_BYTES.
    maxBytes: MAX_VERSION_BYTES,
    containerField: 'folder_id',
    containerTable: 'local_web_folders',
    table: 'local_timegraphs',
  }),
  Spreadsheet: Object.freeze({
    maxBytes: MAX_VERSION_BYTES,
    listOmitFields: Object.freeze(['workbook']),
    snapshotFullPayload: true,
    containerField: 'folder_id',
    containerTable: 'local_web_folders',
    newAtTop: true,
    orderField: 'sort_order',
    table: 'local_spreadsheets',
  }),
  TextHighlight: Object.freeze({
    immutableFields: Object.freeze(['book', 'chapter_number', 'version']),
    table: 'local_text_highlights',
  }),
});

const ASSET_MIME_BY_EXTENSION = Object.freeze({
  gif: 'image/gif',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
});

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function portableRecordKey(value, label) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  if (typeof value === 'string' && value.trim() && value.length <= 200) {
    return value.trim();
  }
  throw codedError('BEX_ENTITY_INVALID', `${label} has an invalid portable ID.`);
}

function requireImportRecords(importValue, field) {
  const records = importValue[field];
  if (!Array.isArray(records) || records.length > MAX_IMPORT_RECORDS_PER_GROUP) {
    throw codedError('BEX_ENTITY_INVALID', `The imported ${field} list is invalid.`);
  }
  return records;
}

function requireImportRecord(value, label) {
  if (!isPlainObject(value)) {
    throw codedError('BEX_ENTITY_INVALID', `The imported ${label} is invalid.`);
  }
  assertSafeValue(value);
  return value;
}

function requireOptionalImportText(value, label, maxLength) {
  if (value === undefined) return undefined;
  if (value === null && label === 'connector style') return null;
  if (typeof value !== 'string' || value.length > maxLength) {
    throw codedError('BEX_ENTITY_INVALID', `The imported ${label} is invalid.`);
  }
  return value;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertSafeValue(value, depth = 0) {
  if (depth > 40) throw codedError('BEX_ENTITY_INVALID', 'The local record is nested too deeply.');
  if (value === null || value === undefined || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return;
    throw codedError('BEX_ENTITY_INVALID', 'The local record contains an invalid number.');
  }
  if (Array.isArray(value)) {
    for (const item of value) assertSafeValue(item, depth + 1);
    return;
  }
  if (!isPlainObject(value)) {
    throw codedError('BEX_ENTITY_INVALID', 'The local record contains an unsupported value.');
  }
  for (const [key, nestedValue] of Object.entries(value)) {
    if (!key || key.length > 120 || FORBIDDEN_KEYS.has(key)) {
      throw codedError('BEX_ENTITY_INVALID', 'The local record contains an unsafe field name.');
    }
    assertSafeValue(nestedValue, depth + 1);
  }
}

function cleanPayload(value, maxBytes = MAX_ENTITY_BYTES) {
  if (!isPlainObject(value)) {
    throw codedError('BEX_ENTITY_INVALID', 'A local record must be an object.');
  }
  assertSafeValue(value);
  const cleaned = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (!SYSTEM_FIELDS.has(key) && nestedValue !== undefined) cleaned[key] = nestedValue;
  }
  let serialized;
  try {
    serialized = JSON.stringify(cleaned);
  } catch {
    throw codedError('BEX_ENTITY_INVALID', 'The local record could not be encoded.');
  }
  if (!serialized || Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    throw codedError('BEX_ENTITY_TOO_LARGE', 'The local record is too large to save safely.');
  }
  return JSON.parse(serialized);
}

function requireEntityConfig(entityType) {
  if (typeof entityType !== 'string' || !ENTITY_CONFIG[entityType]) {
    throw codedError('BEX_ENTITY_UNSUPPORTED', 'That type of local record is not available yet.');
  }
  return ENTITY_CONFIG[entityType];
}

function requireEntityId(entityId) {
  const normalized = Number(entityId);
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw codedError('BEX_ENTITY_INVALID', 'The local record ID is invalid.');
  }
  return normalized;
}

function optionalEntityId(entityId) {
  return entityId === null || entityId === undefined ? null : requireEntityId(entityId);
}

function requireReorderIds(entityIds) {
  if (!Array.isArray(entityIds) || entityIds.length < 1 || entityIds.length > MAX_REORDER_RECORDS) {
    throw codedError('BEX_ENTITY_INVALID', 'The local record order is invalid.');
  }
  const normalized = entityIds.map(requireEntityId);
  if (new Set(normalized).size !== normalized.length) {
    throw codedError('BEX_ENTITY_INVALID', 'The local record order contains duplicates.');
  }
  return normalized;
}

function entityPurpose(entityType, entityId) {
  return `bex:local-entity:v1:${entityType}:${entityId}`;
}

function valueMatches(actual, expected) {
  if (Array.isArray(expected)) return expected.some((value) => valueMatches(actual, value));
  if (actual === expected) return true;
  if (typeof actual === 'number' && typeof expected === 'string') return String(actual) === expected;
  if (typeof expected === 'number' && typeof actual === 'string') return actual === String(expected);
  return false;
}

function compareValues(left, right) {
  if (left === right) return 0;
  if (left === null || left === undefined) return 1;
  if (right === null || right === undefined) return -1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right));
}

class LocalEntityStore {
  constructor(database, privacyVault, now = () => Date.now()) {
    if (!database || typeof database.prepare !== 'function') {
      throw codedError('BEX_DATABASE_NOT_OPEN', 'The Berean Library database is not open.');
    }
    if (!privacyVault || typeof privacyVault.encryptValue !== 'function') {
      throw codedError('BEX_PRIVACY_NOT_OPEN', 'The encrypted Berean Library vault is not open.');
    }
    this.database = database;
    this.privacyVault = privacyVault;
    this.now = now;
  }

  assertReady(entityType) {
    const config = requireEntityConfig(entityType);
    this.privacyVault.assertUnlocked();
    return config;
  }

  selectColumns(config) {
    return `id${config.scopeField ? `, ${config.scopeField}` : ''}, encrypted_payload, created_at, updated_at`;
  }

  allRows(config) {
    return this.database.prepare(`
      SELECT ${this.selectColumns(config)}
      FROM ${config.table}
    `).all();
  }

  validateConfiguredPayload(config, payload, { defaultOrdering = false, nowMs, existingId = null } = {}) {
    if (config.table === 'local_spreadsheets') {
      if (typeof payload.title !== 'string' || payload.title.length > 500
        || !isPlainObject(payload.workbook) || !Array.isArray(payload.workbook.sheets)
        || payload.workbook.sheets.length < 1 || payload.workbook.sheets.length > 1024
        || payload.workbook.sheets.some(sheet => !isPlainObject(sheet))) {
        throw codedError('BEX_ENTITY_INVALID', 'The spreadsheet needs a title and a valid workbook.');
      }
      const sheetIds = new Set();
      for (const sheet of payload.workbook.sheets) {
        if (typeof sheet.id !== 'string' || !sheet.id || sheet.id.length > 120 || sheetIds.has(sheet.id)
          || typeof sheet.name !== 'string' || !sheet.name.trim() || sheet.name.length > 200
          || !Number.isSafeInteger(sheet.rowCount) || sheet.rowCount < 1 || sheet.rowCount > 1048576
          || !Number.isSafeInteger(sheet.columnCount) || sheet.columnCount < 1 || sheet.columnCount > 16384
          || !isPlainObject(sheet.cells)) {
          throw codedError('BEX_ENTITY_INVALID', 'The worksheet identity, dimensions or cells are invalid.');
        }
        sheetIds.add(sheet.id);
        for (const [address, cell] of Object.entries(sheet.cells)) {
          const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(address);
          const column = match ? [...match[1]].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) : 0;
          if (!match || column > sheet.columnCount || Number(match[2]) > sheet.rowCount
            || !isPlainObject(cell)
            || (cell.v != null && !['string', 'number', 'boolean'].includes(typeof cell.v))
            || (cell.f !== undefined && typeof cell.f !== 'string')) {
            throw codedError('BEX_ENTITY_INVALID', 'The worksheet contains an invalid cell.');
          }
        }
        for (const [field, maximum] of [['columnWidths', sheet.columnCount], ['rowHeights', sheet.rowCount]]) {
          if (sheet[field] === undefined) continue;
          if (!isPlainObject(sheet[field]) || Object.entries(sheet[field]).some(([key, size]) => !/^\d+$/.test(key)
            || Number(key) >= maximum || typeof size !== 'number' || size < 0 || size > 10000)) {
            throw codedError('BEX_ENTITY_INVALID', 'The worksheet dimensions are invalid.');
          }
        }
      }
      if (payload.workbook.activeSheetId != null && !sheetIds.has(payload.workbook.activeSheetId)) {
        throw codedError('BEX_ENTITY_INVALID', 'The active worksheet no longer exists.');
      }
    }
    if (config.table === 'local_study_canvas_objects' || config.table === 'local_study_connections') {
      validateStudyCanvasRecord(config.table === 'local_study_connections' ? 'StudyConnection' : 'StudyCanvasObject', payload,
        (type, id) => !!this.database.prepare(`SELECT id FROM ${requireEntityConfig(type).table} WHERE id = ?`).get(id));
      if (config.table === 'local_study_connections' && defaultOrdering) {
        const key = value => [JSON.stringify(value.from), JSON.stringify(value.to)].sort().join('|');
        if (this.allRows(config).some(row => row.id !== existingId && key(this.decodeRow('StudyConnection', row)) === key(payload))) {
          throw codedError('BEX_ENTITY_INVALID', 'Those study items are already connected.');
        }
      }
    }
    if (config.orderField) {
      if (payload[config.orderField] === undefined && defaultOrdering) {
        payload[config.orderField] = -Math.trunc(nowMs);
      }
      if (!Number.isSafeInteger(payload[config.orderField])) {
        throw codedError('BEX_ENTITY_INVALID', 'The local record order is invalid.');
      }
    }
    if (config.containerField) {
      const containerId = optionalEntityId(payload[config.containerField]);
      payload[config.containerField] = containerId;
      if (containerId !== null) {
        const container = this.database.prepare(`
          SELECT id FROM ${config.containerTable} WHERE id = ?
        `).get(containerId);
        if (!container) {
          throw codedError('BEX_ENTITY_INVALID', 'The selected folder no longer exists.');
        }
      }
    }
    return payload;
  }

  validateMindLink(payload) {
    const endpointEntity = (endpointType) => {
      if (endpointType === 'note') return 'MindNote';
      if (endpointType === 'web') return 'KnowledgeWeb';
      throw codedError('BEX_ENTITY_INVALID', 'A note link has an invalid endpoint type.');
    };
    const fromEntity = endpointEntity(payload.from_type);
    const toEntity = endpointEntity(payload.to_type);
    const fromId = requireEntityId(payload.from_id);
    const toId = requireEntityId(payload.to_id);
    if (fromEntity === toEntity && fromId === toId) {
      throw codedError('BEX_ENTITY_INVALID', 'A note link cannot connect an item to itself.');
    }
    for (const [entityType, entityId] of [[fromEntity, fromId], [toEntity, toId]]) {
      const endpointConfig = requireEntityConfig(entityType);
      const endpoint = this.database.prepare(`
        SELECT id FROM ${endpointConfig.table} WHERE id = ?
      `).get(entityId);
      if (!endpoint) throw codedError('BEX_ENTITY_INVALID', 'A linked item no longer exists.');
    }
    payload.from_id = fromId;
    payload.to_id = toId;
    return payload;
  }

  validateBrainSource(payload, { creating = false } = {}) {
    if (typeof payload.title !== 'string' || !payload.title.trim() || payload.title.length > 500) {
      throw codedError('BEX_ENTITY_INVALID', 'A Second Brain source needs a valid title.');
    }
    if (!ALLOWED_BRAIN_SOURCE_TYPES.has(payload.source_type)) {
      throw codedError('BEX_ENTITY_INVALID', 'The Second Brain source type is invalid.');
    }
    if (
      typeof payload.raw_text !== 'string'
      || !payload.raw_text.trim()
      || Buffer.byteLength(payload.raw_text, 'utf8') > MAX_ENTITY_BYTES - 4096
    ) {
      throw codedError('BEX_ENTITY_INVALID', 'The Second Brain source text is invalid.');
    }
    if (
      payload.source_url !== undefined
      && payload.source_url !== null
      && (typeof payload.source_url !== 'string' || payload.source_url.length > 8192)
    ) {
      throw codedError('BEX_ENTITY_INVALID', 'The Second Brain source address is invalid.');
    }
    if (
      payload.metadata_json !== undefined
      && payload.metadata_json !== null
      && !isPlainObject(payload.metadata_json)
    ) {
      throw codedError('BEX_ENTITY_INVALID', 'The Second Brain source details are invalid.');
    }
    const webId = optionalEntityId(payload.web_id);
    if (webId !== null) {
      const web = this.database.prepare(`
        SELECT id FROM local_knowledge_webs WHERE id = ?
      `).get(webId);
      if (!web) throw codedError('BEX_ENTITY_INVALID', 'The selected Knowledge Web no longer exists.');
    }
    if (
      creating
      && payload.processing_status !== undefined
      && payload.processing_status !== 'unprocessed'
    ) {
      throw codedError('BEX_ENTITY_INVALID', 'Online processing is unavailable in Offline Mode.');
    }
    if (creating && payload.processed_at !== undefined && payload.processed_at !== null) {
      throw codedError('BEX_ENTITY_INVALID', 'Online processing is unavailable in Offline Mode.');
    }
    return cleanPayload({
      ...payload,
      metadata_json: payload.metadata_json ?? null,
      processed_at: null,
      processing_status: 'unprocessed',
      source_url: payload.source_url?.trim() || null,
      title: payload.title.trim(),
      web_id: webId,
    });
  }

  validateAsset(payload) {
    if (typeof payload.name !== 'string' || !payload.name.trim() || payload.name.length > 500) {
      throw codedError('BEX_ENTITY_INVALID', 'The asset name is invalid.');
    }
    if (typeof payload.url !== 'string') {
      throw codedError('BEX_ENTITY_INVALID', 'The asset file reference is invalid.');
    }
    const fileName = parseMediaUrl(payload.url);
    const extension = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
    if (payload.mime_type !== ASSET_MIME_BY_EXTENSION[extension]) {
      throw codedError('BEX_ENTITY_INVALID', 'The asset file type is invalid.');
    }
    if (!Number.isSafeInteger(payload.size) || payload.size < 1 || payload.size > MAX_IMAGE_BYTES) {
      throw codedError('BEX_ENTITY_INVALID', 'The asset file size is invalid.');
    }
    return cleanPayload({
      ...payload,
      name: payload.name.trim(),
      url: payload.url,
    });
  }

  /**
   * Timegraphs are structured JSON the renderer draws directly, so the store
   * checks the shape itself rather than trusting whatever reached the bridge.
   * The renderer normalizes too, but a compromised or simply outdated renderer
   * must not be able to write a payload that later crashes the canvas or smuggles
   * an executable URL into every note the graph is embedded in.
   */
  validateTimegraph(payload) {
    const MAX_EVENTS = 20000;
    const COLORS = new Set(['violet', 'indigo', 'teal', 'green', 'gold', 'amber', 'rose', 'slate']);
    const MARKERS = new Set(['dot', 'ring', 'diamond', 'square', 'pin', 'none']);
    const ALIGNMENTS = new Set(['left', 'center', 'right']);
    const POSITIONS = new Set(['above', 'below']);
    const LINK_KINDS = new Set(['note', 'keyword', 'web-card', 'study-chapter']);
    const YEAR_LIMIT = 100000000000;

    const invalid = (message) => codedError('BEX_ENTITY_INVALID', message);
    const text = (value, limit, label) => {
      if (value === undefined || value === null) return '';
      if (typeof value !== 'string' || value.length > limit) throw invalid(label);
      return value;
    };

    if (!isPlainObject(payload)) throw invalid('The timegraph is invalid.');
    const title = text(payload.title, 200, 'The timegraph title is invalid.');
    const description = text(payload.description, 8000, 'The timegraph description is invalid.');

    if (!Array.isArray(payload.events)) throw invalid('The timegraph events are invalid.');
    if (payload.events.length > MAX_EVENTS) throw invalid('The timegraph has too many events.');

    const point = (value, label, { required }) => {
      if (value === undefined || value === null) {
        if (required) throw invalid(label);
        return null;
      }
      if (!isPlainObject(value)) throw invalid(label);
      const year = Number(value.year);
      if (!Number.isFinite(year) || Math.abs(year) > YEAR_LIMIT) throw invalid(label);
      const month = value.month === null || value.month === undefined ? null : Number(value.month);
      if (month !== null && (!Number.isSafeInteger(month) || month < 1 || month > 12)) {
        throw invalid(label);
      }
      const day = value.day === null || value.day === undefined ? null : Number(value.day);
      if (day !== null && (!Number.isSafeInteger(day) || day < 1 || day > 31)) throw invalid(label);
      if (!['exact', 'month', 'year', 'approximate'].includes(value.precision)) throw invalid(label);
      return { year: Math.trunc(year), month, day, precision: value.precision };
    };

    const seenIds = new Set();
    const events = payload.events.map((event) => {
      if (!isPlainObject(event)) throw invalid('A timegraph event is invalid.');
      const id = text(event.id, 200, 'A timegraph event id is invalid.').trim();
      if (!id) throw invalid('A timegraph event id is missing.');
      if (seenIds.has(id)) throw invalid('The timegraph contains a duplicate event id.');
      seenIds.add(id);

      if (!COLORS.has(event.color)) throw invalid('A timegraph event colour is invalid.');
      if (!MARKERS.has(event.marker)) throw invalid('A timegraph event marker is invalid.');
      if (!ALIGNMENTS.has(event.align)) throw invalid('A timegraph event alignment is invalid.');
      if (!POSITIONS.has(event.position)) throw invalid('A timegraph event position is invalid.');

      const scale = Number(event.scale);
      if (!Number.isFinite(scale) || scale < 0.6 || scale > 2.5) {
        throw invalid('A timegraph event scale is invalid.');
      }

      const tags = Array.isArray(event.tags) ? event.tags : [];
      if (tags.length > 24) throw invalid('A timegraph event has too many tags.');
      tags.forEach((tag) => text(tag, 48, 'A timegraph event tag is invalid.'));

      const media = Array.isArray(event.media) ? event.media : [];
      if (media.length > 12) throw invalid('A timegraph event has too many attachments.');
      media.forEach((item) => {
        if (!isPlainObject(item)) throw invalid('A timegraph attachment is invalid.');
        const url = text(item.url, 2000, 'A timegraph attachment URL is invalid.');
        // Only schemes the renderer can safely resolve. Anything else — above all
        // javascript: and data: — is rejected outright.
        if (!/^(?:https?:|bex-media:|\/)/i.test(url)) {
          throw invalid('A timegraph attachment URL is not allowed.');
        }
        text(item.caption, 300, 'A timegraph attachment caption is invalid.');
      });

      const links = Array.isArray(event.links) ? event.links : [];
      if (links.length > 32) throw invalid('A timegraph event has too many links.');
      links.forEach((link) => {
        if (!isPlainObject(link) || !LINK_KINDS.has(link.kind)) {
          throw invalid('A timegraph event link is invalid.');
        }
        text(link.id, 200, 'A timegraph event link is invalid.');
        text(link.label, 200, 'A timegraph event link label is invalid.');
      });

      return {
        ...event,
        id,
        title: text(event.title, 300, 'A timegraph event title is invalid.'),
        description: text(event.description, 512 * 1024, 'A timegraph event description is invalid.'),
        start: point(event.start, 'A timegraph event date is invalid.', { required: true }),
        end: point(event.end, 'A timegraph event end date is invalid.', { required: false }),
        tags,
        media,
        links,
      };
    });

    let view = null;
    if (payload.view !== undefined && payload.view !== null) {
      if (!isPlainObject(payload.view)) throw invalid('The timegraph view is invalid.');
      const centerYear = Number(payload.view.centerYear);
      const yearsPerPixel = Number(payload.view.yearsPerPixel);
      if (!Number.isFinite(centerYear) || Math.abs(centerYear) > YEAR_LIMIT * 2) {
        throw invalid('The timegraph view is invalid.');
      }
      if (!Number.isFinite(yearsPerPixel) || yearsPerPixel <= 0) {
        throw invalid('The timegraph view is invalid.');
      }
      view = { centerYear, yearsPerPixel };
      if (payload.view.scrollTop !== undefined) {
        if (!Number.isFinite(payload.view.scrollTop) || payload.view.scrollTop < 0 || payload.view.scrollTop > 100000000) throw invalid('The timegraph scroll position is invalid.');
        view.scrollTop = payload.view.scrollTop;
      }
      if (payload.view.filters !== undefined) {
        const filters = payload.view.filters;
        if (!isPlainObject(filters)) throw invalid('The timegraph filters are invalid.');
        view.filters = { query: text(filters.query, 300, 'The timegraph filter query is invalid.'), hideUntagged: filters.hideUntagged === true };
        for (const field of ['tags', 'hiddenTags', 'colors']) {
          const values = filters[field] ?? [];
          if (!Array.isArray(values) || values.length > 1000) throw invalid('The timegraph filters are invalid.');
          view.filters[field] = values.map(value => text(value, 300, 'The timegraph filter value is invalid.'));
        }
      }
    }

    return { ...payload, title, description, events, view };
  }

  validateChapterArtCatalog(payload, { creating = false } = {}) {
    if (creating && this.allRows(requireEntityConfig('ChapterArtCatalog')).length > 0) {
      throw codedError('BEX_ENTITY_INVALID', 'The Chapter Art catalog already exists.');
    }
    if (!Array.isArray(payload.entries) || payload.entries.length > 1500) {
      throw codedError('BEX_ENTITY_INVALID', 'The Chapter Art catalog is invalid.');
    }
    const seen = new Set();
    const entries = payload.entries.map((entry) => {
      if (!isPlainObject(entry)) {
        throw codedError('BEX_ENTITY_INVALID', 'A Chapter Art entry is invalid.');
      }
      if (typeof entry.book !== 'string' || !entry.book.trim() || entry.book.length > 100) {
        throw codedError('BEX_ENTITY_INVALID', 'The Chapter Art book is invalid.');
      }
      if (!Number.isSafeInteger(entry.chapter_number)
        || entry.chapter_number < 1
        || entry.chapter_number > 150) {
        throw codedError('BEX_ENTITY_INVALID', 'The Chapter Art chapter is invalid.');
      }
      parseMediaUrl(entry.cover_art_url);
      const key = `${entry.book.trim()}::${entry.chapter_number}`;
      if (seen.has(key)) {
        throw codedError('BEX_ENTITY_INVALID', 'The Chapter Art catalog contains a duplicate chapter.');
      }
      seen.add(key);
      if (typeof entry.cover_art_name !== 'string' || entry.cover_art_name.length > 500) {
        throw codedError('BEX_ENTITY_INVALID', 'The Chapter Art name is invalid.');
      }
      const ranges = {
        cover_art_opacity: [0, 200],
        cover_art_scale: [10, 200],
        cover_art_x: [0, 100],
        cover_art_y: [0, 100],
      };
      for (const [field, [minimum, maximum]] of Object.entries(ranges)) {
        if (!Number.isSafeInteger(entry[field]) || entry[field] < minimum || entry[field] > maximum) {
          throw codedError('BEX_ENTITY_INVALID', 'The Chapter Art settings are invalid.');
        }
      }
      if (
        typeof entry.updated_date !== 'string'
        || !Number.isFinite(new Date(entry.updated_date).getTime())
      ) {
        throw codedError('BEX_ENTITY_INVALID', 'The Chapter Art update date is invalid.');
      }
      return {
        book: entry.book.trim(),
        chapter_number: entry.chapter_number,
        cover_art_name: entry.cover_art_name,
        cover_art_opacity: entry.cover_art_opacity,
        cover_art_scale: entry.cover_art_scale,
        cover_art_url: entry.cover_art_url,
        cover_art_x: entry.cover_art_x,
        cover_art_y: entry.cover_art_y,
        updated_date: entry.updated_date,
      };
    });
    return cleanPayload({ entries });
  }

  validateStudyLocator(payload) {
    if (typeof payload.book !== 'string' || !payload.book.trim() || payload.book.length > 100) {
      throw codedError('BEX_ENTITY_INVALID', 'The Bible Study book is invalid.');
    }
    if (typeof payload.version !== 'string' || !payload.version.trim() || payload.version.length > 50) {
      throw codedError('BEX_ENTITY_INVALID', 'The Bible Study translation is invalid.');
    }
    if (!Number.isSafeInteger(payload.chapter_number) || payload.chapter_number < 0 || payload.chapter_number > 150) {
      throw codedError('BEX_ENTITY_INVALID', 'The Bible Study chapter is invalid.');
    }
    const book = payload.book.trim();
    const version = payload.version.trim();
    if (payload.chapter_number === 0 && !(version === 'LSV' && LSV_SPECIAL_SECTIONS.has(book))) {
      throw codedError('BEX_ENTITY_INVALID', 'The Bible Study chapter is invalid.');
    }
    payload.book = book;
    payload.version = version;
    return payload;
  }

  requireStudyChapter(payload) {
    const chapterConfig = requireEntityConfig('StudyChapter');
    const chapter = this.allRows(chapterConfig)
      .map((row) => this.decodeRow('StudyChapter', row))
      .find((record) => (
        record.book === payload.book
        && record.chapter_number === payload.chapter_number
        && record.version === payload.version
      ));
    if (!chapter) {
      throw codedError('BEX_ENTITY_INVALID', 'The Bible Study chapter no longer exists.');
    }
    return chapter;
  }

  assertUniqueStudyValue(entityType, field, value, existingId = null) {
    const config = requireEntityConfig(entityType);
    const duplicate = this.allRows(config)
      .map((row) => this.decodeRow(entityType, row))
      .some((record) => record.id !== existingId && record[field] === value);
    if (duplicate) throw codedError('BEX_ENTITY_INVALID', 'That local record already exists.');
  }

  validateStudyEntity(entityType, payload, { creating = false, existingId = null } = {}) {
    const config = requireEntityConfig(entityType);
    if (entityType === 'StudyChapter') {
      payload = separateApiStudyRecord(payload);
      this.validateStudyLocator(payload);
      const duplicate = this.allRows(config)
        .map((row) => this.decodeRow(entityType, row))
        .some((record) => (
          record.id !== existingId
          && record.book === payload.book
          && record.chapter_number === payload.chapter_number
          && record.version === payload.version
        ));
      if (duplicate) throw codedError('BEX_ENTITY_INVALID', 'That Bible Study chapter already exists.');
      if (payload.annotation_count === undefined && creating) payload.annotation_count = 0;
      if (!Number.isSafeInteger(payload.annotation_count) || payload.annotation_count < 0) {
        throw codedError('BEX_ENTITY_INVALID', 'The Bible Study annotation count is invalid.');
      }
    } else if (entityType === 'Annotation' || entityType === 'TextHighlight') {
      this.validateStudyLocator(payload);
      this.requireStudyChapter(payload);
      for (const field of ['start_verse', 'end_verse']) {
        if (!Number.isSafeInteger(payload[field]) || payload[field] < 1) {
          throw codedError('BEX_ENTITY_INVALID', 'The selected verse range is invalid.');
        }
      }
      for (const field of ['start_token_index', 'end_token_index']) {
        if (!Number.isSafeInteger(payload[field]) || payload[field] < 0) {
          throw codedError('BEX_ENTITY_INVALID', 'The selected word range is invalid.');
        }
      }
      const start = payload.start_verse * 1000000 + payload.start_token_index;
      const end = payload.end_verse * 1000000 + payload.end_token_index;
      if (end < start) throw codedError('BEX_ENTITY_INVALID', 'The selected text range is invalid.');
      if (entityType === 'Annotation' && payload.gutter_route != null) {
        const route = payload.gutter_route;
        if (!isPlainObject(route) || !Number.isFinite(route.x)
          || !Number.isFinite(route.y)) {
          throw codedError('BEX_ENTITY_INVALID', 'The annotation connector position is invalid.');
        }
        payload.gutter_route = { x: route.x, y: route.y };
      }
      if (entityType === 'Annotation' && payload.gutter_position != null) {
        const position = payload.gutter_position;
        if (!isPlainObject(position) || !Number.isFinite(position.x)
          || !Number.isFinite(position.y)) {
          throw codedError('BEX_ENTITY_INVALID', 'The annotation card position is invalid.');
        }
        payload.gutter_position = { x: position.x, y: position.y, ...(position.absolute === true ? { absolute: true } : {}) };
      }
      if (entityType === 'Annotation' && payload.gutter_size != null) {
        const size = payload.gutter_size;
        if (!isPlainObject(size) || !Number.isFinite(size.width) || size.width < 180
          || !Number.isFinite(size.height) || size.height < 96) {
          throw codedError('BEX_ENTITY_INVALID', 'The annotation card size is invalid.');
        }
        payload.gutter_size = { width: size.width, height: size.height };
      }
      if (entityType === 'TextHighlight') {
        if (typeof payload.color !== 'string' || !payload.color.trim() || payload.color.length > 50) {
          throw codedError('BEX_ENTITY_INVALID', 'The highlight color is invalid.');
        }
        payload.color = payload.color.trim();
      }
    } else if (entityType === 'Drawing') {
      const annotationId = requireEntityId(payload.annotation_id);
      const annotationConfig = requireEntityConfig('Annotation');
      const annotation = this.database.prepare(`
        SELECT id FROM ${annotationConfig.table} WHERE id = ?
      `).get(annotationId);
      if (!annotation) throw codedError('BEX_ENTITY_INVALID', 'The drawing annotation no longer exists.');
      payload.annotation_id = annotationId;
      if (payload.is_deleted === undefined && creating) payload.is_deleted = false;
      if (typeof payload.is_deleted !== 'boolean') {
        throw codedError('BEX_ENTITY_INVALID', 'The drawing deletion state is invalid.');
      }
      if (payload.version === undefined && creating) payload.version = 2;
      if (!Number.isSafeInteger(payload.version) || payload.version < 1) {
        throw codedError('BEX_ENTITY_INVALID', 'The drawing version is invalid.');
      }
    } else if (entityType === 'Keyword') {
      if (typeof payload.title !== 'string' || !payload.title.trim() || payload.title.length > 500) {
        throw codedError('BEX_ENTITY_INVALID', 'The keyword title is invalid.');
      }
      payload.title = payload.title.trim();
      if (payload.category !== undefined && payload.category !== null
        && (typeof payload.category !== 'string' || payload.category.length > 255)) {
        throw codedError('BEX_ENTITY_INVALID', 'The keyword category is invalid.');
      }
    } else if (entityType === 'DailyActivity') {
      if (typeof payload.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) {
        throw codedError('BEX_ENTITY_INVALID', 'The daily activity date is invalid.');
      }
      this.assertUniqueStudyValue(entityType, 'date', payload.date, existingId);
      for (const field of ['verses_studied', 'annotations_created', 'chapters_completed']) {
        if (payload[field] === undefined && creating) payload[field] = 0;
        if (!Number.isSafeInteger(payload[field]) || payload[field] < 0) {
          throw codedError('BEX_ENTITY_INVALID', 'The daily activity count is invalid.');
        }
      }
    }
    return cleanPayload(payload, config.maxBytes);
  }

  deleteDrawingsForAnnotation(annotationId) {
    const drawingConfig = requireEntityConfig('Drawing');
    for (const row of this.allRows(drawingConfig)) {
      const drawing = this.decodeRow('Drawing', row);
      if (drawing.annotation_id === annotationId) {
        this.database.prepare(`DELETE FROM ${drawingConfig.table} WHERE id = ?`).run(drawing.id);
      }
    }
  }

  deleteStudyChapterChildren(chapter) {
    const matchesChapter = (record) => (
      record.book === chapter.book
      && record.chapter_number === chapter.chapter_number
      && record.version === chapter.version
    );
    const annotationConfig = requireEntityConfig('Annotation');
    for (const row of this.allRows(annotationConfig)) {
      const annotation = this.decodeRow('Annotation', row);
      if (!matchesChapter(annotation)) continue;
      this.deleteDrawingsForAnnotation(annotation.id);
      this.deleteStudyCanvasConnections('annotation', annotation.id);
      this.database.prepare(`DELETE FROM ${annotationConfig.table} WHERE id = ?`).run(annotation.id);
    }
    const highlightConfig = requireEntityConfig('TextHighlight');
    for (const row of this.allRows(highlightConfig)) {
      const highlight = this.decodeRow('TextHighlight', row);
      if (matchesChapter(highlight)) {
        this.database.prepare(`DELETE FROM ${highlightConfig.table} WHERE id = ?`).run(highlight.id);
      }
    }
  }

  deleteStudyCanvasConnections(kind, id) {
    const config = requireEntityConfig('StudyConnection');
    for (const row of this.allRows(config)) {
      const record = this.decodeRow('StudyConnection', row);
      if ([record.from, record.to].some(endpoint => endpoint?.kind === kind && endpoint.id === id)) {
        this.database.prepare('DELETE FROM local_study_connections WHERE id = ?').run(row.id);
      }
    }
  }

  validateWebCardSources(payload) {
    if (payload.source_ids === undefined || payload.source_ids === null) {
      payload.source_ids = [];
      return payload;
    }
    if (!Array.isArray(payload.source_ids) || payload.source_ids.length > 1000) {
      throw codedError('BEX_ENTITY_INVALID', 'The card has invalid Second Brain sources.');
    }
    const sourceIds = payload.source_ids.map(requireEntityId);
    if (new Set(sourceIds).size !== sourceIds.length) {
      throw codedError('BEX_ENTITY_INVALID', 'The card has duplicate Second Brain sources.');
    }
    for (const sourceId of sourceIds) {
      const source = this.database.prepare(`
        SELECT id FROM local_brain_sources WHERE id = ?
      `).get(sourceId);
      if (!source) throw codedError('BEX_ENTITY_INVALID', 'A linked Second Brain source no longer exists.');
    }
    payload.source_ids = sourceIds;
    return payload;
  }

  detachBrainSourcesFromWeb(webId, timestamp) {
    const config = requireEntityConfig('BrainSource');
    for (const row of this.allRows(config)) {
      const source = this.decodeRow('BrainSource', row);
      if (source.web_id !== webId) continue;
      const payload = this.validateBrainSource({ ...source, web_id: null });
      this.writeExistingRow('BrainSource', config, row, payload, timestamp);
    }
  }

  detachBrainSourceFromCards(sourceId, timestamp) {
    const config = requireEntityConfig('WebCard');
    for (const row of this.allRows(config)) {
      const card = this.decodeRow('WebCard', row);
      if (!Array.isArray(card.source_ids) || !card.source_ids.includes(sourceId)) continue;
      const payload = cleanPayload({
        ...card,
        source_ids: card.source_ids.filter((candidate) => candidate !== sourceId),
      }, config.maxBytes);
      this.validateWebCardSources(payload);
      this.writeExistingRow('WebCard', config, row, payload, timestamp);
    }
  }

  validateWebVersion(payload) {
    if (
      payload.label !== undefined
      && payload.label !== null
      && (typeof payload.label !== 'string' || payload.label.length > 500)
    ) {
      throw codedError('BEX_ENTITY_INVALID', 'The version label is invalid.');
    }
    let snapshot;
    try {
      snapshot = typeof payload.snapshot === 'string'
        ? JSON.parse(payload.snapshot)
        : payload.snapshot;
    } catch {
      throw codedError('BEX_ENTITY_INVALID', 'The version snapshot is invalid.');
    }
    if (!isPlainObject(snapshot)) {
      throw codedError('BEX_ENTITY_INVALID', 'The version snapshot is invalid.');
    }
    const normalizedSnapshot = {};
    let totalRecords = 0;
    for (const field of ['cards', 'connections', 'canvasObjects']) {
      const rows = snapshot[field] === undefined ? [] : snapshot[field];
      if (!Array.isArray(rows) || rows.length > 10000) {
        throw codedError('BEX_ENTITY_INVALID', 'The version snapshot contains too many records.');
      }
      totalRecords += rows.length;
      const recordIds = new Set();
      normalizedSnapshot[field] = rows.map((row) => {
        if (!isPlainObject(row)) {
          throw codedError('BEX_ENTITY_INVALID', 'The version snapshot contains an invalid record.');
        }
        assertSafeValue(row);
        const recordId = requireEntityId(row.id);
        if (recordIds.has(recordId)) {
          throw codedError('BEX_ENTITY_INVALID', 'The version snapshot contains duplicate records.');
        }
        recordIds.add(recordId);
        const normalizedRow = { ...row, id: recordId, web_id: payload.web_id };
        if (
          row.web_id !== undefined
          && requireEntityId(row.web_id) !== payload.web_id
        ) {
          throw codedError('BEX_ENTITY_INVALID', 'The version snapshot belongs to another web.');
        }
        return normalizedRow;
      });
    }
    if (totalRecords > 25000) {
      throw codedError('BEX_ENTITY_INVALID', 'The version snapshot contains too many records.');
    }
    return cleanPayload({
      ...payload,
      label: payload.label ?? null,
      snapshot: JSON.stringify(normalizedSnapshot),
    }, MAX_VERSION_BYTES);
  }

  deleteMindLinksForEndpoint(endpointType, endpointId) {
    const linkConfig = requireEntityConfig('MindLink');
    for (const row of this.allRows(linkConfig)) {
      const link = this.decodeRow('MindLink', row);
      const matchesFrom = link.from_type === endpointType && link.from_id === endpointId;
      const matchesTo = link.to_type === endpointType && link.to_id === endpointId;
      if (matchesFrom || matchesTo) {
        this.database.prepare(`DELETE FROM ${linkConfig.table} WHERE id = ?`).run(link.id);
      }
    }
  }

  reserveImportIds(entityType, count) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw codedError('BEX_ENTITY_INVALID', 'The imported record count is invalid.');
    }
    if (count === 0) return [];
    const config = requireEntityConfig(entityType);
    const maximum = this.database.prepare(`
      SELECT COALESCE(MAX(id), 0) AS largest_id FROM ${config.table}
    `).get();
    const sequence = this.database.prepare(`
      SELECT last_id FROM local_entity_sequences WHERE entity_type = ?
    `).get(entityType);
    const lastId = Math.max(Number(maximum.largest_id || 0), Number(sequence?.last_id || 0));
    const finalId = lastId + count;
    if (!Number.isSafeInteger(finalId)) {
      throw codedError('BEX_ENTITY_INVALID', 'The local record ID limit was reached.');
    }
    this.database.prepare(`
      INSERT INTO local_entity_sequences (entity_type, last_id)
      VALUES (?, ?)
      ON CONFLICT(entity_type) DO UPDATE SET last_id = excluded.last_id
    `).run(entityType, finalId);
    return Array.from({ length: count }, (_unused, index) => lastId + index + 1);
  }

  writeImportedRecords(entityType, preparedRecords, entityIds, timestamp) {
    const config = requireEntityConfig(entityType);
    return preparedRecords.map((prepared, index) => {
      const entityId = entityIds[index];
      const payload = cleanPayload(prepared.payload, config.maxBytes);
      const encryptedPayload = this.privacyVault.encryptValue(
        payload,
        entityPurpose(entityType, entityId),
      );
      this.database.prepare(`
        INSERT INTO ${config.table}
          (id, ${config.scopeField}, encrypted_payload, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(entityId, payload[config.scopeField], encryptedPayload, timestamp, timestamp);
      return Object.freeze({
        ...payload,
        id: entityId,
        created_date: timestamp,
        updated_date: timestamp,
      });
    });
  }

  importKnowledgeWebGraph(webId, importValue, { commit = false } = {}) {
    this.assertReady('KnowledgeWeb');
    const normalizedWebId = requireEntityId(webId);
    requireImportRecord(importValue, 'Knowledge Web file');
    if (Buffer.byteLength(JSON.stringify(importValue), 'utf8') > MAX_VERSION_BYTES) {
      throw codedError('BEX_ENTITY_TOO_LARGE', 'The imported Knowledge Web is too large.');
    }
    if (typeof commit !== 'boolean') {
      throw codedError('BEX_ENTITY_INVALID', 'The import choice is invalid.');
    }
    const formatVersion = importValue.formatVersion ?? importValue.version ?? 1;
    if (formatVersion !== 1 && formatVersion !== 2) {
      throw codedError('BEX_ENTITY_INVALID', 'That .berean format version is not supported.');
    }

    const cardsInput = requireImportRecords(importValue, 'cards');
    const connectionsInput = requireImportRecords(importValue, 'connections');
    const objectsInput = requireImportRecords(importValue, 'canvasObjects');
    if (cardsInput.length + connectionsInput.length + objectsInput.length > MAX_IMPORT_TOTAL_RECORDS) {
      throw codedError('BEX_ENTITY_INVALID', 'The imported Knowledge Web contains too many records.');
    }

    const webInput = importValue.web === undefined
      ? {}
      : requireImportRecord(importValue.web, 'Knowledge Web details');
    const webPatch = {};
    for (const [field, label, maxLength] of [
      ['title', 'title', 500],
      ['description', 'description', 100000],
      ['connector_style', 'connector style', 100],
    ]) {
      const value = requireOptionalImportText(webInput[field], label, maxLength);
      if (value !== undefined) webPatch[field] = value;
    }

    const cardKeys = new Map();
    let droppedSourceLinks = 0;
    const preparedCards = cardsInput.map((record, index) => {
      const source = requireImportRecord(record, `card ${index + 1}`);
      const sourceKey = portableRecordKey(source.id, `Card ${index + 1}`);
      if (cardKeys.has(sourceKey)) {
        throw codedError('BEX_ENTITY_INVALID', 'The imported Knowledge Web has duplicate card IDs.');
      }
      const { id: _sourceId, ...rawPayload } = source;
      if (Array.isArray(rawPayload.source_ids)) droppedSourceLinks += rawPayload.source_ids.length;
      let payload = cleanPayload({
        ...rawPayload,
        source_ids: [],
        web_id: normalizedWebId,
      });
      this.validateConfiguredPayload(requireEntityConfig('WebCard'), payload);
      this.validateWebCardSources(payload);
      const prepared = { payload, sourceKey };
      cardKeys.set(sourceKey, prepared);
      return prepared;
    });

    const objectKeys = new Map();
    let legacyObjectsWithoutIds = 0;
    const preparedObjects = objectsInput
      .filter((record) => record?.object_type !== 'text')
      .map((record, index) => {
        const source = requireImportRecord(record, `canvas object ${index + 1}`);
        if (typeof source.object_type !== 'string' || !source.object_type.trim() || source.object_type.length > 100) {
          throw codedError('BEX_ENTITY_INVALID', 'An imported canvas object has an invalid type.');
        }
        let sourceKey = null;
        if (source.id === undefined || source.id === null) {
          if (formatVersion >= 2) {
            throw codedError('BEX_ENTITY_INVALID', 'A version 2 canvas object is missing its portable ID.');
          }
          legacyObjectsWithoutIds += 1;
        } else {
          sourceKey = portableRecordKey(source.id, `Canvas object ${index + 1}`);
          if (objectKeys.has(sourceKey)) {
            throw codedError('BEX_ENTITY_INVALID', 'The imported Knowledge Web has duplicate canvas-object IDs.');
          }
        }
        const { id: _sourceId, ...rawPayload } = source;
        const prepared = {
          objectType: source.object_type,
          payload: cleanPayload({ ...rawPayload, web_id: normalizedWebId }),
          sourceKey,
        };
        if (sourceKey !== null) objectKeys.set(sourceKey, prepared);
        return prepared;
      });

    const skippedReasons = {
      canvasTypeMismatch: 0,
      invalidEndpoint: 0,
      missingCanvasEndpoint: 0,
      missingCardEndpoint: 0,
    };
    const preparedConnections = [];
    for (let index = 0; index < connectionsInput.length; index += 1) {
      const source = requireImportRecord(connectionsInput[index], `connection ${index + 1}`);
      const endpoints = {};
      let skipReason = null;
      for (const side of ['from', 'to']) {
        const rawKind = source[`${side}_kind`];
        const kind = rawKind === undefined || rawKind === null ? 'card' : rawKind;
        if (typeof kind !== 'string' || !kind.trim() || kind.length > 100) {
          skipReason = 'invalidEndpoint';
          break;
        }
        let sourceKey;
        try {
          sourceKey = portableRecordKey(source[`${side}_card_id`], `Connection ${index + 1}`);
        } catch {
          skipReason = 'invalidEndpoint';
          break;
        }
        if (kind === 'card') {
          if (!cardKeys.has(sourceKey)) {
            skipReason = 'missingCardEndpoint';
            break;
          }
        } else {
          const object = objectKeys.get(sourceKey);
          if (!object) {
            skipReason = 'missingCanvasEndpoint';
            break;
          }
          if (object.objectType !== kind) {
            skipReason = 'canvasTypeMismatch';
            break;
          }
        }
        endpoints[side] = { kind, sourceKey };
      }
      if (skipReason) {
        skippedReasons[skipReason] += 1;
        continue;
      }
      const { id: _sourceId, ...rawPayload } = source;
      preparedConnections.push({
        endpoints,
        payload: cleanPayload({ ...rawPayload, web_id: normalizedWebId }),
      });
    }

    const report = Object.freeze({
      accepted: Object.freeze({
        canvasObjects: preparedObjects.length,
        cards: preparedCards.length,
        connections: preparedConnections.length,
      }),
      droppedSourceLinks,
      input: Object.freeze({
        canvasObjects: objectsInput.length,
        cards: cardsInput.length,
        connections: connectionsInput.length,
      }),
      legacyObjectsWithoutIds,
      metadataFields: Object.freeze(Object.keys(webPatch)),
      skippedConnections: connectionsInput.length - preparedConnections.length,
      skippedReasons: Object.freeze(skippedReasons),
    });

    const webConfig = requireEntityConfig('KnowledgeWeb');
    const existingWebRow = this.database.prepare(`
      SELECT ${this.selectColumns(webConfig)} FROM ${webConfig.table} WHERE id = ?
    `).get(normalizedWebId);
    if (!existingWebRow) throw codedError('BEX_ENTITY_NOT_FOUND', 'The Knowledge Web no longer exists.');
    if (!commit) return Object.freeze({ committed: false, report });

    this.database.exec('BEGIN IMMEDIATE');
    try {
      const currentWebRow = this.database.prepare(`
        SELECT ${this.selectColumns(webConfig)} FROM ${webConfig.table} WHERE id = ?
      `).get(normalizedWebId);
      if (!currentWebRow) throw codedError('BEX_ENTITY_NOT_FOUND', 'The Knowledge Web no longer exists.');
      const currentWeb = this.decodeRow('KnowledgeWeb', currentWebRow);

      const cardIds = this.reserveImportIds('WebCard', preparedCards.length);
      const objectIds = this.reserveImportIds('CanvasObject', preparedObjects.length);
      const connectionIds = this.reserveImportIds('WebConnection', preparedConnections.length);
      const cardIdMap = new Map(preparedCards.map((record, index) => [record.sourceKey, cardIds[index]]));
      const objectIdMap = new Map(
        preparedObjects
          .map((record, index) => [record.sourceKey, objectIds[index]])
          .filter(([sourceKey]) => sourceKey !== null),
      );
      const finalizedCards = preparedCards.map((record) => ({ payload: record.payload }));
      const finalizedObjects = preparedObjects.map((record) => ({ payload: record.payload }));
      const finalizedConnections = preparedConnections.map((record) => {
        const fromMap = record.endpoints.from.kind === 'card' ? cardIdMap : objectIdMap;
        const toMap = record.endpoints.to.kind === 'card' ? cardIdMap : objectIdMap;
        return {
          payload: cleanPayload({
            ...record.payload,
            from_card_id: fromMap.get(record.endpoints.from.sourceKey),
            to_card_id: toMap.get(record.endpoints.to.sourceKey),
            web_id: normalizedWebId,
          }),
        };
      });

      for (const entityType of ['WebConnection', 'WebCard', 'CanvasObject']) {
        const config = requireEntityConfig(entityType);
        this.database.prepare(`
          DELETE FROM ${config.table} WHERE ${config.scopeField} = ?
        `).run(normalizedWebId);
      }

      const timestamp = new Date(this.now()).toISOString();
      const webPayload = cleanPayload({ ...currentWeb, ...webPatch });
      this.validateConfiguredPayload(webConfig, webPayload, { defaultOrdering: true, nowMs: this.now() });
      const updatedWeb = this.writeExistingRow(
        'KnowledgeWeb',
        webConfig,
        currentWebRow,
        webPayload,
        timestamp,
      );
      const restoredCards = this.writeImportedRecords('WebCard', finalizedCards, cardIds, timestamp);
      const restoredObjects = this.writeImportedRecords('CanvasObject', finalizedObjects, objectIds, timestamp);
      const restoredConnections = this.writeImportedRecords(
        'WebConnection',
        finalizedConnections,
        connectionIds,
        timestamp,
      );

      this.database.exec('COMMIT');
      return Object.freeze({
        committed: true,
        report,
        snapshot: Object.freeze({
          canvasObjects: Object.freeze(restoredObjects),
          cards: Object.freeze(restoredCards),
          connections: Object.freeze(restoredConnections),
        }),
        web: updatedWeb,
      });
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  restoreKnowledgeWebGraph(webId, snapshotValue) {
    this.assertReady('KnowledgeWeb');
    const normalizedWebId = requireEntityId(webId);
    const parent = this.database.prepare(`
      SELECT id FROM local_knowledge_webs WHERE id = ?
    `).get(normalizedWebId);
    if (!parent) throw codedError('BEX_ENTITY_NOT_FOUND', 'The Knowledge Web no longer exists.');

    const normalizedVersion = this.validateWebVersion({
      web_id: normalizedWebId,
      label: null,
      snapshot: snapshotValue,
    });
    const snapshot = JSON.parse(normalizedVersion.snapshot);
    const cardIds = new Set(snapshot.cards.map((record) => record.id));
    const objectIds = new Set(snapshot.canvasObjects.map((record) => record.id));
    for (const connection of snapshot.connections) {
      for (const side of ['from', 'to']) {
        const endpointId = requireEntityId(connection[`${side}_card_id`]);
        const endpointKind = connection[`${side}_kind`] || 'card';
        const validEndpoint = endpointKind === 'card'
          ? cardIds.has(endpointId)
          : objectIds.has(endpointId);
        if (!validEndpoint) {
          throw codedError('BEX_ENTITY_INVALID', 'The version snapshot contains a broken connection.');
        }
      }
    }

    const groups = [
      ['cards', 'WebCard'],
      ['connections', 'WebConnection'],
      ['canvasObjects', 'CanvasObject'],
    ];
    this.database.exec('BEGIN IMMEDIATE');
    try {
      for (const [field, entityType] of groups) {
        const config = requireEntityConfig(entityType);
        for (const record of snapshot[field]) {
          const collision = this.database.prepare(`
            SELECT ${config.scopeField} AS scope_id
            FROM ${config.table}
            WHERE id = ?
          `).get(record.id);
          if (collision && Number(collision.scope_id) !== normalizedWebId) {
            throw codedError('BEX_ENTITY_INVALID', 'The version snapshot conflicts with another web.');
          }
        }
      }

      for (const [, entityType] of groups) {
        const config = requireEntityConfig(entityType);
        this.database.prepare(`
          DELETE FROM ${config.table} WHERE ${config.scopeField} = ?
        `).run(normalizedWebId);
      }

      const timestamp = new Date(this.now()).toISOString();
      const restored = {};
      for (const [field, entityType] of groups) {
        const config = requireEntityConfig(entityType);
        let largestId = 0;
        restored[field] = snapshot[field].map((record) => {
          const entityId = requireEntityId(record.id);
          largestId = Math.max(largestId, entityId);
          const payload = cleanPayload({
            ...record,
            [config.scopeField]: normalizedWebId,
          }, config.maxBytes);
          const encryptedPayload = this.privacyVault.encryptValue(
            payload,
            entityPurpose(entityType, entityId),
          );
          this.database.prepare(`
            INSERT INTO ${config.table}
              (id, ${config.scopeField}, encrypted_payload, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `).run(entityId, normalizedWebId, encryptedPayload, timestamp, timestamp);
          return Object.freeze({
            ...payload,
            id: entityId,
            created_date: timestamp,
            updated_date: timestamp,
          });
        });
        if (largestId > 0) {
          this.database.prepare(`
            INSERT INTO local_entity_sequences (entity_type, last_id)
            VALUES (?, ?)
            ON CONFLICT(entity_type) DO UPDATE
            SET last_id = MAX(last_id, excluded.last_id)
          `).run(entityType, largestId);
        }
        restored[field] = Object.freeze(restored[field]);
      }
      this.database.exec('COMMIT');
      return Object.freeze(restored);
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  writeExistingRow(entityType, config, row, payload, timestamp) {
    const normalizedId = requireEntityId(row.id);
    const encryptedPayload = this.privacyVault.encryptValue(
      entityType === 'Spreadsheet' ? encodeSpreadsheetPayload(payload) : payload,
      entityPurpose(entityType, normalizedId),
    );
    this.database.prepare(`
      UPDATE ${config.table}
      SET encrypted_payload = ?, updated_at = ?
      WHERE id = ?
    `).run(encryptedPayload, timestamp, normalizedId);
    return Object.freeze({
      ...payload,
      id: normalizedId,
      created_date: row.created_at,
      updated_date: timestamp,
    });
  }

  decodeRow(entityType, row, { readOnly = false, omitWorkbook = false } = {}) {
    const config = requireEntityConfig(entityType);
    let payload = this.privacyVault.decryptValue(
      row.encrypted_payload,
      entityPurpose(entityType, Number(row.id)),
    );
    if (entityType === 'Spreadsheet') payload = decodeSpreadsheetPayload(payload, { omitWorkbook });
    if (entityType === 'StudyChapter') {
      const separated = separateApiStudyRecord(payload);
      if (JSON.stringify(separated) !== JSON.stringify(payload)) {
        // Rewrite only the fetched body, in the existing encrypted row. Preserve
        // its ID, writing, links, and timestamps; this is safe to repeat on restore.
        if (!readOnly) {
          const encrypted = this.privacyVault.encryptValue(separated, entityPurpose(entityType, Number(row.id)));
          this.database.prepare(`UPDATE ${config.table} SET encrypted_payload = ? WHERE id = ?`).run(encrypted, row.id);
        }
        payload = separated;
      }
    }
    if (config.scopeField) {
      const storedScopeId = requireEntityId(row[config.scopeField]);
      if (
        payload[config.scopeField] !== undefined
        && requireEntityId(payload[config.scopeField]) !== storedScopeId
      ) {
        throw codedError('BEX_ENTITY_INVALID', 'The local record has an invalid parent link.');
      }
      payload[config.scopeField] = storedScopeId;
    }
    return Object.freeze({
      ...payload,
      id: Number(row.id),
      created_date: row.created_at,
      updated_date: row.updated_at,
    });
  }

  create(entityType, value) {
    const config = this.assertReady(entityType);
    let payload = cleanPayload(value, config.maxBytes);
    let scopeId = null;
    if (config.scopeField) {
      scopeId = requireEntityId(payload[config.scopeField]);
      payload[config.scopeField] = scopeId;
      const parent = this.database.prepare(`
        SELECT id FROM ${config.parentTable} WHERE id = ?
      `).get(scopeId);
      if (!parent) {
        throw codedError('BEX_ENTITY_INVALID', 'The parent Knowledge Web no longer exists.');
      }
    }
    const nowMs = this.now();
    this.validateConfiguredPayload(config, payload, { defaultOrdering: true, nowMs });
    if (entityType === 'Asset') payload = this.validateAsset(payload);
    if (entityType === 'BrainSource') payload = this.validateBrainSource(payload, { creating: true });
    if (entityType === 'ChapterArtCatalog') {
      payload = this.validateChapterArtCatalog(payload, { creating: true });
    }
    if (entityType === 'MindLink') this.validateMindLink(payload);
    if (entityType === 'Timegraph') payload = this.validateTimegraph(payload);
    if (entityType === 'WebVersion') payload = this.validateWebVersion(payload);
    if (entityType === 'WebCard') this.validateWebCardSources(payload);
    if (STUDY_ENTITY_TYPES.has(entityType)) {
      payload = this.validateStudyEntity(entityType, payload, { creating: true });
    }
    const timestamp = new Date(nowMs).toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const sequence = this.database.prepare(`
        INSERT INTO local_entity_sequences (entity_type, last_id)
        VALUES (?, 1)
        ON CONFLICT(entity_type) DO UPDATE SET last_id = last_id + 1
        RETURNING last_id
      `).get(entityType);
      const entityId = Number(sequence.last_id);
      const encryptedPayload = this.privacyVault.encryptValue(
        entityType === 'Spreadsheet' ? encodeSpreadsheetPayload(payload) : payload,
        entityPurpose(entityType, entityId),
      );
      if (config.scopeField) {
        this.database.prepare(`
          INSERT INTO ${config.table}
            (id, ${config.scopeField}, encrypted_payload, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(entityId, scopeId, encryptedPayload, timestamp, timestamp);
      } else {
        this.database.prepare(`
          INSERT INTO ${config.table} (id, encrypted_payload, created_at, updated_at)
          VALUES (?, ?, ?, ?)
        `).run(entityId, encryptedPayload, timestamp, timestamp);
      }
      this.database.exec('COMMIT');
      return Object.freeze({
        ...payload,
        id: entityId,
        created_date: timestamp,
        updated_date: timestamp,
      });
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  get(entityType, entityId) {
    const config = this.assertReady(entityType);
    const normalizedId = requireEntityId(entityId);
    const scopeColumn = config.scopeField ? `, ${config.scopeField}` : '';
    const row = this.database.prepare(`
      SELECT id${scopeColumn}, encrypted_payload, created_at, updated_at
      FROM ${config.table}
      WHERE id = ?
    `).get(normalizedId);
    if (!row) throw codedError('BEX_ENTITY_NOT_FOUND', 'The local record was not found.');
    return this.decodeRow(entityType, row);
  }

  /** One read transaction prevents exports from mixing states across windows.
   * Return the same safe fields as list(), with no archive or filesystem work. */
  readSnapshot(entityTypes) {
    if (!Array.isArray(entityTypes) || !entityTypes.length || entityTypes.length > 32
      || new Set(entityTypes).size !== entityTypes.length) {
      throw codedError('BEX_ENTITY_INVALID', 'The requested library snapshot is invalid.');
    }
    const configs = entityTypes.map(type => this.assertReady(type));
    const snapshot = {};
    let byteLength = 0;
    this.database.exec('BEGIN');
    try {
      for (const [index, type] of entityTypes.entries()) {
        const config = configs[index], records = [];
        const query = this.database.prepare(`SELECT ${this.selectColumns(config)} FROM ${config.table} WHERE id > ? ORDER BY id LIMIT 1000`);
        let cursor = 0;
        while (true) {
          const rows = query.all(cursor);
          if (records.length + rows.length > 50000) throw codedError('BEX_ENTITY_SNAPSHOT_TOO_LARGE', 'The complete library snapshot exceeds its record limit.');
          for (const row of rows) {
            const record = { ...this.decodeRow(type, row, { readOnly: true }) };
            if (!config.snapshotFullPayload) for (const field of config.listOmitFields || []) delete record[field];
            byteLength += Buffer.byteLength(JSON.stringify(record), 'utf8');
            if (byteLength > 128 * 1024 * 1024) throw codedError('BEX_ENTITY_SNAPSHOT_TOO_LARGE', 'The complete library snapshot exceeds 128 MB.');
            records.push(record);
          }
          if (rows.length < 1000) break;
          cursor = Number(rows.at(-1).id);
        }
        snapshot[type] = records;
      }
      this.database.exec('COMMIT');
      return snapshot;
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }

  list(entityType, query = {}) {
    const config = this.assertReady(entityType);
    if (!isPlainObject(query)) {
      throw codedError('BEX_ENTITY_INVALID', 'The local record query is invalid.');
    }
    const filter = query.filter === undefined ? {} : query.filter;
    if (!isPlainObject(filter) || Object.keys(filter).length > MAX_FILTER_FIELDS) {
      throw codedError('BEX_ENTITY_INVALID', 'The local record filter is invalid.');
    }
    assertSafeValue(filter);
    const rawLimit = query.limit === undefined ? 1000 : Number(query.limit);
    if (!Number.isSafeInteger(rawLimit) || rawLimit < 1 || rawLimit > 5000) {
      throw codedError('BEX_ENTITY_INVALID', 'The local record limit is invalid.');
    }
    const cursor = query.cursor === undefined || query.cursor === null
      ? null
      : Number(query.cursor);
    if (cursor !== null && (!Number.isSafeInteger(cursor) || cursor < 0)) {
      throw codedError('BEX_ENTITY_INVALID', 'The local record cursor is invalid.');
    }
    const sort = query.sort === undefined ? '-updated_date' : query.sort;
    if (typeof sort !== 'string' || !/^-?[A-Za-z][A-Za-z0-9_]{0,119}$/.test(sort)) {
      throw codedError('BEX_ENTITY_INVALID', 'The local record sort is invalid.');
    }
    if (cursor !== null && sort !== 'id') {
      throw codedError('BEX_ENTITY_INVALID', 'Paginated local records must be ordered by id.');
    }

    const scopeColumn = config.scopeField ? `, ${config.scopeField}` : '';
    const hasDirectScopeFilter = config.scopeField
      && Object.prototype.hasOwnProperty.call(filter, config.scopeField)
      && !Array.isArray(filter[config.scopeField]);
    const rows = hasDirectScopeFilter
      ? this.database.prepare(`
        SELECT id${scopeColumn}, encrypted_payload, created_at, updated_at
        FROM ${config.table}
        WHERE ${config.scopeField} = ?
      `).all(requireEntityId(filter[config.scopeField]))
      : this.database.prepare(`
        SELECT id${scopeColumn}, encrypted_payload, created_at, updated_at
        FROM ${config.table}
      `).all();
    const records = rows
      .map((row) => this.decodeRow(entityType, row, { omitWorkbook: entityType === 'Spreadsheet' }))
      .filter((record) => Object.entries(filter).every(
        ([key, expected]) => valueMatches(record[key], expected),
      ))
      .filter((record) => cursor === null || record.id > cursor);
    const descending = sort.startsWith('-');
    const sortField = descending ? sort.slice(1) : sort;
    records.sort((left, right) => {
      const comparison = compareValues(left[sortField], right[sortField]);
      return descending ? -comparison : comparison;
    });
    const limitedRecords = records.slice(0, rawLimit);
    if (!config.listOmitFields) return limitedRecords;
    return limitedRecords.map((record) => {
      const listedRecord = { ...record };
      for (const field of config.listOmitFields) delete listedRecord[field];
      return Object.freeze(listedRecord);
    });
  }

  update(entityType, entityId, patch) {
    const config = this.assertReady(entityType);
    const normalizedId = requireEntityId(entityId);
    const cleanedPatch = cleanPayload(patch, config.maxBytes);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const row = this.database.prepare(`
        SELECT ${this.selectColumns(config)}
        FROM ${config.table}
        WHERE id = ?
      `).get(normalizedId);
      if (!row) throw codedError('BEX_ENTITY_NOT_FOUND', 'The local record was not found.');
      const current = this.decodeRow(entityType, row);
      if (
        config.scopeField
        && Object.prototype.hasOwnProperty.call(cleanedPatch, config.scopeField)
        && requireEntityId(cleanedPatch[config.scopeField]) !== current[config.scopeField]
      ) {
        throw codedError('BEX_ENTITY_INVALID', 'A local record cannot move between Knowledge Webs.');
      }
      for (const field of config.immutableFields || []) {
        if (
          Object.prototype.hasOwnProperty.call(cleanedPatch, field)
          && cleanedPatch[field] !== current[field]
        ) {
          throw codedError('BEX_ENTITY_INVALID', 'That local record link cannot be changed.');
        }
      }
      let payload = cleanPayload({ ...current, ...cleanedPatch }, config.maxBytes);
      const nowMs = this.now();
      this.validateConfiguredPayload(config, payload, { defaultOrdering: true, nowMs, existingId: normalizedId });
      if (entityType === 'Asset') payload = this.validateAsset(payload);
      if (entityType === 'BrainSource') payload = this.validateBrainSource(payload);
      if (entityType === 'ChapterArtCatalog') payload = this.validateChapterArtCatalog(payload);
      if (entityType === 'MindLink') this.validateMindLink(payload);
      if (entityType === 'Timegraph') payload = this.validateTimegraph(payload);
      if (entityType === 'WebVersion') payload = this.validateWebVersion(payload);
      if (entityType === 'WebCard') this.validateWebCardSources(payload);
      if (STUDY_ENTITY_TYPES.has(entityType)) {
        payload = this.validateStudyEntity(entityType, payload, { existingId: normalizedId });
      }
      const timestamp = new Date(nowMs).toISOString();
      const record = this.writeExistingRow(entityType, config, row, payload, timestamp);
      this.database.exec('COMMIT');
      return record;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  delete(entityType, entityId) {
    const config = this.assertReady(entityType);
    const normalizedId = requireEntityId(entityId);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const timestamp = new Date(this.now()).toISOString();
      if (entityType === 'WebFolder') {
        for (const containedType of ['KnowledgeWeb', 'MindNote', 'Timegraph', 'StudyChapter', 'Spreadsheet']) {
          const containedConfig = requireEntityConfig(containedType);
          for (const row of this.allRows(containedConfig)) {
            const current = this.decodeRow(containedType, row);
            if (current.folder_id !== normalizedId) continue;
            const payload = cleanPayload(
              { ...current, folder_id: null },
              containedConfig.maxBytes,
            );
            this.validateConfiguredPayload(containedConfig, payload, {
              defaultOrdering: true,
              nowMs: this.now(),
            });
            this.writeExistingRow(containedType, containedConfig, row, payload, timestamp);
          }
        }
      }
      if (entityType === 'KnowledgeWeb') {
        this.deleteMindLinksForEndpoint('web', normalizedId);
        this.detachBrainSourcesFromWeb(normalizedId, timestamp);
      }
      if (entityType === 'MindNote') this.deleteMindLinksForEndpoint('note', normalizedId);
      if (entityType === 'BrainSource') this.detachBrainSourceFromCards(normalizedId, timestamp);
      if (entityType === 'Annotation') this.deleteDrawingsForAnnotation(normalizedId);
      if (entityType === 'StudyCanvasObject' || entityType === 'Annotation') {
        this.deleteStudyCanvasConnections(entityType === 'Annotation' ? 'annotation' : 'object', normalizedId);
      }
      if (entityType === 'StudyChapter') {
        const row = this.database.prepare(`
          SELECT ${this.selectColumns(config)} FROM ${config.table} WHERE id = ?
        `).get(normalizedId);
        if (row) this.deleteStudyChapterChildren(this.decodeRow(entityType, row));
      }
      const result = this.database.prepare(`DELETE FROM ${config.table} WHERE id = ?`).run(normalizedId);
      if (Number(result.changes) !== 1) {
        throw codedError('BEX_ENTITY_NOT_FOUND', 'The local record was not found.');
      }
      this.database.exec('COMMIT');
      return Object.freeze({ deleted: true, id: normalizedId });
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  reorder(entityType, entityIds, containerId = null) {
    const config = this.assertReady(entityType);
    if (!config.orderField) {
      throw codedError('BEX_ENTITY_UNSUPPORTED', 'That type of local record cannot be reordered.');
    }
    const orderedIds = requireReorderIds(entityIds);
    const normalizedContainerId = config.containerField
      ? optionalEntityId(containerId)
      : null;
    if (!config.containerField && containerId !== null && containerId !== undefined) {
      throw codedError('BEX_ENTITY_INVALID', 'That local record order has an invalid container.');
    }

    this.database.exec('BEGIN IMMEDIATE');
    try {
      if (config.containerField && normalizedContainerId !== null) {
        const container = this.database.prepare(`
          SELECT id FROM ${config.containerTable} WHERE id = ?
        `).get(normalizedContainerId);
        if (!container) throw codedError('BEX_ENTITY_INVALID', 'The selected folder no longer exists.');
      }

      const rows = this.allRows(config);
      const recordsById = new Map(rows.map((row) => {
        const record = this.decodeRow(entityType, row);
        return [record.id, { record, row }];
      }));
      for (const entityId of orderedIds) {
        if (!recordsById.has(entityId)) {
          throw codedError('BEX_ENTITY_NOT_FOUND', 'A reordered local record no longer exists.');
        }
      }

      if (config.containerField) {
        const expectedIds = [...recordsById.values()]
          .filter(({ record }) => optionalEntityId(record[config.containerField]) === normalizedContainerId)
          .map(({ record }) => record.id);
        if (expectedIds.some((entityId) => !orderedIds.includes(entityId))) {
          throw codedError('BEX_ENTITY_INVALID', 'The local record order is incomplete.');
        }
      } else if (
        orderedIds.length !== recordsById.size
        || [...recordsById.keys()].some((entityId) => !orderedIds.includes(entityId))
      ) {
        throw codedError('BEX_ENTITY_INVALID', 'The local record order is incomplete.');
      }

      const timestamp = new Date(this.now()).toISOString();
      const records = orderedIds.map((entityId, index) => {
        const { record, row } = recordsById.get(entityId);
        const payload = cleanPayload({
          ...record,
          [config.orderField]: index,
          ...(config.containerField ? { [config.containerField]: normalizedContainerId } : {}),
        }, config.maxBytes);
        this.validateConfiguredPayload(config, payload, { nowMs: this.now() });
        return this.writeExistingRow(entityType, config, row, payload, timestamp);
      });
      this.database.exec('COMMIT');
      return records;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

module.exports = {
  LocalEntityStore,
};
