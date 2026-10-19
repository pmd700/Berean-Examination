'use strict';
// Real Study renderer + native encrypted entity store; only API text is a fixture.
// This proof never opens the user's Berean Library or API credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const database = require('../desktop/database.cjs');
const { registerLocalEntityHandlers } = require('../desktop/local-entity-ipc.cjs');
const { createSafeStorageProtector } = require('../desktop/privacy-vault.cjs');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bex-api-study-proof-'));
const library = path.join(temp, 'Library');
for (const dir of ['Database', 'Courses', 'Media', 'Imports', 'Exports', 'Backups']) fs.mkdirSync(path.join(library, dir), { recursive: true });
app.setPath('userData', path.join(temp, 'profile'));
app.setName('BEX Launcher Official');
app.on('window-all-closed', () => {});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, window, failCreate = false, failCount = false, slowCreate = false;
const evaluate = code => window.webContents.executeJavaScript(code);
async function until(code) {
  for (let i = 0; i < 120; i++) { if (await evaluate(code)) return; await wait(100); }
  throw new Error(`Timed out: ${code}; ${await evaluate('document.body.innerText.slice(-2500)')}`);
}
async function open() {
  await window.loadURL(`http://127.0.0.1:${server.address().port}/Study?q=Romans%201`);
  await until('!!document.querySelector("[data-token-key]")');
}
async function annotate(text) {
  await evaluate(`(() => {
    const token = document.querySelector('[data-token-key]'); token.scrollIntoView({block: 'center'});
    const range = document.createRange(); range.selectNodeContents(token);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  })()`);
  await until('!!document.querySelector("[data-testid=button-popover-add-annotation]")');
  await evaluate('document.querySelector("[data-testid=button-popover-add-annotation]").click()');
  await until('!!document.querySelector("[data-testid=window-annotation] .ProseMirror")');
  await evaluate(`document.querySelector('[data-testid=window-annotation] .ProseMirror').focus(); document.execCommand('insertText', false, ${JSON.stringify(text)})`);
  await wait(100);
}
const save = () => evaluate('document.querySelector("[data-testid=button-window-save]").click()');
const closed = () => until('!document.querySelector("[data-testid=window-annotation]")');
const annotations = () => database.listLocalEntities('Annotation', {});

app.whenReady().then(async () => {
  try {
    const protector = createSafeStorageProtector(safeStorage);
    database.initializeDatabase(library, { privacyProtector: protector });
    server = http.createServer((req, res) => {
      let file = path.resolve(root, 'dist', '.' + new URL(req.url, 'http://localhost').pathname);
      if (!file.startsWith(path.join(root, 'dist') + path.sep)) { res.writeHead(403); res.end(); return; }
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(root, 'dist/index.html');
      res.writeHead(200, { 'Content-Type': ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    registerLocalEntityHandlers({ ...database, ipcMain, appUrl: `http://127.0.0.1:${server.address().port}`,
      createLocalEntity: async (type, data) => {
        if (type === 'Annotation' && failCreate) { failCreate = false; throw new Error('Injected write failure'); }
        if (type === 'Annotation' && slowCreate) { slowCreate = false; await wait(700); }
        return database.createLocalEntity(type, data);
      },
      updateLocalEntity: async (type, id, patch) => {
        if (type === 'StudyChapter' && failCount) { failCount = false; throw new Error('Injected count failure'); }
        return database.updateLocalEntity(type, id, patch);
      },
    });
    window = new BrowserWindow({ show: false, width: 1440, height: 900, webPreferences: { preload: path.join(root, 'desktop/api-study-proof-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
    await open();
    const chapters = database.listLocalEntities('StudyChapter', {});
    assert.equal(chapters.length, 1); assert.equal(chapters[0].api_bible_id, '317e03834065a236-01');
    await annotate('API-ANNOTATION-PERSISTENCE-PROOF');
    const padding = await evaluate('getComputedStyle(document.querySelector("[data-testid=window-annotation] .ProseMirror")).paddingLeft');
    assert.equal(padding, '12px');
    await save(); await closed();
    assert.equal(annotations().length, 1);
    assert.match(annotations()[0].content, /API-ANNOTATION-PERSISTENCE-PROOF/);
    assert.equal(database.listLocalEntities('StudyChapter', {})[0].annotation_count, 1);
    console.log('PASS: API chapter has a real encrypted parent; manual Save persists writing and count; caret inset is 12px');

    await annotate('Retry keeps this draft'); failCreate = true;
    await evaluate('document.querySelector("[data-testid=button-window-close]").click()');
    await until('Array.from(document.querySelectorAll("button")).some(button => button.textContent === "Save & Leave")');
    await evaluate('Array.from(document.querySelectorAll("button")).find(button => button.textContent === "Save & Leave").click()');
    await wait(400);
    assert.match(await evaluate('document.querySelector("[data-testid=window-annotation] .ProseMirror").textContent'), /Retry keeps/);
    assert.equal(annotations().length, 1);
    await evaluate('Array.from(document.querySelectorAll("button")).find(button => button.textContent === "Stay").click()');
    await save(); await closed(); assert.equal(annotations().length, 2);
    console.log('PASS: failed native write retains the draft; retry saves once');

    await annotate('Created before count failed'); failCount = true;
    await save(); await wait(400); assert.equal(annotations().length, 3);
    await save(); await closed(); assert.equal(annotations().length, 3);
    console.log('PASS: retry after a successful create and failed count does not duplicate annotations');

    await annotate('Autosave first revision'); slowCreate = true;
    await until('document.querySelector("[data-testid=window-annotation]").textContent.includes("Saving")');
    await evaluate("document.querySelector('[data-testid=window-annotation] .ProseMirror').focus(); document.execCommand('insertText', false, ' and latest revision')");
    await save(); await closed(); assert.equal(annotations().length, 4);
    assert.ok(annotations().some(record => record.content.includes('Autosave first revision and latest revision')));
    console.log('PASS: new annotations autosave; manual Save during autosave drains latest text without duplicate creates');

    window.destroy(); database.closeDatabase();
    for (const name of fs.readdirSync(path.join(library, 'Database'))) {
      const file = path.join(library, 'Database', name);
      if (fs.statSync(file).isFile()) assert.equal(fs.readFileSync(file).includes(Buffer.from('API-ANNOTATION-PERSISTENCE-PROOF')), false);
    }
    database.initializeDatabase(library, { privacyProtector: protector });
    window = new BrowserWindow({ show: false, width: 1440, height: 900, webPreferences: { preload: path.join(root, 'desktop/api-study-proof-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
    await open();
    await until('document.body.textContent.includes("Annotations (4)")');
    assert.equal(database.listLocalEntities('StudyChapter', {}).length, 1);
    assert.equal(annotations().length, 4);
    await evaluate('Array.from(document.querySelectorAll("button")).find(button => button.textContent.includes("Annotations (4)")).click()');
    await until('!!document.querySelector("[role=dialog] .lucide-pen") || !!document.querySelector("[role=dialog] .lucide-square-pen")');
    await evaluate('document.querySelector("[role=dialog] .lucide-pen, [role=dialog] .lucide-square-pen").closest("button").click()');
    await until('!!document.querySelector("[data-testid=window-annotation] .ProseMirror")');
    await evaluate("document.querySelector('[data-testid=window-annotation] .ProseMirror').focus(); document.execCommand('selectAll'); document.execCommand('insertText', false, 'Edited after reopening')");
    await wait(100); await save(); await closed();
    assert.equal(annotations().length, 4);
    assert.ok(annotations().some(record => record.content.includes('Edited after reopening')));
    console.log('PASS: closing/reopening the encrypted database and renderer preserves API annotations and reuses the same chapter');
    console.log('PASS: editing a reopened annotation updates its original record');
    console.log('PASS: private annotation plaintext is absent from database files');
    window.destroy(); database.closeDatabase(); server.close(); fs.rmSync(temp, { recursive: true, force: true }); app.exit(0);
  } catch (error) {
    console.error(error.stack); if (window && !window.isDestroyed()) window.destroy(); database.closeDatabase(); if (server) server.close(); fs.rmSync(temp, { recursive: true, force: true }); app.exit(1);
  }
});
