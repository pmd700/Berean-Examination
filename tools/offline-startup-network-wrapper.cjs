'use strict';

// Test-only bootstrap, never imported by either desktop entry point.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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

// Inject an ephemeral trust root only in this harness's module cache. The real
// verifier and database store still check the signature and this Mac's request.
// No release key or user activation is read, copied or changed. Production has
// no test-mode activation branch, and no private fixture key leaves memory.
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const keyId = 'disposable-startup-proof';
const keyModulePath = require.resolve('../desktop/activation-public-key.cjs');
require.cache[keyModulePath] = {
  id: keyModulePath,
  filename: keyModulePath,
  loaded: true,
  exports: { TRUSTED_ACTIVATION_PUBLIC_KEYS: Object.freeze({
    [keyId]: publicKey.export({ type: 'spki', format: 'pem' }),
  }) },
};

const { LIBRARY_FOLDERS } = require('../desktop/library.cjs');
for (const folder of LIBRARY_FOLDERS) fs.mkdirSync(path.join(libraryPath, folder));
fs.writeFileSync(path.join(profilePath, 'library-config.json'), JSON.stringify({
  libraryPath, selectedAt: new Date().toISOString(), version: 1,
}), { mode: 0o600 });

require('./offline-startup-network-hook.cjs');
app.whenReady().then(() => {
  const database = require('../desktop/database.cjs');
  const { createSafeStorageProtector } = require('../desktop/privacy-vault.cjs');
  const { createMachineRequest } = require('../desktop/activation.cjs');
  database.initializeDatabase(libraryPath, { privacyProtector: createSafeStorageProtector(safeStorage) });
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    product: 'bex-launcher-official',
    keyId,
    requestCode: createMachineRequest().requestCode,
    issuedAt: new Date().toISOString(),
  }));
  const signature = crypto.sign(null, payload, privateKey);
  const code = ['BEX-ACT-1', payload.toString('base64url'), signature.toString('base64url')].join('.');
  assert.equal(database.activateInstallation(code).activated, true);
}).catch(error => {
  process.stderr.write('[startup-proof fixture] ' + (error.stack || error) + '\n');
  app.exit(1);
});

require('../desktop/main.cjs');
