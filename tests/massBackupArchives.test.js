import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import localEntityStoreModule from '../desktop/local-entity-store.cjs';
import {
  MASS_BACKUP_CATEGORY_SPECS,
  MASS_BACKUP_DEFAULT_LIMITS,
  buildMassBackupArchives,
  listAllEntityRecords,
} from '../src/lib/massBackup.js';

const { LocalEntityStore } = localEntityStoreModule;

async function openArchive(archive) {
  return JSZip.loadAsync(archive.bytes);
}

async function readManifest(archive) {
  const zip = await openArchive(archive);
  return JSON.parse(await zip.file('_bex-mass-backup.json').async('string'));
}

describe('Mass Backup archive generation', () => {
  it('creates three separate archives with stable safe names and signed manifests', async () => {
    const calls = [];
    const result = await buildMassBackupArchives({
      webs: [
        { id: 7, title: 'Faith / Works' },
        { id: 8, title: 'Faith / Works' },
      ],
      notes: [{ id: 11, title: 'λόγος: notes?' }],
      timelines: [{ id: 20, title: 'Reformation | master' }],
      buildArtifact: async (kind, item) => {
        calls.push([kind, item.id]);
        return `${kind}:${item.id}`;
      },
    });

    assert.equal(result.totalItems, 4);
    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.archives.map(({ kind, itemCount }) => ({ kind, itemCount })), [
      { kind: 'knowledge', itemCount: 2 },
      { kind: 'notes', itemCount: 1 },
      { kind: 'timelines', itemCount: 1 },
    ]);
    assert.deepEqual(new Set(calls.map(([kind]) => kind)), new Set(['knowledge', 'notes', 'timelines']));

    const knowledge = await openArchive(result.archives[0]);
    assert.ok(knowledge.file('Faith - Works - web-7.berean'));
    assert.ok(knowledge.file('Faith - Works - web-8.berean'));
    assert.equal(await knowledge.file('Faith - Works - web-7.berean').async('string'), 'knowledge:7');

    const notes = await openArchive(result.archives[1]);
    assert.ok(notes.file('λόγος notes - note-11.md'));

    const timelines = await openArchive(result.archives[2]);
    assert.ok(timelines.file('Reformation master - timeline-20.json'));

    for (const archive of result.archives) {
      assert.ok(archive.bytes instanceof Uint8Array);
      const manifest = await readManifest(archive);
      assert.deepEqual(
        {
          signature: manifest.signature,
          version: manifest.version,
          category: manifest.category,
          itemCount: manifest.itemCount,
          createdAtType: typeof manifest.createdAt,
        },
        {
          signature: 'bex-mass-backup',
          version: 1,
          category: archive.kind,
          itemCount: archive.itemCount,
          createdAtType: 'string',
        },
      );
    }
  });

  it('has no chapter category or serializer branch by construction', () => {
    assert.deepEqual(
      MASS_BACKUP_CATEGORY_SPECS.map(({ kind, collection }) => [kind, collection]),
      [
        ['knowledge', 'webs'],
        ['notes', 'notes'],
        ['timelines', 'timelines'],
      ],
    );
    assert.equal(MASS_BACKUP_CATEGORY_SPECS.some(({ kind }) => /study|chapter/i.test(kind)), false);
  });

  it('omits empty categories rather than creating blank ZIP files', async () => {
    const result = await buildMassBackupArchives({
      notes: [{ id: 3, title: 'Only note' }],
      buildArtifact: (_kind, item) => `# ${item.title}\n`,
    });

    assert.deepEqual(result.archives.map((archive) => archive.kind), ['notes']);
    assert.equal(result.archives[0].itemCount, 1);
    assert.equal(result.totalItems, 1);
  });

  it('is category-atomic when one artifact fails while preserving other categories', async () => {
    const result = await buildMassBackupArchives({
      webs: [{ id: 1, title: 'Complete web' }],
      notes: [{ id: 2, title: 'Good note' }, { id: 3, title: 'Broken note' }],
      buildArtifact: async (kind, item) => {
        if (kind === 'notes' && item.id === 3) throw new Error('Markdown conversion failed');
        return `${kind}:${item.id}`;
      },
    });

    assert.deepEqual(result.archives.map((archive) => archive.kind), ['knowledge']);
    assert.equal(result.failures.length, 1);
    assert.deepEqual(
      { kind: result.failures[0].kind, itemId: result.failures[0].itemId, stage: result.failures[0].stage },
      { kind: 'notes', itemId: 3, stage: 'artifact' },
    );
    assert.match(result.failures[0].message, /Markdown conversion failed/);
  });

  it('bounds artifact work and reports monotonic progress', async () => {
    let active = 0;
    let maximumActive = 0;
    const updates = [];
    const notes = Array.from({ length: 12 }, (_unused, index) => ({
      id: index + 1,
      title: `Note ${index + 1}`,
    }));

    const result = await buildMassBackupArchives({
      notes,
      concurrency: 3,
      onProgress: (update) => updates.push(update),
      buildArtifact: async (_kind, item) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return `# ${item.title}`;
      },
    });

    assert.equal(maximumActive, 3);
    assert.equal(result.archives[0].itemCount, notes.length);
    const building = updates.filter(({ phase }) => phase === 'building');
    assert.deepEqual(building.map(({ totalCompleted }) => totalCompleted),
      Array.from({ length: notes.length }, (_unused, index) => index + 1));
    assert.equal(updates.at(-1).phase, 'complete');
  });

  it('uses an artifact title override without surrendering filename safety', async () => {
    const result = await buildMassBackupArchives({
      webs: [{ id: 42, title: 'Private Web' }],
      buildArtifact: () => ({ content: '{}', title: 'Decrypted / Name' }),
    });
    const zip = await openArchive(result.archives[0]);
    assert.ok(zip.file('Decrypted - Name - web-42.berean'));
  });

  it('builds and zips one category before retaining artifacts from the next', async () => {
    const events = [];
    const result = await buildMassBackupArchives({
      webs: [{ id: 1, title: 'Web' }],
      notes: [{ id: 2, title: 'Note' }],
      buildArtifact: (kind) => {
        events.push(`build:${kind}`);
        return kind;
      },
      onProgress: ({ phase, kind }) => {
        if (phase === 'zipping') events.push(`zip:${kind}`);
      },
    });

    assert.deepEqual(result.archives.map(({ kind }) => kind), ['knowledge', 'notes']);
    assert.ok(events.indexOf('zip:knowledge') < events.indexOf('build:notes'));
  });

  it('suppresses an entire category when its retained raw-data budget is exceeded', async () => {
    const result = await buildMassBackupArchives({
      webs: [{ id: 1, title: 'Safe web' }],
      notes: [{ id: 2, title: 'First note' }, { id: 3, title: 'Second note' }],
      concurrency: 1,
      limits: {
        maxArtifactBytes: 10,
        maxCategoryRawBytes: 7,
      },
      buildArtifact: (kind) => (kind === 'knowledge' ? '{}' : '1234'),
    });

    assert.deepEqual(result.archives.map(({ kind }) => kind), ['knowledge']);
    assert.equal(result.failures.length, 1);
    assert.deepEqual(
      {
        kind: result.failures[0].kind,
        itemId: result.failures[0].itemId,
        stage: result.failures[0].stage,
      },
      { kind: 'notes', itemId: 3, stage: 'artifact' },
    );
    assert.match(result.failures[0].message, /7 bytes.*raw-data safety limit/i);
  });

  it('measures UTF-8 artifact bytes without allocating an encoded copy', async () => {
    const result = await buildMassBackupArchives({
      notes: [{ id: 1, title: 'Emoji' }],
      limits: { maxArtifactBytes: 3 },
      buildArtifact: () => '🙂',
    });

    assert.deepEqual(result.archives, []);
    assert.equal(result.failures[0].stage, 'artifact');
    assert.match(result.failures[0].message, /3 bytes.*raw-data safety limit/i);
  });

  it('streams ZIP output through an archive byte ceiling and stays category-atomic', async () => {
    const result = await buildMassBackupArchives({
      notes: [{ id: 1, title: 'Tiny note' }],
      limits: { maxArchiveBytes: 100 },
      buildArtifact: () => 'tiny',
    });

    assert.deepEqual(result.archives, []);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].stage, 'archive');
    assert.match(result.failures[0].message, /100 bytes.*archive safety limit/i);
  });

  it('bounds combined completed ZIP bytes across categories', async () => {
    const result = await buildMassBackupArchives({
      webs: [{ id: 1, title: 'Web' }],
      notes: [{ id: 2, title: 'Note' }],
      limits: {
        maxArchiveBytes: 2048,
        maxTotalArchiveBytes: 700,
      },
      buildArtifact: (kind) => kind,
    });

    assert.deepEqual(result.archives.map(({ kind }) => kind), ['knowledge']);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].kind, 'notes');
    assert.equal(result.failures[0].stage, 'archive');
    assert.match(result.failures[0].message, /700 bytes.*combined safety limit/i);
    assert.ok(result.archives.reduce((total, archive) => total + archive.bytes.byteLength, 0) <= 700);
  });

  it('validates testable limit overrides before starting artifact work', async () => {
    let calls = 0;
    await assert.rejects(
      buildMassBackupArchives({
        notes: [{ id: 1 }, { id: 2 }],
        limits: { maxItemsPerCategory: 1 },
        buildArtifact: () => { calls += 1; return ''; },
      }),
      /1-item safety limit/,
    );
    await assert.rejects(
      buildMassBackupArchives({
        buildArtifact: () => '',
        limits: { maxArchiveBytes: MASS_BACKUP_DEFAULT_LIMITS.maxArchiveBytes + 1 },
      }),
      /maxArchiveBytes must be between/,
    );
    assert.equal(calls, 0);
    assert.equal(Object.isFrozen(MASS_BACKUP_DEFAULT_LIMITS), true);
  });
});

describe('Mass Backup entity pagination', () => {
  it('reads every id-ordered page, forwards filters, then applies the requested sort', async () => {
    const calls = [];
    const client = {
      async listPage(options) {
        calls.push(options);
        if (options.cursor === null) {
          return {
            records: [
              { id: 2, title: 'two', updated_date: '2026-01-02' },
              { id: 5, title: 'five', updated_date: '2026-01-05' },
            ],
            nextCursor: 5,
          };
        }
        return {
          records: [{ id: 9, title: 'nine', updated_date: '2026-01-03' }],
          nextCursor: null,
        };
      },
    };

    const records = await listAllEntityRecords(client, {
      sort: '-updated_date',
      filter: { folder_id: 4 },
      pageSize: 2,
    });

    assert.deepEqual(records.map(({ id }) => id), [5, 9, 2]);
    assert.deepEqual(calls, [
      { cursor: null, filter: { folder_id: 4 }, limit: 2 },
      { cursor: 5, filter: { folder_id: 4 }, limit: 2 },
    ]);
  });

  it('applies the backend id cursor before the safety limit', () => {
    const rows = [5, 1, 4, 2, 3].map((id) => ({
      id,
      encrypted_payload: { title: `Note ${id}` },
      created_at: `2026-01-0${id}T00:00:00.000Z`,
      updated_at: `2026-01-0${id}T00:00:00.000Z`,
    }));
    const database = {
      prepare: () => ({ all: () => rows }),
    };
    const privacyVault = {
      assertUnlocked() {},
      decryptValue: (value) => ({ ...value }),
      encryptValue: (value) => value,
    };
    const store = new LocalEntityStore(database, privacyVault);

    const page = store.list('MindNote', { cursor: 2, limit: 2, sort: 'id' });
    assert.deepEqual(page.map(({ id }) => id), [3, 4]);
    assert.throws(
      () => store.list('MindNote', { cursor: 2, limit: 2, sort: '-updated_date' }),
      /must be ordered by id/,
    );
  });

  it('rejects a non-advancing cursor instead of looping forever', async () => {
    const client = {
      listPage: async () => ({ records: [{ id: 1 }], nextCursor: 1 }),
    };
    await assert.rejects(
      listAllEntityRecords(client, { sort: 'id', pageSize: 1 }),
      /did not advance/,
    );
  });

  it('stops pagination at the renderer record ceiling before collecting an unbounded library', async () => {
    const client = {
      async listPage({ cursor }) {
        if (cursor === null) return { records: [{ id: 1 }, { id: 2 }], nextCursor: 2 };
        return { records: [{ id: 3 }], nextCursor: null };
      },
    };
    await assert.rejects(
      listAllEntityRecords(client, { maxRecords: 2, pageSize: 2, sort: 'id' }),
      /2-record safety limit/,
    );
  });
});
