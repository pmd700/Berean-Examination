'use strict';
// Real app, picker, resume card, guarded IPC and encrypted SQLite. Synthetic books only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const database = require('../desktop/database.cjs');
const { createSafeStorageProtector } = require('../desktop/privacy-vault.cjs');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bex-book-page-recovery-'));
const library = path.join(temp, 'Library');
for (const dir of ['Database', 'Courses', 'Media', 'Imports', 'Exports', 'Backups']) fs.mkdirSync(path.join(library, dir), { recursive: true });
app.setPath('userData', path.join(temp, 'profile'));
app.on('window-all-closed', () => {});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let window, server;
app.whenReady().then(async () => {
  try {
    const protector = createSafeStorageProtector(safeStorage);
    database.initializeDatabase(library, { privacyProtector: protector });
    const { DatabaseSync } = require('node:sqlite');
    const seed = new DatabaseSync(path.join(library, 'Database', database.DATABASE_FILE_NAME));
    seed.prepare('INSERT OR IGNORE INTO local_owner (singleton_id, owner_id, display_name, created_at, updated_at, preferences_json) VALUES (1, ?, ?, ?, ?, ?)')
      .run('book-fixture-owner', 'Fixture Owner', new Date().toISOString(), new Date().toISOString(), '{"theme":"dark"}');
    seed.close();
    const content = Array.from({ length: 12 }, (_, i) => `<!--bex-page-title:Page%20${i + 1}--><p>BOOK_PAGE_${i + 1}_WRITING</p>`).join('<!--bex-page-break-->');
    const note = database.createLocalEntity('MindNote', { title: 'Page 1', content, last_page_index: 8 });
    const other = database.createLocalEntity('MindNote', { title: 'Other book', content: content.split('<!--bex-page-break-->').slice(0, 4).join('<!--bex-page-break-->'), last_page_index: 2 });
    server = http.createServer((request, reply) => {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/fixture-bootstrap') {
        const route = url.searchParams.get('route');
        const session = { tabs: [{ id: 'book-proof', kind: route.startsWith('/notes/') || route.startsWith('/KnowledgeWeb') ? 'notes' : 'home', path: route, title: 'Book proof' }], activeId: 'book-proof' };
        reply.writeHead(200, { 'Content-Type': 'text/html' });
        reply.end(`<script>localStorage.setItem('bex_workspace_tabs_v1', ${JSON.stringify(JSON.stringify(session))}); location.replace(${JSON.stringify(route)});</script>`); return;
      }
      let file = path.resolve(root, 'dist', '.' + url.pathname);
      if (!file.startsWith(path.join(root, 'dist') + path.sep)) { reply.writeHead(403); reply.end(); return; }
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(root, 'dist/index.html');
      reply.writeHead(200, { 'Content-Type': { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(reply);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const appUrl = `http://127.0.0.1:${server.address().port}`;
    require('../desktop/local-entity-ipc.cjs').registerLocalEntityHandlers({ ...database, appUrl, ipcMain });
    require('../desktop/local-owner-ipc.cjs').registerLocalOwnerHandlers({ ...database, appUrl, ipcMain });
    const makeWindow = () => new BrowserWindow({ width: 1440, height: 900, useContentSize: true,
      webPreferences: { preload: path.join(root, 'desktop/annotation-gutter-proof-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    const run = code => window.webContents.executeJavaScript(code);
    const until = async code => {
      for (let i = 0; i < 140; i++) { if (await run(code)) return; await wait(60); }
      throw new Error(`Timed out: ${code}; ${await run('document.body.innerText.slice(-1600)')}`);
    };
    const open = async route => { await window.loadURL(`${appUrl}/fixture-bootstrap?route=${encodeURIComponent(route)}`); };
    const page = index => until(`document.querySelector('[data-testid=text-page-indicator]')?.textContent === '${index} / 12' && document.querySelector('[data-testid=book-surface] .ProseMirror')?.textContent.includes('BOOK_PAGE_${index}_WRITING')`);
    const choose = async index => {
      await run('document.querySelector("[data-testid=button-page-wheel]").click()');
      await until(`!!document.querySelector('[data-testid=page-wheel-option-${index}]')`); await wait(100);
      const point = await run(`(() => { const row = document.querySelector('[data-testid=page-wheel-option-${index}]'); row.scrollIntoView({ block: 'nearest' }); const r = row.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
      await wait(40);
      const hit = await run(`document.elementFromPoint(${point.x}, ${point.y})?.closest('[data-testid]')?.dataset.testid`);
      assert.equal(hit, `page-wheel-option-${index}`, `Requested row must be under the real pointer at ${JSON.stringify(point)}`);
      window.focus();
      window.webContents.sendInputEvent({ type: 'mouseMove', ...point });
      window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
      window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
    };
    window = makeWindow(); await open(`/notes/${note.id}`); await page(9);
    await choose(10); await page(10);
    await choose(12); await page(12);
    await until('!document.querySelector("[data-testid=book-page-turn]")');
    await choose(10); await page(10);
    await until('!document.querySelector("[data-testid=book-page-turn]")');
    assert.ok(await run('location.search.includes("page=10")'));
    console.log('PASS: real picker clicks turn to page 10; another click during the animation reaches the latest requested page 12');
    // Capture an in-memory Copy event: never touch the user's OS clipboard.
    await run(`void (document.execCommand=command=>{if(command!=='copy')throw new Error('Unexpected clipboard command');const event=new Event('copy',{cancelable:true});Object.defineProperty(event,'clipboardData',{value:{setData:(type,value)=>{(window.__noteLinkPayload ||= {})[type]=value;}}});window.dispatchEvent(event);return true;});`);
    const linkButton = await run(`(() => {const button=document.querySelector('[data-testid="button-copy-note-link"]'),rect=button.getBoundingClientRect();return {x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)};})()`);
    window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...linkButton});window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...linkButton});
    await until(`!!window.__noteLinkPayload['text/html']`);
    const copiedLink = await run('window.__noteLinkPayload');
    assert.ok(copiedLink['text/html'].includes(`/notes/page-1-${note.id}?page=10`));
    assert.ok(copiedLink['text/plain'].startsWith('[Page 1 — Page 10]'));
    await open(`/notes/${note.id}?page=3`);await page(3);
    await run(`(() => {const editor=document.querySelector('[data-testid="book-surface"] .ProseMirror').editor;editor.commands.focus('end');const data=new DataTransfer();for(const [type,value] of Object.entries(${JSON.stringify(copiedLink)}))data.setData(type,value);editor.view.dom.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));})()`);
    await until(`!!document.querySelector('.ProseMirror a[href$="?page=10"]')`);
    await run(`document.querySelector('.ProseMirror a[href$="?page=10"]').click()`);await page(10);
    await until('!document.querySelector("[data-testid=book-page-turn]")');
    console.log('PASS: the native Link button copies a rich hyperlink; pasting it into another page and clicking it returns to its exact original page');
    await run('document.querySelector("[data-testid=book-surface] .ProseMirror").editor.commands.insertContent(" PERMANENT_PAGE_TEN_EDIT")');
    await run('document.querySelector("[data-testid=workspace-refresh]").click()');
    await until('!!document.querySelector("[data-testid=workspace-refresh][disabled]")');
    await until('!document.querySelector("[data-testid=workspace-refresh][disabled]")');
    await page(10);
    const saved = database.getLocalEntity('MindNote', note.id);
    assert.equal(saved.last_page_index, 9);
    assert.ok(saved.content.split('<!--bex-page-break-->')[9].includes('PERMANENT_PAGE_TEN_EDIT'));
    assert.equal(saved.content.split('<!--bex-page-break-->')[8], content.split('<!--bex-page-break-->')[8]);
    assert.ok(JSON.parse(database.getLocalOwner().last_activity).deep_link.endsWith('?page=10'));
    console.log('PASS: refreshing flushes writing, reading position and resume destination, and returns to the exact page 10');
    window.destroy(); database.closeDatabase(); database.initializeDatabase(library, { privacyProtector: protector });
    window = makeWindow(); await open(`/notes/${note.id}`); await page(10);
    window.destroy();
    // Prove the resume URL selects its page even if the book's fallback differs.
    database.updateLocalEntity('MindNote', note.id, { last_page_index: 0 });
    window = makeWindow(); await open('/LibraryHome');
    await until('!!document.querySelector("[data-testid=button-resume]")');
    await run('document.querySelector("[data-testid=button-resume]").click()'); await page(10);
    await until('!document.querySelector("[data-testid=book-page-turn]")');
    console.log('PASS: encrypted SQLite survives reopening, bare note links restore the saved page, and the real Resume popup opens its exact page');
    await open(`/KnowledgeWeb?note=${note.id}&page=3`); await page(3);
    await choose(4); await page(4);
    await until('location.search.includes("page=4")');
    await run('document.querySelector("[data-testid=workspace-refresh]").click()');
    await until('!!document.querySelector("[data-testid=workspace-refresh][disabled]")');
    await until('!document.querySelector("[data-testid=workspace-refresh][disabled]")');
    await page(4);
    console.log('PASS: legacy note links also keep their current page through refresh');
    await open(`/notes/${other.id}`);
    await until('document.querySelector("[data-testid=text-page-indicator]")?.textContent === "3 / 4"');
    assert.ok(await run('document.querySelector("[data-testid=book-surface] .ProseMirror").textContent.includes("BOOK_PAGE_3_WRITING")'));
    console.log('PASS: each book remembers its own reading position');
    window.destroy(); database.closeDatabase(); await new Promise(resolve => server.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true }); app.exit(0);
  } catch (error) {
    console.error(error.stack); window?.destroy(); database.closeDatabase(); server?.close();
    fs.rmSync(temp, { recursive: true, force: true }); app.exit(1);
  }
});
