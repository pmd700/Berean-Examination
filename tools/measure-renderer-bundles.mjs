import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { parse } from '@babel/parser';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; };
const dist = path.resolve(option('--dist') || path.join(root, 'dist'));
const manifestPath = path.join(dist, '.vite/manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
const manifestByFile = new Map(Object.values(manifest || {}).map(chunk => [chunk.file, chunk]));
const relativeAsset = href => href.replace(/^\/?(?:\.\/)?/, '');

function fileSizes(files) {
  let rawBytes = 0, gzipBytes = 0;
  for (const file of files) {
    const buffer = fs.readFileSync(path.join(dist, file));
    rawBytes += buffer.length; gzipBytes += gzipSync(buffer).length;
  }
  return { files: [...files].sort(), rawBytes, gzipBytes };
}

function measure(htmlName) {
  const html = fs.readFileSync(path.join(dist, htmlName), 'utf8');
  const entry = relativeAsset(html.match(/<script\b[^>]*\bsrc=["']([^"']+\.js)["']/)?.[1] || '');
  if (!entry) throw new Error(`No JavaScript entry found in ${htmlName}.`);
  const js = new Set(), css = new Set();
  for (const link of html.matchAll(/<link\b[^>]*>/g)) {
    if (!/\brel=["']stylesheet["']/.test(link[0])) continue;
    const href = link[0].match(/\bhref=["']([^"']+)["']/)?.[1];
    if (href) css.add(relativeAsset(href));
  }
  function visit(file) {
    if (js.has(file)) return;
    js.add(file);
    const chunk = manifestByFile.get(file);
    if (chunk) {
      chunk.css?.forEach(file => css.add(file));
      for (const imported of chunk.imports || []) {
        if (!manifest[imported]) throw new Error(`Missing manifest import ${imported}.`);
        visit(manifest[imported].file);
      }
    } else {
      // Support baseline builds made before manifest output was enabled.
      const ast = parse(fs.readFileSync(path.join(dist, file), 'utf8'), { sourceType: 'module' });
      for (const node of ast.program.body) {
        if (!['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) || !node.source?.value?.startsWith('.')) continue;
        const imported = path.posix.normalize(path.posix.join(path.posix.dirname(file), node.source.value));
        if (/\.[cm]?js$/.test(imported)) visit(imported);
        else if (imported.endsWith('.css')) css.add(imported);
      }
    }
  }
  visit(entry);
  return { html: htmlName, entry, staticJavaScript: fileSizes(js), staticCss: fileSizes(css) };
}

const report = {
  label: option('--label') || 'renderer build',
  measuredAt: new Date().toISOString(),
  method: manifest ? 'Vite manifest static imports plus HTML stylesheets' : 'JavaScript AST static imports plus HTML stylesheets',
  note: 'Static entry dependency closures only; excludes lazy routes/assets. These sizes do not measure startup latency, process memory, or the complete installed application.',
  entries: fs.readdirSync(dist).filter(file => file.endsWith('.html')).sort().map(measure),
};
for (const entry of report.entries) {
  console.log(`${entry.html}: initial JS ${entry.staticJavaScript.rawBytes} bytes (${entry.staticJavaScript.gzipBytes} gzip), CSS ${entry.staticCss.rawBytes} bytes (${entry.staticCss.gzipBytes} gzip)`);
}
if (option('--json')) {
  const target = path.resolve(option('--json'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n');
  console.log(`Report: ${target}`);
}
