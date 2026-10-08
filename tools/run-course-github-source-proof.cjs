'use strict';

const assert = require('node:assert/strict');
const { HttpMirrorObjectSource } = require('../desktop/course-http-source.cjs');

const byteSize = 1787248;
const unavailable = 'https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/bex-missing-proof.tar.gz';
const releaseAsset = 'https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/ripgrep-14.1.1-aarch64-apple-darwin.tar.gz';
const asset = { id: 'github-range-proof', sha256: 'a'.repeat(64), byteSize };

(async () => {
  const source = new HttpMirrorObjectSource([{ sha256: asset.sha256, byteSize, mirrors: [unavailable, releaseAsset] }]);
  const opened = await source.open(asset);
  const bytes = await opened.read(0, 100);
  await opened.close();
  assert.equal(bytes.length, 100);
  assert.deepEqual([...bytes.subarray(0, 2)], [0x1f, 0x8b]);
  process.stdout.write('PASS: an unavailable GitHub mirror was skipped\n');
  process.stdout.write('PASS: GitHub returned the exact requested 100-byte range\n');
  process.stdout.write('PASS: the bytes came from the expected gzip release asset\n');
})().catch((error) => { process.stderr.write((error?.stack || error) + '\n'); process.exitCode = 1; });
