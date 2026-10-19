'use strict';
// The complete built renderer against disposable encrypted SQLite and Media.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { app, BrowserWindow, ipcMain, safeStorage, protocol } = require('electron');
const database = require('../desktop/database.cjs');
const { createSafeStorageProtector } = require('../desktop/privacy-vault.cjs');
const { registerLocalMediaScheme, registerLocalMediaProtocol } = require('../desktop/local-media-protocol.cjs');
registerLocalMediaScheme(protocol);
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bex-study-canvas-'));
const library = path.join(temp, 'Library');
for (const dir of ['Database', 'Courses', 'Media', 'Imports', 'Exports', 'Backups']) fs.mkdirSync(path.join(library, dir), { recursive: true });
app.setPath('userData', path.join(temp, 'profile')); app.on('window-all-closed', () => {});
const preload = path.join(temp, 'preload.cjs');
fs.writeFileSync(preload, fs.readFileSync(path.join(root, 'desktop/annotation-gutter-proof-preload.cjs'), 'utf8').replace('isDesktop: true,', "isDesktop: true, saveLocalImage: payload => ipcRenderer.invoke('local-media:save-image', payload),"));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let win, server;
const run = code => win.webContents.executeJavaScript(code).catch(error => { throw new Error(`${error.message}; evaluating: ${code}`); });
const until = async code => { for (let i = 0; i < 150; i++) { if (await run(code)) return; await wait(50); } throw new Error('Timed out: ' + code + '\n' + await run('document.body.innerText.slice(-2000)')); };
const objects = () => database.listLocalEntities('StudyCanvasObject', {});
const links = () => database.listLocalEntities('StudyConnection', {});
async function tool(label) {
  await run(`document.querySelector('button[aria-label="Chapter Study tools"]').click()`); await wait(50);
  await run(`(() => { const button=[...document.querySelectorAll('button')].find(button=>button.textContent.trim().match(${JSON.stringify(`^${label}\\s*[0-9\x60]$`)})); if(!button) throw new Error('Missing tool ${label}'); button.click(); })()`);
  await wait(50);
}
async function place(drag = false) {
  await run(`(() => { const view=document.querySelector('.bex-scripture-viewport'), rect=view.getBoundingClientRect();
    view.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,pointerId:4,clientX:20,clientY:rect.top+180}));
    ${drag ? "window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,button:0,pointerId:4,clientX:65,clientY:rect.top+250}));" : ''}
    window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,pointerId:4,clientX:${drag ? 65 : 20},clientY:rect.top+${drag ? 250 : 180}})); })()`);
}
async function clearSpace() {
  await run(`document.querySelector('.bex-scripture-viewport').dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:2000}))`); await wait(60);
}
async function submit(query) {
  await run(`(() => { const input=document.querySelector('[aria-label="Search scripture"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(query)}); input.dispatchEvent(new Event('input',{bubbles:true})); input.closest('form').requestSubmit(); })()`);
}
app.whenReady().then(async () => {
  try {
    const protector = createSafeStorageProtector(safeStorage);
    database.initializeDatabase(library, { privacyProtector: protector });
    const { DatabaseSync } = require('node:sqlite');
    const seed = new DatabaseSync(path.join(library, 'Database', database.DATABASE_FILE_NAME));
    seed.prepare('INSERT OR IGNORE INTO local_owner (singleton_id, owner_id, display_name, created_at, updated_at, preferences_json) VALUES (1, ?, ?, ?, ?, ?)').run('fixture-owner', 'Fixture Owner', new Date().toISOString(), new Date().toISOString(), '{"theme":"dark"}'); seed.close();
    database.createLocalEntity('StudyChapter', { book:'Romans', chapter_number:1, version:'API:317e03834065a236-01', display_version:'BSB', api_bible_id:'317e03834065a236-01', scripture_source:'api', raw_text:'', annotation_count:1 });
    const annotation = database.createLocalEntity('Annotation', { book:'Romans', chapter_number:1, version:'API:317e03834065a236-01', start_verse:1, end_verse:1, start_token_index:0, end_token_index:0, selected_text:'FIXTURE1', content:'<p>Commentary source</p>' });
    database.createLocalEntity('KnowledgeWeb', { title:'Fixture web' });
    database.createLocalEntity('Timegraph', { title:'Fixture chronology', events:[] });
    server = http.createServer((request, response) => {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/fixture-bootstrap') {
        const tab = { id:'study-proof', kind:'study', title:'Study', path:'/Study?q=Romans%201' };
        response.writeHead(200, {'Content-Type':'text/html'}); response.end(`<script>localStorage.setItem('bex_workspace_tabs_v1',${JSON.stringify(JSON.stringify({tabs:[tab],activeId:tab.id}))});location.replace(${JSON.stringify(tab.path)})</script>`); return;
      }
      let file = path.resolve(root, 'dist', '.' + url.pathname);
      if (!file.startsWith(path.join(root,'dist') + path.sep)) { response.writeHead(403); response.end(); return; }
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(root,'dist/index.html');
      response.writeHead(200, {'Content-Type':{'.js':'text/javascript','.css':'text/css','.html':'text/html'}[path.extname(file)] || 'application/octet-stream'}); fs.createReadStream(file).pipe(response);
    });
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    const appUrl = `http://127.0.0.1:${server.address().port}`;
    require('../desktop/local-entity-ipc.cjs').registerLocalEntityHandlers({...database,appUrl,ipcMain});
    require('../desktop/local-owner-ipc.cjs').registerLocalOwnerHandlers({...database,appUrl,ipcMain});
    require('../desktop/local-media-ipc.cjs').registerLocalMediaHandlers({...database,appUrl,ipcMain});
    registerLocalMediaProtocol({protocol,readLocalMedia:database.readLocalMedia,trustedOrigin:appUrl});
    ipcMain.handle('scripture:fetch-content', (_event, options) => ({ok:true,result:{data:{content:[{type:'tag',name:'para',attrs:{style:'p'},items:[{type:'tag',name:'verse',attrs:{number:options.id.endsWith('.2')?'2':'1'}},{type:'text',text:options.id.endsWith('.2')?'FIXTURE2':'FIXTURE1'}]}]}}}));
    const open = async () => { win = new BrowserWindow({show:false,width:1440,height:950,webPreferences:{preload,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}}); await win.loadURL(appUrl+'/fixture-bootstrap'); await until('!!document.querySelector("[data-study-verse-key]") && !!document.querySelector(".bex-gutter-card")'); await wait(150); };
    await open();
    const findKey = async (shift = false) => {
      const modifiers = [process.platform === 'darwin' ? 'meta' : 'control', ...(shift ? ['shift'] : [])];
      win.webContents.sendInputEvent({type:'keyDown',keyCode:'F',modifiers});
      win.webContents.sendInputEvent({type:'keyUp',keyCode:'F',modifiers});
      await wait(80);
    };
    await findKey(); await until(`!!document.querySelector('[aria-label="Find in this chapter study"]')`);
    await win.webContents.insertText('FIXTURE1');
    await until(`CSS.highlights.get('bex-study-find')?.size===1`);
    assert.equal(await run(`!!document.querySelector('[data-testid="global-spotlight"]')`),false);
    await findKey(); await until(`!document.querySelector('[aria-label="Find in this chapter study"]')`);
    assert.equal(await run(`CSS.highlights.has('bex-study-find')`),false);
    await run('document.activeElement.blur()'); await findKey(true);
    await until(`!!document.querySelector('[data-testid="global-spotlight"]')`);
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'}); win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
    await until(`!document.querySelector('[data-testid="global-spotlight"]')`);
    await run(`document.querySelector('button[title="Edit annotation"]').click()`);
    await until(`!!document.querySelector('[data-testid="gutter-annotation-editor"] .ProseMirror')`);
    await run(`document.querySelector('[data-testid="gutter-annotation-editor"] .ProseMirror').editor.commands.focus('end',{scrollIntoView:false})`);
    await findKey(true); await until(`!!document.querySelector('[data-testid="footnote-composer"]')`);
    assert.equal(await run(`!!document.querySelector('[data-testid="global-spotlight"]')`),false);
    await run(`document.querySelector('[data-testid="footnote-composer"] .ProseMirror').editor.commands.setContent('<p>Native footnote source.</p>',true)`);
    await run(`document.querySelector('[data-testid="button-footnote-save"]').click()`);
    await until(`document.querySelector('[data-testid="footnote-entry-1"]')?.textContent.includes('Native footnote source.')`);
    await run(`document.querySelector('[data-testid="button-gutter-done"]').click()`);
    await until(`!document.querySelector('[data-testid="gutter-annotation-editor"]')`);
    assert.ok(database.listLocalEntities('Annotation',{}).find(item=>item.id===annotation.id).content.includes('Native footnote source.'));
    console.log('PASS: native Cmd+F toggles page highlights, Shift+Cmd+F opens global search, and the focused Study editor creates and saves a footnote');
    await tool('Connect');
    await run(`document.querySelector('[data-study-verse-key]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0}))`); await wait(50);
    await run(`document.querySelector('[data-annotation-card-id]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0}))`);
    await until('document.querySelectorAll("[data-study-connection-id]").length===1');
    await tool('Hand');
    await run(`(() => {const view=document.querySelector('.bex-scripture-viewport'), edge=document.querySelector('.bex-study-edge-hit'), box=view.getBoundingClientRect(), point=edge.getPointAtLength(edge.getTotalLength()/2).matrixTransform(edge.getScreenCTM()); view.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:point.x-(box.left+box.width/2),deltaY:point.y-(box.top+box.height/2)}));})()`);
    await wait(80);
    const edgePoint = await run(`(() => {const edge=document.querySelector('.bex-study-edge-hit'),length=edge.getTotalLength();for(let i=1;i<100;i++){const point=edge.getPointAtLength(length*i/100).matrixTransform(edge.getScreenCTM()),x=Math.round(point.x),y=Math.round(point.y);if(document.elementFromPoint(x,y)?.closest('[data-study-connection-id]'))return {x,y};}return null;})()`);
    assert.ok(edgePoint,'The connection must have an unobstructed native click target');
    assert.equal(await run(`!!document.elementFromPoint(${edgePoint.x},${edgePoint.y})?.closest('[data-study-connection-id]')`),true,'The visible connection must own its native click target');
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...edgePoint}); win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...edgePoint});
    await until(`!!document.querySelector('[aria-label="Study connection label"]')`);
    await run(`document.querySelector('[aria-label="Study connection label"]').focus()`); await win.webContents.insertText('Permanent evidence');
    for(let i=0;i<100&&links()[0]?.label!=='Permanent evidence';i++) await wait(30);
    assert.equal(links()[0].label,'Permanent evidence');
    await run(`document.querySelector('[aria-label="Close study item controls"]').click()`);
    const saved = links()[0]; assert.equal(saved.from.book,'romans'); assert.equal(saved.from.verse,1); assert.equal(saved.to.id,annotation.id);
    await tool('Hand');
    await submit('Romans 1:2'); await until('document.querySelector("[data-study-verse-key]")?.dataset.studyVerseKey === "romans|1|2"');
    assert.equal(links().length,1); assert.equal(await run('document.querySelectorAll("[data-study-connection-id]").length'),0);
    await submit('Romans 1:1'); await until('document.querySelectorAll("[data-study-connection-id]").length===1');
    assert.equal(links()[0].id,saved.id);
    console.log('PASS: permanent verse-to-commentary connection survives removing/reloading its verse');

    await clearSpace(); await tool('Card'); await place();
    await until('!!document.querySelector(".bex-study-free-card .ProseMirror")');
    await run(`document.querySelector('.bex-study-free-card .ProseMirror').editor.commands.setContent('<p>Persisted study idea.</p>',true)`);
    for(let i=0;i<100&&!objects().some(item=>item.content?.includes('Persisted study idea'));i++) await wait(30);
    assert.ok(objects().some(item=>item.content?.includes('Persisted study idea')));
    for (const [label,type,drag] of [['Draw','drawing',true],['Section','section',true],['Point','point',false]]) {
      await clearSpace(); await tool(label); await place(drag);
      for(let i=0;i<100&&!objects().some(item=>item.object_type===type);i++) await wait(30);
      assert.ok(objects().some(item=>item.object_type===type),label);
    }
    await clearSpace(); await tool('Image');
    await run(`void(document.querySelector('[data-study-ui] input[type=file]').click=()=>{})`); await place();
    await run(`(() => { const input=document.querySelector('[data-study-ui] input[type=file]'), data=new DataTransfer(); data.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],'fixture.png',{type:'image/png'})); input.files=data.files; input.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    for(let i=0;i<100&&!objects().some(item=>item.object_type==='image');i++) await wait(30);
    assert.ok(objects().find(item=>item.object_type==='image')?.image_url.startsWith('bex-media://'));
    await clearSpace(); await tool('Timeline'); await place(); await until('!!document.querySelector("[data-testid=timegraph-picker]")');
    await run(`[...document.querySelectorAll('[data-testid=timegraph-picker] button')].find(button=>button.textContent.includes('Fixture chronology')).click()`);
    for(let i=0;i<100&&!objects().some(item=>item.object_type==='timegraph');i++) await wait(30);
    assert.ok(objects().some(item=>item.object_type==='timegraph'));
    await clearSpace(); await tool('Web Link'); await place(); await until('!!document.querySelector("[data-testid=modal-weblink-picker]")');
    await run(`[...document.querySelectorAll('[data-testid=modal-weblink-picker] button')].find(button=>button.textContent.includes('Fixture web')).click()`);
    for(let i=0;i<100&&!objects().some(item=>item.object_type==='web_link');i++) await wait(30);
    assert.equal(objects().length,7);
    await clearSpace(); await tool('Hand'); const before=await run('Number(document.querySelector(".bex-scripture-viewport").dataset.panX)'); await place(true);
    assert.notEqual(await run('Number(document.querySelector(".bex-scripture-viewport").dataset.panX)'),before);
    await tool('Erase'); const point=objects().find(item=>item.object_type==='point');
    await run(`document.querySelector('[data-study-object-id="${point.id}"]').firstElementChild.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0}))`);
    for(let i=0;i<100&&objects().some(item=>item.id===point.id);i++) await wait(30);
    assert.equal(objects().length,6); assert.equal(links().length,1);
    console.log('PASS: all ten tools place/edit/move/erase through the actual renderer and persist encrypted records');
    win.destroy(); database.closeDatabase(); database.initializeDatabase(library,{privacyProtector:protector}); await open();
    await until('document.querySelectorAll("[data-study-connection-id]").length===1 && document.querySelectorAll("[data-study-object-id]").length===6');
    assert.deepEqual(links()[0],saved); assert.ok(objects().some(item=>item.content?.includes('Persisted study idea')));
    await run(`document.querySelector('.bex-scripture-viewport').dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:160,clientX:400,clientY:400}))`);
    const grip=await run(`(() => { const rect=document.querySelector('.bex-gutter-move').getBoundingClientRect(); return {width:rect.width,height:rect.height}; })()`);
    assert.ok(grip.width>=27&&grip.height>=31,JSON.stringify(grip));
    console.log('PASS: reopening SQLite and the renderer restores every item/connection; zoomed-out purple handles remain usable');
    win.destroy(); database.closeDatabase(); await new Promise(resolve=>server.close(resolve)); fs.rmSync(temp,{recursive:true,force:true}); app.exit(0);
  } catch(error) { console.error(error.stack||error); if(win&&!win.isDestroyed()) {console.error(await run('document.body.innerText.slice(-2000)'));win.destroy();} database.closeDatabase();server?.close();app.exit(1); }
});
