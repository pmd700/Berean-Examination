'use strict';
// Real shared editor and Chromium ClipboardEvents. Never reads or writes the OS clipboard.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const project = path.resolve(__dirname, '..');
if (!process.versions.electron) {
  (async () => {
    const temp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bex-toggle-clipboard-'));
    try {
      await require('esbuild').build({ entryPoints: [path.join(project, 'tests/fixtures/toggleClipboard.jsx')], outfile: path.join(temp, 'fixture.js'), bundle: true, platform: 'browser', format: 'iife',
        alias: { '@/api/desktopClient': path.join(project, 'tests/fixtures/spotlightDesktopStub.js'), '@': path.join(project, 'src'), '@shared': path.join(project, 'shared') },
        loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file' }, logLevel: 'warning', define: { 'process.env.NODE_ENV': '"production"' } });
      fs.writeFileSync(path.join(temp, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="fixture.css"></head><body><main id="editor"></main><script src="fixture.js"></script></body></html>');
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
      const result = require('node:child_process').spawnSync(require('electron'), [__filename, temp], { env, cwd: project, encoding: 'utf8', timeout: 60000 });
      process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
      if (result.error) console.error(result.error);
      process.exitCode = result.status === 0 ? 0 : 1;
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  const { app, BrowserWindow } = require('electron');
  const temp = process.argv[2];
  app.setPath('userData', path.join(temp, 'profile'));
  app.whenReady().then(async () => {
    const win = new BrowserWindow({ width: 1100, height: 800, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const run = code => win.webContents.executeJavaScript(code);
    try {
      await win.loadFile(path.join(temp, 'index.html'));
      for (let i = 0; i < 120 && !await run('window.toggleClipboardProof?.ready()'); i++) await new Promise(resolve => setTimeout(resolve, 50));
      for (const source of [
        '<details><summary>John 20:23 ❌</summary><div data-type="detailsContent"><p>Unselected body</p></div></details>',
        '<details open><summary>Outer</summary><div data-type="detailsContent"><details><summary>Nested ❌</summary><div data-type="detailsContent"><p>Unselected body</p></div></details></div></details>',
        '<details open><summary>Title</summary><div data-type="detailsContent"><p>Selected body ❌</p></div></details>',
      ]) {
        await run(`toggleClipboardProof.set(${JSON.stringify(source)}); toggleClipboardProof.select('❌')`);
        const before = await run('toggleClipboardProof.html()');
        const copied = await run('toggleClipboardProof.copy()');
        assert.equal(copied.text, '❌'); assert.ok(copied.handled && !/details|summary|chevron/.test(copied.html), copied.html);
        assert.equal(await run('toggleClipboardProof.html()'), before);
        await run('toggleClipboardProof.set("<p>Destination</p>")');
        const pasted = await run(`toggleClipboardProof.paste(${JSON.stringify(copied)})`);
        assert.equal(pasted.dropdowns, 0); assert.equal(pasted.text, 'Destination❌');
      }
      console.log('PASS: actual shared editor copies/pastes just the selected emoji from closed titles, nested titles and open bodies, with no unselected dropdowns');
      const whole = '<details open><summary>Full dropdown</summary><div data-type="detailsContent"><p>Full body</p></div></details>';
      for (const method of ['whole', 'marquee']) {
        await run(`toggleClipboardProof.set(${JSON.stringify(whole)}); toggleClipboardProof.${method}()`);
        const copied = await run('toggleClipboardProof.copy()');
        assert.ok(copied.html.includes('<details') && copied.text.includes('Full body'));
        await run('toggleClipboardProof.set("<p>Destination</p>")');
        const pasted = await run(`toggleClipboardProof.paste(${JSON.stringify(copied)})`);
        assert.equal(pasted.dropdowns, 1); assert.ok(pasted.text.includes('Full dropdown') && pasted.text.includes('Full body'));
      }
      console.log('PASS: whole-dropdown and marquee copies preserve one complete dropdown and all its writing; OS clipboard untouched');
      win.destroy(); app.exit(0);
    } catch (error) { console.error(error.stack || error); win.destroy(); app.exit(1); }
  });
}
