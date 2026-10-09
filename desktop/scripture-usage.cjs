'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Local request ledger partitioned by key fingerprint.
 * Records counts and timestamps without storing API keys or user search queries.
 */
class ScriptureUsageLedger {
  constructor({ storageDir } = {}) {
    this.storageDir = storageDir;
  }

  _getFilePath(fingerprint) {
    if (!this.storageDir || !fingerprint) return null;
    return path.join(this.storageDir, `scripture-usage-${fingerprint}.json`);
  }

  _readLedger(fingerprint) {
    const file = this._getFilePath(fingerprint);
    if (!file) return { totalRequests: 0, byDay: {}, recent: [] };
    try {
      if (fs.existsSync(file)) {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      }
    } catch {
      // Ignore corrupt ledger read
    }
    return { totalRequests: 0, byDay: {}, recent: [] };
  }

  _writeLedger(fingerprint, data) {
    const file = this._getFilePath(fingerprint);
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      const tmp = `${file}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
      fs.renameSync(tmp, file);
    } catch {
      // Non-fatal
    }
  }

  recordRequest({ fingerprint, endpointType, status, durationMs }) {
    if (!fingerprint) return;
    const ledger = this._readLedger(fingerprint);
    const day = new Date().toISOString().slice(0, 10);
    ledger.totalRequests = (ledger.totalRequests || 0) + 1;
    ledger.byDay = ledger.byDay || {};
    ledger.byDay[day] = (ledger.byDay[day] || 0) + 1;

    ledger.recent = ledger.recent || [];
    ledger.recent.unshift({
      timestamp: Date.now(),
      endpointType: endpointType || 'content',
      status: status || 200,
      durationMs: durationMs || 0,
    });
    // Keep at most 50 recent records
    if (ledger.recent.length > 50) {
      ledger.recent = ledger.recent.slice(0, 50);
    }

    this._writeLedger(fingerprint, ledger);
  }

  getSummary(fingerprint) {
    if (!fingerprint) {
      return { totalRequests: 0, requestsToday: 0, lastRequest: null };
    }
    const ledger = this._readLedger(fingerprint);
    const day = new Date().toISOString().slice(0, 10);
    return {
      totalRequests: ledger.totalRequests || 0,
      requestsToday: (ledger.byDay && ledger.byDay[day]) || 0,
      lastRequest: ledger.recent && ledger.recent[0] ? ledger.recent[0].timestamp : null,
    };
  }
}

module.exports = { ScriptureUsageLedger };
