import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {PhoneSyncSession} from '../../apps/iphone/src/syncSession.js';import {SyncReplica} from '../../shared/sync/replica.js';import {importSyncKey,randomSecret} from '../../shared/sync/crypto.js';
const {SqliteReplicaStore}=createRequire(import.meta.url)('../../desktop/sync/replica-store.cjs');
test('a note created during a long attachment download uploads immediately and the live queue stays accurate',async()=>{
 const identity={vaultId:crypto.randomUUID(),epoch:crypto.randomUUID(),deviceId:crypto.randomUUID(),slot:2},store=new SqliteReplicaStore(':memory:',identity),replica=new SyncReplica(store,await importSyncKey(randomSecret()));
 const sent=[];let release,started=false;const download=new Promise(resolve=>{release=resolve;});
 const session={identity,store,replica,relay:{async request(){return identity;},async push(row){sent.push(row.id);},async pull(cursor){return {operations:[],cursor,hasMore:false};}},blobs:{}};
 const statuses=[],coordinator=new PhoneSyncSession(session,{download:async()=>{started=true;await download;},status:value=>statuses.push(value)});
 try{await coordinator.sync();assert.equal(started,true);assert.ok(coordinator.hydration);const op=await replica.create('MindNote',{title:'Written while files download',content:'<p>Durable</p>'});assert.equal(store.pendingCount(),1);await coordinator.sync();assert.deepEqual(sent,[op.id]);assert.equal(store.pendingCount(),0);assert.ok(coordinator.hydration);assert.equal(statuses.at(-1),'Up to date with your encrypted mailbox');release();await coordinator.hydration;}finally{coordinator.close();store.close();}
});
test('offline saves report the entire durable queue without starting network retries',async()=>{
 const identity={vaultId:crypto.randomUUID(),epoch:crypto.randomUUID(),deviceId:crypto.randomUUID(),slot:2},store=new SqliteReplicaStore(':memory:',identity),replica=new SyncReplica(store,await importSyncKey(randomSecret()));let status;
 const coordinator=new PhoneSyncSession({identity,store,replica,relay:{request(){throw new Error('Offline network call');}}},{canSync:()=>false,status:value=>{status=value;}});
 try{for(let index=0;index<20;index++)await replica.create('MindNote',{title:`Offline ${index}`});await coordinator.sync();assert.equal(status,'Offline · 20 changes saved locally');assert.equal(store.pendingCount(),20);}finally{coordinator.close();store.close();}
});
