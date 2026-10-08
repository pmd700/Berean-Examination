'use strict';
// Real Chromium, native shortcuts and isolated fixture data. Never opens the vault.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const project = path.resolve(__dirname, '..');
if (!process.versions.electron) {
  (async () => {
    const temp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bex-pointers-'));
    await require('esbuild').build({
      entryPoints: [path.join(project, 'tests/fixtures/pointers.jsx')],
      outfile: path.join(temp, 'fixture.js'), bundle: true, platform: 'browser', format: 'iife',
      alias: { '@/api/desktopClient': path.join(project, 'tests/fixtures/spotlightDesktopStub.js'), '@': path.join(project, 'src') },
      loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file' }, logLevel: 'warning',
      define: { 'process.env.NODE_ENV': '"production"' },
    });
    fs.copyFileSync(path.join(project, 'tests/fixtures/pointers.html'), path.join(temp, 'index.html'));
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const result = require('node:child_process').spawnSync(require('electron'), [__filename, temp], { env, cwd: project, encoding: 'utf8', timeout: 60000 });
    process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
    if (result.error) console.error(result.error);
    process.exitCode = result.status === 0 ? 0 : 1;
  })().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  const { app, BrowserWindow } = require('electron');
  const temp = process.argv[2];
  app.setPath('userData', path.join(temp, 'user-data'));
  app.whenReady().then(async () => {
    const win = new BrowserWindow({ width: 1180, height: 900, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const js = source => win.webContents.executeJavaScript(source);
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const until = async condition => {
      const deadline = Date.now() + 10000;
      while (!await js(condition)) { assert.ok(Date.now() < deadline, 'Timed out: ' + condition); await pause(40); }
    };
    const pressP = async () => {
      win.webContents.focus();
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'P', modifiers: ['meta'] });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'P', modifiers: ['meta'] });
      await pause(90);
    };
    try {
      await win.loadFile(path.join(temp, 'index.html'));
      await until('window.pointerProof?.ready()'); await pause(150);
      for (const [source, target] of [['Pellentesque', 'venenatis'], ['nibh', 'tincidunt'], ['condimentum', 'destination']]) {
        await js(`pointerProof.select(${JSON.stringify(source)})`); await pressP();
        assert.ok((await js('pointerProof.snapshot()')).pending);
        await js(`pointerProof.select(${JSON.stringify(target)}, true)`); await pressP();
      }
      assert.equal((await js('pointerProof.snapshot()')).count, 3);
      console.log('PASS: native Command-P twice creates each connection');
      await js('pointerProof.closeSections()'); await pause(400);
      let state = await js('pointerProof.snapshot()');
      assert.deepEqual(new Set(state.kinds), new Set(['bounce', 'diagonal', 'gutter']), JSON.stringify(state));
      fs.writeFileSync(path.join(temp, 'routes.png'), (await win.webContents.capturePage()).toPNG());
      console.log('PASS: real text layout produces bounce, diagonal and gutter paths');
      let alignment = await js('pointerProof.scrollAlignment()');
      assert.ok(alignment.maxDrift < 0.1 && alignment.pathsUnchanged, JSON.stringify(alignment));
      console.log('PASS: every line stays rigidly aligned during immediate scroll reversals, without redraws');
      await js('pointerProof.reload()'); await pause(120);
      assert.equal((await js('pointerProof.snapshot()')).count, 3);
      const point = await js('pointerProof.linePoint()');
      win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
      win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
      await until('pointerProof.snapshot().hit === "destination"');
      state = await js('pointerProof.snapshot()');
      assert.ok(state.scroll > 1000 && state.sections.every(Boolean));
      assert.ok(state.hitY > 100 && state.hitY < 800, JSON.stringify(state));
      fs.writeFileSync(path.join(temp, 'arrival.png'), (await win.webContents.capturePage()).toPNG());
      console.log('PASS: clicking the gutter reaches the precise target and reveals nested dropdowns');
      await js('pointerProof.closeSections()'); await pause(400);
      assert.ok((await js('pointerProof.snapshot()')).sections.every(open => !open));
      await js('document.getElementById("editor").style.zoom = "1.25"'); await pause(160);
      assert.equal((await js('pointerProof.snapshot()')).count, 3);
      assert.ok((await js('pointerProof.snapshot()')).paths.every(d => !d.includes('NaN')));
      win.setSize(720, 850); await pause(180);
      fs.writeFileSync(path.join(temp, 'narrow.png'), (await win.webContents.capturePage()).toPNG());
      console.log('PASS: routes update after zoom and narrow-window reflow');
      alignment = await js('pointerProof.scrollAlignment()');
      assert.ok(alignment.maxDrift < 0.1 && alignment.pathsUnchanged, JSON.stringify(alignment));
      console.log('PASS: scrolling remains rigid after zoom and reflow');
      await js('pointerProof.blockSelect()'); await pressP();
      assert.ok((await js('pointerProof.snapshot()')).pending);
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await pause(100);
      assert.equal((await js('pointerProof.snapshot()')).pending, 0);
      console.log('PASS: whole-block shortcut and native Escape cancellation');
      await js('pointerProof.rightRoute()');
      await js('pointerProof.select("Right source")'); await pressP();
      await js('pointerProof.select("Right target")'); await pressP();
      await until('pointerProof.gutterBounds().side === "right"');
      const bounds = await js('pointerProof.gutterBounds()');
      assert.ok(bounds.routeRight > bounds.textRight && bounds.endpointGap > 0 && bounds.endpointGap < 6, JSON.stringify(bounds));
      alignment = await js('pointerProof.scrollAlignment()');
      assert.ok(alignment.maxDrift < 0.1 && alignment.pathsUnchanged, JSON.stringify(alignment));
      fs.writeFileSync(path.join(temp, 'right-gutter.png'), (await win.webContents.capturePage()).toPNG());
      console.log('PASS: right-edge text uses the right gutter and remains rigid during scrolling');
      const prose = await js('pointerProof.text()');
      const rightPoint = await js('pointerProof.linePoint()');
      win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...rightPoint });
      win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...rightPoint });
      await pause(80);
      assert.ok(await js('document.activeElement?.classList.contains("bex-pointer-line-hit")'));
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
      await until('pointerProof.snapshot().count === 0');
      assert.equal(await js('pointerProof.text()'), prose);
      await js('pointerProof.undo()');
      await until('pointerProof.snapshot().count === 1');
      console.log('PASS: click then Backspace removes the arrow, preserves prose, and supports undo');
      await js('pointerProof.dropdownRoute()');
      await js('pointerProof.select("Source material")'); await pressP();
      await js('pointerProof.select("Target material")'); await pressP();
      await js('pointerProof.closeSections()'); await pause(400);
      const caretAlignment = await js('pointerProof.caretAlignment()');
      assert.ok(caretAlignment.every(point => Math.abs(point.dx) < 0.1 && Math.abs(point.dy) < 0.1), JSON.stringify(caretAlignment));
      fs.writeFileSync(path.join(temp, 'dropdown-carets.png'), (await win.webContents.capturePage()).toPNG());
      const caretPoint = await js('pointerProof.linePoint()');
      win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...caretPoint });
      win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...caretPoint });
      await until('pointerProof.snapshot().hit === "Target material"');
      assert.deepEqual((await js('pointerProof.snapshot()')).sections, [false, true]);
      console.log('PASS: collapsed dropdown pointers attach exactly to both white carets at zoom and still open the target when clicked');
      await js('pointerProof.echoFixture()');
      await js('pointerProof.select("placeholder")'); await pressP();
      await js('pointerProof.select("Linked passage")'); await pressP();
      const togglePoint = await js(`(() => { const r = document.querySelector('[aria-label="Echo Copy"]').getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })()`);
      win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...togglePoint });
      win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...togglePoint });
      await pause(80);
      assert.ok((await js('pointerProof.saved()')).includes('data-pointer-echo="true"'));
      await js('pointerProof.select("placeholder")');
      for (const method of ['selection', 'block', 'page']) {
        const data = await js(`pointerProof.copy(${JSON.stringify(method)})`);
        assert.ok(data['text/plain'].includes('Linked passage') && !data['text/plain'].includes('placeholder'), JSON.stringify(data));
        assert.ok(data['text/html'].includes('<strong>Linked passage</strong>'), JSON.stringify(data));
      }
      assert.equal(await js('pointerProof.text()'), 'Linked passageplaceholderUnchanged prose');
      console.log('PASS: Echo Copy toggle expands rich/plain selection, block and page copies without changing the note');
      console.log('SCREENSHOTS: ' + temp);
      win.destroy(); app.exit(0);
    } catch (error) {
      console.error(error);
      console.error('STATE:', await js('window.pointerProof?.snapshot()').catch(() => null));
      fs.writeFileSync(path.join(temp, 'failure.png'), (await win.webContents.capturePage()).toPNG());
      console.error('SCREENSHOTS: ' + temp);
      win.destroy(); app.exit(1);
    }
  });
}
