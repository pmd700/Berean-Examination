'use strict';
const {randomUUID}=require('node:crypto');
async function renderNotePdf({html,BrowserWindow,assertUnlocked=()=>{}}){
 if(typeof html!=='string'||Buffer.byteLength(html)>64*1024*1024)throw new Error('This PDF exceeds the supported export size.');
 assertUnlocked();
 const window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,javascript:false,partition:'bex-note-pdf-'+randomUUID()}});
 const printSession=window.webContents.session,documentUrl='https://bex-note-pdf.invalid/';
 try{
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  printSession.webRequest.onBeforeRequest((details,done)=>done({cancel:details.url!==documentUrl&&!details.url.startsWith('data:')}));
  // Embedded images can exceed Chromium's URL length limit. Serve the HTML
  // from this isolated in-memory session instead of encoding it into a URL.
  printSession.protocol.handle('https',request=>new Response(request.url===documentUrl?html:'',{status:request.url===documentUrl?200:403,headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store'}}));
  await window.loadURL(documentUrl);
  const bytes=await window.webContents.printToPDF({printBackground:true,pageSize:'A4',preferCSSPageSize:true});assertUnlocked();return bytes;
 }catch(error){throw new Error('BEX could not render this PDF. Please try the export again.',{cause:error});}
 finally{printSession.protocol.unhandle('https');window.destroy();}
}
async function readPdfImage(source,{readLocalMedia,fetchImage=fetch,assertUnlocked=()=>{}}){
 assertUnlocked();
 const url=new URL(source);
 let bytes,mimeType;
 try{
  if(url.protocol==='bex-media:'){
   const media=readLocalMedia(source);bytes=media.bytes;mimeType=media.mimeType;
  }else{
   if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Unsupported PDF image URL.');
   const response=await fetchImage(url.href,{credentials:'omit',signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw new Error('An image could not be loaded for PDF export.');
   mimeType=(response.headers.get('content-type')||'').split(';')[0].trim();
   const reader=response.body.getReader(),chunks=[];let size=0;
   try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>32*1024*1024)throw new Error('A PDF image exceeds 32 MB.');chunks.push(value);}}finally{await reader.cancel();}
   bytes=Buffer.concat(chunks);
  }
  if(!bytes||!/^image\/(png|jpeg|webp|gif)$/.test(mimeType)||bytes.length>32*1024*1024)throw new Error('An image has an unsupported PDF format.');
  assertUnlocked();
  return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
 }finally{bytes?.fill(0);}
}
function registerNotePdfHandler({ipcMain,appUrl,BrowserWindow,assertUnlocked,readLocalMedia,fetchImage}){
 const trusted=event=>{if(event.senderFrame!==event.sender.mainFrame||new URL(event.senderFrame.url).origin!==new URL(appUrl).origin)throw new Error('Untrusted PDF request.');};
 ipcMain.removeHandler('export:read-pdf-image');
 ipcMain.handle('export:read-pdf-image',async(event,payload)=>{try{trusted(event);return {ok:true,dataUrl:await readPdfImage(payload?.source,{readLocalMedia,fetchImage,assertUnlocked})};}catch(error){return {ok:false,error:error.message};}});
 ipcMain.removeHandler('export:render-note-pdf');
 ipcMain.handle('export:render-note-pdf',async(event,payload)=>{try{trusted(event);return {ok:true,bytes:await renderNotePdf({html:payload?.html,BrowserWindow,assertUnlocked})};}catch(error){return {ok:false,error:error.message};}});
}
module.exports={renderNotePdf,registerNotePdfHandler,readPdfImage};
