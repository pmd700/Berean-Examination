import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parse } = require('node-html-parser');
const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(toolsDir, '..');
const sourceDir = path.join(toolsDir, 'license-sources');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sorted = values => [...values].sort((a, b) => a.localeCompare(b, 'en'));
const read = file => fs.readFileSync(file, 'utf8');
const NOTICE_NAME = /^(licen[cs]e|copying|notice|copyright)([.\-_]|$)/i;

// Keep the source copies verbatim. These are version-pinned upstream files,
// fetched during maintenance, never from the network at build or app startup.
function sourceFile(name, provenance) {
  const text = read(path.join(sourceDir, name));
  if (sha256(text) !== provenance.sources[name]?.sha256) throw new Error(`License source changed: ${name}`);
  return { text, source: provenance.sources[name].url };
}

function noticeFiles(folder, depth = 0) {
  const found = [];
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const file = path.join(folder, entry.name);
    if (entry.isDirectory() && depth < 4) found.push(...noticeFiles(file, depth + 1));
    else if (entry.isFile() && NOTICE_NAME.test(entry.name) && fs.statSync(file).size < 2_000_000) found.push(file);
  }
  return sorted(found);
}

function upstreamSupplement(pkg, provenance) {
  let name;
  if (pkg.name.startsWith('@tiptap/')) name = `tiptap-${pkg.version}-LICENSE`;
  if (pkg.name.startsWith('@radix-ui/')) name = 'radix-1.1.2-LICENSE';
  if (pkg.name.startsWith('embla-carousel')) name = `embla-${pkg.version}-LICENSE`;
  if (pkg.name === 'boolbase') name = 'boolbase-1.0.0-LICENSE';
  if (pkg.name === 'input-otp') name = `input-otp-${pkg.version}-LICENSE`;
  if (pkg.name === 'victory-vendor') name = `victory-vendor-${pkg.version}-LICENSE`;
  return name && provenance.sources[name] ? sourceFile(name, provenance) : null;
}

export function licenseChoices(declared) {
  // Deliberate choices for alternative licenses; AND still means both apply.
  if (declared === '(MIT OR GPL-3.0-or-later)' || declared === 'MIT OR SEE LICENSE IN FEEL-FREE.md') return ['MIT'];
  if (declared === '(MPL-2.0 OR Apache-2.0)') return ['Apache-2.0'];
  if (declared === '(MIT AND Zlib)') return ['MIT', 'Zlib'];
  if (declared === 'MIT AND ISC') return ['MIT', 'ISC'];
  if (/^[\w.-]+$/.test(declared)) return [declared];
  throw new Error(`Unreviewed npm license expression: ${declared}`);
}

export function licenseIssues(pkg) {
  const issues = [];
  if (/\b(?:A?GPL)-/i.test(pkg.declaredLicense)) issues.push({
    package: `${pkg.name}@${pkg.version}`,
    kind: 'copyleft',
    message: pkg.licenses.includes('MIT') && / OR /.test(pkg.declaredLicense)
      ? 'GPL alternative declared; BEX uses the available MIT option. Preserve the upstream dual-license notice.'
      : 'Potential GPL/AGPL issue: review distribution obligations before release.',
  });
  if (pkg.licenses.includes('Hippocratic-2.1')) issues.push({ package: `${pkg.name}@${pkg.version}`, kind: 'restricted', message: 'Hippocratic-2.1 includes additional use conditions; review them before distribution.' });
  if (pkg.metadataOnly) issues.push({ package: `${pkg.name}@${pkg.version}`, kind: 'notice', message: 'No complete original notice was found in the installed package or checked upstream locations. Declared license and author metadata are retained; verify attribution before distribution.' });
  return issues;
}

function packageRecord(root, relative, entry, provenance) {
  const folder = path.join(root, relative);
  if (!fs.existsSync(path.join(folder, 'package.json'))) {
    if (entry.optional) return null; // other OS/CPU artifacts are not shipped here
    throw new Error(`Missing runtime package: ${relative}. Run npm ci before generating notices.`);
  }
  const pkg = readJson(path.join(folder, 'package.json'));
  if (entry.version !== pkg.version) throw new Error(`License inventory differs from package-lock.json: ${relative}`);
  const notices = noticeFiles(folder).map(file => ({ source: `${relative}/${path.relative(folder, file).split(path.sep).join('/')}`, text: read(file) }));
  const supplement = !notices.length || pkg.name === 'victory-vendor' ? upstreamSupplement(pkg, provenance) : null;
  if (supplement && !notices.some(notice => notice.text === supplement.text)) notices.push(supplement);
  // Pako's second (zlib) notice is in a README, not its top-level MIT file.
  if (pkg.name === 'pako') notices.push({ source: `${relative}/lib/zlib/README`, text: read(path.join(folder, 'lib/zlib/README')) });
  if (!notices.length) {
    for (const file of fs.readdirSync(folder).filter(file => /^readme/i.test(file))) {
      const text = read(path.join(folder, file));
      const start = text.search(/(?:^|\n)(?:#+\s*)?(?:The )?MIT License|(?:^|\n)(?:#+\s*)?License\s*(?:\n[-=]+)?\s*\n/i);
      if (start >= 0 && /Permission is hereby granted/.test(text.slice(start))) notices.push({ source: `${relative}/${file}`, text: text.slice(start).trim() });
    }
  }
  // Platform binaries use the same release's wrapper notice (the binaries
  // themselves omit it). Do not manufacture a copyright owner or year.
  if (!notices.length && (pkg.name.startsWith('@napi-rs/canvas-') || pkg.name.startsWith('@esbuild/'))) {
    const wrapper = pkg.name.startsWith('@napi-rs/canvas-') ? 'node_modules/@napi-rs/canvas/LICENSE' : relative.replace(/node_modules\/@esbuild\/[^/]+$/, 'node_modules/esbuild/LICENSE.md');
    const fallback = path.join(root, wrapper);
    if (fs.existsSync(fallback)) notices.push({ source: wrapper, text: read(fallback) });
  }
  const declaredLicense = pkg.license || entry.license || (/The MIT License/.test(notices.map(n => n.text).join('\n')) ? 'MIT' : '');
  if (!declaredLicense) throw new Error(`No license identified: ${pkg.name}@${pkg.version}`);
  const author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name || '';
  const copyright = sorted(new Set(notices.flatMap(n => n.text.split('\n').filter(line => /copyright|^\s*\(c\)\s*\d/i.test(line) && !/permission notice|this list|the above|copyright (?:law|owner|holder|and patent)|copyright,|copyright and|copyright or|<''year''>/i.test(line)).map(line => line.trim()))));
  return { name: pkg.name, version: pkg.version, path: relative, declaredLicense, licenses: licenseChoices(declaredLicense), author, copyright, notices, metadataOnly: !notices.length };
}

function rendererPackagePaths(root, moduleIds, lock) {
  const result = new Set();
  for (const id of moduleIds) {
    const clean = id.replace(/^\0/, '').split('?')[0];
    if (!clean.includes('/node_modules/')) continue;
    const relative = path.relative(root, clean).split(path.sep).join('/');
    // Take the deepest package, including scoped/nested packages.
    const matches = [...relative.matchAll(/(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+/g)];
    const last = matches.at(-1);
    if (!last) continue;
    const key = relative.slice(0, last.index + last[0].length);
    if (lock.packages[key]) result.add(key);
    else throw new Error(`Bundled npm module absent from lockfile: ${key}`);
  }
  return result;
}

export function collectLicenseAssets({ root = defaultRoot, moduleIds = [] } = {}) {
  const lock = readJson(path.join(root, 'package-lock.json'));
  const provenance = readJson(path.join(sourceDir, 'provenance.json'));
  const electronRoot = path.join(root, 'node_modules/electron');
  const version = readJson(path.join(electronRoot, 'package.json')).version;
  const binaryVersion = read(path.join(electronRoot, 'dist/version')).trim();
  if (version !== binaryVersion || version !== provenance.electronVersion) throw new Error('Electron changed: refresh pinned runtime license sources before building. See read.me (Dependencies, assets and notices).');
  const chromiumFile = fs.readFileSync(path.join(electronRoot, 'dist/LICENSES.chromium.html'));
  const credits = parse(chromiumFile.toString('utf8'));
  const productText = name => {
    const product = credits.querySelectorAll('.product').find(product => product.querySelector('.title')?.text === name);
    const text = product?.querySelector('pre')?.text;
    if (!text) throw new Error(`Electron notices omit ${name}`);
    return text;
  };
  const releaseUrl = `https://github.com/electron/electron/releases/tag/v${version}`;
  const depsUrl = `https://github.com/electron/electron/blob/v${version}/DEPS`;
  const runtime = [
    { name: 'Electron', version, license: 'MIT', text: read(path.join(electronRoot, 'LICENSE')), source: `https://github.com/electron/electron/blob/v${version}/LICENSE` },
    { name: 'Chromium third-party licenses', license: 'Multiple licenses', file: '/licenses/LICENSES.chromium.html', bytes: chromiumFile.length, sha256: sha256(chromiumFile), source: depsUrl, note: 'Complete, unmodified LICENSES.chromium.html from the installed Electron package. Bundled separately for offline reading.' },
    { name: 'Node.js', version: provenance.nodeVersion, license: 'MIT + bundled third-party notices', text: productText('Node.js'), source: `https://github.com/nodejs/node/blob/v${provenance.nodeVersion}/LICENSE` },
    { name: 'OpenSSL (bundled with Node.js)', license: 'Apache-2.0', ...sourceFile('openssl-node-24.18.0-LICENSE', provenance) },
    { name: 'Squirrel.Mac', license: 'MIT', ...sourceFile('Squirrel-Mac-LICENSE', provenance), note: 'The Squirrel.Mac revision pinned by this Electron release is distributed under the MIT license. Its original notice is retained here.' },
    { name: 'Mantle', license: 'MIT + Proton BSD-style notice', ...sourceFile('Mantle-LICENSE', provenance), note: 'The pinned Mantle license includes MIT terms and a separate two-condition Proton notice. Both are retained verbatim.' },
    { name: 'ReactiveObjC', license: 'MIT', ...sourceFile('ReactiveObjC-LICENSE', provenance) },
    { name: 'nan (Native Abstractions for Node)', license: 'MIT', ...sourceFile('nan-LICENSE', provenance) },
    { name: 'FFmpeg', license: 'LGPL-2.1-or-later', text: productText('ffmpeg'), source: releaseUrl,
      note: `This software uses libraries from the FFmpeg project under LGPL-2.1-or-later. Matching Electron source and release: ${releaseUrl}. Use that exact tag's DEPS to obtain the corresponding Chromium/FFmpeg revisions and its patches/build configuration. BEX uses Electron's unmodified dynamically linked FFmpeg library.`,
      links: [{ label: `Electron v${version} source and release`, url: releaseUrl }, { label: 'Pinned dependencies and revisions', url: depsUrl }, { label: 'Build instructions for this release', url: `https://github.com/electron/electron/blob/v${version}/docs/development/build-instructions-gn.md` }] },
  ];
  const bundled = rendererPackagePaths(root, moduleIds, lock);
  const paths = new Set(Object.keys(lock.packages).filter(key => key && !lock.packages[key].dev));
  for (const key of bundled) if (key !== 'node_modules/electron') paths.add(key);
  const packages = sorted(paths).map(key => packageRecord(root, key, lock.packages[key], provenance)).filter(Boolean);
  const groups = sorted(new Set(packages.flatMap(pkg => pkg.licenses))).map(license => {
    const members = packages.filter(pkg => pkg.licenses.includes(license));
    const find = (name, file) => read(path.join(root, 'node_modules', name, file));
    const templates = {
      MIT: () => find('react', 'LICENSE'),
      ISC: () => find('d3-color', 'LICENSE'),
      'Apache-2.0': () => find('pdfjs-dist', 'LICENSE'),
      'BSD-2-Clause': () => find('css-what', 'LICENSE'),
      'BSD-3-Clause': () => find('d3-ease', 'LICENSE'),
      'OFL-1.1': () => find('@fontsource/rajdhani', 'LICENSE'),
      'Python-2.0': () => find('argparse', 'LICENSE'),
      'BlueOak-1.0.0': () => find('jackspeak', 'LICENSE.md'),
      'Hippocratic-2.1': () => find('react-leaflet', 'LICENSE.md'),
      Unlicense: () => find('robust-predicates', 'LICENSE'),
      '0BSD': () => find('tslib', 'LICENSE.txt'),
      Zlib: () => find('pako', 'lib/zlib/README'),
    };
    if (!templates[license]) throw new Error(`Add a full text for license type ${license} before release.`);
    return { license, text: templates[license](), packages: members.map(({ notices, ...pkg }) => ({ ...pkg, bundled: bundled.has(pkg.path) })) };
  });
  const issues = packages.flatMap(licenseIssues);
  const manifest = { schemaVersion: 1, electronVersion: version, lockSha256: sha256(read(path.join(root, 'package-lock.json'))),
    scope: 'All installed production dependencies and their transitive dependencies, plus npm modules included in either renderer bundle. Production entries are retained conservatively even if tree-shaken. Other-platform optional binaries and development-only tooling are excluded.',
    packageCount: packages.length, runtime, groups, issues,
    originalNoticesFile: '/licenses/npm-original-notices.txt',
  };
  // Originals carry package-specific terms, copyright and NOTICE files; grouping
  // the UI must never discard them or replace them with a generic license.
  const originals = packages.map(pkg => [
    `\n${'='.repeat(76)}\n${pkg.name}@${pkg.version}\nPath: ${pkg.path}\nDeclared: ${pkg.declaredLicense}\nUsed: ${pkg.licenses.join(' AND ')}\n${pkg.author ? `Author (package metadata): ${pkg.author}\n` : ''}`,
    ...pkg.notices.map(notice => `\nSource: ${notice.source}\n\n${notice.text}`),
    ...(pkg.metadataOnly ? [`\nNo separate notice supplied upstream. Declared license terms follow; attribution requires review.\n${groups.find(group => group.license === pkg.licenses[0]).text}`] : []),
  ].join('\n')).join('\n');
  const assets = new Map([
    ['licenses/manifest.json', Buffer.from(JSON.stringify(manifest))],
    ['licenses/LICENSES.chromium.html', chromiumFile],
    ['licenses/npm-original-notices.txt', Buffer.from(originals)],
  ]);
  return { manifest, assets };
}

export function licenseAssetsPlugin() {
  let root = defaultRoot;
  let cached;
  function developmentAssets() {
    if (!cached) cached = collectLicenseAssets({ root });
    return cached.assets;
  }
  return {
    name: 'bex-software-license-assets',
    configResolved(config) { root = config.root; },
    configureServer(server) {
      server.watcher.on('change', file => { if (/package(?:-lock)?\.json$/.test(file) || file.includes('license-sources')) cached = undefined; });
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url || '/', 'http://localhost').pathname;
        if (!pathname.startsWith('/licenses/')) return next();
        if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
        try {
          const data = developmentAssets().get(pathname.slice(1));
          if (!data) { response.writeHead(404); response.end('License file not found'); return; }
          const mime = pathname.endsWith('.html') ? 'text/html' : pathname.endsWith('.json') ? 'application/json' : 'text/plain';
          response.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8`, 'Content-Length': data.length, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
          response.end(request.method === 'HEAD' ? undefined : data);
        } catch (error) { response.writeHead(500); response.end(`Could not generate license notices: ${error.message}`); }
      });
    },
    generateBundle() {
      const { assets } = collectLicenseAssets({ root, moduleIds: this.getModuleIds() });
      for (const [fileName, source] of assets) this.emitFile({ type: 'asset', fileName, source });
    },
  };
}
