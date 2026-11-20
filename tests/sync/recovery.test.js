import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteReplicaStore } from '../../desktop/sync/replica-store.cjs';
import { SyncReplica } from '../../shared/sync/replica.js';
import { randomSecret, importSyncKey } from '../../shared/sync/crypto.js';
import { recoverPendingOperations } from '../../shared/sync/recovery.js';

test('a newly paired device restores unsent work without reusing the old identity or losing concurrent Mac edits',async()=>{
 const key=await importSyncKey(randomSecret()),vaultId=crypto.randomUUID(),epoch=crypto.randomUUID();
 const stores=[1,2,3].map(slot=>new SqliteReplicaStore(':memory:',{vaultId,epoch,slot,deviceId:crypto.randomUUID()})),[mac,oldPhone,newPhone]=stores.map(store=>new SyncReplica(store,key));
 try{
  const initial=await mac.create('MindNote',{title:'Original',content:'<p>Original</p>'});await mac.acknowledge([initial.id]);await oldPhone.receive(stores[0].all(),{baseCursor:0,cursor:1});
  const phoneEdit=await oldPhone.change(initial.record,{...initial.payload,content:'<p>Phone unsent</p>'});
  await oldPhone.change(initial.record,{...phoneEdit.payload,content:'<p>Phone final unsent</p>'});
  const created=await oldPhone.create('MindNote',{title:'Phone new',content:'<p>Keep this</p>'});
  await mac.change(initial.record,{...initial.payload,content:'<p>Concurrent Mac</p>'});
  await newPhone.receive(stores[0].all(),{baseCursor:0,cursor:2});
  const options={source:stores[1].all(),sourceReplica:oldPhone,target:newPhone,putChunk:async()=>{}};
  const result=await recoverPendingOperations(options);assert.equal(result.recovered,3);
  assert.equal((await newPhone.record(initial.record)).status,'conflict');assert.equal((await newPhone.record(created.record)).versions[0].payload.content,'<p>Keep this</p>');
  assert.equal(stores[2].pendingCount(),3);assert(stores[2].pending().every(row=>row.id.startsWith(stores[2].meta().identity.deviceId+':')));
  assert.equal((await recoverPendingOperations(options)).alreadyImported,true);assert.equal(stores[2].pendingCount(),3);
  const another=await newPhone.create('MindNote',{title:'After recovery'});assert.notEqual(another.record.id,created.record.id);
  await assert.rejects(recoverPendingOperations({...options,target:oldPhone}),/newly paired/);
 }finally{stores.forEach(store=>store.close());}
});
test('recovery rejects a different Vault and corrupt ciphertext before changing the target',async()=>{
 const key=await importSyncKey(randomSecret()),identity=slot=>({vaultId:crypto.randomUUID(),epoch:crypto.randomUUID(),deviceId:crypto.randomUUID(),slot}),a=new SqliteReplicaStore(':memory:',identity(1)),b=new SqliteReplicaStore(':memory:',identity(2)),sourceReplica=new SyncReplica(a,key),target=new SyncReplica(b,key);
 try{await sourceReplica.create('Keyword',{title:'Private'});await assert.rejects(recoverPendingOperations({source:a.all(),sourceReplica,target,putChunk:async()=>{}}),/same Vault/);assert.equal(b.all().length,0);}finally{a.close();b.close();}
});
