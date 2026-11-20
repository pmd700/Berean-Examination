const test=require('node:test'),assert=require('node:assert/strict');
const {renderNotePdf,registerNotePdfHandler,readPdfImage}=require('../desktop/note-pdf.cjs');
test('PDF renderer isolates content, blocks network and destroys its window',async()=>{
 let options,request,destroyed=false;class Window{constructor(value){options=value;this.webContents={setWindowOpenHandler(){},session:{protocol:{handle(){},unhandle(){}},webRequest:{onBeforeRequest(callback){request=callback;}}},printToPDF:async settings=>{assert.equal(settings.preferCSSPageSize,true);return Buffer.from('%PDF-proof');}};}async loadURL(url){assert.equal(url,'https://bex-note-pdf.invalid/');}destroy(){destroyed=true;}}
 const result=await renderNotePdf({html:'<h1>Proof</h1>',BrowserWindow:Window});assert(result.toString().startsWith('%PDF'));assert.equal(options.webPreferences.javascript,false);assert.equal(options.webPreferences.nodeIntegration,false);request({url:'https://example.com/image'},value=>assert.equal(value.cancel,true));request({url:'file:///secret'},value=>assert.equal(value.cancel,true));assert(destroyed);
});
test('PDF image reads preserve local images and reject file URLs and executable formats',async()=>{
 const bytes=Buffer.from('local image');
 assert.equal(await readPdfImage('bex-media://library/image.png',{readLocalMedia:()=>({bytes,mimeType:'image/png'})}),`data:image/png;base64,${Buffer.from('local image').toString('base64')}`);
 assert(bytes.every(value=>value===0));
 await assert.rejects(readPdfImage('file:///private/content',{}),/Unsupported/);
 await assert.rejects(readPdfImage('https://example.test/image',{fetchImage:async()=>new Response('<svg/>',{headers:{'content-type':'image/svg+xml'}})}),/unsupported PDF format/);
 await assert.rejects(readPdfImage('https://example.test/image',{assertUnlocked(){throw new Error('Locked');}}),/Locked/);
});
test('PDF IPC rejects subframes and locked libraries before creating a window',async()=>{
 let handler,windows=0;const ipcMain={removeHandler(){},handle(_name,callback){handler=callback;}};
 registerNotePdfHandler({ipcMain,appUrl:'http://127.0.0.1:3000',BrowserWindow:class {constructor(){windows++;}},assertUnlocked(){throw new Error('Library locked');}});
 const frame={url:'http://127.0.0.1:3000'},sender={mainFrame:frame};assert.equal((await handler({sender,senderFrame:{...frame}},{html:'x'})).ok,false);assert.match((await handler({sender,senderFrame:frame},{html:'x'})).error,/locked/);assert.equal(windows,0);
});
