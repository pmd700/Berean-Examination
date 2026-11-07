'use strict';

/**
 * Proves that a Timegraph survives a real Electron launch cycle in the encrypted
 * library: it is written, it is unreadable as plaintext on disk, it decrypts back
 * byte-for-byte on a second launch, and the store refuses malformed or hostile
 * payloads rather than storing them for the renderer to trip over later.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, safeStorage } = require('electron');
const {
  CURRENT_SCHEMA_VERSION,
  closeDatabase,
  createLocalEntity,
  deleteLocalEntity,
  getLocalEntity,
  initializeDatabase,
  listLocalEntities,
  updateLocalEntity,
} = require('./database.cjs');
const { createSafeStorageProtector } = require('./privacy-vault.cjs');

const SECRET_TITLE = 'DISPOSABLE-TIMEGRAPH-TITLE';
const SECRET_EVENT = 'DISPOSABLE-TIMEGRAPH-EVENT';
const RICH_DESCRIPTION = '<p><strong>Rich description</strong></p>' + '<p>Long paragraph</p>'.repeat(600);

function point(year, precision = 'year', month = null, day = null) {
  return { year, month, day, precision };
}

function event(id, title, year, extra = {}) {
  return {
    id,
    title,
    description: '',
    start: point(year),
    end: null,
    color: 'violet',
    position: 'above',
    align: 'center',
    marker: 'dot',
    scale: 1,
    tags: [],
    media: [],
    links: [],
    ...extra,
  };
}

function assertPlaintextAbsent(libraryPath) {
  for (const folderName of ['Database', 'Media']) {
    const folder = path.join(libraryPath, folderName);
    if (!fs.existsSync(folder)) continue;
    for (const fileName of fs.readdirSync(folder)) {
      const filePath = path.join(folder, fileName);
      if (!fs.statSync(filePath).isFile()) continue;
      const bytes = fs.readFileSync(filePath);
      for (const secret of [SECRET_TITLE, SECRET_EVENT]) {
        assert.equal(
          bytes.includes(Buffer.from(secret)),
          false,
          `${secret} leaked into ${folderName}/${fileName}`,
        );
      }
    }
  }
}

function createPhase(libraryPath, protector) {
  assert.equal(initializeDatabase(libraryPath, { privacyProtector: protector }).schemaVersion, CURRENT_SCHEMA_VERSION);

  const saved = createLocalEntity('Timegraph', {
    title: SECRET_TITLE,
    description: 'Reformation chronology',
    events: [
      event('e-luther', SECRET_EVENT, 1483, {
        start: point(1483, 'exact', 11, 10),
        tags: ['people'],
        description: RICH_DESCRIPTION,
        links: [{ kind: 'keyword', id: '7', label: 'Justification' }],
      }),
      // 776 BCE is astronomical year -775: the store must accept negatives.
      event('e-olympiad', 'First Olympiad', -775, { position: 'below', color: 'gold' }),
      event('e-deeptime', 'Formation of the earth', 1 - 4.54e9, {
        start: point(1 - 4.54e9, 'approximate'),
        marker: 'ring',
      }),
      event('e-trent', 'Council of Trent', 1545, {
        end: point(1563),
        color: 'teal',
        marker: 'square',
      }),
    ],
    view: { centerYear: 1500, yearsPerPixel: 0.5 },
  });

  assert.ok(saved.id > 0);
  assert.equal(saved.events.length, 4);
  assert.equal(saved.events.find((e) => e.id === 'e-olympiad').start.year, -775);
  assert.equal(saved.events.find((e) => e.id === 'e-deeptime').start.year, 1 - 4.54e9);
  assert.equal(saved.events.find((e) => e.id === 'e-trent').end.year, 1563);

  // Hostile and malformed payloads must be refused by the store itself.
  const rejects = [
    ['a javascript: attachment', {
      title: 'x',
      events: [event('a', 'a', 1500, { media: [{ kind: 'image', url: 'javascript:alert(1)' }] })],
    }],
    ['an unknown link kind', {
      title: 'x',
      events: [event('a', 'a', 1500, { links: [{ kind: 'shell', id: 'rm -rf' }] })],
    }],
    ['an event with no date', {
      title: 'x',
      events: [{ ...event('a', 'a', 1500), start: null }],
    }],
    ['a year beyond the axis', {
      title: 'x',
      events: [event('a', 'a', 5e11)],
    }],
    ['a duplicate event id', {
      title: 'x',
      events: [event('a', 'one', 1500), event('a', 'two', 1600)],
    }],
    ['an unknown colour', {
      title: 'x',
      events: [event('a', 'a', 1500, { color: 'chartreuse' })],
    }],
    ['a non-finite scale', {
      title: 'x',
      events: [event('a', 'a', 1500, { scale: Number.POSITIVE_INFINITY })],
    }],
    ['events that are not an array', { title: 'x', events: 'lots' }],
  ];
  for (const [label, payload] of rejects) {
    assert.throws(
      () => createLocalEntity('Timegraph', payload),
      (error) => error?.code === 'BEX_ENTITY_INVALID',
      `store accepted ${label}`,
    );
  }
  // A rejected write must not have left a record behind.
  assert.equal(listLocalEntities('Timegraph', {}).length, 1);

  closeDatabase();
  assertPlaintextAbsent(libraryPath);

  return [
    `schema ${CURRENT_SCHEMA_VERSION} stores a Timegraph with BCE, deep-time, exact and ranged events`,
    'the store rejects unsafe URLs, unknown link kinds, undated events, out-of-range years, duplicate ids and bad enums',
    'no Timegraph title or event text is readable as plaintext anywhere in the library',
  ];
}

function reopenPhase(libraryPath, protector) {
  assert.equal(initializeDatabase(libraryPath, { privacyProtector: protector }).schemaVersion, CURRENT_SCHEMA_VERSION);

  const [listed] = listLocalEntities('Timegraph', {});
  assert.ok(listed, 'the Timegraph did not survive the relaunch');
  const reopened = getLocalEntity('Timegraph', listed.id);

  assert.equal(reopened.title, SECRET_TITLE);
  assert.equal(reopened.events.length, 4);
  const luther = reopened.events.find((e) => e.id === 'e-luther');
  assert.equal(luther.title, SECRET_EVENT);
  assert.equal(luther.description, RICH_DESCRIPTION);
  assert.deepEqual(luther.start, point(1483, 'exact', 11, 10));
  assert.deepEqual(luther.links, [{ kind: 'keyword', id: '7', label: 'Justification' }]);
  assert.equal(reopened.events.find((e) => e.id === 'e-olympiad').start.year, -775);
  assert.equal(reopened.events.find((e) => e.id === 'e-deeptime').start.year, 1 - 4.54e9);
  assert.deepEqual(reopened.view, { centerYear: 1500, yearsPerPixel: 0.5 });

  // Editing the one record is what makes every embed of it update.
  const edited = updateLocalEntity('Timegraph', reopened.id, {
    ...reopened,
    title: 'Renamed chronology',
    events: reopened.events.map((candidate) => (
      candidate.id === 'e-trent' ? { ...candidate, title: 'Trent (renamed)' } : candidate
    )),
  });
  assert.equal(edited.title, 'Renamed chronology');
  assert.equal(edited.events.find((e) => e.id === 'e-trent').title, 'Trent (renamed)');
  assert.equal(edited.events.length, 4);

  // A thousand events must round-trip inside the payload ceiling.
  const many = Array.from({ length: 1000 }, (_, index) =>
    event(`bulk-${index}`, `Bulk event ${index}`, 1000 + index));
  const bulk = updateLocalEntity('Timegraph', reopened.id, { ...edited, events: many });
  assert.equal(bulk.events.length, 1000);
  const bulkReread = getLocalEntity('Timegraph', reopened.id);
  assert.equal(bulkReread.events.length, 1000);
  assert.equal(bulkReread.events[999].title, 'Bulk event 999');

  deleteLocalEntity('Timegraph', reopened.id);
  assert.equal(listLocalEntities('Timegraph', {}).length, 0);

  closeDatabase();
  return [
    'a second launch decrypts the same Timegraph including exact, BCE and deep-time dates and its saved view',
    'editing the single shared record updates it in place, which is what propagates to every embed',
    '1000 events round-trip through the encrypted payload and reread intact',
    'deleting a Timegraph removes it completely',
  ];
}

async function main() {
  const phase = process.argv[2];
  const libraryPath = path.resolve(process.argv[3] || '');
  assert.ok(phase === 'create' || phase === 'reopen');
  assert.ok(libraryPath);
  const protector = createSafeStorageProtector(safeStorage);
  const checks = phase === 'create'
    ? createPhase(libraryPath, protector)
    : reopenPhase(libraryPath, protector);
  process.stdout.write(`BEX_TIMEGRAPH_PROOF ${JSON.stringify({ phase, checks })}\n`);
}

app.setName('BEX Launcher Official');
if (process.platform === 'darwin' && app.dock) app.dock.hide();
app.whenReady().then(async () => {
  try {
    await main();
    app.exit(0);
  } catch (error) {
    process.stderr.write(`${error?.stack || error}\n`);
    app.exit(1);
  }
});
