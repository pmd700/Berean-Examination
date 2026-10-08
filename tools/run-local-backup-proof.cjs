'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const runnerPath = path.join(projectRoot, 'desktop', 'local-backup-proof-runner.cjs');
const electronPath = require('electron');
const proofRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bex-local-backup-proof-'));

try {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(electronPath, [runnerPath, proofRoot], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: environment,
    timeout: 120000,
  });
  if (result.status !== 0) {
    throw new Error(`Local backup proof failed.\n${result.stdout || ''}${result.stderr || ''}`);
  }
  const markerLine = result.stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith('BEX_BACKUP_PROOF '));
  assert.ok(markerLine, 'Local backup proof returned no result.');
  const resultData = JSON.parse(markerLine.slice('BEX_BACKUP_PROOF '.length));
  for (const check of resultData.checks) process.stdout.write(`PASS: ${check}\n`);
  process.stdout.write(`PASS: ${resultData.checks.length} local backup checks completed\n`);
  process.stdout.write('PASS: disposable source and restored libraries removed\n');
} finally {
  fs.rmSync(proofRoot, { recursive: true, force: true });
}
