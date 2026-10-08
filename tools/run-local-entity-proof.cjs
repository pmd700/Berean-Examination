'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const runnerPath = path.join(projectRoot, 'desktop', 'local-entity-proof-runner.cjs');
const electronPath = require('electron');
const proofFolder = fs.mkdtempSync(path.join(projectRoot, '.bex-entity-proof-'));
const libraryPath = path.join(proofFolder, 'Disposable Berean Library');
const LIBRARY_FOLDERS = ['Database', 'Courses', 'Media', 'Imports', 'Exports', 'Backups'];

for (const folderName of LIBRARY_FOLDERS) {
  fs.mkdirSync(path.join(libraryPath, folderName), { recursive: true });
}

function runPhase(phase) {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(
    electronPath,
    [runnerPath, phase, libraryPath],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      env: environment,
      timeout: 120000,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `Local entity proof ${phase} phase failed.\n${result.stdout || ''}${result.stderr || ''}`,
    );
  }
  const markerLine = result.stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith('BEX_ENTITY_PROOF '));
  assert.ok(markerLine, `Local entity proof ${phase} phase returned no result.`);
  return JSON.parse(markerLine.slice('BEX_ENTITY_PROOF '.length));
}

try {
  const createResult = runPhase('create');
  const reopenResult = runPhase('reopen');
  const checks = [...createResult.checks, ...reopenResult.checks];
  for (const check of checks) process.stdout.write(`PASS: ${check}\n`);
  process.stdout.write(`PASS: ${checks.length} local entity checks completed in two Electron launches\n`);
  process.stdout.write('PASS: disposable Berean Library removed\n');
} finally {
  fs.rmSync(proofFolder, { recursive: true, force: true });
}
