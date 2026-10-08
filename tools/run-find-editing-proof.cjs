'use strict';
// Regression proof using real mouse clicks and typing in a note with Cmd+F open.
// Temporary offline data only; never starts the user's workspace or library.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const project = path.resolve(__dirname, '..');
if (!process.versions.electron) {
  (async () => {
    const temp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bex-find-editing-'));
    await require('esbuild').build({
      entryPoints: [path.join(project, 'tests/fixtures/findEditing.jsx')],
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
      await until('Boolean(document.querySelector(".ProseMirror"))');
      const keys = (keyCode, modifiers = []) => { win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers}); win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers}); };
      await click('.ProseMirror > p');
      keys('f', ['meta']);
      await until(`Boolean(document.querySelector('[data-testid="input-editor-find"]'))`);
      await win.webContents.insertText('times');
      await until('document.querySelectorAll(".bex-find-hit").length === 3');
      await pause(500);
      // Click straight from the find field into a temporarily revealed body.
      await click('.bex-find-hit-active');
      await pause(100);
      let state = await js('findEditingProof.snapshot()');
      assert.ok(state.active.includes('ProseMirror'), 'Clicking highlighted text must focus note');
      assert.equal(state.anchor, 'times', 'Caret must remain in clicked text, not bounce to the dropdown title');
      await win.webContents.insertText('CHANGED');
      await pause(200);
      state = await js('findEditingProof.snapshot()');
      assert.ok(state.paragraph.includes('CHANGED') && state.find === 'times', JSON.stringify(state));
      assert.equal(state.matches, 2, 'Highlights update as the word is edited');
      assert.deepEqual(state.open, [true, true], 'Editing must keep this body visible');
      await click('.ProseMirror > p');
      await pause(100);
      await win.webContents.insertText('EDIT');
      await pause(200);
      state = await js('findEditingProof.snapshot()');
      assert.ok(state.paragraph.includes('EDIT') && state.find === 'times', JSON.stringify(state));
      // Cmd+F still focuses the existing bar; manual closure stays authoritative.
      keys('f', ['meta']);
      await until('document.activeElement?.getAttribute("data-testid") === "input-editor-find"');
      await win.webContents.insertText('Second');
      await until('document.querySelectorAll(".bex-find-hit").length === 1');
      await click('.toggle-block__chevron');
      await pause(250);
      assert.deepEqual((await js('findEditingProof.snapshot()')).open, [false, true]);
      await click('.ProseMirror > p');
      await pause(100);
      await win.webContents.insertText('MORE');
      await pause(100);
      assert.deepEqual((await js('findEditingProof.snapshot()')).open, [false, true]);
      await click('[data-testid="button-editor-find-next"]');
      await pause(300);
      assert.deepEqual((await js('findEditingProof.snapshot()')).open, [true, true]);
      await click('.bex-find-hit-active');
      await pause(100);
      assert.equal((await js('findEditingProof.snapshot()')).anchor, 'Second');
      console.log('PASS: native clicks place caret and edit highlighted and ordinary text while Cmd+F stays open');
      console.log('PASS: highlights update, Cmd+F refocuses the bar, manual dropdown closure persists until arrow navigation');
      win.destroy(); app.exit(0);
    } catch (error) {
      console.error(error); console.error('STATE:', await js('findEditingProof.snapshot()')); fs.writeFileSync(path.join(temp, 'failure.png'), (await win.webContents.capturePage()).toPNG()); console.error('SCREENSHOTS: ' + temp); win.destroy(); app.exit(1);
    }
  });
}
