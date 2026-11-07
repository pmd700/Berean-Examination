'use strict';
// Reproducible maintenance gates. All native proofs create disposable profiles
// and libraries; this runner never opens a user's selected Vault.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const native = process.argv.includes('--native');
const nativeTools = [
  'run-local-entity-proof.cjs', 'run-local-attachment-proof.cjs', 'run-local-backup-proof.cjs',
  'run-local-study-proof.cjs', 'run-local-timegraph-proof.cjs',
  'run-local-course-proof.cjs', 'run-course-playback-proof.cjs', 'run-privacy-proof.cjs',
  'run-offline-startup-network-proof.cjs', 'run-spreadsheet-proof.cjs',
];
const steps = native ? nativeTools.map(name => [name, process.execPath, [`tools/${name}`]]) : [
  ['lint', 'npm', ['run', 'lint']],
  ['DOM regression suite', 'npm', ['run', 'test:dom']],
  ['complete Node and TypeScript contract suite', process.execPath, ['tools/run-node-tests.cjs']],
  ['production app and Course Studio build', 'npm', ['run', 'build']],
];
const logs = fs.mkdtempSync(path.join(os.tmpdir(), native ? 'bex-native-checks-' : 'bex-core-checks-'));
let failures = 0;
for (const [index, [label, executable, args]] of steps.entries()) {
  const log = path.join(logs, `${index + 1}-${label.replace(/[^\w-]+/g, '-')}.log`);
  const file = fs.openSync(log, 'w');
  process.stdout.write(`Running ${label}…\n`);
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
  const start = Date.now();
  const result = spawnSync(executable, args, { cwd: root, env: environment, stdio: ['ignore', file, file], timeout: native ? 180000 : 300000 });
  fs.closeSync(file);
  if (result.status !== 0) {
    failures++;
    process.stdout.write(`FAIL ${label}: ${result.error?.message || `exit ${result.status}`} — ${log}\n`);
  } else process.stdout.write(`PASS ${label} (${((Date.now() - start) / 1000).toFixed(1)}s)\n`);
}
process.stdout.write(`Logs: ${logs}\n`);
if (!native) process.stdout.write('Typecheck remains a separate explicit gate: npm run typecheck (existing backlog tracked in maintenance-checklist.md).\n');
process.exitCode = failures ? 1 : 0;
