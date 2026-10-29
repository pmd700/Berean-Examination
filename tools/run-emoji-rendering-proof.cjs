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
      await require('esbuild').build({ entryPoints: [path.join(project, 'tests/fixtures/emojiRendering.jsx')], outfile: path.join(temp, 'fixture.js'), bundle: true, platform: 'browser', format: 'esm',
        alias: { '@/api/desktopClient': path.join(project, 'tests/fixtures/spotlightDesktopStub.js'), '@': path.join(project, 'src'), '@shared': path.join(project, 'shared') },
        loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file' }, logLevel: 'warning', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'true' } });
      fs.writeFileSync(path.join(temp, 'index.html'), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><style>body{background:white!important;color:black!important;font-family:var(--bex-app-font-family)}#samples{width:1408px}.sample{display:inline-block;width:64px;height:64px;line-height:64px;font-size:36px}.ProseMirror{color:black!important;font-size:36px!important}</style><div id="samples"></div><canvas width="64" height="64"></canvas><svg width="64" height="64"><text x="8" y="45" font-size="36">❌</text></svg><div id="editor"></div><script type="module" src="fixture.js"></script>');
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
      const result = require('node:child_process').spawnSync(require('electron'), [__filename, temp, ...process.argv.slice(2)], { env, cwd: project, encoding: 'utf8', timeout: 60000 });
      process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
      if (result.error) console.error(result.error);
      process.exitCode = result.status === 0 ? 0 : 1;
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  const { app, BrowserWindow, ipcMain } = require('electron');
  const { registerEmojiHandlers } = require('../desktop/emoji.cjs');
  const temp = process.argv[2];
  app.setPath('userData', path.join(temp, 'profile'));
  app.whenReady().then(async () => {
    const legacy = process.argv.includes('--legacy-preload');
    let server, appUrl = `file://${path.join(temp, 'index.html')}`;
    let preload = path.join(project, 'desktop/preload.cjs');
    if (legacy) {
      // Simulate the still-running pre-update main process, while serving the
      // new renderer and prepared font exactly as the Vite development server.
      preload = path.join(temp, 'old-preload.cjs');
      fs.writeFileSync(preload, 'require("electron").contextBridge.exposeInMainWorld("bexDesktop", {isDesktop:true});');
      const { prepareNativeEmojiCache } = require('./prepare-native-emoji-cache.cjs');
      const font = fs.readFileSync(await prepareNativeEmojiCache(path.join(temp, 'native-emoji-cache')));
      server = require('node:http').createServer((request, response) => {
        const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
        if (pathname === '/node_modules/.cache/bex-native-emoji/compatible.ttf') {
          response.writeHead(200, { 'Content-Type': 'font/ttf' }); response.end(font); return;
        }
        const file = path.resolve(temp, `.${pathname}`);
        if (!file.startsWith(temp + path.sep) || !fs.existsSync(file)) { response.writeHead(404); response.end(); return; }
        response.writeHead(200, { 'Content-Type': { '.js': 'application/javascript', '.html': 'text/html', '.css': 'text/css', '.ttf': 'font/ttf' }[path.extname(file)] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(response);
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      appUrl = `http://127.0.0.1:${server.address().port}/index.html`;
    } else registerEmojiHandlers({ appUrl, ipcMain, cacheFolder: path.join(temp, 'native-emoji-cache') });
    const win = new BrowserWindow({ width: 1500, height: 1100, show: false, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, preload } });
    const run = code => win.webContents.executeJavaScript(code);
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    try {
      await win.loadURL(appUrl + (process.argv.includes('--windows-fallback') ? '?platform=Win32' : ''));
      for (let i = 0; i < 400 && !await run('window.emojiProof?.ready()'); i++) await pause(50);
      assert.ok(await run('window.emojiProof?.ready()'), 'Emoji fixture failed to start.');
      const text = await run('emojiProof.prepare()');
      await pause(200);
      assert.equal(await run('emojiProof.copy()'), text, 'Copy must retain original emoji Unicode sequences');
      await run('window.getSelection().removeAllRanges()');
      const rectangles = await run(`Array.from(document.querySelectorAll('.sample,canvas,svg')).map(el=>{const r=el.getBoundingClientRect();return {label:el.textContent||el.tagName,x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}}).concat(emojiProof.glyphRectangles())`);
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
      const { nodeId } = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: '#samples .sample:nth-child(6)' });
      const { fonts } = await win.webContents.debugger.sendCommand('CSS.getPlatformFontsForNode', { nodeId });
      if (process.platform === 'darwin' && !process.argv.includes('--windows-fallback')) {
        assert.equal(fonts.reduce((count, font) => count + font.glyphCount, 0), 1, 'Skin-tone ZWJ sequence must remain one combined emoji.');
        assert.ok(fonts.every(font => /Apple/.test(font.familyName)), `Mac emoji must use Apple's artwork: ${JSON.stringify(fonts)}`);
        const count = await run('emojiProof.samples.length');
        for (let index = 0; index < count; index += 1) {
          if ([8, 9, 10, 11].includes(index)) continue;
          const { nodeId: sampleId } = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: `#samples .sample:nth-child(${index + 1})` });
          const { fonts: sampleFonts } = await win.webContents.debugger.sendCommand('CSS.getPlatformFontsForNode', { nodeId: sampleId });
          assert.ok(sampleFonts.length && sampleFonts.every(font => /Apple/.test(font.familyName)), `Emoji ${index} fell back to a non-Apple style: ${JSON.stringify(sampleFonts)}`);
        }
        const alignment = await run('emojiProof.alignmentChecks()');
        for (const check of alignment) {
          assert.ok(check.face.bottom >= check.face.top, `Missing ${check.emoji} at ${check.size}px.`);
          assert.ok(Math.abs(check.offset) <= 1 + check.size * 0.07,
            `${check.emoji} is not centered at ${check.size}px/${check.weight}: offset ${check.offset}px`);
        }
        console.log(`PASS: ${alignment.length} emoji/text baseline comparisons from 12px to 144px in normal and bold text`);
      }
      assert.equal(await run('window.bexDesktop.isDesktop'), true, 'Use the production isolated preload.');
      console.log(`PASS: ${rectangles.length} visible text/heading/SVG/canvas samples; Apple artwork on every Mac sample; intact skin tones, ZWJ, flags, keycaps and mixed-tone pairs; original Unicode copied; text fonts unchanged; sandbox/context isolation enabled${legacy ? '; old desktop preload supported without restart' : ''}`);
      win.destroy(); server?.close(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); server?.close(); app.exit(1); }
  }).catch(error => { console.error(error); app.exit(1); });
}
