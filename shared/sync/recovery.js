import { canonicalJson, createOperation, recordKey } from './protocol.js';
import { hashBytes, sealJson, openJson, operationPurpose } from './crypto.js';
import { reconcileOperations } from './reconcile.js';
import { hexDigest } from './relay-client.js';

// Restore an old device's unsent work through a newly paired identity. Never
// reuse its sequence or numeric allocation range, even if the old phone returns.
export async function recoverPendingOperations({source,sourceReplica,target,putChunk,chunks={}}) {
  const sourceMeta=await sourceReplica.store.meta(),targetMeta=await target.store.meta();
  if(sourceMeta.identity.vaultId!==targetMeta.identity.vaultId||sourceMeta.identity.epoch!==targetMeta.identity.epoch)throw new Error('Pair with the same Vault before importing this recovery copy.');
  if(sourceMeta.identity.deviceId===targetMeta.identity.deviceId)throw new Error('Restore a recovery copy on a newly paired device. Your current library remains unchanged.');
  // The same logical Vault must also use the same epoch key.
  await openJson(target.key,await sealJson(sourceReplica.key,{recovery:true},'bex:sync:recovery-key-check:1'),'bex:sync:recovery-key-check:1');
  const fingerprint=await hashBytes(new TextEncoder().encode(canonicalJson(source,256*1024*1024)));
  if(targetMeta.recoveryImports?.includes(fingerprint))return {alreadyImported:true,recovered:0};
  const decoded=[];
  for(const row of source){sourceReplica.assertUnlocked();decoded.push({...row,operation:await sourceReplica.decode(row,sourceMeta.identity)});}
  reconcileOperations({...sourceMeta.identity,operations:decoded.map(row=>row.operation)});
  const pending=decoded.filter(row=>row.pending===1).sort((a,b)=>a.operation.sequence-b.operation.sequence);
  if(pending.some(row=>row.operation.deviceId!==sourceMeta.identity.deviceId))throw new Error('Recovery contains an invalid outgoing device identity.');
  const pendingIds=new Set(pending.map(row=>row.id));
  if(decoded.some(row=>!row.pending&&row.operation.parents.some(id=>pendingIds.has(id))))throw new Error('Recovery acknowledgements are inconsistent. The original copy was preserved.');
  // Verify every pending file before any restored operation becomes visible.
  for(const row of pending){const op=row.operation;if(op.record.kind!=='VaultFile'||op.action!=='put')continue;for(const hash of op.payload.chunks){const bytes=chunks[hash];if(!bytes||await hexDigest(bytes)!==hash)throw new Error('A pending file in the recovery copy is incomplete.');await putChunk(hash,bytes);}}
  const known=decoded.filter(row=>!row.pending).map(({operation,...row})=>row);
  for(let index=0;index<known.length;index+=32){const meta=await target.store.meta();await target.receive(known.slice(index,index+32),{baseCursor:meta.cursor,cursor:meta.cursor});}
  for(let attempt=0;attempt<20;attempt++){
    const meta=await target.store.meta();if(meta.recoveryImports?.includes(fingerprint))return {alreadyImported:true,recovered:0};
    const mapping=new Map(pending.map((row,index)=>[row.id,`${meta.identity.deviceId}:${meta.sequence+index+1}`])),rows=[];
    for(let index=0;index<pending.length;index++){
      const previous=pending[index].operation;
      const op=createOperation({...meta.identity,sequence:meta.sequence+index+1,record:previous.record,parents:previous.parents.map(id=>mapping.get(id)||id),action:previous.action,payload:previous.payload});
      rows.push({id:op.id,key:await hashBytes(new TextEncoder().encode(recordKey(op.record))),envelope:await sealJson(target.key,op,operationPurpose(meta.identity,op.id)),pending:1});
    }
    target.assertUnlocked();
    if(await target.store.commit(meta.version,{rows,sequence:meta.sequence+pending.length,recoveryImports:[...(meta.recoveryImports||[]),fingerprint]}))return {recovered:pending.length,alreadyImported:false};
  }
  throw new Error('Recovery is busy. Retry with the original copy; existing work was preserved.');
}
