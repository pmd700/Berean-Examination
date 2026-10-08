import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getMassBackupSettings,
  writeMassBackupArchives,
} from '../src/lib/massBackupDesktop.js';

function withDesktopApi(api, run) {
  const previousWindow = globalThis.window;
  globalThis.window = { bexDesktop: { isDesktop: true, ...api } };
  return Promise.resolve()
    .then(run)
    .finally(() => {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    });
}

test('renderer settings never enable a remembered folder that is no longer available', async () => {
  await withDesktopApi({
    getMassBackupSettings: async () => ({
      ok: true,
      settings: {
        available: false,
        configured: true,
        destinationPath: '/missing/Berean Backups',
        replacePrevious: true,
      },
    }),
  }, async () => {
    const settings = await getMassBackupSettings();
    assert.equal(settings.folderPath, '');
    assert.equal(settings.replacePrevious, true);
  });
});

test('renderer maps archive kinds to the narrow desktop contract and unwraps the result', async () => {
  const bytes = new Uint8Array([80, 75, 3, 4]);
  let received = null;
  await withDesktopApi({
    writeMassBackupArchives: async (archives) => {
      received = archives;
      return {
        ok: true,
        result: {
          archives: [{ category: 'notes', fileName: 'BEX-Mass-Backup-Notes.zip' }],
        },
      };
    },
  }, async () => {
    const result = await writeMassBackupArchives([{ kind: 'notes', bytes }]);
    assert.deepEqual(received, [{ category: 'notes', bytes }]);
    assert.equal(result.archives[0].category, 'notes');
  });
});
