'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const runnerPath = path.join(projectRoot, 'desktop', 'local-timegraph-proof-runner.cjs');
const electronPath = require('electron');
const proofFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'bex-timegraph-proof-'));
const libraryPath = path.join(proofFolder, 'Disposable Berean Library');

for (const folder of ['Database', 'Courses', 'Media', 'Imports', 'Exports', 'Backups']) {
  fs.mkdirSync(path.join(libraryPath, folder), { recursive: true });
}

function runPhase(phase) {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(electronPath, [runnerPath, phase, libraryPath], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: environment,
    timeout: 120000,
  });
  if (result.status !== 0) {
    throw new Error(`Timegraph proof ${phase} failed.\n${result.stdout || ''}${result.stderr || ''}`);
  }
  const marker = result.stdout.split(/\r?\n/)
    .find((line) => line.startsWith('BEX_TIMEGRAPH_PROOF '));
  assert.ok(marker, `Timegraph proof ${phase} produced no result marker.`);
  return JSON.parse(marker.slice('BEX_TIMEGRAPH_PROOF '.length));
}

try {
  const checks = [...runPhase('create').checks, ...runPhase('reopen').checks];
  for (const check of checks) process.stdout.write(`PASS: ${check}\n`);
  process.stdout.write(`PASS: ${checks.length} Timegraph checks completed across two Electron launches\n`);
  process.stdout.write('PASS: disposable Berean Library removed\n');
} finally {
  fs.rmSync(proofFolder, { force: true, recursive: true });
}
