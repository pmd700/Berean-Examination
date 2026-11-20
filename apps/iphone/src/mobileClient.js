import { installScriptureBackend } from '../../../src/lib/scriptureClient';
import { installLocalBibleBackend } from '../../../src/lib/localBible';
import { readOnlineStudy } from './scripture';
import { readPhoneChapter } from './bible';
import { USFM_BOOKS } from '../../../src/lib/scriptureReferences';
import { installLocalEntityBackend, localEntities } from '../../../src/lib/localEntities';
import { decryptIncomingWithKey, decryptString, encryptJson, PRIVATE_FIELDS, getActiveEncryption } from '../../../src/lib/webCrypto';
import { importFile } from '../../../shared/sync/files.js';
import { ENTITY_TABLES } from '../../../shared/sync/catalog.js';
import { publishNoteChange } from '../../../src/lib/noteChanges.js';
let session = null;
export function setMobileSession(value) { session = value; }
export function getMobileSession() { if (!session) throw new Error('Unlock your BEX library first.'); return session; }
export async function decodeMobileRecord(kind,value) {
  const current=getMobileSession(),webId=value.web_id||(kind==='KnowledgeWeb'?value.id:null),active=getActiveEncryption(),key=current.webKeys?.get(webId)||(active?.webId===webId?active.key:null);if(key)current.webKeys.set(webId,key);
  if (kind==='KnowledgeWeb' && value.is_private && key && value.enc_name) return {...value,title:await decryptString(key,value.enc_name)};
  return key ? decryptIncomingWithKey(kind,value,key) : value;
}
export async function encodeMobileRecord(kind,value) {
  if (!PRIVATE_FIELDS[kind]) return value;
  const current=getMobileSession();
  const parent=value.web_id?await current.replica.record({kind:'KnowledgeWeb',id:String(value.web_id)}):null;
  if (!value.enc_payload && !parent?.versions[0].payload.is_private) return value;
  const active=getActiveEncryption(),key=current.webKeys?.get(value.web_id)||(active?.webId===value.web_id?active.key:null);
  if (!key) throw new Error('Unlock this private Knowledge Web before editing its contents.');
  const sensitive={}, result={...value};
  for (const field of PRIVATE_FIELDS[kind]) if (Object.hasOwn(value,field)) { sensitive[field]=value[field];result[field]=Array.isArray(value[field])?[]:typeof value[field]==='string'?'':null; }
  result.enc_payload=await encryptJson(key,sensitive);return result;
}
const methods = kind => ({
  async list(sort = '-updated_date', limit = 5000) {
    const { records } = await getMobileSession().replica.records();
    let results = records.filter(record => record.record.kind === kind && record.status === 'current').map(record => record.versions[0].payload);
    const field = sort.replace(/^-/, ''), direction = sort.startsWith('-') ? -1 : 1;
    results.sort((a,b)=>(typeof a[field]==='number'&&typeof b[field]==='number'?a[field]-b[field]:String(a[field]||'').localeCompare(String(b[field]||'')))*direction);
    return Promise.all(results.slice(0, limit).map(value=>decodeMobileRecord(kind,value)));
  },
  async filter(filter,sort,limit=5000) { return (await this.list(sort,1000000)).filter(record => Object.entries(filter).every(([key,value]) => record[key]===value)).slice(0,limit); },
  async get(id) {
    const record = await getMobileSession().replica.record({ kind, id: String(id) });
    if (!record || record.status === 'deleted') throw new Error('This item no longer exists.');
    if (record.status === 'conflict') throw new Error('Resolve the conflicting versions before editing this item.');
    return decodeMobileRecord(kind,record.versions[0].payload);
  },
  async create(payload) {
    const now = new Date().toISOString();
    const op = await getMobileSession().replica.create(kind, await encodeMobileRecord(kind,JSON.parse(JSON.stringify({ ...payload, created_date: now, updated_date: now }))));
    getMobileSession().changed(); return decodeMobileRecord(kind,op.payload);
  },
  async update(id, patch) {
    const record = await getMobileSession().replica.record({ kind, id: String(id) });
    if (!record || record.status !== 'current') throw new Error('This item changed or has a conflict. Reopen it before saving.');
    const op = await getMobileSession().replica.change(record.record, await encodeMobileRecord(kind,{ ...await decodeMobileRecord(kind,record.versions[0].payload), ...JSON.parse(JSON.stringify(patch)), id: Number(id), updated_date: new Date().toISOString() }), { baseParents: record.versions.map(op => op.id) });
    if (kind === 'MindNote') publishNoteChange({ operation: 'update', id: Number(id), record: op.payload, fields: Object.keys(patch) });
    getMobileSession().changed(); return decodeMobileRecord(kind,op.payload);
  },
  async delete(id) { const result = await getMobileSession().replica.change({ kind, id: String(id) }, null, { action: 'delete' }); getMobileSession().changed(); return result; },
});
const replicaEntities = Object.fromEntries(Object.keys(ENTITY_TABLES).map(kind => [kind, methods(kind)]));
export const desktopClient = {
  entities: localEntities,
  owner: {
    async exists(){return true;},
    async read() { const current=getMobileSession(),record=(await current.replica.records()).records.find(row=>row.record.kind==='OwnerProfile'&&row.status==='current'),value=record?.versions[0].payload||{};return {...JSON.parse(value.preferences_json||'{}'),...JSON.parse(localStorage.getItem('bex-phone-preferences')||'{}'),preferences:JSON.parse(value.preferences_json||'{}'),is_local_owner:true,id:value.owner_id||current.identity.deviceId,full_name:value.display_name||'BEX Library'}; },
    async updatePreferences(patch) { const device={},shared={};for(const [key,value]of Object.entries(patch))(/workspace|viewport|scroll|collapsed|keybind|last_activity|nav_position|kw_autofocus/.test(key)?device:shared)[key]=value;localStorage.setItem('bex-phone-preferences',JSON.stringify({...JSON.parse(localStorage.getItem('bex-phone-preferences')||'{}'),...device}));if(Object.keys(shared).length){const current=getMobileSession(),record=(await current.replica.records()).records.find(row=>row.record.kind==='OwnerProfile'&&row.status==='current');if(!record)throw new Error('Library preferences have not synchronized yet.');const value=record.versions[0].payload;await current.replica.change(record.record,{...value,preferences_json:JSON.stringify({...JSON.parse(value.preferences_json),...shared}),updated_at:new Date().toISOString()},{baseParents:record.versions.map(op=>op.id)});current.changed();}return this.read(); },
  },
  media: { async uploadFile({ file }) { const manifest = await importFile(file.name?file:new File([file],file.type==='image/png'?'Drawing preview.png':'Attachment.bin',{type:file.type}), getMobileSession()); return { file_url: manifest.url }; } },
  online: { async invoke() { throw new Error('This online service is not enabled on this device.'); } },
};

// Reuse the existing entity gateway and its mutation/export/save barriers.
// Only its storage transport differs on the phone.
export function installPhoneBackends() {
  installLocalBibleBackend({getLocalBibleChapter:async({version,book,chapter})=>({ok:true,chapter:{...await readPhoneChapter(version,book,chapter),version,book,chapter}})});
  const editions=[['317e03834065a236-01','BSB','Berean Standard Bible'],['b8ee27bcd1cae43a-01','NASB1995','New American Standard Bible 1995'],['a761ca71e0b3ddcf-01','NASB2020','New American Standard Bible 2020'],['de4e12af7f28f599-02','KJV','King James Version']].map(([id,abbreviation,name])=>({id,abbreviation,name,language:{id:'eng',name:'English'}}));
  installScriptureBackend({
    getScriptureCatalog:async()=>({ok:true,result:{data:editions,cached:true}}),
    getScriptureBooks:async()=>({ok:true,result:{data:Object.values(USFM_BOOKS).map(book=>({id:book.id,name:book.name})),cached:true}}),
    fetchScriptureContent:async({bibleId,type,id})=>{if(type!=='chapter')return {ok:false,error:'Open a complete chapter on this iPhone.'};const parts=id.split('.'),book=Object.values(USFM_BOOKS).find(book=>book.id===parts[0]);const result=await readOnlineStudy({version:`API:${bibleId}`,book:book?.name||parts[0],chapter_number:Number(parts[1])},getMobileSession());return {ok:true,result:{data:result.data,meta:result.meta,cached:false}};},
  });
  installLocalEntityBackend({
    listLocalEntities:async(kind,{filter={},sort='-updated_date',limit=5000,cursor=null}={})=>{let rows=await replicaEntities[kind].filter(filter,sort,1000000);if(cursor!==null)rows=rows.filter(row=>row.id>Number(cursor));return {ok:true,records:rows.slice(0,limit)};},
    getLocalEntity:async(kind,id)=>({ok:true,record:await replicaEntities[kind].get(id)}),
    createLocalEntity:async(kind,value)=>({ok:true,record:await replicaEntities[kind].create(value)}),
    updateLocalEntity:async(kind,id,patch)=>({ok:true,record:await replicaEntities[kind].update(id,patch)}),
    deleteLocalEntity:async(kind,id)=>{await replicaEntities[kind].delete(id);return {ok:true,result:{deleted:true}};},
    reorderLocalEntities:async(kind,ids,containerId)=>{const records=[];for(const [sort_order,id]of ids.entries())records.push(await replicaEntities[kind].update(id,{sort_order,folder_id:containerId}));return {ok:true,records};},
  });
}
export default desktopClient;
