'use strict';

// Test-only bootstrap, never imported by either desktop entry point.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, safeStorage } = require('electron');

const proofRoot = fs.realpathSync(process.env.BEX_STARTUP_PROOF_ROOT || '');
assert.match(path.basename(proofRoot), /^bex-startup-proof-/);
const projectRoot = path.resolve(__dirname, '..');
const profilePath = path.join(proofRoot, 'profile');
const libraryPath = path.join(proofRoot, 'library');
for (const folder of ['profile', 'profile/session', 'logs', 'crashes', 'library']) {
  fs.mkdirSync(path.join(proofRoot, folder), { recursive: true });
}
app.setPath('userData', profilePath);
app.setPath('sessionData', path.join(profilePath, 'session'));
app.setPath('logs', path.join(proofRoot, 'logs'));
app.setPath('crashDumps', path.join(proofRoot, 'crashes'));
app.getAppPath = () => projectRoot;

const { LIBRARY_FOLDERS } = require('../desktop/library.cjs');
for (const folder of LIBRARY_FOLDERS) fs.mkdirSync(path.join(libraryPath, folder));
fs.writeFileSync(path.join(profilePath, 'library-config.json'), JSON.stringify({
  libraryPath, selectedAt: new Date().toISOString(), version: 1,
}), { mode: 0o600 });

require('./offline-startup-network-hook.cjs');
app.whenReady().then(() => {
  const database = require('../desktop/database.cjs');
  const { createSafeStorageProtector } = require('../desktop/privacy-vault.cjs');
  database.initializeDatabase(libraryPath, { privacyProtector: createSafeStorageProtector(safeStorage) });
}).catch(error => {
  process.stderr.write('[startup-proof fixture] ' + (error.stack || error) + '\n');
  app.exit(1);
});

require('../desktop/main.cjs');
