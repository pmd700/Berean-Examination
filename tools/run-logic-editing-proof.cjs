'use strict';

// A disposable, offline Chromium proof. It never opens the real library.
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const project = path.resolve(__dirname, '..');

if (!process.versions.electron) {
  (async () => {
    const temp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bex-logic-editing-'));
    await require('esbuild').build({
      entryPoints: [path.join(project, 'tests/fixtures/logicEditing.js')],
      outfile: path.join(temp, 'fixture.js'),
      bundle: true,
      platform: 'browser',
      format: 'iife',
      alias: { '@': path.join(project, 'src') },
      loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file' },
      logLevel: 'warning',
    });
    fs.copyFileSync(path.join(project, 'tests/fixtures/logicEditing.html'), path.join(temp, 'index.html'));
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = require('node:child_process').spawnSync(require('electron'), [__filename, temp], {
      env, cwd: project, encoding: 'utf8', timeout: 45000,
    });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    if (result.signal) console.error('Electron stopped with signal:', result.signal);
    if (result.error) console.error(result.error);
    process.exitCode = result.status === 0 ? 0 : 1;
  })().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  const { app, BrowserWindow } = require('electron');
  const temp = process.argv[2];
  app.setPath('userData', path.join(temp, 'user-data'));
  app.whenReady().then(async () => {
    const win = new BrowserWindow({
      width: 1100, height: 570, show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    const wait = () => new Promise(resolve => setTimeout(resolve, 80));
    const js = source => win.webContents.executeJavaScript(source);
    const state = () => js('logicProof.state()');
    const mouse = (type, x, y) => win.webContents.sendInputEvent({
      type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1,
    });
    const key = async (keyCode, modifiers = []) => {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
      await wait();
    };
    try {
      await win.loadFile(path.join(temp, 'index.html'));
      await js('document.fonts.ready');
      win.webContents.focus();
      const glyph = await js('logicProof.rect(1)');
      const y = glyph.y + glyph.height / 2;
      mouse('mouseDown', glyph.x + 1, y);
      mouse('mouseUp', glyph.x + 1, y);
      await wait();
      assert.equal((await state()).sourceMode, false);
      assert.equal((await state()).formula, 'B→¬H');
      console.log('PASS: real mouse click keeps the formula rendered');
      mouse('mouseDown', glyph.x + 1, y);
      mouse('mouseMove', glyph.x + glyph.width - 1, y);
      mouse('mouseUp', glyph.x + glyph.width - 1, y);
      await wait();
      assert.equal((await state()).selected, '→');
      console.log('PASS: native mouse drag selects only the arrow');
      await js('logicProof.editor.commands.setHighlight("rgba(139,92,246,0.4)")');
      assert.equal(await js('document.querySelector("mark").textContent'), '→');
      fs.writeFileSync(path.join(temp, 'selected-symbol.png'), (await win.webContents.capturePage()).toPNG());
      await key('Backspace');
      assert.equal((await state()).formula, 'B¬H');
      console.log('PASS: native Backspace deletes just the selected arrow');
      await key('Z', ['meta']);
      assert.equal((await state()).formula, 'B→¬H');
      console.log('PASS: native Cmd+Z restores the deleted symbol');
      // Collapse the selection and click after the final glyph. Backspace
      // must remove H, not select/delete the surrounding inline formula.
      await js('logicProof.editor.commands.unsetHighlight()');
      await js('logicProof.editor.commands.setTextSelection(1)');
      const last = await js('logicProof.rect(3)');
      mouse('mouseDown', last.x + last.width - 1, last.y + last.height / 2);
      mouse('mouseUp', last.x + last.width - 1, last.y + last.height / 2);
      await wait();
      await key('Backspace');
      assert.equal((await state()).formula, 'B→¬');
      console.log('PASS: Backspace at a collapsed caret deletes the final letter only');
      win.webContents.sendInputEvent({ type: 'char', keyCode: 'Q' });
      await wait();
      assert.equal((await state()).formula, 'B→¬Q');
      console.log('PASS: replacement typing stays inside the formatted expression');
      assert.match((await state()).mathFont, /BEX_EditableMath/);
      console.log('PASS: the shared-editor font rule does not override the math face');
      console.log('SCREENSHOT: ' + path.join(temp, 'selected-symbol.png'));
      win.destroy();
      app.exit(0);
    } catch (error) {
      console.error(error);
      win.destroy();
      app.exit(1);
    }
  });
}
