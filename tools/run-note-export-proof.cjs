'use strict';
// Exercise renderer -> isolated preload -> native PDF -> save IPC using only
// synthetic content and a disposable destination. No personal Vault is opened.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

if (!process.versions.electron) {
  (async () => {
    const folder = fs.mkdtempSync('/private/tmp/bex-note-export-proof-');
    fs.chmodSync(folder, 0o700);
    await require('esbuild').build({ entryPoints: [path.join(root, 'tests/fixtures/noteExport.js')], outfile: path.join(folder, 'fixture.js'), bundle: true, platform: 'browser', format: 'iife', alias: { '@': path.join(root, 'src') }, logLevel: 'error' });
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const result = require('node:child_process').spawnSync(require('electron'), [__filename, folder, ...(process.argv.includes('--native-dialog') ? ['--native-dialog'] : [])], { env, stdio: 'inherit', timeout: process.argv.includes('--native-dialog') ? 300000 : 60000 });
    process.exitCode = result.status ?? 1;
  })().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  const { app, BrowserWindow, ipcMain, net } = require('electron');
  const folder = process.argv[2];
  const nativeDialog = process.argv.includes('--native-dialog');
  app.setPath('userData', path.join(folder, 'profile'));
  app.on('window-all-closed', () => {});
  app.whenReady().then(async () => {
    // Real embedded image size, above the old data-URL navigation limit.
    const image = require('electron').nativeImage.createFromBitmap(require('node:crypto').randomBytes(1024*1024*4), {width:1024,height:1024}).toPNG();
    assert(image.length>2*1024*1024);
    const media = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(image); });
    const server = http.createServer((req, res) => {
      if (req.url === '/fixture.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); res.end(fs.readFileSync(path.join(folder, 'fixture.js'))); }
      else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><html><body><script src="/fixture.js"></script></body></html>'); }
    });
    await Promise.all([new Promise(done => media.listen(0, '127.0.0.1', done)), new Promise(done => server.listen(0, '127.0.0.1', done))]);
    const appUrl = `http://127.0.0.1:${server.address().port}`;
    require('../desktop/note-pdf.cjs').registerNotePdfHandler({ ipcMain, appUrl, BrowserWindow, fetchImage: (...args) => net.fetch(...args) });
    let dialogs = 0, cancel = false, window;
    require('../desktop/export-file-ipc.cjs').registerExportFileHandlers({ appUrl, ipcMain, showSaveDialog: async (_event, options) => {
      dialogs++;
      if (nativeDialog) return require('electron').dialog.showSaveDialog(window, { ...options, title: 'BEX export verification', defaultPath: path.join(folder, path.basename(options.defaultPath)), showsTagField: false });
      return cancel ? { canceled: true } : { canceled: false, filePath: path.join(folder, path.basename(options.defaultPath)) };
    } });
    window = new BrowserWindow({ show: nativeDialog, title: 'BEX export verification', width: 760, height: 380, webPreferences: { preload: path.join(root, 'desktop/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    await window.loadURL(appUrl);
    for (const options of nativeDialog ? [{}] : [{}, { selected: true }, { markdown: true }]) {
      const result = await window.webContents.executeJavaScript(`window.runNoteExportProof(${JSON.stringify({ imageUrl: `http://127.0.0.1:${media.address().port}/image.png`, ...options })})`);
      assert.equal(result.status, 'saved'); assert.equal(result.corsBlocked, true);
      const bytes = fs.readFileSync(path.join(folder, result.fileName));
      assert(options.markdown ? bytes.toString().includes('Current selected page.') : bytes.subarray(0, 5).toString() === '%PDF-');
      console.log(JSON.stringify({ ...result, bytes: bytes.length, savedFile: path.join(folder, result.fileName) }));
    }
    assert.equal(dialogs, nativeDialog ? 1 : 3, 'one destination dialog per export');
    if (!nativeDialog) {
    cancel = true;
    assert.equal((await window.webContents.executeJavaScript('window.runNoteExportProof({imageUrl:"data:image/png;base64,eA=="})')).status, 'canceled');
    assert.equal(dialogs, 4);
    }
    window.destroy(); server.close(); media.close();
    console.log('PASS: native PDF/Markdown, selected pages, non-CORS image, single save dialog, cancellation');
    app.exit(0);
  }).catch(error => { console.error(error); app.exit(1); });
}
