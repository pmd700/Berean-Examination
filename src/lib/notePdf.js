import { getPageBody, getPageTitle, footnoteOffsets, extractFootnotes, numberFootnotesInHtml } from '@/components/notes/bookModel';
import { sanitizeFileName } from '@/components/knowledgeweb/bereanFileFormat';
import { saveExportFile } from './saveExportFile';
import { resolveMediaSource } from './mediaSource';
const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const allowed=new Set('P DIV SPAN H1 H2 H3 H4 H5 H6 UL OL LI BLOCKQUOTE PRE CODE STRONG B EM I U S DEL BR HR A IMG TABLE THEAD TBODY TR TH TD SUP SUB DETAILS SUMMARY'.split(' '));
function cleanHtml(html){
 const doc=new DOMParser().parseFromString(html,'text/html');
 for(const node of Array.from(doc.body.querySelectorAll('*'))){
  if(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','LINK','META','SVG','MATH','FORM','INPUT','BUTTON'].includes(node.tagName)){node.remove();continue;}
  if(!allowed.has(node.tagName)){node.replaceWith(...Array.from(node.childNodes));continue;}
  for(const attr of Array.from(node.attributes))if(!['href','src','alt','colspan','rowspan','start'].includes(attr.name))node.removeAttribute(attr.name);
  if(node.tagName==='A'&&!/^(https?:|mailto:|#)/i.test(node.getAttribute('href')||''))node.removeAttribute('href');
  if(node.tagName==='IMG'&&!/^(data:image\/(?:png|jpeg|gif|webp);|bex-media:|blob:|https?:)/i.test(node.getAttribute('src')||''))node.removeAttribute('src');
  if(node.tagName==='DETAILS')node.setAttribute('open','');
 }
 return doc.body.innerHTML;
}
export function buildNotePrintHtml({title,pages,indices}){
 const chosen=[...new Set(indices||pages.map((_,i)=>i))].filter(i=>Number.isInteger(i)&&i>=0&&i<pages.length).sort((a,b)=>a-b),offsets=footnoteOffsets(pages);
 if(!chosen.length)throw new Error('Select at least one page to export.');
 const body=chosen.map(index=>{
  const raw=getPageBody(pages[index]),footnotes=extractFootnotes(raw,offsets[index]||0),doc=new DOMParser().parseFromString(numberFootnotesInHtml(raw,offsets[index]||0),'text/html'),asides=[];
  for(const el of Array.from(doc.querySelectorAll('[data-tooltip-text],[data-comment-text]'))){const text=el.getAttribute('data-tooltip-text')||el.getAttribute('data-comment-text');if(text&&!asides.includes(text))asides.push(text);}
  return `<section><h2>${escape(getPageTitle(pages[index],pages.length>1?`Page ${index+1}`:''))}</h2>${cleanHtml(doc.body.innerHTML)}${footnotes.length?`<ol class="footnotes">${footnotes.map(item=>`<li value="${item.number}">${cleanHtml(item.text)}</li>`).join('')}</ol>`:''}${asides.length?`<aside><h3>Annotations</h3>${asides.map(text=>cleanHtml(text)).join('')}</aside>`:''}</section>`;
 }).join('');
 return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:"><title>${escape(title||'Note')}</title><style>@page{size:A4;margin:18mm}*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#15171b;font-size:11pt;line-height:1.6}h1{font-size:24pt}h2{font-size:18pt}h3{font-size:14pt}h1,h2,h3,h4,summary{break-after:avoid}p{orphans:3;widows:3}section+section{break-before:page}img{max-width:100%;height:auto;max-height:235mm;object-fit:contain}table{border-collapse:collapse;width:100%;table-layout:fixed}td,th{border:1px solid #aab0b8;padding:5pt;overflow-wrap:anywhere}thead{display:table-header-group}tr,img{break-inside:avoid}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f4f6;padding:10pt}blockquote{border-left:3pt solid #b8a3d1;padding-left:12pt;margin-left:0}.footnotes,aside{border-top:1px solid #bbb;padding-top:10pt;font-size:9pt}a{color:#375b99}hr{border:0;border-top:1px solid #bbb}summary{font-weight:600}</style></head><body><h1>${escape(title||'Untitled Note')}</h1>${body}</body></html>`;
}
export async function exportNotePdf({title,pages,indices=undefined,destination=undefined,onProgress=(_message)=>{}}){
 const desktop=/** @type {Window & {bexDesktop?: {isDesktop?:boolean,readPdfImage?:(payload:{source:string})=>Promise<any>,renderNotePdf?:(payload:{html:string})=>Promise<any>}}} */ (window).bexDesktop;
 if(desktop?.isDesktop&&!desktop.renderNotePdf)throw new Error('Restart BEX to finish loading PDF export.');
 onProgress('Preparing PDF…');
 const doc=new DOMParser().parseFromString(buildNotePrintHtml({title,pages,indices}),'text/html');
 const images=Array.from(doc.querySelectorAll('img[src]'));
 for(const [index,image] of images.entries()){
  onProgress(`Preparing PDF images (${index+1} of ${images.length})…`);
  const source=image.getAttribute('src');
  if(source.startsWith('data:'))continue;
  // Native reads also handle remote images without requiring a site's CORS
  // headers. Keep the print window itself isolated and entirely self-contained.
  if(desktop?.readPdfImage && /^(https?:|bex-media:)/i.test(source)){
   const result=await desktop.readPdfImage({source});
   if(!result?.ok)throw new Error(result?.error||'An image could not be loaded for PDF export.');
   image.setAttribute('src',result.dataUrl);continue;
  }
  const resolved=await resolveMediaSource(source),response=await fetch(resolved,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('An image could not be loaded for PDF export.');
  const blob=await response.blob();if(!blob.type.startsWith('image/'))throw new Error('An image has an unsupported format.');
  const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});image.setAttribute('src',String(data));
 }
 onProgress('Creating PDF…');
 const html='<!doctype html>'+doc.documentElement.outerHTML;
 if(desktop?.renderNotePdf){const result=await desktop.renderNotePdf({html});if(!result?.ok)throw new Error(result?.error||'PDF creation failed.');const suffix=indices?.length===1?`-page-${indices[0]+1}`:indices?.length?'-pages':'';onProgress('Saving PDF…');return saveExportFile(new Blob([result.bytes],{type:'application/pdf'}),`${sanitizeFileName(title||'note')}${suffix}.pdf`,destination);}
 const frame=document.createElement('iframe');frame.style.cssText='position:fixed;left:-10000px;width:800px;height:1100px';frame.srcdoc=html;document.body.append(frame);await new Promise(resolve=>{frame.onload=resolve;});frame.contentWindow.focus();frame.contentWindow.print();setTimeout(()=>frame.remove(),60000);return {status:'started'};
}
