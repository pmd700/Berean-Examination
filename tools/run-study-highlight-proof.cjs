'use strict';
// Real renderer, guarded Scripture IPC, shared request queue, and encrypted vault.
// Highlight regression proof. All data is disposable; no user key/library is opened.
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
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bex-study-highlight-'));
const captures = path.join(os.tmpdir(), 'bex-study-highlight-captures');
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
  { type: 'tag', name: 'para', attrs: { style: 'p' }, items: [ { type: 'tag', name: 'verse', attrs: { number: id.split('.')[2] || '1' } }, { type: 'text', text } ] },
] .concat(id === 'JHN.2' ? [{ type: 'tag', name: 'para', attrs: { style: 'p' }, items: [
  { type: 'tag', name: 'verse', attrs: { number: '2' } }, { type: 'text', text: 'READY_SECOND_JHN_2' },
] }] : []) }, meta: { fumsToken: 'fixture-reporting-token' } }) });
global.fetch = async (url, options) => {
  if (url.endsWith('/bibles?include-full-details=true')) return { ok: true, status: 200, json: async () => ({ data: [{ id: '317e03834065a236-01', abbreviation: 'BSB', name: 'Berean Standard Bible' }, { id: 'b8ee27bcd1cae43a-01', abbreviation: 'NASB1995', name: 'New American Standard Bible 1995' }] }) };
  const id = decodeURIComponent(new URL(url).pathname.split('/').at(-1));
  const bibleId = new URL(url).pathname.split('/')[3];
  calls.push({ id, bibleId, signal: options.signal });
  if (['ROM.1', 'ROM.2', 'ROM.3'].includes(id) && !gates.has(`${id}:done`)) {
    // Deliberately ignores cancellation until resolved, to exercise late replies.
    return new Promise(resolve => gates.set(id, resolve));
  }
  return response(id, 'First word. Last word.');
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
    webPreferences: { preload: path.join(root, 'desktop/annotation-gutter-proof-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
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
    const { DatabaseSync } = require('node:sqlite');
    const seed = new DatabaseSync(path.join(library, 'Database', database.DATABASE_FILE_NAME));
    seed.prepare('INSERT OR IGNORE INTO local_owner (singleton_id, owner_id, display_name, created_at, updated_at, preferences_json) VALUES (1, ?, ?, ?, ?, ?)')
      .run('fixture-owner', 'Fixture Owner', new Date().toISOString(), new Date().toISOString(), '{"theme":"dark"}');
    seed.close();
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
    require('../desktop/local-owner-ipc.cjs').registerLocalOwnerHandlers({ ...database, appUrl, ipcMain });
    window = makeWindow();
    await open('/Study?q=John%202');
    await until('!!document.querySelector("[data-token-key]")');
    const select = async () => {
      await evaluate(`(() => {
        // Simulate an inactive reader before the active one in DOM order.
        if (!document.querySelector('#other-reader')) {
          const other = document.createElement('div'); other.id = 'other-reader'; other.dataset.scriptureRoot = 'true'; document.body.prepend(other);
        }
        const verse = document.querySelector('[data-token-key]').closest('[data-study-chapter-id]');
        const r = document.createRange(); r.selectNodeContents(verse);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
        verse.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      })()`);
      await until(`!!document.querySelector('button[aria-label="Highlight yellow"]')`);
    };
    const click = async selector => {
      const point = await evaluate(`(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
      window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
      window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    };
    await select();
    await click('button[aria-label="Highlight yellow"]');
    for (let i=0;i<100 && database.listLocalEntities('TextHighlight', {}).length !== 1;i++) await wait(30);
    const saved = database.listLocalEntities('TextHighlight', {});
    assert.equal(saved.length, 1);
    assert.equal(saved[0].color, '#fde047');
    assert.equal(saved[0].start_token_index, 0);
    assert.equal(saved[0].end_token_index, 6);
    await until('!!document.querySelector("[data-token-key]").style.backgroundColor');
    await window.webContents.reload();
    await until('!!document.querySelector("[data-token-key]")?.style.backgroundColor');
    assert.equal(database.listLocalEntities('TextHighlight', {}).length, 1);
    await select();
    await click('button[aria-label="Remove highlight"]');
    for (let i=0;i<100 && database.listLocalEntities('TextHighlight', {}).length;i++) await wait(30);
    assert.equal(database.listLocalEntities('TextHighlight', {}).length, 0);
    await until('!document.querySelector("[data-token-key]").style.backgroundColor');
    console.log('PASS: whole-verse selection with another reader mounted; native color and removal clicks; exact token range saved in encrypted vault; highlight survives refresh');
    window.destroy(); database.closeDatabase(); server.close(); fs.rmSync(temp, { recursive: true, force: true }); app.exit(0);
  } catch (error) {
    console.error(error.stack);
    if (window && !window.isDestroyed()) window.destroy();
    database.closeDatabase(); server?.close(); fs.rmSync(temp, { recursive: true, force: true }); app.exit(1);
  }
});
