'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const electronPath = require('electron');
const wrapperPath = path.join(__dirname, 'offline-startup-network-wrapper.cjs');
const reportPath = path.join(projectRoot, '.bex-offline-startup-network-proof.json');
const onlineModePath = path.join(projectRoot, 'src', 'lib', 'onlineMode.js');

fs.rmSync(reportPath, { force: true });

const child = spawn(electronPath, [wrapperPath, '--built'], {
  cwd: projectRoot,
  env: {
    ...process.env,
    BEX_STARTUP_PROOF_REPORT: reportPath,
    BEX_STARTUP_PROOF_TIMEOUT_MS: '30000',
  },
  stdio: 'inherit',
});

const killTimer = setTimeout(() => child.kill('SIGKILL'), 40000);

child.once('error', (error) => {
  clearTimeout(killTimer);
  throw error;
});

child.once('exit', (code, signal) => {
  clearTimeout(killTimer);
  assert.equal(signal, null, `The startup proof was terminated by ${signal}.`);
  assert.ok(fs.existsSync(reportPath), 'The startup proof did not write its report.');

  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const onlineModeSource = fs.readFileSync(onlineModePath, 'utf8');
  assert.match(onlineModeSource, /export const ONLINE_MODE_ENABLED = false;/);
  assert.equal(report.onlineModeEnabled, false);
  assert.equal(report.libraryReady, true);
  assert.equal(report.activationReady, true);
  assert.equal(report.privacyReady, true);
  assert.equal(report.normalAppVisible, true);
  assert.deepEqual(report.outsideRequests, []);
  assert.equal(code, 0, report.reason || 'The normal BEX startup proof failed.');

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write('PASS: normal BEX startup reached the local app with Online Mode off and zero outside requests.\n');
});
