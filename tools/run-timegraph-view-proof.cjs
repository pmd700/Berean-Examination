'use strict';
// Real timeline gestures and encrypted storage, using only a disposable library.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const database = require('../desktop/database.cjs');
const { createSafeStorageProtector } = require('../desktop/privacy-vault.cjs');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bex-timeline-view-'));
const library = path.join(temp, 'Library');
for (const dir of ['Database', 'Media', 'Courses', 'Imports', 'Exports', 'Backups']) fs.mkdirSync(path.join(library, dir), { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); app.on('window-all-closed', () => {});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let win, server;
const run = code => win.webContents.executeJavaScript(code);
const until = async code => { for (let i = 0; i < 160; i++) { if (await run(code)) return; await wait(50); } throw new Error(`Timed out: ${code}; ${await run('document.body.innerText.slice(-1000)')}`); };
app.whenReady().then(async () => {
  try {
    const protector = createSafeStorageProtector(safeStorage);
    database.initializeDatabase(library, { privacyProtector: protector });
    const { DatabaseSync } = require('node:sqlite');
    const seed = new DatabaseSync(path.join(library, 'Database', database.DATABASE_FILE_NAME));
    seed.prepare('INSERT OR IGNORE INTO local_owner (singleton_id, owner_id, display_name, created_at, updated_at, preferences_json) VALUES (1, ?, ?, ?, ?, ?)').run('view-fixture', 'Fixture Owner', new Date().toISOString(), new Date().toISOString(), '{"theme":"dark"}'); seed.close();
    const event = (id, tag) => ({ id: String(id), title: `Dense event ${id}`, start: { year: 2026, month: 10, day: 1, precision: 'exact' }, position: id % 2 ? 'above' : 'below', color: 'violet', align: 'center', marker: 'dot', scale: 1, description: '', end: null, media: [], links: [], tags: [tag] });
    const graph = database.createLocalEntity('Timegraph', { title: 'View fixture', events: Array.from({ length: 48 }, (_, i) => event(i + 1, i === 0 ? 'Hidden' : 'Shown')), view: { centerYear: 2026.75, yearsPerPixel: 0.0003 } });
    const second = database.createLocalEntity('Timegraph', { title: 'Other view', events: [event(100, 'Shown')], view: { centerYear: 1700, yearsPerPixel: 0.01, scrollTop: 0 } });
    server = http.createServer((request, reply) => {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/fixture-bootstrap') {
        const route = url.searchParams.get('route'), tab = { id: 'view-proof', kind: 'timeline', path: route, title: 'View fixture' };
        reply.writeHead(200, { 'Content-Type': 'text/html' }); reply.end(`<script>localStorage.setItem('bex_workspace_tabs_v1',${JSON.stringify(JSON.stringify({ tabs: [tab], activeId: tab.id }))});location.replace(${JSON.stringify(route)})</script>`); return;
      }
      let file = path.resolve(root, 'dist', '.' + url.pathname);
      if (!file.startsWith(path.join(root, 'dist') + path.sep)) { reply.writeHead(403); reply.end(); return; }
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(root, 'dist/index.html');
      reply.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(reply);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const appUrl = `http://127.0.0.1:${server.address().port}`;
    require('../desktop/local-entity-ipc.cjs').registerLocalEntityHandlers({ ...database, appUrl, ipcMain });
    require('../desktop/local-owner-ipc.cjs').registerLocalOwnerHandlers({ ...database, appUrl, ipcMain });
    const makeWindow = () => new BrowserWindow({ show: false, width: 1440, height: 950, webPreferences: { preload: path.join(root, 'desktop/annotation-gutter-proof-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const open = async id => { await win.loadURL(`${appUrl}/fixture-bootstrap?route=${encodeURIComponent(`/timegraphs/${id}`)}`); await until('document.querySelector("[data-testid=timegraph-editor]")?.dataset.viewRestored === "true"'); await wait(800); };
    const snapshot = () => run(`(() => {const host=document.querySelector('[data-testid="timegraph-scroll"]'),svg=host.querySelector('svg.bex-timegraph__svg')||host.querySelector('svg');return {scrollTop:host.scrollTop,viewBox:svg.getAttribute('viewBox'),ticks:[...host.querySelectorAll('.bex-timegraph__tick-label')].map(el=>[el.textContent,el.getAttribute('x')]),hidden:document.querySelector('[aria-label="Show events tagged Hidden"]')?.checked===false};})()`);
    const saved = () => database.getLocalEntity('Timegraph', graph.id).view;
    win = makeWindow(); await open(graph.id);
    await run(`document.querySelector('[aria-label="Hide events tagged Hidden"]').click()`);
    await run(`(() => {const host=document.querySelector('[data-testid="timegraph-canvas"]'),box=host.getBoundingClientRect();host.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,shiftKey:true,deltaY:70,clientX:box.left+400,clientY:400}));})()`);
    await wait(50);
    await run(`(() => {const host=document.querySelector('[data-testid="timegraph-canvas"]'),box=host.getBoundingClientRect();host.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:-40,clientX:box.left+500,clientY:400}));})()`);
    await wait(750); // Let the existing axis crossfade settle before comparing SVG labels.
    await run(`(() => {const host=document.querySelector('[data-testid="timegraph-scroll"]');if(host.scrollHeight-host.clientHeight<300)throw new Error('Fixture needs vertical overflow');host.scrollTop=249;host.dispatchEvent(new Event('scroll',{bubbles:true}));})()`);
    // Refresh immediately, before the 700ms autosave can fire.
    const before = await snapshot();
    await run(`document.querySelector('[data-testid="workspace-refresh"]').click()`);
    await until('!!document.querySelector("[data-testid=workspace-refresh][disabled]")');
    await until('document.querySelector("[data-testid=timegraph-editor]")?.dataset.viewRestored === "true" && !document.querySelector("[data-testid=workspace-refresh][disabled]")');
    await wait(800);
    assert.deepEqual(await snapshot(), before);
    assert.equal(saved().scrollTop, 249); assert.deepEqual(saved().filters.hiddenTags, ['Hidden']);
    let exactView = saved();
    console.log('PASS: immediate Refresh flushes pan/zoom/vertical position/tag visibility and restores the exact SVG viewport');
    await run(`(() => {const host=document.querySelector('[data-testid="timegraph-scroll"]');host.scrollTop=279;host.dispatchEvent(new Event('scroll',{bubbles:true}));})()`);
    before.scrollTop=279;
    win.webContents.reload();
    await until('document.querySelector("[data-testid=timegraph-editor]")?.dataset.viewRestored === "true"');
    await wait(800);
    assert.deepEqual(await snapshot(),before);exactView=saved();assert.equal(exactView.scrollTop,279);
    console.log('PASS: a direct renderer reload also preserves the final scroll position');
    await open(second.id); await open(graph.id);
    assert.deepEqual(await snapshot(), before); assert.deepEqual(saved(), exactView);
    console.log('PASS: each timeline keeps its own view when switching timelines');
    // Quit immediately after a final scroll, while its autosave is still pending.
    await run(`(() => {const host=document.querySelector('[data-testid="timegraph-scroll"]');host.scrollTop=309;host.dispatchEvent(new Event('scroll',{bubbles:true}));})()`);
    const closingView = await snapshot();
    let quitFinished = false;
    const close = require('../desktop/normal-close-backup.cjs').createNormalCloseHandler({
      app: { quit: () => { quitFinished = true; } },
      prepareForShutdown: () => run('window.__bexFlushPendingEditorSaves()'),
      onShutdownStarted: () => { assert.equal(saved().scrollTop, 309); exactView = saved(); },
      closeDatabase: database.closeDatabase, closeServices: () => {},
    });
    await close({preventDefault(){}});assert.equal(quitFinished,true);
    win.destroy(); database.initializeDatabase(library, { privacyProtector: protector });
    win = makeWindow(); await open(graph.id);
    assert.deepEqual(await snapshot(), closingView); assert.deepEqual(saved(), exactView);
    console.log('PASS: graceful quit flushes the final position; reopening SQLite and the renderer restores the exact position without a manual Save');
    await assert.rejects(async () => database.updateLocalEntity('Timegraph', graph.id, { view: { ...exactView, scrollTop: -1 } }));
    await assert.rejects(async () => database.updateLocalEntity('Timegraph', graph.id, { view: { ...exactView, filters: { hiddenTags: ['x'.repeat(301)] } } }));
    console.log('PASS: backend validates persisted view fields');
    win.destroy(); database.closeDatabase(); await new Promise(resolve => server.close(resolve)); fs.rmSync(temp, { recursive: true, force: true }); app.exit(0);
  } catch (error) { console.error(error.stack || error); win?.destroy(); database.closeDatabase(); server?.close(); fs.rmSync(temp, { recursive: true, force: true }); app.exit(1); }
});
