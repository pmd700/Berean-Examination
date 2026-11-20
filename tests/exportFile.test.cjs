'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EXPORT_FILE_CHANNEL, registerExportFileHandlers } = require('../desktop/export-file-ipc.cjs');

test('exporting to the same Markdown path replaces every old byte with the new note', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'bex-note-export-test-'));
  const filePath = path.join(folder, 'note.md');
  let handler;
  registerExportFileHandlers({
    appUrl: 'http://127.0.0.1:5199',
    ipcMain: { removeHandler() {}, handle(channel, callback) { if(channel === EXPORT_FILE_CHANNEL) handler = callback; } },
    showSaveDialog: async () => ({ canceled: false, filePath }),
  });
  const event = { senderFrame: { url: 'http://127.0.0.1:5199/LibraryHome' } };
  try {
    const first = '# Note\n\nOld body to be replaced.\n'.repeat(10);
    const revised = '# Note\n\nUpdated body with new evidence.\n';
    assert.equal((await handler(event, { fileName: 'note.md', bytes: Buffer.from(first) })).status, 'saved');
    assert.equal(await fs.readFile(filePath, 'utf8'), first);
    assert.equal((await handler(event, { fileName: 'note.md', bytes: Buffer.from(revised) })).status, 'saved');
    assert.equal(await fs.readFile(filePath, 'utf8'), revised);
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});

 test('chosen destinations show one dialog, save actual PDF bytes, and cannot be replayed or used by another window', async () => {
  const handlers=new Map(), writes=[], sender={id:1};let dialogs=0;
  registerExportFileHandlers({appUrl:'http://localhost:5199',ipcMain:{removeHandler(){},handle:(name,fn)=>handlers.set(name,fn)},showSaveDialog:async(_event,options)=>{dialogs++;assert.deepEqual(options.filters[0].extensions,['pdf']);return {canceled:false,filePath:'/tmp/chosen.pdf'};},writeFile:async(...args)=>writes.push(args)});
  const event={sender,senderFrame:{url:'http://localhost:5199/notes'}};
  const selection=await handlers.get('export:choose-file')(event,{fileName:'note.pdf'});
  assert.equal(selection.status,'ready');assert.equal(writes.length,0);
  const payload={fileName:'note.pdf',bytes:Buffer.from('%PDF-proof'),selectionId:selection.selectionId};
  assert.equal((await handlers.get(EXPORT_FILE_CHANNEL)({...event,sender:{id:2}},payload)).status,'failed');
  assert.equal((await handlers.get(EXPORT_FILE_CHANNEL)(event,payload)).status,'saved');
  assert.equal(dialogs,1);assert.equal(writes[0][0],'/tmp/chosen.pdf');assert.equal(writes[0][1].toString(),'%PDF-proof');
  assert.equal((await handlers.get(EXPORT_FILE_CHANNEL)(event,payload)).status,'failed');
 });
 test('canceling the location chooser produces no write',async()=>{
  const handlers=new Map();let writes=0;
  registerExportFileHandlers({appUrl:'http://localhost:5199',ipcMain:{removeHandler(){},handle:(name,fn)=>handlers.set(name,fn)},showSaveDialog:async()=>({canceled:true}),writeFile:async()=>{writes++;}});
  assert.equal((await handlers.get('export:choose-file')({senderFrame:{url:'http://localhost:5199'}},{fileName:'note.pdf'})).status,'canceled');assert.equal(writes,0);
 });
