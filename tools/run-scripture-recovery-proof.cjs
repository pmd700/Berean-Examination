'use strict';
// Real renderer, guarded Scripture IPC, shared request queue, and encrypted vault.
// Every network response and library is disposable; no user key/data is opened.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const database = require('../desktop/database.cjs');
const { registerLocalEntityHandlers } = require('../desktop/local-entity-ipc.cjs');
const { createSafeStorageProtector } = require('../desktop/privacy-vault.cjs');
const { ScriptureApi } = require('../desktop/scripture-api.cjs');
const { ScriptureCache } = require('../desktop/scripture-cache.cjs');
const { registerScriptureHandlers } = require('../desktop/scripture-ipc.cjs');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bex-scripture-recovery-'));
const captures = path.join(os.tmpdir(), 'bex-scripture-recovery-captures');
fs.mkdirSync(captures, { recursive: true });
const library = path.join(temp, 'Library');
for (const dir of ['Database', 'Courses', 'Media', 'Imports', 'Exports', 'Backups']) fs.mkdirSync(path.join(library, dir), { recursive: true });
app.setPath('userData', path.join(temp, 'profile'));
app.setName('BEX Launcher Official');
app.on('window-all-closed', () => {});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, window, second;
const gates = new Map();
const calls = [];
const cache = new ScriptureCache();
const settings = { getKey: () => 'disposable-fixture', getFingerprint: () => 'fixture', status: () => ({ configured: true }) };
const api = new ScriptureApi({ settings, cache });
const response = (id, text) => ({ ok: true, status: 200, json: async () => ({ data: { id: `${id}.1`, verseCount: 1, content: [
  { type: 'tag', name: 'para', attrs: { style: 'p' }, items: [ { type: 'tag', name: 'verse', attrs: { number: '1' } }, { type: 'text', text } ] },
] }, meta: { fumsToken: 'fixture-reporting-token' } }) });
global.fetch = async (url, options) => {
  if (url.endsWith('/bibles?include-full-details=true')) return { ok: true, status: 200, json: async () => ({ data: [{ id: '317e03834065a236-01', abbreviation: 'BSB', name: 'Berean Standard Bible' }] }) };
  const id = decodeURIComponent(new URL(url).pathname.split('/').at(-1));
  calls.push({ id, signal: options.signal });
  if (['ROM.1', 'ROM.2', 'ROM.3'].includes(id) && !gates.has(`${id}:done`)) {
    // Deliberately ignores cancellation until resolved, to exercise late replies.
    return new Promise(resolve => gates.set(id, resolve));
  }
  return response(id, `READY_${id.replaceAll('.', '_')}`);
};
const evaluate = async (code, target = window) => {
  try { return await target.webContents.executeJavaScript(code); }
  catch (error) { throw new Error(`${code}: ${error.message}`); }
};
async function until(code, target = window) {
  for (let i = 0; i < 150; i++) { if (await evaluate(`!!document.body && (${code})`, target)) return; await wait(60); }
  throw new Error(`Timed out: ${code}; ${await evaluate('document.body.innerText.slice(-1600)', target)}`);
}
const makeWindow = () => {
  const target = new BrowserWindow({ show: false, width: 1440, height: 900,
    webPreferences: { preload: path.join(root, 'desktop/scripture-recovery-proof-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
  target.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message); });
  return target;
};
const open = (route, target = window) => target.loadURL(`http://127.0.0.1:${server.address().port}/fixture-bootstrap?route=${encodeURIComponent(route)}`);
const submit = query => evaluate(`(() => { const input = document.querySelector('input[aria-label="Search scripture"]');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, ${JSON.stringify(query)});
  input.dispatchEvent(new Event('input', { bubbles: true })); input.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); })()`);
const finishGate = (id, result) => { gates.set(`${id}:done`, true); gates.get(id)(result); };
const chapters = () => database.listLocalEntities('StudyChapter', {});
const annotations = () => database.listLocalEntities('Annotation', {});
app.whenReady().then(async () => {
  try {
    const protector = createSafeStorageProtector(safeStorage);
    database.initializeDatabase(library, { privacyProtector: protector });
    server = http.createServer((request, reply) => {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/fixture-bootstrap') {
        const route = url.searchParams.get('route');
        const session = { tabs: [{ id: 'proof', kind: 'study', path: route, title: 'Reader' }], activeId: 'proof' };
        reply.writeHead(200, { 'Content-Type': 'text/html' });
        reply.end(`<script>localStorage.setItem('bex_workspace_tabs_v1', ${JSON.stringify(JSON.stringify(session))}); location.replace(${JSON.stringify(route)});</script>`);
        return;
      }
      let file = path.resolve(root, 'dist', '.' + url.pathname);
      if (!file.startsWith(path.join(root, 'dist') + path.sep)) { reply.writeHead(403); reply.end(); return; }
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(root, 'dist/index.html');
      reply.writeHead(200, { 'Content-Type': { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(reply);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const appUrl = `http://127.0.0.1:${server.address().port}`;
    registerScriptureHandlers({ appUrl, ipcMain, settings, api });
    registerLocalEntityHandlers({ ...database, appUrl, ipcMain });
    window = makeWindow();
    await open('/Study?q=Romans%201%2C%20John%201');
    await until('!!document.querySelector("[data-testid=reading-controls-panel]")');
    await until('document.body.textContent.includes("READY_JHN_1")');
    assert.equal(await evaluate('!!document.querySelector("[data-testid=scripture-request-0]")'), true);
    assert.match(await evaluate('document.querySelector("[data-testid=scripture-loading-status]").textContent'), /1 of 2 requests finished/);
    fs.writeFileSync(path.join(captures, 'progressive-loading.png'), (await window.webContents.capturePage()).toPNG());
    finishGate('ROM.1', { ok: false, status: 503 });
    await until(`!!document.querySelector('button[aria-label="Retry Romans 1"]:not([disabled])')`);
    await evaluate(`document.querySelector('button[aria-label="Retry Romans 1"]').click()`);
    await until('document.body.textContent.includes("READY_ROM_1")');
    assert.equal(calls.filter(call => call.id === 'JHN.1').length, 1);
    assert.ok(chapters().every(chapter => chapter.raw_text === '' && !chapter.blocks));
    console.log('PASS: controls remain visible, second passage appears before first finishes, single-unit Retry preserves success, API parents contain no fetched bodies');

    await submit('Romans 2'); await until('document.body.textContent.includes("Romans 2")');
    for (let i = 0; i < 50 && !gates.has('ROM.2'); i++) await wait(30);
    await submit('John 2'); await until('document.body.textContent.includes("READY_JHN_2")');
    assert.equal(calls.find(call => call.id === 'ROM.2').signal.aborted, true);
    finishGate('ROM.2', response('ROM.2', 'OUTDATED_TEXT'));
    await wait(250); assert.equal(await evaluate('document.body.textContent.includes("OUTDATED_TEXT")'), false);
    console.log('PASS: replacement search cancels native subscriber and ignores an intentionally late response');

    await submit('Romans 3');
    for (let i = 0; i < 50 && !gates.has('ROM.3'); i++) await wait(30);
    second = makeWindow(); await open('/Study?q=Romans%203', second);
    await until('!!document.querySelector("[data-testid=scripture-loading-status]")', second);
    await wait(200);
    await evaluate('Array.from(document.querySelectorAll("button")).find(button => button.textContent === "Cancel").click()');
    assert.equal(calls.find(call => call.id === 'ROM.3').signal.aborted, false);
    finishGate('ROM.3', response('ROM.3', 'SHARED_READER_SUCCESS'));
    await until('document.body.textContent.includes("SHARED_READER_SUCCESS")', second);
    assert.equal(await evaluate('document.body.textContent.includes("SHARED_READER_SUCCESS")'), false);
    second.destroy(); second = null;
    console.log('PASS: cancelling one real window does not abort the other window sharing its passage');

    await submit('John 2'); await until('document.body.textContent.includes("READY_JHN_2")');
    await evaluate(`(() => { const token = document.querySelector('[data-token-key]'); token.scrollIntoView({ block: 'center' });
      const range = document.createRange(); range.selectNodeContents(token); getSelection().removeAllRanges(); getSelection().addRange(range);
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); })()`);
    await until('!!document.querySelector("[data-testid=button-popover-add-annotation]")');
    await evaluate('document.querySelector("[data-testid=button-popover-add-annotation]").click()');
    await until('!!document.querySelector("[data-testid=window-annotation] .ProseMirror")');
    await evaluate(`document.querySelector('[data-testid=window-annotation] .ProseMirror').focus(); document.execCommand('insertText', false, 'PERMANENT_RECOVERY_WRITING')`);
    await submit('Romans 4'); await until('document.body.textContent.includes("READY_ROM_4")');
    await evaluate('document.querySelector("[data-testid=button-window-save]").click()');
    await until('!document.querySelector("[data-testid=window-annotation]")');
    assert.equal(annotations().length, 1); assert.equal(annotations()[0].book, 'John'); assert.equal(annotations()[0].chapter_number, 2);
    assert.match(annotations()[0].content, /PERMANENT_RECOVERY_WRITING/);
    const parent = chapters().find(chapter => chapter.book === 'John' && chapter.chapter_number === 2);
    database.updateLocalEntity('StudyChapter', parent.id, { notes: 'PRESERVED_PERSONAL_NOTE' });
    console.log('PASS: an open draft remains tied to its original passage while a new query loads');

    for (const width of [1440, 683, 480]) {
      window.setContentSize(width, 900); await wait(150);
      const geometry = await evaluate(`(() => { const el = document.querySelector('[data-testid=reading-controls-panel]'); return { right: el.getBoundingClientRect().right, width: innerWidth, scroll: document.documentElement.scrollWidth }; })()`);
      assert.ok(geometry.right <= geometry.width && geometry.scroll <= geometry.width);
      if (width === 480) fs.writeFileSync(path.join(captures, 'narrow-reader.png'), (await window.webContents.capturePage()).toPNG());
    }
    window.destroy(); database.closeDatabase(); api.reset();
    database.initializeDatabase(library, { privacyProtector: protector });
    window = makeWindow(); await open(`/Study?chapter_id=${parent.id}`);
    await until('document.body.textContent.includes("READY_JHN_2")');
    await until('!!document.querySelector("[data-token-key]")');
    assert.equal(annotations().length, 1);
    assert.equal(chapters().find(chapter => chapter.id === parent.id).notes, 'PRESERVED_PERSONAL_NOTE');
    assert.equal(await evaluate('!!document.querySelector("[data-scripture-root] .lucide-pen")'), true);
    assert.ok(chapters().every(chapter => chapter.raw_text === '' && !chapter.blocks));
    window.destroy(); database.closeDatabase();
    for (const name of fs.readdirSync(path.join(library, 'Database'))) {
      const file = path.join(library, 'Database', name);
      if (fs.statSync(file).isFile()) assert.equal(fs.readFileSync(file).includes(Buffer.from('PERMANENT_RECOVERY_WRITING')), false);
    }
    console.log('PASS: desktop/split-view controls fit; encrypted annotations, notes, and IDs survive reopening while Scripture is retrieved again');
    server.close(); fs.rmSync(temp, { recursive: true, force: true }); app.exit(0);
  } catch (error) {
    console.error(error.stack);
    if (window && !window.isDestroyed()) window.destroy(); if (second && !second.isDestroyed()) second.destroy();
    database.closeDatabase(); server?.close(); fs.rmSync(temp, { recursive: true, force: true }); app.exit(1);
  }
});
