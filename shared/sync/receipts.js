import { sealJson, openJson, hashBytes } from './crypto.js';
import { canonicalJson } from './protocol.js';
const purpose=(identity,device)=>`bex:sync:receipt:1:${identity.vaultId}:${identity.epoch}:${device}`;
export async function replicaReceipt(replica,identity,{availableFiles=0,totalFiles=0}={}) {
 const state=await replica.records(),meta=await replica.store.meta();
 const heads=state.records.map(record=>[record.key,record.versions.map(version=>version.id).sort()]).sort((a,b)=>a[0].localeCompare(b[0]));
 return {version:1,deviceId:identity.deviceId,cursor:meta.cursor,headsDigest:await hashBytes(new TextEncoder().encode(canonicalJson(heads))),records:state.records.filter(record=>record.status!=='deleted').length,pending:await replica.store.pendingCount(),availableFiles,totalFiles};
}
export async function publishReceipt(session) {
 session.replica.assertUnlocked();
 const files=(await session.replica.records()).records.filter(record=>record.record.kind==='VaultFile'&&record.status==='current');
 const receipt=await replicaReceipt(session.replica,session.identity,{availableFiles:files.filter(record=>session.downloadedManifests?.has(record.versions[0].id)).length,totalFiles:files.length});
 const serialized=canonicalJson(receipt);if(serialized===session.lastReceipt&&Date.now()-(session.lastReceiptTime||0)<300000)return;
 const envelope=await sealJson(session.replica.key,receipt,purpose(session.identity,session.identity.deviceId));
 session.replica.assertUnlocked();await session.relay.request('/api/receipts',{method:'POST',body:{envelope}});session.lastReceipt=serialized;session.lastReceiptTime=Date.now();
}
export async function readReceipts(replica,identity,relay) {
 const local=await replicaReceipt(replica,identity),result=await relay.request('/api/receipts'),receipts=[];
 for(const row of result.receipts){const value=await openJson(replica.key,row.envelope,purpose(identity,row.deviceId));if(value.version!==1||value.deviceId!==row.deviceId)throw new Error('Invalid encrypted device receipt.');receipts.push({...value,receivedAt:row.updatedAt,matchesCurrentHeads:value.headsDigest===local.headsDigest});}
 return receipts;
}
