'use strict';
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
if(!process.versions.electron){
(async()=>{
 const temp=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'bex-footnote-creation-'));
 try {
 await require('esbuild').build({entryPoints:[path.join(root,'tests/fixtures/footnoteAlignment.jsx')],outfile:path.join(temp,'fixture.js'),bundle:true,platform:'browser',format:'iife',alias:{'@/api/desktopClient':path.join(root,'tests/fixtures/spotlightDesktopStub.js'),'@':path.join(root,'src'),'@shared':path.join(root,'shared')},loader:{'.woff':'file','.woff2':'file','.ttf':'file'},define:{'process.env.NODE_ENV':'"production"'},logLevel:'warning'});
 const css=fs.readdirSync(path.join(root,'dist/assets')).filter(f=>f.endsWith('.css')).map(f=>`<link rel="stylesheet" href="file://${path.join(root,'dist/assets',f)}">`).join('');
 fs.writeFileSync(path.join(temp,'index.html'),`<!doctype html><html class="dark"><head>${css}<link rel="stylesheet" href="fixture.css"><style>html,body,#root{height:100%;margin:0}body{background:#111827;color:#eee}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const result=require('node:child_process').spawnSync(require('electron'),[__filename,temp],{cwd:root,env,encoding:'utf8',timeout:45000});
 process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');if(result.error)console.error(result.error);process.exitCode=result.status===0?0:1;
 }finally{fs.rmSync(temp,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
}else{
 const {app,BrowserWindow}=require('electron'),temp=process.argv[2];app.setPath('userData',path.join(temp,'profile'));
 app.whenReady().then(async()=>{
 const win=new BrowserWindow({width:1300,height:900,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
 const js=code=>win.webContents.executeJavaScript(code),pause=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async code=>{for(let i=0;i<150;i++){if(await js(code))return;await pause(30)}throw Error('Timed out: '+code)};
 try{
 await win.loadFile(path.join(temp,'index.html'));await until(`!!document.querySelector('[data-testid="footnote-entry-1"]')`);
 await js(`document.querySelector('button[aria-label="Full screen"]').click()`);
 const start=async()=>{
 await js(`(()=>{const e=document.querySelector('.kw-card-editor-fullscreen > [data-bex-global-editor] .ProseMirror')?.editor || document.querySelector('.kw-card-editor-fullscreen .ProseMirror').editor;e.commands.focus('end');e.view.dom.focus()})()`);await pause(50);
 win.webContents.sendInputEvent({type:'keyDown',keyCode:'F',modifiers:[process.platform==='darwin'?'meta':'control','shift']});
 win.webContents.sendInputEvent({type:'keyUp',keyCode:'F',modifiers:[process.platform==='darwin'?'meta':'control','shift']});
 await until(`!!document.querySelector('[data-testid="footnote-composer"] .ProseMirror')`);await pause(80);
 assert.equal(await js(`document.querySelector('[data-testid="footnote-composer"] .ProseMirror').textContent`),'','Each new footnote must open blank');
 };
 await start();
 await js(`document.querySelector('[data-testid="footnote-composer"] .ProseMirror').editor.commands.insertContent('Citation A.')`);
 await pause(30);await js(`document.querySelector('[data-testid="button-footnote-save"]').click()`);await until(`!document.querySelector('[data-testid="footnote-composer"]')`);
 await start();
 await js(`document.querySelector('[data-testid="footnote-composer"] .ProseMirror').editor.commands.insertContent('Citation B.')`);
 await pause(30);await js(`document.querySelector('[data-testid="button-footnote-save"]').click()`);await until(`!document.querySelector('[data-testid="footnote-composer"]')`);
 const bodies=await js(`Array.from(document.querySelectorAll('[data-testid^="footnote-entry-"] .bex-footnote-body')).map(el=>el.textContent)`);
 assert.equal(bodies.length,3);assert(bodies.some(text=>text.includes('A source with')));assert(bodies.includes('Citation A.'));assert(bodies.includes('Citation B.'));assert.equal(await js(`document.querySelector('[data-testid^="footnote-entry-"][data-footnote-id="proof"] .bex-footnote-body').textContent`),'A source with italic text that stays in the same place.');
 console.log('PASS: native Cmd/Ctrl+Shift+F creates blank, independent consecutive footnotes; saving each preserves all previous citations.');
 win.destroy();app.exit(0);
 }catch(e){console.error(e);win.destroy();app.exit(1)}
 });
}
