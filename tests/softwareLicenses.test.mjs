import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { collectLicenseAssets, licenseChoices, licenseIssues, licenseAssetsPlugin } from '../tools/vite-license-assets.mjs';

const root = process.cwd();
const { manifest, assets } = collectLicenseAssets();
const packages = [...new Map(manifest.groups.flatMap(group => group.packages).map(pkg => [pkg.path, pkg])).values()];
const runtime = name => manifest.runtime.find(item => item.name === name);

test('ships the complete unmodified Chromium credits separately from the manifest', () => {
  const original = fs.readFileSync('node_modules/electron/dist/LICENSES.chromium.html');
  assert.deepEqual(assets.get('licenses/LICENSES.chromium.html'), original);
  assert.equal(runtime('Chromium third-party licenses').sha256, crypto.createHash('sha256').update(original).digest('hex'));
  assert.equal(runtime('Chromium third-party licenses').bytes, original.length);
  assert.equal(runtime('Chromium third-party licenses').file, '/licenses/LICENSES.chromium.html');
  assert.equal(runtime('Chromium third-party licenses').text, undefined);
  assert.ok(assets.get('licenses/manifest.json').length < original.length / 10);
});

test('includes all requested runtime components with actual version-specific terms', () => {
  assert.equal(runtime('Electron').text, fs.readFileSync('node_modules/electron/LICENSE', 'utf8'));
  assert.match(runtime('Node.js').text, /Copyright Node\.js contributors/);
  assert.match(runtime('Node.js').text, /Permission is hereby granted/);
  assert.match(runtime('OpenSSL (bundled with Node.js)').text, /Apache License[\s\S]*Version 2\.0/);
  assert.equal(runtime('Squirrel.Mac').license, 'MIT');
  assert.match(runtime('Squirrel.Mac').text, /Copyright \(c\) 2013 GitHub/);
  assert.match(runtime('Mantle').text, /Proton[\s\S]*Bitswift/);
  assert.match(runtime('ReactiveObjC').text, /2012 - 2016, GitHub/);
  assert.match(runtime('nan (Native Abstractions for Node)').text, /NAN contributors/);
  assert.match(runtime('FFmpeg').text, /GNU LESSER GENERAL PUBLIC LICENSE/);
  assert.match(runtime('FFmpeg').text, /Version 2\.1, February 1999/);
  assert.match(runtime('FFmpeg').note, new RegExp(`releases/tag/v${manifest.electronVersion.replaceAll('.', '\\.')}`));
  assert.match(runtime('FFmpeg').links[1].url, /\/DEPS$/);
});

test('covers every installed production dependency, versions included, without dev-only tooling', () => {
  const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
  const expected = Object.entries(lock.packages).filter(([key, pkg]) => key && !pkg.dev && fs.existsSync(path.join(key, 'package.json')));
  assert.equal(manifest.packageCount, expected.length);
  assert.equal(packages.length, expected.length);
  for (const [key, pkg] of expected) {
    const entry = packages.find(record => record.path === key);
    assert.ok(entry, `Missing shipped package ${key}`);
    assert.equal(entry.version, pkg.version);
  }
  assert.ok(!packages.some(pkg => pkg.name === 'eslint'));
  assert.equal(new Set(manifest.groups.map(group => group.license)).size, manifest.groups.length);
  assert.ok(manifest.groups.every(group => group.text.length > 500));
});

test('preserves package-specific originals, copyright and nested vendored notices', () => {
  const text = assets.get('licenses/npm-original-notices.txt').toString();
  assert.ok(text.includes(fs.readFileSync('node_modules/react/LICENSE', 'utf8')));
  assert.ok(text.includes(fs.readFileSync('node_modules/jszip/LICENSE.markdown', 'utf8')));
  assert.ok(text.includes(fs.readFileSync('node_modules/pako/lib/zlib/README', 'utf8')));
  assert.ok(text.includes(fs.readFileSync('node_modules/victory-vendor/lib-vendor/d3-array/LICENSE', 'utf8')));
  assert.match(text, /Copyright \(c\) 2013 Julian Gruber/);
  assert.ok(!manifest.issues.some(issue => issue.package === 'isarray@1.0.0'));
  assert.ok(packages.find(pkg => pkg.name === 'react').copyright.some(line => /Meta Platforms|Facebook/.test(line)));
});

test('records deliberate OR selections, both AND terms, and GPL/AGPL flags', () => {
  const jszip = packages.find(pkg => pkg.name === 'jszip');
  assert.equal(jszip.declaredLicense, '(MIT OR GPL-3.0-or-later)');
  assert.deepEqual(jszip.licenses, ['MIT']);
  assert.match(manifest.issues.find(issue => issue.package === 'jszip@3.10.1').message, /GPL alternative/);
  assert.deepEqual(licenseChoices('(MIT AND Zlib)'), ['MIT', 'Zlib']);
  assert.deepEqual(licenseChoices('(MPL-2.0 OR Apache-2.0)'), ['Apache-2.0']);
  for (const license of ['GPL-3.0-only', 'AGPL-3.0-or-later']) {
    assert.match(licenseIssues({ name: 'example', version: '1', declaredLicense: license, licenses: [license] })[0].message, /Potential GPL\/AGPL issue/);
  }
  assert.throws(() => licenseChoices('(Custom OR MIT)'), /Unreviewed/);
  assert.ok(manifest.issues.some(issue => issue.kind === 'restricted' && issue.package.startsWith('react-leaflet@')));
});

test('fails safely when the Electron release changes instead of reusing stale license sources', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bex-license-mismatch-'));
  try {
    fs.mkdirSync(path.join(folder, 'node_modules/electron/dist'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'package-lock.json'), '{"packages":{}}');
    fs.writeFileSync(path.join(folder, 'node_modules/electron/package.json'), '{"version":"99.0.0"}');
    fs.writeFileSync(path.join(folder, 'node_modules/electron/dist/version'), '99.0.0');
    assert.throws(() => collectLicenseAssets({ root: folder }), /refresh pinned runtime license sources/);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('Vite emits the local documents and can include a bundled development dependency', () => {
  const id = 'node_modules/@babel/helper-plugin-utils';
  const build = collectLicenseAssets({ moduleIds: [path.join(root, id, 'lib/index.js')] });
  assert.ok(build.manifest.groups.flatMap(group => group.packages).some(pkg => pkg.path === id && pkg.bundled));
  const emitted = new Map();
  licenseAssetsPlugin().generateBundle.call({
    getModuleIds: () => [path.join(root, 'src/main.jsx')],
    emitFile: file => emitted.set(file.fileName, file.source),
  });
  assert.deepEqual([...emitted.keys()].sort(), [...assets.keys()].sort());
  assert.deepEqual(emitted.get('licenses/LICENSES.chromium.html'), assets.get('licenses/LICENSES.chromium.html'));
});
