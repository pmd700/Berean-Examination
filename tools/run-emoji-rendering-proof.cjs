'use strict';
// Pixel-level regression: DOM text alone also passed when native emoji were blank.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const project = path.resolve(__dirname, '..');
if (!process.versions.electron) {
  (async () => {
    const temp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bex-emoji-'));
    try {
      await require('esbuild').build({ entryPoints: [path.join(project, 'tests/fixtures/emojiRendering.jsx')], outfile: path.join(temp, 'fixture.js'), bundle: true, platform: 'browser', format: 'iife',
        alias: { '@/api/desktopClient': path.join(project, 'tests/fixtures/spotlightDesktopStub.js'), '@': path.join(project, 'src'), '@shared': path.join(project, 'shared') },
        loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file' }, logLevel: 'warning', define: { 'process.env.NODE_ENV': '"production"' } });
      fs.writeFileSync(path.join(temp, 'index.html'), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><style>body{background:white!important;color:black!important;font-family:var(--bex-app-font-family)}#samples{width:800px}.sample{display:inline-block;width:64px;height:64px;line-height:64px;font-size:36px}.ProseMirror{color:black!important;font-size:36px!important}</style><div id="samples"></div><canvas width="64" height="64"></canvas><svg width="64" height="64"><text x="8" y="45" font-size="36">❌</text></svg><div id="editor"></div><script src="fixture.js"></script>');
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
      const result = require('node:child_process').spawnSync(require('electron'), [__filename, temp, ...process.argv.slice(2)], { env, cwd: project, encoding: 'utf8', timeout: 60000 });
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
    const win = new BrowserWindow({ width: 1000, height: 900, show: false, webPreferences: { sandbox: true, contextIsolation: true } });
    const run = code => win.webContents.executeJavaScript(code);
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    try {
      await win.loadFile(path.join(temp, 'index.html'), process.argv.includes('--windows-fallback') ? { query: { platform: 'Win32' } } : {});
      for (let i = 0; i < 120 && !await run('window.emojiProof?.ready()'); i++) await pause(50);
      const text = await run('emojiProof.prepare()');
      await pause(200);
      assert.equal(await run('emojiProof.copy()'), text, 'Copy must retain original emoji Unicode sequences');
      await run('window.getSelection().removeAllRanges()');
      const rectangles = await run(`Array.from(document.querySelectorAll('.sample,canvas,svg')).map(el=>{const r=el.getBoundingClientRect();return {label:el.textContent||el.tagName,x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}})`);
      for (const { label, ...rect } of rectangles) {
        const bitmap = (await win.webContents.capturePage(rect)).toBitmap();
        let pixels = 0;
        for (let i = 0; i < bitmap.length; i += 4) if (bitmap[i] < 245 || bitmap[i + 1] < 245 || bitmap[i + 2] < 245) pixels++;
        assert.ok(pixels > 100, `${label} painted only ${pixels} pixels`);
      }
      // A fallback must not replace ordinary numbers/letters with emoji glyphs.
      win.webContents.debugger.attach('1.3');
      await win.webContents.debugger.sendCommand('DOM.enable');
      await win.webContents.debugger.sendCommand('CSS.enable');
      const { root } = await win.webContents.debugger.sendCommand('DOM.getDocument');
      for (const index of [8, 9, 10, 11]) {
        const { nodeId } = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: `.sample:nth-child(${index + 1})` });
        const { fonts } = await win.webContents.debugger.sendCommand('CSS.getPlatformFontsForNode', { nodeId });
        assert.ok(fonts.length && fonts.every(font => !font.isCustomFont), `Ordinary text unexpectedly used emoji font: ${JSON.stringify(fonts)}`);
      }
      console.log('PASS: visible normal/bold/italic emoji, skin tones, ZWJ, flags, keycaps, SVG and canvas; original Unicode copied from shared editor; Latin/digits/Hebrew/Greek retain text fonts');
      win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
  }).catch(error => { console.error(error); app.exit(1); });
}
