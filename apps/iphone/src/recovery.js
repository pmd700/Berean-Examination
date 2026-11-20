import { toBase64 } from '../../../shared/sync/crypto';
import { enrollment } from './enrollment';
export async function exportPhoneRecovery(session) {
  session.replica.assertUnlocked();
  const rows=await session.store.all(),state=await session.replica.records(),pendingIds=new Set((await session.store.pending(1000000)).map(row=>row.id)),hashes=new Set();
  for(const op of state.operations)if(pendingIds.has(op.id)&&op.record.kind==='VaultFile'&&op.action==='put')for(const hash of op.payload.chunks)hashes.add(hash);
  const chunks={};for(const hash of hashes){session.replica.assertUnlocked();const bytes=await session.blobs.get(hash);if(!bytes)throw new Error('A pending file is incomplete. Existing local data was preserved.');chunks[hash]=toBase64(bytes);}
  const file={format:'bex-phone-recovery-1',createdAt:new Date().toISOString(),wrapped:await enrollment(),meta:await session.store.meta(),operations:rows,chunks};
  session.replica.assertUnlocked();
  const blob=new Blob([JSON.stringify(file)],{type:'application/json'}),name=`BEX-encrypted-recovery-${new Date().toISOString().slice(0,10)}.json`;
  if(navigator.canShare?.({files:[new File([blob],name,{type:blob.type})]})){await navigator.share({files:[new File([blob],name,{type:blob.type})],title:'BEX encrypted recovery copy'});return;}
  const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
