'use strict';
// Real built PWA + browser IndexedDB/service worker + actual relay handlers.
// Every library, credential, file and Electron profile here is disposable.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'),path = require('node:path'),os = require('node:os'),http = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const root=path.resolve(__dirname,'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bex-phone-proof-'));
app.setPath('userData',path.join(temporary,'profile'));
class D1 {
 constructor(db){this.database=db;}
 prepare(sql){const db=this.database;let args=[];return {bind(...values){args=values.map(value=>value instanceof ArrayBuffer?Buffer.from(value):value);return this;},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){const result=db.prepare(sql).run(...args);return {success:true,meta:{changes:Number(result.changes)}};}};}
 async batch(statements){this.database.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());this.database.exec('COMMIT');return result;}catch(error){this.database.exec('ROLLBACK');throw error;}}
}
async function run(){
 const { default:worker }=await import('../services/sync-relay/worker.js');
 const {SyncReplica}=await import('../shared/sync/replica.js'),{SqliteReplicaStore}=require('../desktop/sync/replica-store.cjs');
 const {RelayClient,hexDigest,exchangeReplica}=await import('../shared/sync/relay-client.js');
 const {randomSecret,importSyncKey}=await import('../shared/sync/crypto.js'),{createInvitation}=await import('../shared/sync/pairing.js');
 const sql=new DatabaseSync(':memory:');sql.exec(fs.readFileSync(path.join(root,'services/sync-relay/schema.sql'),'utf8'));const env={DB:new D1(sql),BOOTSTRAP_SECRET:randomSecret()};
 const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.txt':'text/plain'};
 const server=http.createServer(async(request,response)=>{try{const origin=`http://127.0.0.1:${server.address().port}`,url=new URL(request.url,origin);if(url.pathname.startsWith('/api/')){const chunks=[];for await(const chunk of request)chunks.push(chunk);const result=await worker.fetch(new Request(url,{method:request.method,headers:request.headers,...(['GET','HEAD'].includes(request.method)?{}:{body:Buffer.concat(chunks)})}),env);response.writeHead(result.status,Object.fromEntries(result.headers));response.end(Buffer.from(await result.arrayBuffer()));}else{const relative=url.pathname==='/'?'/index.html':url.pathname,target=path.join(root,'apps/iphone/dist',relative);if(!target.startsWith(path.join(root,'apps/iphone/dist')+path.sep)||!fs.existsSync(target)){response.writeHead(404);response.end();return;}response.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-cache'});fs.createReadStream(target).pipe(response);}}catch{response.writeHead(503);response.end('{}');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 const identity={vaultId:crypto.randomUUID(),epoch:crypto.randomUUID(),deviceId:crypto.randomUUID(),slot:1},token=randomSecret(),syncKey=randomSecret(),relay=new RelayClient(origin,token),replica=new SyncReplica(new SqliteReplicaStore(':memory:',identity),await importSyncKey(syncKey));
 await new RelayClient(origin,env.BOOTSTRAP_SECRET).request('/api/libraries',{method:'POST',body:{...identity,tokenHash:await hexDigest(new TextEncoder().encode(token))}});
 const note=await replica.create('MindNote',{title:'Phone browser proof',content:'<p>Original synthetic paragraph.</p>',folder_id:null,sort_order:0,created_date:new Date().toISOString(),updated_date:new Date().toISOString()});await exchangeReplica(replica,relay);const invitation=await createInvitation(relay,{identity,syncKey});
 const window=new BrowserWindow({show:true,title:'BEX disposable phone test',width:430,height:932,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}}),errors=[];
 window.webContents.on('console-message',(_event,_level,message)=>{console.log('BROWSER: '+message);if(/Uncaught|The above error|Invalid hook/.test(message))errors.push(message);});
 const js=source=>window.webContents.executeJavaScript(source,true);
 const wait=async(source,label,limit=45000)=>{const start=Date.now();while(Date.now()-start<limit){if(await js(source)){console.log('PASS: '+label);return;}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('Timed out: '+label+'; '+await js('JSON.stringify({visibility:document.visibilityState,online:navigator.onLine,url:location.href,text:document.body.innerText.slice(0,900),html:document.body.innerHTML.slice(0,600)})'));};
 const set=async(selector,value)=>js(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element),'value').set.call(element,${JSON.stringify(value)});element.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 try{
  await window.loadURL(origin);await wait("Boolean(document.querySelector('[data-testid=phone-unlock] textarea'))",'pairing form');await wait("document.querySelector('form button')?.disabled===false",'pairing button enabled');
  await set('textarea',invitation.code);await set('input[type=password]','synthetic unlock passphrase');await js("document.querySelector('form button').click()");
  await wait("Boolean(document.querySelector('[data-testid=library-home]'))",'original BEX Library Home');
  await wait("document.body.innerText.includes('Phone browser proof')",'original BEX notes list');
  await wait("navigator.serviceWorker.controller!==null",'offline shell installed',90000);
  await js("Array.from(document.querySelectorAll('[data-testid^=library-item-]')).find(el=>el.textContent.includes('Phone browser proof')).querySelector('button:last-child').click()");
  await wait("Boolean(document.querySelector('[data-testid=note-zoom-page] .ProseMirror'))",'original BEX note editor');
  await window.webContents.session.enableNetworkEmulation({offline:true});
  await js("const e=document.querySelector('[data-testid=note-zoom-page] .ProseMirror');e.innerHTML='<p>Exact offline phone edit.</p>';e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'Exact offline phone edit.'}));");
  await new Promise(resolve=>setTimeout(resolve,1000));await js('window.__bexFlushPendingEditorSaves()');
  await js('window.bexPhoneSync.syncLock()');await wait("Boolean(document.querySelector('[data-testid=phone-unlock]'))",'locked safely');await window.reload();await wait("Boolean(document.querySelector('[data-testid=phone-unlock] input'))",'offline relaunch');await wait("document.querySelector('form button')?.disabled===false",'unlock form ready');await set('input[type=password]','synthetic unlock passphrase');await js("document.querySelector('form button').click()");await wait("Boolean(document.querySelector('[data-testid=note-zoom-page] .ProseMirror'))",'original BEX offline unlock');
  await wait("document.querySelector('[data-testid=note-zoom-page] .ProseMirror')?.textContent.includes('Exact offline phone edit.')",'offline edit survives reopen');
  await window.webContents.session.enableNetworkEmulation({offline:false});await js('window.bexPhoneSync.syncNow()');await exchangeReplica(replica,relay);if(!(await replica.record(note.record)).versions[0].payload.content.includes('Exact offline phone edit.'))throw new Error('Phone edit did not reach Mac replica');
  if(errors.length)throw new Error(errors.join('\n'));await window.capturePage().then(image=>fs.writeFileSync('/private/tmp/bex-shared-phone-ui.png',image.toPNG()));
  console.log(JSON.stringify({originalBexLibrary:true,originalBexNoteEditor:true,offlineReopen:true,phoneEditReceivedByMac:true,syncPreserved:true}));
 }finally{window.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));replica.store.close();sql.close();}
}
app.whenReady().then(run).then(()=>app.exit(0)).catch(error=>{console.error(error.stack);app.exit(1);});
