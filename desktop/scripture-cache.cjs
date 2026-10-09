'use strict';

/**
 * In-memory / disk cache with bounded capacity and licensing lifetimes:
 * - Catalog: 24-hour freshness
 * - Book/Chapter maps: 7-day freshness
 * - Scripture content (passages, verses, chapters): 14-day freshness, max 499 verses per Bible
 */
class ScriptureCache {
  constructor({ maxVersesPerBible = 499 } = {}) {
    this.maxVersesPerBible = maxVersesPerBible;
    this.catalog = null;
    this.catalogTime = 0;
    this.books = new Map(); // bibleId -> { time, data }
    this.content = new Map(); // `${bibleId}:${type}:${id}` -> { time, verseCount, data }
  }

  // --- Catalog (24h) ---
  getCatalog() {
    if (!this.catalog) return null;
    const age = Date.now() - this.catalogTime;
    if (age > 24 * 60 * 60 * 1000) {
      this.catalog = null;
      return null;
    }
    return this.catalog;
  }

  setCatalog(data) {
    this.catalog = data;
    this.catalogTime = Date.now();
  }

  // --- Books / Chapters (7 days) ---
  getBooks(bibleId) {
    const entry = this.books.get(bibleId);
    if (!entry) return null;
    const age = Date.now() - entry.time;
    if (age > 7 * 24 * 60 * 60 * 1000) {
      this.books.delete(bibleId);
      return null;
    }
    return entry.data;
  }

  setBooks(bibleId, data) {
    this.books.set(bibleId, { time: Date.now(), data });
  }

  // --- Content (14 days, max 499 verses per Bible) ---
  getContent(bibleId, type, id) {
    const key = `${bibleId}:${type}:${id}`;
    const entry = this.content.get(key);
    if (!entry) return null;
    const age = Date.now() - entry.time;
    if (age > 14 * 24 * 60 * 60 * 1000) {
      this.content.delete(key);
      return null;
    }
    // Touch LRU
    entry.lastAccess = Date.now();
    return entry.data;
  }

  setContent(bibleId, type, id, data, verseCount = 1) {
    const key = `${bibleId}:${type}:${id}`;
    // Prune if Bible exceeds max verses
    let currentVerses = 0;
    const bibleEntries = [];
    for (const [k, v] of this.content.entries()) {
      if (k.startsWith(`${bibleId}:`)) {
        currentVerses += v.verseCount;
        bibleEntries.push({ key: k, lastAccess: v.lastAccess || v.time, verseCount: v.verseCount });
      }
    }

    if (currentVerses + verseCount > this.maxVersesPerBible) {
      // Sort oldest accessed first
      bibleEntries.sort((a, b) => a.lastAccess - b.lastAccess);
      while (currentVerses + verseCount > this.maxVersesPerBible && bibleEntries.length > 0) {
        const oldest = bibleEntries.shift();
        this.content.delete(oldest.key);
        currentVerses -= oldest.verseCount;
      }
    }

    this.content.set(key, {
      time: Date.now(),
      lastAccess: Date.now(),
      verseCount: verseCount || 1,
      data,
    });
  }

  clear() {
    this.catalog = null;
    this.catalogTime = 0;
    this.books.clear();
    this.content.clear();
  }
}

module.exports = { ScriptureCache };
