'use strict';
// Native typing against the shared editor, with a disposable offline profile.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const project = path.resolve(__dirname, '..');
if (!process.versions.electron) {
  (async () => {
    const temp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bex-quote-boundary-'));
    try {
      await require('esbuild').build({ entryPoints: [path.join(project, 'tests/fixtures/quoteBoundaries.jsx')], outfile: path.join(temp, 'fixture.js'), bundle: true, platform: 'browser', format: 'iife',
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
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const load = async (html, text, offset = 0) => {
      await run(`quoteBoundaryProof.load(${JSON.stringify(html)}, ${JSON.stringify(text)}, ${offset})`);
      await pause(60);
    };
    const key = async (keyCode, modifiers = []) => {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
      await pause(80);
      return run('quoteBoundaryProof.snapshot()');
    };
    try {
      await win.loadFile(path.join(temp, 'index.html'));
      for (let i = 0; i < 120 && !await run('window.quoteBoundaryProof?.ready()'); i++) await pause(50);
      const quote = '<blockquote><p><em>Quote</em></p></blockquote>';
      await load(quote, 'Quote', 5);
      let result = await key('Enter');
      assert.equal(result.html, quote + '<p></p>'); assert.equal(result.quoted, false);
      await win.webContents.insertText('Following text');
      result = await run('quoteBoundaryProof.snapshot()');
      assert.equal(result.html, quote + '<p>Following text</p>'); assert.equal(result.quoted, false);
      console.log('PASS: native Enter exits the quote; subsequent typing stays outside its rule');

      const source = '<blockquote><p>Quote</p><p></p></blockquote><p>After</p>';
      await load(source, null);
      result = await key('Backspace');
      assert.equal(result.html, '<blockquote><p>Quote</p></blockquote><p></p><p>After</p>');
      assert.equal(result.offset, 0); assert.equal(result.quoted, false);
      await run('quoteBoundaryProof.undo()');
      assert.equal((await run('quoteBoundaryProof.snapshot()')).html, source);
      await run('quoteBoundaryProof.redo()');
      assert.equal((await run('quoteBoundaryProof.snapshot()')).html, result.html);
      console.log('PASS: native Backspace removes only quote formatting, preserving the line; Undo/Redo restores it');

      result = await key('Backspace');
      assert.equal(result.html, '<blockquote><p>Quote</p></blockquote><p>After</p>');
      assert.equal(result.offset, 5);
      result = await key('Backspace');
      assert.equal(result.html, '<blockquote><p>Quot</p></blockquote><p>After</p>');
      console.log('PASS: repeated Backspace deletes the unquoted blank line, then a character, without recreating a quoted line');

      await load(quote, 'Quote', 5);
      result = await key('Enter', ['shift']);
      assert.equal(result.html, '<blockquote><p><em>Quote</em></p><p></p></blockquote>'); assert.equal(result.quoted, true);
      result = await key('Enter'); assert.equal(result.quoted, false);
      await load(quote, 'Quote', 3);
      result = await key('Backspace'); assert.equal(result.html, '<blockquote><p><em>Qute</em></p></blockquote>');
      console.log('PASS: Shift+Enter continues the quote; normal character Backspace is unchanged');

      const dropdown = '<details open><summary>Title</summary><div data-type="detailsContent"><blockquote><p>Quote</p></blockquote></div></details>';
      await load(dropdown, 'Quote', 5);
      result = await key('Enter'); assert.equal(result.quoted, false); assert.equal(result.dropdown, true);
      result = await key('Enter'); assert.equal(result.dropdown, true);
      await load('<ul><li><p>First</p></li><li><p>Target</p></li></ul>', 'Target');
      result = await key('Backspace'); assert.equal(result.html, '<ul><li><p>First</p></li></ul><p>Target</p>');
      console.log('PASS: native dropdown containment and list-marker Backspace still work');
      win.destroy(); app.exit(0);
    } catch (error) {
      console.error(error.stack || error);
      console.error('STATE:', await run('quoteBoundaryProof.snapshot()'));
      win.destroy(); app.exit(1);
    }
  });
}
