import test from 'node:test';import assert from 'node:assert/strict';import {RelayClient} from '../../shared/sync/relay-client.js';
test('browser fetch keeps its global receiver and transient chunk failures retry without replaying pairing',async()=>{
 let calls=0;const client=new RelayClient('https://synthetic.invalid','x'.repeat(44),function(){assert.equal(this,globalThis);calls++;return Promise.resolve(calls===1?Response.json({error:'TEMPORARY'},{status:503}):Response.json({ok:true}));});
 assert.equal((await client.request('/api/blobs/'+'a'.repeat(64),{method:'PUT',body:new Uint8Array([1]),binary:true})).ok,true);assert.equal(calls,2);
 let consumed=0;const pairing=new RelayClient('https://synthetic.invalid','x'.repeat(44),function(){consumed++;return Promise.resolve(Response.json({error:'TEMPORARY'},{status:503}));});await assert.rejects(pairing.request('/api/pair/consume',{method:'POST',body:{}}));assert.equal(consumed,1);
});
