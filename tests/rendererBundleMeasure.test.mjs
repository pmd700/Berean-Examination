import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
test('renderer measurement follows static imports and styles, not lazy assets, with and without a Vite manifest', () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'bex-bundle-measure-'));
  try {
    mkdirSync(path.join(temp, 'assets'));
    const files = {
      'index.html': '<script type="module" src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css">',
      'studio.html': '<script type="module" src="/assets/studio.js"></script>',
      'assets/app.js': 'import { value } from "./shared.js"; import "./shared.js"; export const later = () => import("./lazy.js"); console.log(value);',
      'assets/studio.js': 'export { value } from "./shared.js";',
      'assets/shared.js': 'export const value = 42;',
      'assets/lazy.js': 'export const unused = "Do not count me until opened";',
      'assets/app.css': 'body { color: white; }',
      'assets/shared.css': 'button { color: green; }',
      'assets/lazy.css': '.later { color: red; }',
    };
    for (const [file, content] of Object.entries(files)) writeFileSync(path.join(temp, file), content);
    const measure = () => {
      execFileSync(process.execPath, [path.join(root, 'tools/measure-renderer-bundles.mjs'), '--dist', temp, '--json', path.join(temp, 'report.json')], { cwd: root });
      return JSON.parse(readFileSync(path.join(temp, 'report.json'), 'utf8'));
    };
    const old = measure();
    assert.match(old.method, /AST/);
    const app = old.entries.find(entry => entry.html === 'index.html');
    assert.deepEqual(app.staticJavaScript.files, ['assets/app.js', 'assets/shared.js']);
    assert.equal(app.staticJavaScript.rawBytes, Buffer.byteLength(files['assets/app.js']) + Buffer.byteLength(files['assets/shared.js']));
    assert.equal(app.staticJavaScript.gzipBytes, gzipSync(files['assets/app.js']).length + gzipSync(files['assets/shared.js']).length);
    assert.deepEqual(app.staticCss.files, ['assets/app.css']);
    assert.deepEqual(old.entries.find(entry => entry.html === 'studio.html').staticJavaScript.files, ['assets/shared.js', 'assets/studio.js']);
    mkdirSync(path.join(temp, '.vite'));
    writeFileSync(path.join(temp, '.vite/manifest.json'), JSON.stringify({
      'index.html': { file: 'assets/app.js', imports: ['shared'], dynamicImports: ['later'], css: ['assets/app.css'] },
      'studio.html': { file: 'assets/studio.js', imports: ['shared'] },
      shared: { file: 'assets/shared.js', css: ['assets/shared.css'] },
      later: { file: 'assets/lazy.js', css: ['assets/lazy.css'] },
    }));
    const current = measure(), result = current.entries.find(entry => entry.html === 'index.html');
    assert.match(current.method, /manifest/);
    assert.deepEqual(result.staticJavaScript, app.staticJavaScript);
    assert.deepEqual(result.staticCss.files, ['assets/app.css', 'assets/shared.css']);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
