import { convertApiBibleContentToBlocks } from '../../../src/lib/apiBibleToStudyBlocks';
import { parseScriptureQuery } from '../../../src/lib/scriptureReferences';
import { sealJson,openJson } from '../../../shared/sync/crypto';
const cache=new Map(),TTL=14*24*60*60*1000;
const purpose=(session,id)=>`bex:scripture:view:1:${session.identity.vaultId}:${session.identity.epoch}:${session.identity.deviceId}:${id}`;
export function clearScripture(){cache.clear();}
export async function readOnlineStudy(value,session){
 session.replica.assertUnlocked();
 const bible=value.api_bible_id||value.version.slice(4),reference=parseScriptureQuery(`${value.book} ${value.chapter_number}`).requests[0];
 if(!reference)throw new Error('The exact Scripture chapter could not be located.');
 const key=JSON.stringify([bible,reference.id]);let result=cache.get(key);
 if(result&&Date.now()-result.fetchedAt>TTL){cache.delete(key);result=null;}
 if(!result){
  try{result=await session.relay.request(`/api/scripture/chapter?bible=${encodeURIComponent(bible)}&chapter=${encodeURIComponent(reference.id)}`);}
  catch(error){if(error.code==='SCRIPTURE_NOT_CONNECTED')throw new Error('Online Bible access is being connected. Your writing and exact edition references remain saved.');throw error;}
  const blocks=convertApiBibleContentToBlocks(result.data),verseCount=blocks.filter(block=>block.type==='verse').length;
  if(verseCount>0&&verseCount<=499){
   let count=verseCount;for(const [other,entry]of cache){if(entry.bible!==bible)continue;if(Date.now()-entry.fetchedAt>TTL||count+entry.verseCount>499)cache.delete(other);else count+=entry.verseCount;}
   cache.set(key,{...result,bible,verseCount});
  }
 }
 session.replica.assertUnlocked();
 const id=crypto.randomUUID(),report={id,token:result.meta.fumsToken,sessionId:session.scriptureSessionId||(session.scriptureSessionId=crypto.randomUUID())};
 await session.blobs.put(`scripture-view:${id}`,await sealJson(session.replica.key,report,purpose(session,id)));
 void flushScriptureViews(session).catch(()=>{});
 return {blocks:convertApiBibleContentToBlocks(result.data),notice:result.data.copyright,data:result.data,meta:result.meta};
}
export async function flushScriptureViews(session){
 if(session.reportingViews)return session.reportingViews;
 const operation=(async()=>{for(const key of await session.blobs.keys('scripture-view:')){session.replica.assertUnlocked();const id=key.slice('scripture-view:'.length),row=await session.blobs.get(key),report=await openJson(session.replica.key,row,purpose(session,id));await session.relay.request('/api/scripture/view',{method:'POST',body:report});session.replica.assertUnlocked();await session.blobs.delete(key);}})().finally(()=>{session.reportingViews=null;});
 session.reportingViews=operation;return operation;
}
