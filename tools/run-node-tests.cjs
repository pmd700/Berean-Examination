'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const files = fs.readdirSync(path.join(root, 'tests')).filter(name => /\.test\.(?:[cm]?js|tsx?)$/.test(name)).sort().map(name => `tests/${name}`);
const result = spawnSync(process.execPath, ['--import', 'tsx', '--import', './tests/registerRawAssets.mjs', '--test', ...files], {
  cwd: root, stdio: 'inherit',
  env: { ...process.env, TSX_TSCONFIG_PATH: path.join(root, 'tests/tsconfig.json') },
});
if (result.error) process.stderr.write(result.error.message + '\n');
process.exitCode = result.status === 0 ? 0 : 1;
