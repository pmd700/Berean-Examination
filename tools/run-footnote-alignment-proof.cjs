'use strict';
const fs=require('node:fs'), path=require('node:path'), assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
if(!process.versions.electron){
(async()=>{
 const temp=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'bex-footnote-alignment-'));
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
 const measure=`(()=>{const entry=document.querySelector('[data-testid="footnote-entry-1"]'),body=entry.querySelector('.bex-footnote-body'),p=body.querySelector('p'),range=document.createRange();range.selectNodeContents(p.firstChild);const r=range.getBoundingClientRect(),c=getComputedStyle(p);return{x:r.x,y:r.y,font:c.fontSize,line:c.lineHeight,number:entry.firstElementChild.getBoundingClientRect().x}})()`;
 for(const width of [1300,750]){
 win.setContentSize(width,900);await pause(100);
 await js(`document.querySelector('[data-testid="footnote-entry-1"]').scrollIntoView({block:'center'})`);await pause(80);const before=await js(measure);
 await js(`document.querySelector('[data-testid="button-footnote-edit-1"]').click()`);await until(`!!document.querySelector('.bex-footnote-body .ProseMirror')`);await pause(120);const during=await js(measure);
 assert(Math.abs(before.x-during.x)<=1,`Horizontal jump at ${width}: ${JSON.stringify({before,during})}`);
 assert(Math.abs(before.y-during.y)<=1,`Vertical jump at ${width}: ${JSON.stringify({before,during})}`);
 assert.equal(before.font,during.font);assert.equal(before.line,during.line);assert(before.number>=16,'Footnote number too close to edge');
 await js(`document.querySelector('[title="Done editing footnote"]').click()`);await pause(50);
 console.log(`PASS ${width}px: text stays at (${before.x}, ${before.y}); number inset ${before.number}px; font/line height unchanged`);
 }
 win.destroy();app.exit(0);
 }catch(e){console.error(e);win.destroy();app.exit(1)}
 });
}
