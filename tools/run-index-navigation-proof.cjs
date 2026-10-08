'use strict';
// Real Chromium layout + native interruption, using the actual shared editor.
// Temporary offline data only; never starts the user's workspace or library.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const project = path.resolve(__dirname, '..');
if (!process.versions.electron) {
  (async () => {
    const temp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bex-index-'));
    await require('esbuild').build({
      entryPoints: [path.join(project, 'tests/fixtures/indexNavigation.jsx')],
      outfile: path.join(temp, 'fixture.js'), bundle: true, platform: 'browser', format: 'iife',
      alias: { '@/api/desktopClient': path.join(project, 'tests/fixtures/spotlightDesktopStub.js'), '@': path.join(project, 'src') },
      loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file' }, logLevel: 'warning',
      define: { 'process.env.NODE_ENV': '"production"' },
    });
    const styles = fs.readdirSync(path.join(project, 'dist/assets')).filter(name => name.endsWith('.css'))
      .map(name => `<link rel="stylesheet" href="file://${path.join(project, 'dist/assets', name)}">`).join('');
    fs.writeFileSync(path.join(temp, 'index.html'), `<!doctype html><html class="dark"><head>${styles}<link rel="stylesheet" href="fixture.css"><style>html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column;overflow:hidden}body{background:#0f111a;color:#eee;font-family:Arial,sans-serif}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = require('node:child_process').spawnSync(require('electron'), [__filename, temp], {
      env, cwd: project, encoding: 'utf8', timeout: 45000,
    });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    if (result.signal) console.error('Signal:', result.signal);
    if (result.error) console.error(result.error);
    process.exitCode = result.status === 0 ? 0 : 1;
  })().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  const { app, BrowserWindow } = require('electron');
  const temp = process.argv[2];
  app.setPath('userData', path.join(temp, 'user-data'));
  app.whenReady().then(async () => {
    const win = new BrowserWindow({ width: 1100, height: 730, show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const js = source => win.webContents.executeJavaScript(source);
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const until = async condition => {
      const deadline = Date.now() + 12000;
      while (!await js(condition)) {
        assert.ok(Date.now() < deadline, 'Timed out: ' + condition);
        await pause(35);
      }
    };
    const click = async selector => {
      const point = await js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return {x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2)}; })()`);
      win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
      win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    };
    try {
      await win.loadFile(path.join(temp, 'index.html'));
      await until('Boolean(document.querySelector(\'[data-testid="button-book-index"]\'))');
      await click('[data-testid="button-book-index"]');
      await until('Boolean(document.querySelector(\'[aria-label="Go to Exact evidence"]\'))');
      const style = await js(`(() => { const el = document.querySelector('[aria-label="Go to Exact evidence"]'); const s = getComputedStyle(el); return {color:s.color, weight:s.fontWeight, decoration:s.textDecorationLine}; })()`);
      assert.equal(style.decoration, 'none'); assert.equal(style.weight, '400');
      await js('indexProof.record()');
      await click('[aria-label="Go to Exact evidence"]');
      await until('indexProof.samples().some(sample => sample.turning)');
      await until('indexProof.snapshot().open.length === 2 && indexProof.snapshot().open.every(Boolean) && indexProof.snapshot().y > 100 && indexProof.snapshot().y < 550');
      await pause(350);
      const state = await js('indexProof.snapshot()');
      assert.ok(!state.turning && !state.highlighted && state.scroll > 1000, JSON.stringify(state));
      const samples = await js('indexProof.samples()');
      assert.ok(new Set(samples.map(sample => Math.round(sample.scroll))).size > 15, 'Expected smooth intermediate scroll positions');
      assert.ok(samples.some(sample => sample.open[0] && !sample.open[1]), 'Expected sequential reveal');
      fs.writeFileSync(path.join(temp, 'arrival.png'), (await win.webContents.capturePage()).toPNG());
      console.log('PASS: native index click turns pages, smoothly scrolls and opens nested dropdowns to the exact heading');
      console.log('PASS: index entry retains ordinary color/weight with no underline; destination receives no formatting change');
      console.log('SCREENSHOTS: ' + temp);
      win.destroy(); app.exit(0);
    } catch (error) {
      console.error(error); console.error('STATE:', await js('indexProof.snapshot()')); fs.writeFileSync(path.join(temp, 'failure.png'), (await win.webContents.capturePage()).toPNG()); console.error('SCREENSHOTS: ' + temp); win.destroy(); app.exit(1);
    }
  });
}
