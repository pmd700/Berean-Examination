'use strict';

const { deflateRawSync, inflateRawSync } = require('node:zlib');

const MAX_WORKBOOK_BYTES = 32 * 1024 * 1024;
const FORMAT = 'bex-spreadsheet-deflate-v1';

function invalid(message = 'The spreadsheet data is invalid.') {
  return Object.assign(new Error(message), { code: 'BEX_ENTITY_INVALID' });
}

// Only occupied cells are supplied by the workbook model. Compression happens
// before the existing authenticated encryption, never in plaintext disk files.
function encodeSpreadsheetPayload(payload) {
  const bytes = Buffer.from(JSON.stringify(payload.workbook), 'utf8');
  if (bytes.length > MAX_WORKBOOK_BYTES) throw invalid('The workbook is too large.');
  try {
    const compressed = deflateRawSync(bytes, { level: 6 });
    // Very small or incompressible documents need no compression overhead.
    if (compressed.length * 4 / 3 + 96 >= bytes.length) return payload;
    return { ...payload, workbook: { storage: FORMAT, size: bytes.length, data: compressed.toString('base64') } };
  } finally {
    bytes.fill(0);
  }
}

function decodeSpreadsheetPayload(payload, { omitWorkbook = false } = {}) {
  if (omitWorkbook) {
    const metadata = { ...payload };
    delete metadata.workbook;
    return metadata;
  }
  const encoded = payload.workbook;
  if (encoded?.storage !== FORMAT) return payload;
  if (!Number.isSafeInteger(encoded.size) || encoded.size < 1 || encoded.size > MAX_WORKBOOK_BYTES
    || typeof encoded.data !== 'string' || encoded.data.length > MAX_WORKBOOK_BYTES * 2
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded.data)) throw invalid();
  let bytes;
  try {
    bytes = inflateRawSync(Buffer.from(encoded.data, 'base64'), { maxOutputLength: encoded.size });
    if (bytes.length !== encoded.size) throw invalid();
    const workbook = JSON.parse(bytes.toString('utf8'));
    if (!workbook || typeof workbook !== 'object' || Array.isArray(workbook)) throw invalid();
    return { ...payload, workbook };
  } catch {
    throw invalid('The stored spreadsheet could not be decoded safely.');
  } finally {
    bytes?.fill(0);
  }
}

module.exports = { encodeSpreadsheetPayload, decodeSpreadsheetPayload, MAX_WORKBOOK_BYTES };
