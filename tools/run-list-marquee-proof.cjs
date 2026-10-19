'use strict';
// Actual shared Notes editor, native mouse/keyboard, disposable offline profile.
// Copy tests use in-memory ClipboardEvents and never touch the OS clipboard.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const project = path.resolve(__dirname, '..');
if (!process.versions.electron) {
  (async () => {
    const temp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bex-list-marquee-'));
    try {
      await require('esbuild').build({ entryPoints: [path.join(project, 'tests/fixtures/blockListMarquee.jsx')], outfile: path.join(temp, 'fixture.js'), bundle: true, platform: 'browser', format: 'iife',
        alias: { '@/api/desktopClient': path.join(project, 'tests/fixtures/spotlightDesktopStub.js'), '@': path.join(project, 'src'), '@shared': path.join(project, 'shared') },
        loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file' }, logLevel: 'warning', define: { 'process.env.NODE_ENV': '"production"' } });
      fs.writeFileSync(path.join(temp, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="fixture.css"><style>body{margin:0}main[data-bex-marquee-surface]{min-height:100vh}.ProseMirror{max-width:650px;margin:0 auto;padding:80px 0}p{line-height:1.5}li{margin:18px 0}</style></head><body><div id="editor"></div><script src="fixture.js"></script></body></html>');
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
    const win = new BrowserWindow({ width: 1100, height: 900, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const run = code => win.webContents.executeJavaScript(code);
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    try {
      await win.loadFile(path.join(temp, 'index.html'));
      for (let i = 0; i < 120 && !await run('window.listMarqueeProof?.ready()'); i++) await pause(50);
      for (const reverse of [false, true]) {
        await run('listMarqueeProof.reset()'); await pause(100);
        const before = await run('listMarqueeProof.snapshot().html');
        const points = await run('listMarqueeProof.points()');
        const from = reverse ? points.end : points.start, to = reverse ? points.start : points.end;
        win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...from });
        win.webContents.sendInputEvent({ type: 'mouseMove', ...to });
        await pause(60);
        let state = await run('listMarqueeProof.snapshot()');
        assert.deepEqual(state.selected, ['Explanation to select']);
        assert.equal(state.selectedItems, 1); assert.equal(state.selectedLists, 0);
        win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...to });
        await pause(60);
        state = await run('listMarqueeProof.snapshot()');
        assert.equal(state.html, before); assert.deepEqual(state.selected, ['Explanation to select']);
        const copied = await run('listMarqueeProof.copy()');
        assert.equal(copied.text, 'Explanation to select');
        assert.equal(copied.html, '<ul><li><p>Explanation to select</p></li></ul>');
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' });
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
        await pause(60);
        state = await run('listMarqueeProof.snapshot()');
        assert.ok(!state.html.includes('Explanation to select'));
        assert.ok(state.html.includes('First quotation') && state.html.includes('Second quotation') && state.html.includes('After the list'));
        await run('listMarqueeProof.undo()');
        assert.equal((await run('listMarqueeProof.snapshot()')).html, before);
      }
      console.log('PASS: native marquee in either direction selects one list entry inside an open dropdown');
      console.log('PASS: copy preserves its bullet; Backspace removes only that entry; Undo restores all text and structure');
      await run('listMarqueeProof.resetDrop()'); await pause(100);
      const beforeDrop = await run('listMarqueeProof.snapshot().html');
      const points = await run('listMarqueeProof.dropPoints()');
      win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...points.start });
      win.webContents.sendInputEvent({ type: 'mouseMove', ...points.end });
      win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...points.end });
      await pause(60);
      assert.equal((await run('listMarqueeProof.snapshot()')).selected.length,8);
      win.webContents.sendInputEvent({ type: 'mouseMove', ...points.hover }); await pause(60);
      const grip = await run(`(() => {const rect=document.querySelector('.bex-block-drag-handle.is-visible').getBoundingClientRect();return {x:Math.round(rect.left+rect.width/2),y:Math.round(rect.top+rect.height/2)};})()`);
      win.webContents.sendInputEvent({ type: 'mouseMove', ...grip });
      win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...grip });
      win.webContents.sendInputEvent({ type: 'mouseMove', ...points.target }); await pause(60);
      win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...points.target });
      await pause(60);
      const dropped = await run('listMarqueeProof.dropResult()');
      assert.deepEqual(dropped,{heading:'Principles:',bold:'under the surface.',items:['surface','mechanism','impact','attempt','priority'],headings:1,last:'Keep outside'});
      await run('listMarqueeProof.undo()');assert.equal((await run('listMarqueeProof.snapshot()')).html,beforeDrop);
      await run('listMarqueeProof.redo()');assert.deepEqual(await run('listMarqueeProof.dropResult()'),dropped);
      console.log('PASS: native marquee + six-dot drag moves mixed headings/prose/numbered items into an open dropdown; Undo and Redo preserve the document');
      win.destroy(); app.exit(0);
    } catch (error) { console.error(error.stack || error); console.error('STATE:', await run('listMarqueeProof.snapshot()')); win.destroy(); app.exit(1); }
  });
}
