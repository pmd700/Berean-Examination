import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { getStudyExportRightsNotice } from '../src/lib/bibleStudyExportPolicy.js';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..');
export function iphoneBibleAssets() {
 return {name:'bex-phone-bibles',generateBundle(){
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'attached_assets/bibles/manifest.json'),'utf8')),translations=[];
  for(const edition of manifest.translations){
   const source=fs.readFileSync(path.join(root,'attached_assets/bibles',edition.file)),digest=crypto.createHash('sha256').update(source).digest('hex'),notice=getStudyExportRightsNotice({version:edition.code});
   if(digest!==edition.assetSha256||!notice)throw new Error('Unverified phone Bible source: '+edition.code);
   this.emitFile({type:'asset',fileName:`bibles/${edition.code}.json`,source});translations.push({code:edition.code,title:edition.title,sha256:digest,notice});
  }
  const {buildLsvIndex}=require('../desktop/local-bible.cjs'),index=buildLsvIndex(fs.readFileSync(path.join(root,'attached_assets/lsv_1775867344760.txt'),'utf8'));
  const source=JSON.stringify({schemaVersion:1,code:'LSV',chapters:Object.fromEntries(index)}),notice=getStudyExportRightsNotice({version:'LSV'});
  if(!notice)throw new Error('LSV attribution is missing');this.emitFile({type:'asset',fileName:'bibles/LSV.json',source});translations.push({code:'LSV',title:'Literal Standard Version',sha256:crypto.createHash('sha256').update(source).digest('hex'),notice});
  this.emitFile({type:'asset',fileName:'bibles/catalog.json',source:JSON.stringify({version:1,translations})});
 }};
}
