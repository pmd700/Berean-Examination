'use strict';
// Explicitly supplied workbook only; isolated profile, no app database or Vault.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
if (!process.versions.electron) {
  (async () => {
    const source = process.argv[2];
    if (!source || !fs.existsSync(source)) throw Error('Usage: node tools/run-spreadsheet-formula-proof.cjs /path/to/research.xlsx');
    const temp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bex-formula-proof-'));
    try {
      await require('esbuild').build({ entryPoints: [path.join(root, 'tests/fixtures/spreadsheetFormulas.jsx')], outfile: path.join(temp, 'fixture.js'), bundle: true, platform: 'browser', format: 'iife', alias: { '@/api/desktopClient': path.join(root, 'tests/fixtures/spotlightDesktopStub.js'), '@': path.join(root, 'src'), '@shared': path.join(root, 'shared') }, loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning' });
      const styles = fs.readdirSync(path.join(root, 'dist/assets')).filter(f => f.endsWith('.css')).map(f => `<link rel="stylesheet" href="file://${path.join(root, 'dist/assets', f)}">`).join('');
      fs.writeFileSync(path.join(temp, 'index.html'), `<!doctype html><html class="dark"><head>${styles}<link rel="stylesheet" href="fixture.css"><style>html,body,#root{height:100%;margin:0}body{background:#101620;color:#eee}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`);
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
      const result = require('node:child_process').spawnSync(require('electron'), [__filename, temp, path.resolve(source), ...(process.argv.includes('--oracle') ? ['--oracle'] : [])], { cwd: root, env, encoding: 'utf8', timeout: 90000 });
      process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || ''); if (result.error) console.error(result.error);
      process.exitCode = result.status === 0 ? 0 : 1;
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  const { app, BrowserWindow } = require('electron'), temp = process.argv[2], source = process.argv[3];
  app.setPath('userData', path.join(temp, 'profile'));
  app.whenReady().then(async () => {
    const win = new BrowserWindow({ width: 1600, height: 1000, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const external = [];
    win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (request, callback) => { external.push(request.url); callback({ cancel: true }); });
    const js = code => win.webContents.executeJavaScript(code);
    const until = async code => { for (let i = 0; i < 100; i++) { if (await js(code)) return; await new Promise(resolve => setTimeout(resolve, 25)); } throw Error('Timed out: '+code); };
    try {
      await win.loadFile(path.join(temp,'index.html'));
      await until('!!window.formulaProof');
      const original = fs.readFileSync(source);
      const baseline = await js(`formulaProof.load(${JSON.stringify([...original])})`);
      if (process.argv.includes('--oracle')) {
        assert.deepEqual(baseline.differences, []);
        assert.ok(baseline.formulas > 100);
        assert.deepEqual(external, []);
        console.log(`PASS: ${baseline.formulas} independently recalculated formula results match BEX, including deliberate error cases.`);
        win.destroy(); app.exit(0); return;
      }
      assert.equal(baseline.formulas, 1077); assert.equal(baseline.tables, 6);
      assert.deepEqual(baseline.errors, []); assert.deepEqual(baseline.differences, []);
      assert.deepEqual(baseline.headline.slice(0,5), [['B4',1024],['D4',910],['F4',114],['B5',64],['F5',0]]);
      console.log(`PASS: all ${baseline.formulas} formulas across six worksheets match the source workbook's cached results; ${baseline.tables} tables resolved, no formula errors (${baseline.milliseconds}ms).`);
      await until('!!document.querySelector(\'[data-sheet-cell="B4"]\')');
      assert.equal(await js(`document.querySelector('[data-sheet-cell="B4"]').textContent`), '1024');
      fs.writeFileSync('/private/tmp/bex-research-formulas-proof.png', (await win.webContents.capturePage()).toPNG());
      await js(`formulaProof.edit('Inventory','E8','1 — bedrock')`);
      await until(`formulaProof.read('Inventory','F5')===1`);
      assert.equal(await js(`formulaProof.read('Guide','E7')`), 1);
      assert.equal(await js(`formulaProof.read('Guide','E6')`), 1023);
      await js(`formulaProof.edit('Evidence Log','B8','C0001')`);
      await until(`formulaProof.read('Inventory','V8')===1`);
      assert.equal(await js(`formulaProof.read('Inventory','V9')`), 0);
      assert.equal(await js(`formulaProof.read('Guide','B8')`), 1);
      console.log('PASS: temporary tier and evidence-ID edits recalculate cross-sheet summaries and per-claim counts immediately.');
      const legacy = await js(`formulaProof.legacy()`);
      assert.equal(legacy.unchanged, true); assert.deepEqual(legacy.result.errors, []);
      assert.equal(legacy.result.headline.find(([a]) => a === 'F5')[1], 1);
      console.log('PASS: earlier BEX import metadata is repaired without overwriting any edited cell.');
      const roundTrip = await js(`formulaProof.roundTrip()`);
      assert.deepEqual(roundTrip.report.errors, []); assert.deepEqual(roundTrip.report.differences, []);
      fs.writeFileSync('/private/tmp/bex-research-formulas-verified.xlsx', Buffer.from(roundTrip.bytes));
      console.log('PASS: native Chromium Excel export/reimport retains all formulas and six table definitions, with correct freshly calculated values.');
      assert.deepEqual(external, []); assert.deepEqual(fs.readFileSync(source), original);
      console.log('PASS: supplied file unchanged; no personal Vault or network access.');
      win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
  });
}
