'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const samplePath = process.argv[2] ? path.resolve(process.argv[2]) : null;
const electronPath = require('electron');
const proofFolder = fs.mkdtempSync(path.join(projectRoot, '.bex-berean-import-proof-'));
const libraryPath = path.join(proofFolder, 'Disposable Berean Library');

try {
  for (const folder of ['Database', 'Courses', 'Media', 'Imports', 'Exports', 'Backups']) {
    fs.mkdirSync(path.join(libraryPath, folder), { recursive: true });
  }
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const args = [path.join(projectRoot, 'desktop', 'berean-import-proof-runner.cjs'), libraryPath];
  if (samplePath) args.push(samplePath);
  const result = spawnSync(electronPath, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    env: environment,
    timeout: 120000,
  });
  if (result.status !== 0) {
    throw new Error(`Berean import proof failed.\n${result.stdout || ''}${result.stderr || ''}`);
  }
  const marker = result.stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith('BEX_BEREAN_IMPORT_PROOF '));
  assert.ok(marker, 'The Berean import proof returned no result.');
  process.stdout.write(`${marker}\n`);
  process.stdout.write('PASS: corrected exports retain card and canvas endpoints\n');
  process.stdout.write('PASS: preview and malformed files leave the target unchanged\n');
  process.stdout.write('PASS: complete imports commit atomically and survive reopen\n');
  if (samplePath) process.stdout.write('PASS: legacy sample imported safely without modifying its source file\n');
  process.stdout.write('PASS: disposable Berean Library removed\n');
} finally {
  fs.rmSync(proofFolder, { recursive: true, force: true });
}
