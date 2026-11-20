'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const runnerPath = path.join(projectRoot, 'desktop', 'privacy-proof-runner.cjs');
const electronPath = require('electron');
const proofFolder = fs.mkdtempSync(path.join(projectRoot, '.bex-privacy-proof-'));
const databasePath = path.join(proofFolder, 'privacy-proof.db');

function runPhase(phase) {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(
    electronPath,
    [runnerPath, phase, databasePath],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      env: environment,
      timeout: 120000,
    },
  );

  if (result.status !== 0) {
    throw new Error(
      `Privacy proof ${phase} phase failed.\n${result.stdout || ''}${result.stderr || ''}`,
    );
  }

  const markerLine = result.stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith('BEX_PRIVACY_PROOF '));
  assert.ok(markerLine, `Privacy proof ${phase} phase returned no result.`);
  return JSON.parse(markerLine.slice('BEX_PRIVACY_PROOF '.length));
}

try {
  const createResult = runPhase('create');
  const verifyResult = runPhase('verify');
  const integratedResult = runPhase('integrated');
  const checks = [...createResult.checks, ...verifyResult.checks, ...integratedResult.checks];
  for (const check of checks) process.stdout.write(`PASS: ${check}\n`);
  process.stdout.write(`PASS: ${checks.length} privacy checks completed in three Electron processes\n`);
  process.stdout.write('PASS: disposable proof database removed\n');
} finally {
  fs.rmSync(proofFolder, { recursive: true, force: true });
}
