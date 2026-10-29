'use strict';
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
if(!process.versions.electron){
(async()=>{
 const temp=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'bex-section-hit-'));
 try {
 await require('esbuild').build({entryPoints:[path.join(root,'tests/fixtures/sectionHitPriority.jsx')],outfile:path.join(temp,'fixture.js'),bundle:true,platform:'browser',format:'iife',alias:{'@/api/desktopClient':path.join(root,'tests/fixtures/spotlightDesktopStub.js'),'@':path.join(root,'src'),'@shared':path.join(root,'shared')},loader:{'.woff':'file','.woff2':'file','.ttf':'file'},define:{'process.env.NODE_ENV':'"production"'},logLevel:'warning'});
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
 await win.loadFile(path.join(temp,'index.html'));await until(`!!document.querySelector('[data-testid="section-resize-1"]')`);
 const hits=await js(`(()=>{const hit=(x,y)=>document.elementFromPoint(x,y);return{resize:hit(495,395)?.dataset.testid,border:hit(500,250)?.hasAttribute('data-section-edge'),title:hit(170,120)?.closest('[data-obj-id]')?.dataset.objId,inside:hit(170,220)?.dataset.connectionHit,card:hit(280,220)?.dataset.card}})()`);
 assert.equal(hits.resize,'section-resize-1');assert(hits.border);assert.equal(hits.title,'1');assert.equal(hits.inside,'true');assert.equal(hits.card,'true');
 await js(`(()=>{const el=document.elementFromPoint(495,395);el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:495,clientY:395}));window.dispatchEvent(new MouseEvent('mousemove',{clientX:455,clientY:365}));window.dispatchEvent(new MouseEvent('mouseup',{clientX:455,clientY:365}));})()`);
 await until(`sectionProof.size().width===360&&sectionProof.size().height===270`);
 await js(`sectionProof.lock()`);await until(`!document.querySelector('[data-testid="section-resize-1"]')`);
 assert.equal(await js(`document.elementFromPoint(170,220)?.dataset.connectionHit`),'true');
 console.log('PASS: section resize/title/borders beat crossing noodles; interior noodles and cards remain selectable; resize changes dimensions; locked sections remain click-through.');
 win.destroy();app.exit(0);
 }catch(e){console.error(e);win.destroy();app.exit(1)}
 });
}
