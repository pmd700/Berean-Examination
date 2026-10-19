'use strict';
// Real renderer, guarded Scripture IPC, shared request queue, and encrypted vault.
// Gutter annotations and Home settings proof. All data is disposable; no user key/library is opened.
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
    await wait(150);
    const readerHeightWithoutNote = await evaluate('document.querySelector(".bex-study-page").getBoundingClientRect().height');
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
    await until('!!document.querySelector(".bex-gutter-card .ProseMirror")');
    assert.equal(await evaluate('!!document.querySelector("[data-testid=window-annotation]")'), false);
    const emptyCardHeight = await evaluate('document.querySelector(".bex-gutter-card").getBoundingClientRect().height');
    assert.ok(emptyCardHeight < 140, 'An empty gutter editor must start compact, without a fixed-height writing area');
    await evaluate(`document.querySelector('.bex-gutter-card .ProseMirror').editor.commands.setContent('<p>hello</p><p>Short editable note.</p>', true)`);
    await wait(150);
    const shortCardHeight = await evaluate('document.querySelector(".bex-gutter-card").getBoundingClientRect().height');
    assert.ok(shortCardHeight < 170, 'Two short lines must not create a tall blank card');
    const shortCardWidth = await evaluate('document.querySelector(".bex-gutter-card").getBoundingClientRect().width');
    assert.ok(shortCardWidth <= 360, 'Short commentary must not fill the full wide rail by default');
    assert.equal(await evaluate('document.querySelector(".bex-gutter-editor-actions").textContent.trim()'), '');
    assert.ok(await evaluate(`!!document.querySelector('button[aria-label="Delete annotation"] svg') && !!document.querySelector('button[aria-label="Done editing annotation"] svg')`));
    const shortNoteLeft = await evaluate('document.querySelector(".bex-gutter-card").getBoundingClientRect().left');
    await evaluate(`document.querySelector('[data-testid=scripture-workspace]').dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: ${shortNoteLeft - 24} }))`);
    await wait(100);
    fs.writeFileSync(path.join(captures, 'gutter-compact-editing.png'), (await window.webContents.capturePage()).toPNG());
    window.show(); window.focus(); await wait(100);
    const scriptureSelection = await evaluate(`(() => {
      const token = document.querySelector('[data-token-key]');
      const range = document.createRange(); range.selectNodeContents(token);
      const r = range.getBoundingClientRect();
      return { x: r.left + 1, endX: r.right - 1, y: r.top + r.height / 2, text: token.textContent };
    })()`);
    assert.ok(scriptureSelection.x > 0 && scriptureSelection.endX < 1440);
    await evaluate('window.__noteBeforeScriptureSelection = document.querySelector(".bex-gutter-card .ProseMirror").editor.getHTML()');
    window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(scriptureSelection.x), y: Math.round(scriptureSelection.y) });
    window.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(scriptureSelection.x), y: Math.round(scriptureSelection.y), button: 'left', clickCount: 1 });
    await wait(30);
    window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(scriptureSelection.endX), y: Math.round(scriptureSelection.y), modifiers: ['leftButtonDown'] });
    assert.equal(await evaluate('!!document.querySelector(".bex-block-drag-overlay.is-visible")'), false, 'A Scripture drag must never start the note marquee');
    window.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(scriptureSelection.endX), y: Math.round(scriptureSelection.y), button: 'left', clickCount: 1 });
    await until('!!document.querySelector("[data-testid=button-popover-add-annotation]")');
    assert.equal(await evaluate('getSelection().toString().trim()'), scriptureSelection.text.trim());
    assert.equal(await evaluate('document.querySelector(".bex-gutter-card .ProseMirror").editor.getHTML() === window.__noteBeforeScriptureSelection'), true);
    assert.ok(await evaluate('!!document.querySelector(".bex-gutter-card .ProseMirror")'));
    await evaluate('getSelection().removeAllRanges()');
    console.log('PASS: real Scripture text dragging works while an inline note is editing, opens its selection actions, and never starts a note marquee or changes writing');
    await evaluate('window.__movingEditor = document.querySelector(".bex-gutter-card .ProseMirror")');
    const beforeCard = await evaluate('(() => { const r = document.querySelector(".bex-gutter-card").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()');
    const grip = await evaluate('(() => { const r = document.querySelector(".bex-gutter-move").getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()');
    const pathBeforeCardMove = await evaluate('document.querySelector("[data-testid^=annotation-cable-]").getAttribute("d")');
    window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(grip.x), y: Math.round(grip.y) });
    window.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(grip.x), y: Math.round(grip.y), button: 'left', clickCount: 1 });
    await wait(40);
    window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(grip.x + 100), y: Math.round(grip.y + 60), modifiers: ['leftButtonDown'] });
    await wait(60);
    const movingCard = await evaluate('(() => { const r = document.querySelector(".bex-gutter-card").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()');
    assert.ok(Math.abs(movingCard.x - beforeCard.x - 100) < 2 && Math.abs(movingCard.y - beforeCard.y - 60) < 2, 'The real pointer drag must move the note on both axes before release');
    const pathDuringCardMove = await evaluate('document.querySelector("[data-testid^=annotation-cable-]").getAttribute("d")');
    assert.notEqual(pathDuringCardMove, pathBeforeCardMove);
    assert.deepEqual(pathDuringCardMove.split(' ').slice(-2), pathBeforeCardMove.split(' ').slice(-2), 'The Scripture end of the arrow must not move');
    assert.ok(await evaluate('window.__movingEditor === document.querySelector(".bex-gutter-card .ProseMirror")'));
    window.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(grip.x + 100), y: Math.round(grip.y + 60), button: 'left', clickCount: 1 });
    for (let i = 0; i < 100 && !annotations()[0].gutter_position; i++) await wait(30);
    let savedCardPosition = annotations()[0].gutter_position;
    assert.equal(savedCardPosition.x, 100); assert.equal(savedCardPosition.absolute, true);
    assert.equal(movingCard.width, beforeCard.width, 'Moving the card must never resize its width');
    assert.equal(movingCard.height, beforeCard.height, 'Moving the card must never resize its height');
    assert.throws(() => database.updateLocalEntity('Annotation', annotations()[0].id, { gutter_position: { x: NaN, y: 0 } }), /invalid/);
    assert.ok(await evaluate('window.__movingEditor === document.querySelector(".bex-gutter-card .ProseMirror")'));
    const cancelGrip = await evaluate('(() => { const r = document.querySelector(".bex-gutter-move").getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()');
    window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(cancelGrip.x), y: Math.round(cancelGrip.y) });
    window.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(cancelGrip.x), y: Math.round(cancelGrip.y), button: 'left', clickCount: 1 });
    await wait(30);
    window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(cancelGrip.x + 50), y: Math.round(cancelGrip.y + 30), modifiers: ['leftButtonDown'] });
    await wait(30);
    await evaluate('document.querySelector(".bex-gutter-move").dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 }))');
    window.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(cancelGrip.x + 50), y: Math.round(cancelGrip.y + 30), button: 'left', clickCount: 1 });
    await wait(60);
    assert.deepEqual(annotations()[0].gutter_position, savedCardPosition);
    assert.equal(await evaluate('parseFloat(document.querySelector(".bex-gutter-card").style.right)'), -100);
    fs.writeFileSync(path.join(captures, 'gutter-card-moved.png'), (await window.webContents.capturePage()).toPNG());
    // Resize with actual pointer input at every corner, then return to natural
    // content sizing so the rest of this proof can inspect the entire writing.
    for (const corner of ['nw', 'ne', 'sw', 'se']) {
      const target = await evaluate(`(() => { const r = document.querySelector('.bex-gutter-resize-${corner}').getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })()`);
      await evaluate(`document.querySelector('[data-testid=scripture-workspace]').dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: ${target.x - 600}, deltaY: ${target.y - 450} }))`);
      await wait(100);
      const before = await evaluate('(() => { const r = document.querySelector(".bex-gutter-card").getBoundingClientRect(); return { width: r.width, height: r.height, left: r.left, top: r.top, right: r.right, bottom: r.bottom }; })()');
      const point = await evaluate(`(() => { const r = document.querySelector('.bex-gutter-resize-${corner}').getBoundingClientRect(); return { x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2) }; })()`);
      const dx = corner.includes('e') ? 80 : -80, dy = corner.includes('s') ? 35 : -35;
      window.webContents.sendInputEvent({ type: 'mouseMove', ...point });
      window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 }); await wait(30);
      window.webContents.sendInputEvent({ type: 'mouseMove', x: point.x + dx, y: point.y, modifiers: ['leftButtonDown'] }); await wait(50);
      const horizontal = await evaluate('(() => { const r = document.querySelector(".bex-gutter-card").getBoundingClientRect(); return { width: r.width, height: r.height }; })()');
      assert.ok(Math.abs(horizontal.width - before.width - 80) < 2);
      assert.ok(Math.abs(horizontal.height - before.height) < 2, 'Horizontal resize must leave height unchanged');
      window.webContents.sendInputEvent({ type: 'mouseMove', x: point.x + dx, y: point.y + dy, modifiers: ['leftButtonDown'] }); await wait(50);
      const after = await evaluate('(() => { const r = document.querySelector(".bex-gutter-card").getBoundingClientRect(); return { width: r.width, height: r.height, left: r.left, top: r.top, right: r.right, bottom: r.bottom }; })()');
      assert.ok(Math.abs(after.height - before.height - 35) < 2, 'Vertical size changes independently');
      assert.ok(Math.abs(after[corner.includes('e') ? 'left' : 'right'] - before[corner.includes('e') ? 'left' : 'right']) < 2, 'Opposite horizontal edge stays fixed');
      assert.ok(Math.abs(after[corner.includes('s') ? 'top' : 'bottom'] - before[corner.includes('s') ? 'top' : 'bottom']) < 2, 'Opposite vertical edge stays fixed');
      window.webContents.sendInputEvent({ type: 'mouseUp', x: point.x + dx, y: point.y + dy, button: 'left', clickCount: 1 });
      await until('!!document.querySelector(".bex-gutter-card-sized")');
      for (let i = 0; i < 100 && !annotations()[0].gutter_size; i++) await wait(30);
      assert.ok(Math.abs(annotations()[0].gutter_size.width - after.width) < 2);
      await evaluate(`document.querySelector('.bex-gutter-resize-${corner}').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
      await until('!document.querySelector(".bex-gutter-card-sized")');
      for (let i = 0; i < 100 && annotations()[0].gutter_size != null; i++) await wait(30);
      assert.equal(annotations()[0].gutter_size, null);
    }
    savedCardPosition = annotations()[0].gutter_position;
    await evaluate('document.querySelector("[data-testid=scripture-workspace]").dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }))'); await wait(500);
    await evaluate(`document.querySelector('[data-testid=scripture-workspace]').dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -35, clientX: 700, clientY: 400 }))`);
    await wait(100);
    assert.ok(await evaluate('Number(document.querySelector("[data-testid=scripture-workspace]").dataset.zoom) > 1'));
    const zoomEndpoint = await evaluate(`(() => { const p = document.querySelector('[data-testid^=annotation-cable-]'); const end = p.getPointAtLength(p.getTotalLength()); const point = new DOMPoint(end.x, end.y).matrixTransform(p.getScreenCTM()); const token = document.querySelector('[data-annotation-ids]').getBoundingClientRect(); return { x: point.x, y: point.y, left: token.left, top: token.top, height: token.height }; })()`);
    assert.ok(Math.abs(zoomEndpoint.y - (zoomEndpoint.top + zoomEndpoint.height / 2)) < 3, 'Zoomed connector stays on its scripture text');
    await evaluate('document.querySelector("[data-testid=scripture-workspace]").dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }))'); await wait(500);
    console.log('PASS: all four real resize handles change width and height independently, preserve the opposite corner, persist sizes, and pinch zoom keeps connector alignment');
    console.log('PASS: six-dot handle moves the card and live cable with real pointer capture, preserves the editor instance, and saves its position to encrypted SQLite');

    await evaluate(`document.querySelector('[data-testid=scripture-workspace]').dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: ${24 - shortNoteLeft} }))`);
    const largeNote = 'PERMANENT_RECOVERY_WRITING\n\n' + Array.from({ length: 35 }, (_, index) => `Large annotation paragraph ${index + 1}. ${"This writing stays readable in the side workspace. ".repeat(5)}`).join('\n\n');
    await evaluate(`document.querySelector('.bex-gutter-card .ProseMirror').editor.commands.clearContent(true)`);
    await evaluate(`document.querySelector('.bex-gutter-card .ProseMirror').focus(); document.execCommand('insertText', false, ${JSON.stringify(largeNote)})`);
    await wait(100);
    assert.ok(await evaluate('document.querySelector(".bex-gutter-card").getBoundingClientRect().height') > shortCardHeight * 3, 'Writing more must grow the same card naturally');
    console.log('PASS: empty/short gutter editors are compact, long writing grows naturally, and action/save indicators use accessible icons');
    await submit('Romans 4'); await until('document.body.textContent.includes("READY_ROM_4")');
    // The editor keeps saving to its original source even while another passage is read.
    for (let i = 0; i < 100 && !annotations()[0].content.includes('PERMANENT_RECOVERY_WRITING'); i++) await wait(30);
    await submit('John 2'); await until('!!document.querySelector(".bex-gutter-card .ProseMirror")');
    await evaluate('document.querySelector("[data-testid=button-gutter-done]").click()');
    await until('!document.querySelector(".bex-gutter-card .ProseMirror")');
    const stableId = annotations()[0].id;
    await evaluate(`document.querySelector('.bex-gutter-card button[title="Edit annotation"]').click()`);
    await until('!!document.querySelector(".bex-gutter-card .ProseMirror")');
    assert.equal(await evaluate('!!document.querySelector("[data-testid=window-annotation]")'), false);
    await evaluate(`(() => { const editor = document.querySelector('.bex-gutter-card .ProseMirror').editor;
      editor.commands.insertContent('<p><strong>INLINE_EDITOR_PERSISTENCE</strong></p>'); })()`);
    for (let i = 0; i < 100 && !annotations()[0].content.includes('INLINE_EDITOR_PERSISTENCE'); i++) await wait(30);
    assert.match(annotations()[0].content, /<strong>INLINE_EDITOR_PERSISTENCE<\/strong>/);
    assert.equal(annotations()[0].id, stableId);
    await evaluate('document.querySelector("[data-testid=button-gutter-done]").click()');
    await until('!document.querySelector(".bex-gutter-card .ProseMirror")');
    console.log('PASS: Add/Edit mount the real shared editor inside the same gutter card, autosave rich text to the same SQLite record, and Done returns to read-only without a popup');
    assert.equal(annotations().length, 1); assert.equal(annotations()[0].book, 'John'); assert.equal(annotations()[0].chapter_number, 2);
    assert.match(annotations()[0].content, /PERMANENT_RECOVERY_WRITING/);
    const parent = chapters().find(chapter => chapter.book === 'John' && chapter.chapter_number === 2);
    database.updateLocalEntity('StudyChapter', parent.id, { notes: 'PRESERVED_PERSONAL_NOTE' });
    console.log('PASS: an open draft remains tied to its original passage while a new query loads');
    await submit('John 2'); await until('document.body.textContent.includes("READY_JHN_2")');
    await until('!!document.querySelector(".bex-gutter-card") && !!document.querySelector(".bex-annotation-route-dot")');
    await wait(150);
    const noteLayout = await evaluate('(() => { const reader = document.querySelector(".bex-study-page").getBoundingClientRect(); const note = document.querySelector(".bex-gutter-card").getBoundingClientRect(); return { readerHeight: reader.height, noteBottom: note.bottom, readerBottom: reader.bottom, noteWidth: note.width }; })()');
    assert.ok(Math.abs(noteLayout.readerHeight - readerHeightWithoutNote) < 2, 'A large note must not stretch the Scripture card or add blank space inside it');
    assert.ok(noteLayout.noteBottom > noteLayout.readerBottom, 'Long commentary must remain reachable outside the shorter Scripture card');
    assert.equal(noteLayout.noteWidth, 1040, 'The desktop note must use substantially more of the side workspace');
    assert.equal(await evaluate('!!document.querySelector(".bex-reader-scroll")'), false, 'A long gutter note must not enable Scripture shortcuts when the passage fits');
    // Real layout and ResizeObserver must turn shortcuts on/off as Scripture grows/shrinks.
    await evaluate(`document.querySelector('[data-scripture-root]').style.minHeight = '1600px'`);
    await until('document.querySelectorAll(".bex-reader-scroll").length === 2');
    await evaluate(`document.querySelector('[data-scripture-root]').style.minHeight = ''`);
    await until('!document.querySelector(".bex-reader-scroll")');
    console.log('PASS: fitting Scripture hides both shortcuts despite a tall gutter note; real passage overflow shows both, and shrinking it hides them again');

    assert.ok(await evaluate('document.querySelector(".bex-gutter-card").textContent.includes("PERMANENT_RECOVERY_WRITING")'));
    await wait(250);
    window.show(); window.focus(); await wait(150);
    const dotTarget = await evaluate('(() => { const r = document.querySelector(".bex-annotation-route-dot").getBoundingClientRect(); return { x: r.x+r.width/2, y: r.y+r.height/2 }; })()');
    await evaluate(`document.querySelector('[data-testid=scripture-workspace]').dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: ${dotTarget.x - 650}, deltaY: ${dotTarget.y - 400} }))`);
    await wait(100);
    const beforePath = await evaluate('document.querySelector("[data-testid^=annotation-cable-]").getAttribute("d")');
    const dot = await evaluate('(() => { const r = document.querySelector(".bex-annotation-route-dot").getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()');
    window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(dot.x), y: Math.round(dot.y) });
    window.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(dot.x), y: Math.round(dot.y), button: 'left', clickCount: 1 });
    await wait(40);
    window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(dot.x + 140), y: Math.round(dot.y + 100), modifiers: ['leftButtonDown'] });
    await wait(40);
    window.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(dot.x + 140), y: Math.round(dot.y + 100), button: 'left', clickCount: 1 });
    for (let i = 0; i < 100 && !annotations()[0].gutter_route; i++) await wait(30);
    assert.ok(annotations()[0].gutter_route, 'Pointer drag must persist a connector bend');
    assert.notEqual(await evaluate('document.querySelector("[data-testid^=annotation-cable-]").getAttribute("d")'), beforePath);
    const savedRoute = annotations()[0].gutter_route;
    await wait(100);
    const beforeCancel = await evaluate('document.querySelector("[data-testid^=annotation-cable-]").getAttribute("d")');
    const cancelDot = await evaluate('(() => { const r = document.querySelector(".bex-annotation-route-dot").getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()');
    window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(cancelDot.x), y: Math.round(cancelDot.y) });
    window.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(cancelDot.x), y: Math.round(cancelDot.y), button: 'left', clickCount: 1 });
    await wait(40);
    window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(cancelDot.x - 70), y: Math.round(cancelDot.y + 60), modifiers: ['leftButtonDown'] });
    await wait(40);
    await evaluate('document.querySelector(".bex-annotation-route-dot").dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 }))');
    window.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(cancelDot.x - 70), y: Math.round(cancelDot.y + 60), button: 'left', clickCount: 1 });
    await wait(100);
    assert.equal(await evaluate('document.querySelector("[data-testid^=annotation-cable-]").getAttribute("d")'), beforeCancel);
    assert.deepEqual(annotations()[0].gutter_route, savedRoute);
    console.log('PASS: cancelling a connector drag restores the last saved bend without persisting partial movement');

    window.show(); window.focus(); await wait(300);
    fs.writeFileSync(path.join(captures, 'gutter-desktop.png'), (await window.webContents.capturePage()).toPNG());
    console.log('PASS: default gutter card shows saved commentary and a real pointer drag bends/persists its connector');

    const camera = () => evaluate('Number(document.querySelector("[data-testid=scripture-workspace]").dataset.panX)');
    const centerCamera = async () => { await evaluate('document.querySelector("[data-testid=scripture-workspace]").dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }))'); await wait(500); };
    await centerCamera();
    const cameraBefore = await camera();
    const cableBeforePan = await evaluate('document.querySelector("[data-testid^=annotation-cable-]").getAttribute("d")');
    window.webContents.sendInputEvent({ type: 'mouseWheel', x: 500, y: 400, deltaX: 240, deltaY: 0, hasPreciseScrollingDeltas: true, canScroll: true });
    await wait(200);
    assert.notEqual(await camera(), cameraBefore, 'Horizontal pixel trackpad scrolling must pan the workspace');
    assert.equal(await evaluate('document.querySelector("[data-testid^=annotation-cable-]").getAttribute("d")'), cableBeforePan, 'Panning must not bend the connector');
    await until(`!!document.querySelector('button[aria-label="Center reader"]')`);
    const centerIcon = await evaluate(`(() => { const b = document.querySelector('button[aria-label="Center reader"]'); const r = b.getBoundingClientRect(); const page = document.querySelector('.bex-study-page').getBoundingClientRect(); return { left: b.classList.contains('bex-workspace-center-left'), x: r.left + r.width / 2, pageLeft: page.left, icon: !!b.querySelector('.lucide-focus'), text: b.textContent, animation: getComputedStyle(b).animationName, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches }; })()`);
    assert.ok(centerIcon.left && centerIcon.icon && !centerIcon.text);
    assert.ok(Math.abs(centerIcon.x - centerIcon.pageLeft) < 2, 'Focus icon must sit on the left reader edge');
    await wait(centerIcon.reduced ? 0 : 2100);
    assert.ok(await evaluate(`Number(getComputedStyle(document.querySelector('button.bex-workspace-center-left')).opacity) > 0.99`), 'Slow fade-in must finish at full opacity');
    fs.writeFileSync(path.join(captures, 'center-left.png'), (await window.webContents.capturePage()).toPNG());
    await evaluate(`document.querySelector('button[aria-label="Center reader"]').click()`);
    for (let i = 0; i < 50 && Math.abs(await camera() - cameraBefore) > 0.1; i++) await wait(30);
    assert.ok(Math.abs(await camera() - cameraBefore) < 1, 'Smooth recentering must reach the reader origin within one pixel');
    if (!centerIcon.reduced) {
      const exiting = await evaluate(`(() => { const b = document.querySelector('button.bex-workspace-center-left'); return b && { opacity: Number(getComputedStyle(b).opacity), disabled: b.disabled, hidden: b.getAttribute('aria-hidden') }; })()`);
      assert.ok(exiting && exiting.opacity > 0 && exiting.disabled && exiting.hidden === 'true', 'Centering must fade out the retained icon without leaving an invisible click target');
      for (let i = 0; i < 4; i++) {
        await wait(80);
        const alignment = await evaluate(`(() => { const b = document.querySelector('button.bex-workspace-center-left'); if (!b) return 0; const r = b.getBoundingClientRect(); return Math.abs(r.left + r.width / 2 - document.querySelector('.bex-study-page').getBoundingClientRect().left); })()`);
        assert.ok(alignment < 2, 'The fading icon must continue following the reader border');
      }
      await until(`!document.querySelector('button.bex-workspace-center-left')`);
    }
    await evaluate(`document.querySelector('[data-testid=scripture-workspace]').dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 240 }))`);
    await until(`!!document.querySelector('button.bex-workspace-center-right')`);
    const rightIcon = await evaluate(`(() => { const b = document.querySelector('button.bex-workspace-center-right'); const r = b.getBoundingClientRect(); const page = document.querySelector('.bex-study-page').getBoundingClientRect(); return { x: r.left + r.width / 2, pageRight: page.right, opacity: Number(getComputedStyle(b).opacity), animation: getComputedStyle(b).animationName }; })()`);
    assert.ok(Math.abs(rightIcon.x - rightIcon.pageRight) < 2, 'Focus icon must sit on the right reader edge');
    if (!centerIcon.reduced) assert.ok(rightIcon.opacity < 1, 'Right-side button must fade in instead of appearing immediately');
    await wait(400);
    fs.writeFileSync(path.join(captures, 'center-right.png'), (await window.webContents.capturePage()).toPNG());
    await centerCamera(); await wait(100);
    console.log('PASS: purple focus icon follows the left/right reader edge, fades in on both sides, and recenters the reader');
    window.webContents.sendInputEvent({ type: 'mouseDown', x: 1000, y: 700, button: 'left', clickCount: 1 });
    window.webContents.sendInputEvent({ type: 'mouseMove', x: 900, y: 700, modifiers: ['leftButtonDown'] });
    window.webContents.sendInputEvent({ type: 'mouseUp', x: 900, y: 700, button: 'left', clickCount: 1 });
    await wait(100); assert.equal(await camera(), cameraBefore);
    const dotStyle = await evaluate('(() => { const s = getComputedStyle(document.querySelector(".bex-annotation-route-dot span")); return { width: s.width, border: s.borderWidth, shadow: s.boxShadow }; })()');
    assert.deepEqual(dotStyle, { width: '7px', border: '0px', shadow: 'none' });
    console.log('PASS: native trackpad-style scrolling pans; Center reader restores the camera; mouse drags do not pan; the smaller green dot has no outer ring');

    // This portion dispatches its own wheel events; keep desktop input from
    // changing the camera while its exact synthetic deltas are checked.
    await wait(50);
    await evaluate(`(() => {
      const note = document.querySelector('.bex-gutter-card-content');
      const overflow = document.createElement('div'); overflow.style.width = '4000px'; note.appendChild(overflow);
      for (let i = 0; i < 20; i++) note.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: -200 }));
      note.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: -12, deltaY: 40 }));
      overflow.remove();
    })()`);
    assert.equal(await camera(), -4012, 'One gesture over an overflowing note must continue past every former left boundary');
    await wait(150); assert.equal(await camera(), -4012, 'Note layout updates must not snap the camera back');
    await evaluate(`document.querySelector('[data-testid=scripture-workspace]').dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 10000 }))`);
    assert.equal(await camera(), 5988, 'There must be no right boundary either');
    await centerCamera();
    console.log('PASS: horizontal gestures cross overflowing notes and former walls without snapping; larger notes do not stretch the Scripture card');
    window.show(); window.focus(); await wait(100);

    for (const width of [1440, 683, 480]) {
      window.setContentSize(width, 900); await wait(150);
      await evaluate(`document.querySelector('.bex-tab-pane').scrollTop = 0`);
      await centerCamera(); await wait(50);
      const geometry = await evaluate(`(() => { const el = document.querySelector('[data-testid=reading-controls-panel]'); return { right: el.getBoundingClientRect().right, width: innerWidth, scroll: document.documentElement.scrollWidth }; })()`);
      assert.ok(geometry.right <= geometry.width && geometry.scroll <= geometry.width);
      const beforeNote = await evaluate('(() => { const r = document.querySelector(".bex-gutter-card").getBoundingClientRect(); return { left: r.left, width: r.width }; })()');
      assert.equal(beforeNote.width, Math.min(1040, width - 48), 'Annotations use the wider side space and fit Split View');
      await evaluate(`document.querySelector('[data-testid=scripture-workspace]').dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: ${beforeNote.left - 24}, deltaMode: 0 }))`);
      await wait(100);
      const cardBounds = await evaluate('(() => { const r = document.querySelector(".bex-gutter-card").getBoundingClientRect(); return { left: r.left, right: r.right }; })()');
      assert.ok(cardBounds.left >= 4 && cardBounds.right <= width - 4, `Sideways panning must reveal the full note at ${width}px`);
      const noteScroll = await evaluate('(() => { const el = document.querySelector(".bex-gutter-card-content"); const r = el.getBoundingClientRect(); return { height: el.clientHeight, content: el.scrollHeight, x: r.left + 100, y: Math.min(r.bottom - 8, r.top + 40) }; })()');
      assert.ok(noteScroll.content <= noteScroll.height + 1, 'The full note must render without an internal clipped scroll area');
      const noteCamera = await camera();
      window.webContents.sendInputEvent({ type: 'mouseWheel', x: Math.round(noteScroll.x), y: Math.round(noteScroll.y), deltaX: 0, deltaY: -100, hasPreciseScrollingDeltas: true, canScroll: true });
      await wait(120);
      assert.notEqual(await evaluate('Number(document.querySelector("[data-testid=scripture-workspace]").dataset.panY)'), 0, 'Vertical trackpad scrolling must pan the infinite canvas through the full note');
      assert.equal(await camera(), noteCamera, 'Vertical note scrolling must not pan the workspace');
      if (width === 480) fs.writeFileSync(path.join(captures, 'narrow-reader.png'), (await window.webContents.capturePage()).toPNG());
    }
    window.destroy(); database.closeDatabase(); api.reset();
    database.initializeDatabase(library, { privacyProtector: protector });
    database.updateLocalEntity('Annotation', annotations()[0].id, { end_verse: 2, end_token_index: 0 });
    window = makeWindow(); await open(`/Study?chapter_id=${parent.id}`);
    await until('document.body.textContent.includes("READY_JHN_2")');
    await until('!!document.querySelector("[data-token-key]")');
    assert.equal(annotations().length, 1);
    assert.deepEqual(annotations()[0].gutter_position, savedCardPosition);
    assert.equal(chapters().find(chapter => chapter.id === parent.id).notes, 'PRESERVED_PERSONAL_NOTE');
    assert.equal(await evaluate('!!document.querySelector("[data-scripture-root] .lucide-pen")'), false);
    assert.ok(chapters().every(chapter => chapter.raw_text === '' && !chapter.blocks));
    await until('!!document.querySelector(".bex-gutter-card")');
    await until('document.querySelectorAll("path[data-annotation-arrow]").length === 2');
    await wait(250); // Let overflow controls and ResizeObserver settle the reader layout.
    const arrows = await evaluate(`(() => {
      const root = document.querySelector('[data-testid=annotation-gutter-layout]');
      return [...root.querySelectorAll('path[data-annotation-arrow]')].map(path => {
        const end = path.getPointAtLength(path.getTotalLength()); const svg = path.ownerSVGElement.getBoundingClientRect();
        const body = root.querySelector('[data-verse-id="' + path.dataset.targetVerse + '"]');
        const badge = body.closest('[data-scripture-verse]').querySelector('[data-verse-number]').getBoundingClientRect();
        return { verse: path.dataset.targetVerse, kind: path.dataset.targetKind,
          error: Math.abs(end.x + svg.left - badge.left + 4) + Math.abs(end.y + svg.top - badge.top - badge.height / 2) };
      });
    })()`);
    assert.deepEqual(arrows.map(arrow => arrow.verse), ['1', '2']);
    assert.ok(arrows.every(arrow => arrow.kind === 'verse' && arrow.error < 2), `Each full verse must have an arrow terminating at its number box: ${JSON.stringify(arrows)}`);
    assert.equal(await evaluate('!!document.querySelector(".bex-gutter-card blockquote") || !!document.querySelector(".bex-annotation-cables line")'), false);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-annotation-ids]')).backgroundColor`), 'rgba(0, 0, 0, 0)');
    window.setContentSize(1900, 1000); window.show(); window.focus(); await wait(250);
    const wideLeft = await evaluate('document.querySelector(".bex-gutter-card").getBoundingClientRect().left');
    await evaluate(`document.querySelector('[data-testid=scripture-workspace]').dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: ${wideLeft - 24} }))`);
    await wait(300);
    fs.writeFileSync(path.join(captures, 'wide-gutter-two-verses.png'), (await window.webContents.capturePage()).toPNG());
    console.log('PASS: full notes render without repeated Scripture, gutter text has no pen/shading/underline, and two whole verses get two badge arrows');
    assert.deepEqual(annotations()[0].gutter_route, savedRoute);
    assert.throws(() => database.updateLocalEntity('Annotation', annotations()[0].id, { gutter_route: { x: NaN, y: 0 } }), /invalid/);
    await open('/LibraryHome');
    await until('!!document.querySelector("[data-testid=home-user-settings]")');
    await evaluate('document.querySelector("[data-testid=home-user-settings]").click()');
    await until('!!document.querySelector("input[value=hover]:not([disabled])")');
    await evaluate('document.querySelector("input[value=hover]").click()');
    await until('document.body.textContent.includes("Saved locally.")');
    assert.equal(database.getLocalOwner().scripture_annotation_display, 'hover');
    await open(`/Study?chapter_id=${parent.id}`);
    await until('document.body.textContent.includes("READY_JHN_2")');
    assert.equal(await evaluate('!!document.querySelector(".bex-gutter-card")'), false);
    assert.equal(await evaluate('!!document.querySelector("[data-scripture-root] .lucide-pen")'), true);
    assert.equal(await evaluate('!!document.querySelector("[data-testid=home-user-settings]")'), false);
    await evaluate(`(() => { const token = document.querySelector('[data-annotation-ids]'); token.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); })()`);
    await until('!!document.querySelector("[data-annotation-preview]")');
    assert.equal(annotations().length, 1);
    assert.deepEqual(annotations()[0].gutter_route, savedRoute);
    await evaluate('document.querySelector("[data-scripture-root] .lucide-pen").parentElement.click()');
    await until('!!document.querySelector("[data-testid=window-annotation] .ProseMirror")');
    assert.equal(await evaluate('!!document.querySelector("[data-testid=gutter-annotation-editor]")'), false);
    window.destroy(); database.closeDatabase();
    database.initializeDatabase(library, { privacyProtector: protector });
    assert.equal(database.getLocalOwner().scripture_annotation_display, 'hover');
    database.updateLocalOwner({ scripture_annotation_display: 'gutter' });
    const editionId = 'b8ee27bcd1cae43a-01';
    database.createLocalEntity('StudyChapter', { book: 'John', chapter_number: 20, version: `API:${editionId}`,
      display_version: 'NASB1995', api_bible_id: editionId, scripture_source: 'api', raw_text: '',
      title: 'John 20', annotation_count: 1, notes: '', context: '', application: '' });
    const linkedNote = database.createLocalEntity('Annotation', { book: 'John', chapter_number: 20,
      version: `API:${editionId}`, start_verse: 23, end_verse: 23, start_token_index: 0, end_token_index: 0,
      selected_text: 'READY_JHN_20_23', content: '<p>EDITION_SPECIFIC_COMMENTARY</p>' });
    window = makeWindow();
    for (const suffix of [`&version=API%3A${editionId}`, '']) {
      await open(`/Study?q=John%2020%3A23&annotation_id=${linkedNote.id}${suffix}`);
      await until(`!!document.querySelector('[data-annotation-card-id="${linkedNote.id}"]')`);
      assert.equal(await evaluate('document.querySelector("[data-testid=button-bible-version-selector]").textContent.trim()'), 'NASB1995');
      assert.ok(await evaluate('document.body.textContent.includes("EDITION_SPECIFIC_COMMENTARY")'));
      assert.ok(await evaluate(`document.querySelector('[data-annotation-card-id="${linkedNote.id}"] button[title^="Copy link"]').title.includes('NASB 1995')`));
    }
    assert.ok(calls.filter(call => call.id === 'JHN.20.23').every(call => call.bibleId === editionId));
    assert.equal(chapters().some(chapter => chapter.book === 'John' && chapter.chapter_number === 20 && chapter.api_bible_id !== editionId), false);
    const changeSize = async (testId, value) => evaluate(`(() => { const slider = document.querySelector('[data-testid="${testId}"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '${value}');
      slider.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const noteFont = await evaluate('getComputedStyle(document.querySelector(".bex-gutter-card-content")).fontSize');
    const noteBeforeSizing = database.getLocalEntity('Annotation', linkedNote.id).content;
    await changeSize('text-size-control', 5);
    await until('document.querySelector("[data-testid=text-size-control]").value === "5"');
    await wait(100);
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".bex-gutter-card-content")).fontSize'), noteFont, 'Scripture size must not change personal notes');
    const assertBadgeFits = async expected => {
      const box = await evaluate(`(() => { const label = document.querySelector('[data-verse-number-label]'); const badge = label.closest('[data-verse-number]');
        const digits = [...label.firstChild.textContent].map((_, i) => { const range = document.createRange(); range.setStart(label.firstChild, i); range.setEnd(label.firstChild, i + 1); return range.getBoundingClientRect().top; });
        const number = label.getBoundingClientRect(), container = badge.getBoundingClientRect();
        return { text: label.textContent, digits, contained: number.left >= container.left - 1 && number.right <= container.right + 1 && number.top >= container.top - 1 && number.bottom <= container.bottom + 1 }; })()`);
      assert.equal(box.text, expected);
      assert.ok(Math.max(...box.digits) - Math.min(...box.digits) < 1, 'Verse digits must stay on one line at maximum text size');
      assert.ok(box.contained, 'The complete number must fit inside its badge');
    };
    await assertBadgeFits('23');
    const scriptureFont = await evaluate('getComputedStyle(document.querySelector("[data-verse-id] [data-token-key]")).fontSize');
    await changeSize('notes-text-size-control', 5);
    await until('getComputedStyle(document.querySelector(".bex-gutter-card-content")).fontSize !== ' + JSON.stringify(noteFont));
    assert.equal(await evaluate('getComputedStyle(document.querySelector("[data-verse-id] [data-token-key]")).fontSize'), scriptureFont, 'Notes size must not change Scripture');
    await evaluate(`document.querySelector('.bex-gutter-card button[title="Edit annotation"]').click()`);
    await until('!!document.querySelector(".bex-gutter-card .ProseMirror")');
    assert.ok(Math.abs(await evaluate('parseFloat(getComputedStyle(document.querySelector(".bex-gutter-card .ProseMirror")).fontSize)') - 17.333) < .01);
    await evaluate('document.querySelector("[data-testid=button-gutter-done]").click()');
    await until('!document.querySelector(".bex-gutter-card .ProseMirror")');
    assert.equal(database.getLocalEntity('Annotation', linkedNote.id).content, noteBeforeSizing);
    for (let i = 0; i < 100 && database.getLocalOwner().scripture_notes_text_size !== 5; i++) await wait(30);
    assert.equal(database.getLocalOwner().scripture_notes_text_size, 5);
    assert.equal(database.getLocalOwner().text_size, 5);
    await submit('Psalm 119:176');
    await until('!!document.querySelector("[data-verse-number-label]") && document.querySelector("[data-verse-number-label]").textContent === "176"');
    await assertBadgeFits('176');
    window.destroy(); database.closeDatabase(); database.initializeDatabase(library, { privacyProtector: protector });
    window = makeWindow();
    await open(`/Study?q=John%2020%3A23&annotation_id=${linkedNote.id}`);
    await until('!!document.querySelector(".bex-gutter-card") && document.querySelector("[data-testid=notes-text-size-control]").value === "5"');
    assert.equal(await evaluate('document.querySelector("[data-testid=text-size-control]").value'), '5');
    assert.ok(Math.abs(await evaluate('parseFloat(getComputedStyle(document.querySelector(".bex-gutter-card-content")).fontSize)') - 17.333) < .01);
    console.log('PASS: two- and three-digit badges stay intact at maximum text size; notes and Scripture sliders are independent, inline editing uses notes size, and both preferences survive reopening SQLite');

    await evaluate(`document.querySelector('.bex-gutter-card button[title="Edit annotation"]').click()`);
    await until('!!document.querySelector(".bex-gutter-card .ProseMirror")');
    await evaluate(`document.querySelector('.bex-gutter-card .ProseMirror').editor.commands.setContent(
      '<p>FULL_NOTE_START</p><p></p><p><a href="https://example.com/source">VISIBLE_SOURCE_LINK</a></p>' +
      '<details><summary>Supporting material</summary><div data-type="detailsContent"><p>FULL_NOTE_ARGUMENT</p>' +
      '<details><summary>Nested support</summary><div data-type="detailsContent"><p>FULL_NOTE_END</p></div></details></div></details>', true)`);
    const fullNoteBeforeReading = await evaluate('document.querySelector(".bex-gutter-card .ProseMirror").editor.getHTML()');
    const editingBlankHeight = await evaluate('document.querySelector(".bex-gutter-card .ProseMirror > p:nth-child(2)").getBoundingClientRect().height');
    await evaluate('document.querySelector("[data-testid=button-gutter-done]").click()');
    await until('!!document.querySelector(".bex-gutter-full-note") && !document.querySelector(".bex-gutter-card .ProseMirror")');
    const fullReading = await evaluate(`(() => {
      const body = document.querySelector('.bex-gutter-full-note');
      const blank = body.querySelector('p:empty');
      const link = body.querySelector('a');
      return { text: body.textContent, heights: [...body.querySelectorAll('details p')].map(p => p.getBoundingClientRect().height),
        open: [...body.querySelectorAll('details')].every(d => d.open),
        blankHeight: blank.getBoundingClientRect().height, linkColor: getComputedStyle(link).color,
        linkDecoration: getComputedStyle(link).textDecorationLine };
    })()`);
    assert.ok(fullReading.text.includes('FULL_NOTE_START') && fullReading.text.includes('FULL_NOTE_END'));
    assert.ok(fullReading.open && fullReading.heights.every(height => height > 0), 'Every nested section must be visible before editing');
    assert.ok(Math.abs(fullReading.blankHeight - editingBlankHeight) < 1, 'Saved blank lines must occupy the same space as the editor');
    assert.equal(fullReading.linkColor, 'rgb(96, 165, 250)');
    assert.ok(fullReading.linkDecoration.includes('underline'));
    assert.equal(database.getLocalEntity('Annotation', linkedNote.id).content, fullNoteBeforeReading);
    await evaluate('document.querySelector(".bex-gutter-full-note summary").click()');
    assert.ok(await evaluate('[...document.querySelectorAll(".bex-gutter-full-note details")].every(d => d.open)'));
    fs.writeFileSync(path.join(captures, 'gutter-full-reading.png'), (await window.webContents.capturePage()).toPNG());
    console.log('PASS: read-only gutter notes retain real blank-line spacing and visible links, show all nested section content, and never rewrite the saved editor document');

    window.destroy(); database.closeDatabase();
    console.log('PASS: new and older commentary links open the exact NASB 1995 edition, show the saved commentary, and name the edition in the link tooltip instead of fetching BSB');
    console.log('PASS: connector position survives reopening, invalid positions are rejected, Home-only settings save to SQLite, and the original hover style is restored without modifying annotations');

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
