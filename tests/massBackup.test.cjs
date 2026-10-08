'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const JSZip = require('jszip');

const {
  MAX_ZIP_BYTES,
  MASS_BACKUP_FILE_PATTERN,
  MassBackupManager,
  massBackupFileName,
  parseMassBackupFileName,
} = require('../desktop/mass-backup.cjs');
const {
  MASS_BACKUP_CHANNELS,
  registerMassBackupHandlers,
} = require('../desktop/mass-backup-ipc.cjs');

const FIXED_DATE = new Date('2026-08-24T16:53:37.123Z');

function sequentialUuid() {
  let count = 0;
  return () => {
    count += 1;
    return `00000000-0000-4000-8000-${count.toString(16).padStart(12, '0')}`;
  };
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bex-mass-backup-'));
  const destination = path.join(root, 'chosen-backups');
  fs.mkdirSync(destination);
  return {
    configPath: path.join(root, 'settings', 'mass-backup-config.json'),
    destination,
    manager: new MassBackupManager({
      configPath: path.join(root, 'settings', 'mass-backup-config.json'),
      now: () => new Date(FIXED_DATE),
      randomUUID: sequentialUuid(),
    }),
    root,
  };
}

async function managedZip(category, {
  createdAt = FIXED_DATE.toISOString(),
  fileNames = null,
  itemCount = null,
  signature = 'bex-mass-backup',
  version = 1,
} = {}) {
  const defaults = {
    knowledge: ['Example Web - web-1.berean'],
    notes: ['Example Note - note-1.md'],
    timelines: ['Example Timeline - timeline-1.json'],
  };
  const items = fileNames || defaults[category] || ['item.txt'];
  const zip = new JSZip();
  for (const fileName of items) zip.file(fileName, `contents for ${fileName}`);
  zip.file('_bex-mass-backup.json', JSON.stringify({
    signature,
    version,
    category,
    itemCount: itemCount ?? items.length,
    createdAt,
  }));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function withFixture(run) {
  const fixture = createFixture();
  try {
    await run(fixture);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

test('Mass Backup settings persist the chosen folder and default replacement off', async () => {
  await withFixture(async ({ configPath, destination, manager }) => {
    assert.deepEqual(await manager.getSettings(), {
      available: false,
      configured: false,
      destinationPath: null,
      issue: 'not_configured',
      replacePrevious: false,
    });

    const selected = await manager.setDestination(destination);
    assert.equal(selected.available, true);
    assert.equal(selected.destinationPath, fs.realpathSync(destination));
    assert.equal(selected.replacePrevious, false);

    await manager.setReplacePrevious(true);
    const reopened = new MassBackupManager({ configPath });
    assert.equal((await reopened.getSettings()).replacePrevious, true);
    await assert.rejects(
      () => reopened.setReplacePrevious('true'),
      { code: 'BEX_MASS_BACKUP_SETTING_INVALID' },
    );
  });
});

test('malformed settings are repairable with conservative defaults', async () => {
  await withFixture(async ({ configPath, destination, manager }) => {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, '{"version":999,"destinationPath":"/untrusted","replacePrevious":true}');

    await assert.rejects(
      () => manager.getSettings(),
      { code: 'BEX_MASS_BACKUP_CONFIG_INVALID' },
    );

    const repaired = await manager.getSettings({ repairInvalid: true });
    assert.deepEqual(repaired, {
      available: false,
      configured: false,
      destinationPath: null,
      issue: 'not_configured',
      replacePrevious: false,
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')), {
      destinationPath: null,
      replacePrevious: false,
      version: 1,
    });

    fs.writeFileSync(configPath, '{broken');
    const selected = await manager.setDestination(destination);
    assert.equal(selected.available, true);
    assert.equal(selected.destinationPath, fs.realpathSync(destination));
    assert.equal(selected.replacePrevious, false);

    fs.writeFileSync(configPath, '{broken-again');
    const replacement = await manager.setReplacePrevious(true);
    assert.equal(replacement.available, false);
    assert.equal(replacement.destinationPath, null);
    assert.equal(replacement.replacePrevious, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')), {
      destinationPath: null,
      replacePrevious: true,
      version: 1,
    });
  });
});

test('Mass Backup writes only supplied nonempty categories with managed unique names', async () => {
  await withFixture(async ({ destination, manager }) => {
    await manager.setDestination(destination);
    const knowledge = await managedZip('knowledge');
    const timelines = await managedZip('timelines');
    const result = await manager.writeArchives([
      { category: 'knowledge', bytes: knowledge },
      { category: 'timelines', bytes: new Uint8Array(timelines) },
    ]);

    assert.equal(result.archives.length, 2);
    assert.deepEqual(result.archives.map((archive) => archive.category), ['knowledge', 'timelines']);
    assert.equal(result.deletedPrevious.length, 0);
    for (const archive of result.archives) {
      assert.match(archive.fileName, MASS_BACKUP_FILE_PATTERN);
      assert.equal(parseMassBackupFileName(archive.fileName).category, archive.category);
      assert.equal(fs.readFileSync(path.join(destination, archive.fileName)).equals(
        archive.category === 'knowledge' ? knowledge : timelines,
      ), true);
    }
    assert.equal(fs.readdirSync(destination).some((name) => name.endsWith('.partial')), false);
  });
});

test('replacement off never removes an earlier managed backup or personal file', async () => {
  await withFixture(async ({ destination, manager }) => {
    await manager.setDestination(destination);
    const priorName = massBackupFileName(
      'notes',
      new Date('2026-08-23T10:00:00.000Z'),
      '11111111111111111111111111111111',
    );
    fs.writeFileSync(path.join(destination, priorName), await managedZip('notes'));
    fs.writeFileSync(path.join(destination, 'family-photos.zip'), 'personal');

    await manager.writeArchives([{ category: 'notes', bytes: await managedZip('notes') }]);
    assert.equal(fs.existsSync(path.join(destination, priorName)), true);
    assert.equal(fs.readFileSync(path.join(destination, 'family-photos.zip'), 'utf8'), 'personal');
  });
});

test('replacement on removes only valid prior managed ZIPs for categories in this run', async () => {
  await withFixture(async ({ destination, manager }) => {
    await manager.setDestination(destination);
    await manager.setReplacePrevious(true);

    const priorKnowledgeName = massBackupFileName(
      'knowledge',
      new Date('2026-08-20T10:00:00.000Z'),
      '11111111111111111111111111111111',
    );
    const priorNotesName = massBackupFileName(
      'notes',
      new Date('2026-08-20T10:00:00.000Z'),
      '22222222222222222222222222222222',
    );
    const forgedName = massBackupFileName(
      'knowledge',
      new Date('2026-08-19T10:00:00.000Z'),
      '33333333333333333333333333333333',
    );
    const directoryName = massBackupFileName(
      'knowledge',
      new Date('2026-08-18T10:00:00.000Z'),
      '44444444444444444444444444444444',
    );

    fs.writeFileSync(path.join(destination, priorKnowledgeName), await managedZip('knowledge'));
    fs.writeFileSync(path.join(destination, priorNotesName), await managedZip('notes'));
    fs.writeFileSync(path.join(destination, forgedName), await managedZip('knowledge', { signature: 'personal' }));
    fs.mkdirSync(path.join(destination, directoryName));
    fs.writeFileSync(path.join(destination, 'taxes.zip'), 'personal');

    const result = await manager.writeArchives([
      { category: 'knowledge', bytes: await managedZip('knowledge') },
    ]);

    assert.deepEqual(result.deletedPrevious, [priorKnowledgeName]);
    assert.equal(fs.existsSync(path.join(destination, priorKnowledgeName)), false);
    assert.equal(fs.existsSync(path.join(destination, priorNotesName)), true);
    assert.equal(fs.existsSync(path.join(destination, forgedName)), true);
    assert.equal(fs.statSync(path.join(destination, directoryName)).isDirectory(), true);
    assert.equal(fs.readFileSync(path.join(destination, 'taxes.zip'), 'utf8'), 'personal');
  });
});

test('replacement skips oversized strict-name candidates before reading them', async () => {
  await withFixture(async ({ destination, manager }) => {
    await manager.setDestination(destination);
    await manager.setReplacePrevious(true);
    const oversizedName = massBackupFileName(
      'notes',
      new Date('2026-08-19T10:00:00.000Z'),
      '66666666666666666666666666666666',
    );
    const oversizedPath = path.join(destination, oversizedName);
    fs.writeFileSync(oversizedPath, 'personal');
    fs.truncateSync(oversizedPath, MAX_ZIP_BYTES + 1);

    const originalReadFile = fs.promises.readFile;
    let candidateRead = false;
    fs.promises.readFile = async (...args) => {
      if (path.resolve(String(args[0])) === path.resolve(oversizedPath)) {
        candidateRead = true;
        throw new Error('Oversized candidate should have been rejected from metadata.');
      }
      return originalReadFile(...args);
    };
    try {
      const result = await manager.writeArchives([
        { category: 'notes', bytes: await managedZip('notes') },
      ]);
      assert.deepEqual(result.deletedPrevious, []);
    } finally {
      fs.promises.readFile = originalReadFile;
    }

    assert.equal(candidateRead, false);
    assert.equal(fs.existsSync(oversizedPath), true);
    assert.equal(fs.statSync(oversizedPath).size, MAX_ZIP_BYTES + 1);
  });
});

test('publishing attempts a same-directory hard link and safely falls back to an exclusive copy', async () => {
  await withFixture(async ({ destination, manager }) => {
    await manager.setDestination(destination);

    const originalLink = fs.promises.link;
    let linkCalls = 0;
    fs.promises.link = async (...args) => {
      linkCalls += 1;
      return originalLink(...args);
    };
    try {
      await manager.writeArchives([{ category: 'notes', bytes: await managedZip('notes') }]);
    } finally {
      fs.promises.link = originalLink;
    }
    assert.equal(linkCalls, 1);

    const originalCopyFile = fs.promises.copyFile;
    let copyCalls = 0;
    fs.promises.link = async () => {
      const error = new Error('Hard links are unavailable.');
      error.code = 'EPERM';
      throw error;
    };
    fs.promises.copyFile = async (...args) => {
      copyCalls += 1;
      return originalCopyFile(...args);
    };
    let result;
    try {
      result = await manager.writeArchives([
        { category: 'timelines', bytes: await managedZip('timelines') },
      ]);
    } finally {
      fs.promises.link = originalLink;
      fs.promises.copyFile = originalCopyFile;
    }

    assert.equal(copyCalls, 1);
    assert.equal(result.archives.length, 1);
    assert.equal(
      fs.existsSync(path.join(destination, result.archives[0].fileName)),
      true,
    );
  });
});

test('invalid or empty archive manifests are rejected before any previous backup is cleaned', async () => {
  await withFixture(async ({ destination, manager }) => {
    await manager.setDestination(destination);
    await manager.setReplacePrevious(true);
    const priorName = massBackupFileName(
      'timelines',
      new Date('2026-08-20T10:00:00.000Z'),
      '55555555555555555555555555555555',
    );
    fs.writeFileSync(path.join(destination, priorName), await managedZip('timelines'));

    const empty = await managedZip('timelines', { fileNames: [], itemCount: 0 });
    await assert.rejects(
      () => manager.writeArchives([{ category: 'timelines', bytes: empty }]),
      { code: 'BEX_MASS_BACKUP_ARCHIVE_INVALID' },
    );
    assert.equal(fs.existsSync(path.join(destination, priorName)), true);
    assert.deepEqual(fs.readdirSync(destination), [priorName]);
  });
});

test('archive category and manifest category must agree', async () => {
  await withFixture(async ({ destination, manager }) => {
    await manager.setDestination(destination);
    const knowledge = await managedZip('knowledge');
    await assert.rejects(
      () => manager.writeArchives([
        { category: 'notes', bytes: knowledge },
      ]),
      { code: 'BEX_MASS_BACKUP_ARCHIVE_INVALID' },
    );
    assert.deepEqual(fs.readdirSync(destination), []);
  });
});

test('Mass Backup IPC trusts only the application origin and exposes all five operations', async () => {
  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) { handlers.set(channel, handler); },
    removeHandler(channel) { handlers.delete(channel); },
  };
  const settings = {
    available: true,
    configured: true,
    destinationPath: '/chosen',
    issue: null,
    replacePrevious: false,
  };
  const calls = [];
  const settingsReads = [];
  const manager = {
    async getSettings(options) { settingsReads.push(options ?? null); return settings; },
    async setDestination(folder) { calls.push(['destination', folder]); return settings; },
    async setReplacePrevious(value) { calls.push(['replace', value]); return settings; },
    async writeArchives(archives) { calls.push(['write', archives]); return { archives: [] }; },
  };
  registerMassBackupHandlers({
    appUrl: 'http://127.0.0.1:4173',
    chooseFolder: async () => ({ canceled: false, destinationPath: '/chosen' }),
    ipcMain,
    manager,
    revealFolder: async (folder) => { calls.push(['reveal', folder]); return ''; },
  });

  assert.deepEqual(new Set(handlers.keys()), new Set(Object.values(MASS_BACKUP_CHANNELS)));
  const trusted = { senderFrame: { url: 'http://127.0.0.1:4173/library' } };
  assert.equal((await handlers.get(MASS_BACKUP_CHANNELS.getSettings)(trusted)).ok, true);
  assert.equal((await handlers.get(MASS_BACKUP_CHANNELS.chooseFolder)(trusted)).canceled, false);
  assert.equal((await handlers.get(MASS_BACKUP_CHANNELS.setReplacePrevious)(trusted, true)).ok, true);
  assert.equal((await handlers.get(MASS_BACKUP_CHANNELS.writeArchives)(trusted, [])).ok, true);
  assert.equal((await handlers.get(MASS_BACKUP_CHANNELS.revealFolder)(trusted)).revealed, true);
  assert.deepEqual(calls, [
    ['destination', '/chosen'],
    ['replace', true],
    ['write', []],
    ['reveal', '/chosen'],
  ]);
  assert.deepEqual(settingsReads, [
    null,
    { repairInvalid: true },
    null,
  ]);

  const blocked = await handlers.get(MASS_BACKUP_CHANNELS.getSettings)({
    senderFrame: { url: 'https://attacker.example/' },
  });
  assert.deepEqual(blocked, {
    ok: false,
    code: 'BEX_UNTRUSTED_SENDER',
    error: 'BEX blocked a Mass Backup request from an untrusted page.',
  });
});
