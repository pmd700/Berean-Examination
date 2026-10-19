'use strict';
// Real renderer and encrypted owner settings; all Scripture and library data are synthetic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const database = require('../desktop/database.cjs');
const { createSafeStorageProtector } = require('../desktop/privacy-vault.cjs');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bex-reader-preferences-'));
const library = path.join(temp, 'Library');
for (const folder of ['Database', 'Courses', 'Media', 'Imports', 'Exports', 'Backups']) fs.mkdirSync(path.join(library, folder), { recursive: true });
app.setPath('userData', path.join(temp, 'profile'));
app.on('window-all-closed', () => {});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const favoriteId = 'b8ee27bcd1cae43a-01';
const calls = [];
let server, window;
const run = async code => {
  try { return await window.webContents.executeJavaScript(code); }
  catch (error) { throw new Error(`${error.message}; while evaluating: ${code}`, { cause: error }); }
};
async function until(code) {
  for (let i = 0; i < 160; i++) { if (await run(code)) return; await wait(50); }
  throw new Error(`Timed out: ${code}; ${await run('document.body.innerText.slice(-2000)')}`);
}
async function openServer(home = false) {
  server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/fixture-bootstrap') {
      const tab = { id: 'reader-proof', kind: home ? 'home' : 'study', title: 'Reader proof', path: home ? '/LibraryHome' : '/Study?q=Romans%201' };
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(`<script>localStorage.setItem('bex_workspace_tabs_v1', ${JSON.stringify(JSON.stringify({ tabs: [tab], activeId: tab.id }))}); location.replace(${JSON.stringify(tab.path)});</script>`);
      return;
    }
    let file = path.resolve(root, 'dist', '.' + url.pathname);
    if (!file.startsWith(path.join(root, 'dist') + path.sep)) { response.writeHead(403); response.end(); return; }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(root, 'dist/index.html');
    response.writeHead(200, { 'Content-Type': { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2' }[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const appUrl = `http://127.0.0.1:${server.address().port}`;
  require('../desktop/local-entity-ipc.cjs').registerLocalEntityHandlers({ ...database, appUrl, ipcMain });
  require('../desktop/local-owner-ipc.cjs').registerLocalOwnerHandlers({ ...database, appUrl, ipcMain });
  ipcMain.removeHandler('scripture:fetch-content');
  ipcMain.handle('scripture:fetch-content', (_event, options) => {
    calls.push(options);
    return { ok: true, result: { data: { content: [{ type: 'tag', name: 'para', attrs: { style: 'p' }, items: [{ type: 'tag', name: 'verse', attrs: { number: '1' } }, { type: 'text', text: 'Synthetic Scripture reading preserves the source edition.' }] }] } } };
  });
  window = new BrowserWindow({ width: 1440, height: 950, useContentSize: true, show: false, webPreferences: { preload: path.join(root, 'desktop/annotation-gutter-proof-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  await window.loadURL(appUrl + '/fixture-bootstrap');
  return appUrl;
}
app.whenReady().then(async () => {
  try {
    database.initializeDatabase(library, { privacyProtector: createSafeStorageProtector(safeStorage) });
    const { DatabaseSync } = require('node:sqlite');
    const seed = new DatabaseSync(path.join(library, 'Database', database.DATABASE_FILE_NAME));
    seed.prepare('INSERT OR IGNORE INTO local_owner (singleton_id, owner_id, display_name, created_at, updated_at, preferences_json) VALUES (1, ?, ?, ?, ?, ?)').run('reader-proof-owner', 'Reader Proof', new Date().toISOString(), new Date().toISOString(), '{"theme":"dark"}');
    seed.close();
    database.createLocalEntity('StudyChapter', { book: 'Romans', chapter_number: 1, version: 'API:317e03834065a236-01',
      display_version: 'BSB', api_bible_id: '317e03834065a236-01', scripture_source: 'api', raw_text: '',
      title: 'Romans 1', annotation_count: 1, notes: '', context: '', application: '' });
    database.createLocalEntity('Annotation', { book: 'Romans', chapter_number: 1, version: 'API:317e03834065a236-01',
      start_verse: 1, end_verse: 1, start_token_index: 0, end_token_index: 0,
      selected_text: 'Synthetic', content: '<p>Canvas note remains accessible.</p>' });
    const firstOrigin = await openServer();
    await until('!!document.querySelector("[data-token-key]")');
    await until('!!document.querySelector(".bex-gutter-card")');
    const canvasLayout = await run(`(() => { const pane=document.querySelector('.bex-tab-pane').getBoundingClientRect(), view=document.querySelector('.bex-scripture-viewport').getBoundingClientRect(), footer=document.querySelector('.bex-study-footer').getBoundingClientRect(); return { paneBottom:pane.bottom, viewTop:view.top, viewBottom:view.bottom, footerTop:footer.top, footerBottom:footer.bottom, footerHeight:footer.height }; })()`);
    assert.ok(canvasLayout.viewBottom >= canvasLayout.paneBottom - 60, JSON.stringify(canvasLayout));
    assert.ok(canvasLayout.footerHeight < 60 && canvasLayout.footerBottom <= canvasLayout.paneBottom + 1, JSON.stringify(canvasLayout));
    assert.ok(Math.abs(canvasLayout.viewBottom - canvasLayout.footerTop) < 2, JSON.stringify(canvasLayout));
    await run(`(() => { const view=document.querySelector('.bex-scripture-viewport'); view.dispatchEvent(new WheelEvent('wheel', { bubbles:true, cancelable:true, ctrlKey:true, deltaY:50, clientX:400, clientY:300 })); })()`);
    for (const selector of ['[data-token-key]', '.bex-gutter-card-content p']) {
      const hit = await run(`(() => { const view=document.querySelector('.bex-scripture-viewport'), target=document.querySelector(${JSON.stringify(selector)}), box=view.getBoundingClientRect(), before=target.getBoundingClientRect();
        view.dispatchEvent(new WheelEvent('wheel', { bubbles:true, cancelable:true, deltaX:(before.left+before.right)/2-(box.left+box.right)/2, deltaY:before.bottom-box.bottom+40 }));
        const rect=target.getBoundingClientRect(), x=(rect.left+rect.right)/2, y=(rect.top+rect.bottom)/2, under=document.elementFromPoint(x,y);
        return {visible:!!under&&(target===under||target.contains(under)), y, bottom:box.bottom, height:box.height, top:box.top, zoom:Number(view.dataset.zoom)}; })()`);
      assert.ok(hit.visible && hit.y > hit.top + hit.height * .75 && hit.zoom < 1, JSON.stringify(hit));
    }
    await wait(150); // Let Chromium composite the last camera transform before capture.
    fs.writeFileSync(path.join(os.tmpdir(), 'bex-scripture-canvas-visible.png'), (await window.webContents.capturePage()).toPNG());
    await run(`document.querySelector('.bex-scripture-viewport').dispatchEvent(new KeyboardEvent('keydown', {key:'Home',bubbles:true,cancelable:true}))`);
    await until(`document.querySelector('.bex-scripture-viewport').dataset.zoom === '1' && document.querySelector('.bex-scripture-viewport').dataset.panY === '0'`);
    console.log('PASS: short-passage canvas fills the tab; zoomed/panned Scripture and notes stay visible and clickable in the lower viewport; footer stays compact');
    const sliders = await run(`(() => { const a=document.querySelector('[aria-label="Scripture text size"]').getBoundingClientRect(), b=document.querySelector('[aria-label="Notes text size"]').getBoundingClientRect(); return { a:{top:a.top,right:a.right}, b:{top:b.top,left:b.left} }; })()`);
    assert.ok(Math.abs(sliders.a.top - sliders.b.top) < 2 && sliders.b.left > sliders.a.right, JSON.stringify(sliders));
    await run('document.querySelector("[data-testid=button-bible-version-selector]").click()');
    await until(`!!document.querySelector('[data-testid="favorite-bible-${favoriteId}"]')`);
    const picker = await run(`(() => { const p=document.querySelector('[data-testid="bible-translation-picker"]').getBoundingClientRect(); return {width:p.width,height:p.height}; })()`);
    assert.ok(picker.width >= 500 && picker.height >= 320, JSON.stringify(picker));
    const order = await run('[...document.querySelectorAll("[data-bible-id]")].map(row=>row.dataset.bibleId)');
    assert.equal(order[0], favoriteId); // Only NASB is in this synthetic catalog's ranked English group.
    await run(`document.querySelector('[data-testid="favorite-bible-${favoriteId}"]').click()`);
    for (let i = 0; i < 100 && database.getLocalOwner().scripture_favorite_bible?.id !== favoriteId; i++) await wait(30);
    assert.equal(database.getLocalOwner().scripture_favorite_bible.id, favoriteId);
    assert.equal(calls[0].bibleId, '317e03834065a236-01');
    console.log('PASS: real sliders align horizontally; translation picker is wider, English-first and the star saves the exact edition to encrypted owner settings');
    await run('document.dispatchEvent(new KeyboardEvent("keydown", { key:"Escape", bubbles:true }))');
    await until('!document.querySelector("[data-testid=bible-translation-picker]")');
    await run('document.querySelector("[data-testid=workspace-tab-new]").click()');
    await wait(100);
    const slide = await run(`(() => { const a=document.querySelector('[data-tab-slide="exiting"]'), b=document.querySelector('[data-tab-slide="entering"]'); return a && b && { left:a.getBoundingClientRect().left, incoming:b.getBoundingClientRect().left, inert:a.hasAttribute('inert'), token:!!a.querySelector('[data-token-key]') }; })()`);
    assert.ok(slide && slide.left < 0 && slide.incoming > 0 && slide.inert && slide.token, JSON.stringify(slide));
    await until('!document.querySelector("[data-tab-slide]")');
    console.log('PASS: new tab swipes outgoing content left and incoming Home from the right while retaining the old Scripture DOM');
    window.destroy(); await new Promise(resolve => server.close(resolve));
    calls.length = 0;
    const secondOrigin = await openServer(true);
    assert.notEqual(firstOrigin, secondOrigin);
    await until(`!!document.querySelector('[aria-label="Search scripture"]')`);
    await run(`document.querySelector('[aria-label="Search scripture"]').focus()`);
    await window.webContents.insertText('Romans 2');
    await run(`document.querySelector('[aria-label="Search scripture"]').closest('form').requestSubmit()`);
    await until('!!document.querySelector("[data-token-key]")');
    assert.ok(calls.length > 0 && calls.every(call => call.bibleId === favoriteId), JSON.stringify(calls));
    assert.match(await run('document.querySelector("[data-testid=button-bible-version-selector]").textContent'), /NASB1995/);
    await run('document.querySelector("[data-testid=button-bible-version-selector]").click()');
    await until(`document.querySelector('[data-testid="favorite-bible-${favoriteId}"]')?.getAttribute('aria-pressed') === 'true'`);
    await wait(250); // Capture after the popover's opening animation has painted.
    const screenshot = path.join('/private/tmp', 'bex-reader-options-proof.png');
    fs.writeFileSync(screenshot, (await window.webContents.capturePage()).toPNG());
    console.log('PASS: a fresh desktop origin with no local preference cache uses the persisted favorite for its first Home Scripture search');
    console.log(`Screenshot: ${screenshot}`);
    window.destroy(); await new Promise(resolve => server.close(resolve)); database.closeDatabase();
    fs.rmSync(temp, { recursive: true, force: true }); app.exit(0);
  } catch (error) { console.error(error.stack || error); window?.destroy(); server?.close(); database.closeDatabase(); fs.rmSync(temp, { recursive: true, force: true }); app.exit(1); }
});
