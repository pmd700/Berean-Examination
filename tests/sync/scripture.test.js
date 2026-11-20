import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { brokerScripture } from '../../services/sync-relay/scripture.js';
import { sha256 } from '../../services/sync-relay/worker.js';

function fixture() {
  const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../../services/sync-relay/schema.sql',import.meta.url),'utf8'));
  const device={vault_id:crypto.randomUUID(),id:crypto.randomUUID()};
  const env={SCRIPTURE_API_KEY:'server-secret-only',SCRIPTURE_VAULT_ID:device.vault_id,DB:{prepare(sql){const statement=db.prepare(sql);let params=[];return {bind(...values){params=values;return this;},async first(){return statement.get(...params);},async run(){return statement.run(...params);}};}}};
  return {db,device,env};
}
test('Scripture broker restricts scope, exact editions, provider destinations and monthly usage',async()=>{
  const {db,device,env}=fixture();let calls=0;
  const fetcher=async(url,options)=>{calls++;assert.equal(url.origin,'https://rest.api.bible');assert.equal(url.pathname,'/v1/bibles/b8ee27bcd1cae43a-01/chapters/GEN.1');assert.equal(options.headers['api-key'],env.SCRIPTURE_API_KEY);assert.equal(options.redirect,'manual');return Response.json({data:{copyright:'Publisher notice',content:[]},meta:{fumsToken:'view-token'}});};
  const request=new Request('https://relay.example/api/scripture/chapter?bible=b8ee27bcd1cae43a-01&chapter=GEN.1');
  try {
    await assert.rejects(brokerScripture(request,env,{...device,vault_id:crypto.randomUUID()},{fetcher,sha256}),{code:'SCRIPTURE_NOT_CONNECTED'});
    await assert.rejects(brokerScripture(new Request('https://relay.example/api/scripture/chapter?bible=https://evil.example&chapter=GEN.1'),env,device,{fetcher,sha256}),{code:'INVALID_SCRIPTURE_REFERENCE'});
    assert.equal(calls,0);
    const result=await brokerScripture(request,env,device,{fetcher,sha256});assert.equal(result.data.copyright,'Publisher notice');assert.equal(JSON.stringify(result).includes(env.SCRIPTURE_API_KEY),false);
    db.prepare('UPDATE scripture_budget SET used=1000').run();
    await assert.rejects(brokerScripture(request,env,device,{fetcher,sha256}),{code:'SCRIPTURE_MONTHLY_LIMIT'});assert.equal(calls,1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM operations').get().n,0);
  }finally{db.close();}
});
test('anonymous Scripture reporting retries durably and acknowledges duplicate IDs without repeating delivery',async()=>{
  const {db,device,env}=fixture();const report={id:crypto.randomUUID(),sessionId:crypto.randomUUID(),token:'anonymous-view-token'};let calls=0;
  const request=()=>new Request('https://relay.example/api/scripture/view',{method:'POST',body:JSON.stringify(report)});
  const fetcher=async url=>{calls++;assert.equal(url.origin,'https://fums.api.bible');assert.equal(url.searchParams.get('t'),report.token);assert.equal(url.searchParams.get('dId'),await sha256(device.id));assert.equal(url.searchParams.has('uId'),false);return new Response(null,{status:calls===1?503:204});};
  try{
    await assert.rejects(brokerScripture(request(),env,device,{fetcher,sha256}),{code:'SCRIPTURE_VIEW_PENDING'});assert.equal(db.prepare('SELECT count(*) AS n FROM scripture_views').get().n,0);
    await brokerScripture(request(),env,device,{fetcher,sha256});await brokerScripture(request(),env,device,{fetcher,sha256});assert.equal(calls,2);assert.equal(db.prepare('SELECT count(*) AS n FROM scripture_views').get().n,1);
  }finally{db.close();}
});
