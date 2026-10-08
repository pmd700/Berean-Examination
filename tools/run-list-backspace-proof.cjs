'use strict';
// Native Backspace regression in the real shared note editor; isolated data only.
// Temporary offline data only; never starts the user's workspace or library.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const project = path.resolve(__dirname, '..');
if (!process.versions.electron) {
  (async () => {
    const temp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bex-list-backspace-'));
    await require('esbuild').build({
      entryPoints: [path.join(project, 'tests/fixtures/listBackspace.jsx')],
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
    try {
      await win.loadFile(path.join(temp, 'index.html'));
      await until('listBackspaceProof.ready()');
      const backspace = async () => {
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' });
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
        await pause(120);
      };
      for (const tag of ['ul', 'ol']) {
        const html = `<${tag}><li><p>First</p></li><li><p><strong>Target</strong></p></li></${tag}>`;
        await js(`listBackspaceProof.load(${JSON.stringify(html)}, 'Target')`); await pause(120);
        await backspace();
        let state = await js('listBackspaceProof.snapshot()');
        assert.deepEqual(state.nodes, [tag === 'ul' ? 'bulletList' : 'orderedList', 'paragraph'], JSON.stringify(state));
        assert.equal(state.listItems, 1);
        await backspace();
        state = await js('listBackspaceProof.snapshot()');
        assert.equal(state.html, `<${tag}><li><p>First<strong>Target</strong></p></li></${tag}>`);
        assert.equal(state.offset, 5);
        await backspace();
        state = await js('listBackspaceProof.snapshot()');
        assert.equal(state.text, 'FirsTarget');
        assert.equal(state.listItems, 1);
      }
      await js(`listBackspaceProof.load('<p>text</p><ol><li><p>Target</p></li></ol>', 'Target')`); await pause(120);
      await backspace(); await backspace();
      const state = await js('listBackspaceProof.snapshot()');
      assert.equal(state.html, '<p>textTarget</p>');
      assert.equal(state.listItems, 0);
      assert.equal(state.offset, 4);
      console.log('PASS: native Backspace removes bullet/number, joins on the second press, and deletes a character on the third');
      console.log('PASS: plain paragraphs join normally and bold formatting survives');
      win.destroy(); app.exit(0);
    } catch (error) {
      console.error(error); console.error('STATE:', await js('listBackspaceProof.snapshot()')); fs.writeFileSync(path.join(temp, 'failure.png'), (await win.webContents.capturePage()).toPNG()); console.error('SCREENSHOTS: ' + temp); win.destroy(); app.exit(1);
    }
  });
}
