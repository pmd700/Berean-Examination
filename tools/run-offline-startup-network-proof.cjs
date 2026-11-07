'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const proofRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bex-startup-proof-'));
const reportPath = path.join(proofRoot, 'report.json');
const wrapperPath = path.join(__dirname, 'offline-startup-network-wrapper.cjs');
const onlineModePath = path.join(projectRoot, 'src', 'lib', 'onlineMode.js');

try {
  assert.ok(fs.existsSync(path.join(projectRoot, 'dist', '.vite', 'manifest.json')), 'Build the production renderer before running this proof.');
  const environment = {
    ...process.env,
    BEX_STARTUP_PROOF_ROOT: proofRoot,
    BEX_STARTUP_PROOF_REPORT: reportPath,
    BEX_STARTUP_PROOF_TIMEOUT_MS: '45000',
  };
  delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawnSync(require('electron'), [wrapperPath, '--built'], {
    cwd: projectRoot, env: environment, stdio: 'inherit', timeout: 60000,
  });
  assert.ifError(child.error);
  assert.equal(child.signal, null, 'The startup proof was terminated by ' + child.signal);
  assert.ok(fs.existsSync(reportPath), 'The isolated startup proof did not write its report.');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.match(fs.readFileSync(onlineModePath, 'utf8'), /export const ONLINE_MODE_ENABLED = false;/);
  assert.equal(child.status, 0, JSON.stringify(report));
  assert.equal(report.onlineModeEnabled, false);
  assert.equal(report.libraryReady, true);
  assert.equal(report.activationReady, true);
  assert.equal(report.privacyReady, true);
  assert.equal(report.normalAppVisible, true);
  assert.equal(report.disposableLibrary, true);
  assert.deepEqual(report.routesVerified, ['LibraryHome', 'Stats', 'Courses', 'LibraryHome']);
  assert.deepEqual(report.deferredPagesVerified, ['Stats', 'Courses']);
  assert.deepEqual(report.outsideRequests, []);
  assert.deepEqual(report.rendererErrors, []);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.stdout.write('PASS: built production main/preload/renderer opened the disposable encrypted library, passed startup gates with test-only signed activation, and lazily opened Stats and Courses through the UI with zero external Electron-session requests.\n');
} finally {
  fs.rmSync(proofRoot, { recursive: true, force: true });
  process.stdout.write('PASS: disposable startup profile, library and ephemeral activation fixture removed.\n');
}
