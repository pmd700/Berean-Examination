const BIBLES=new Set(['317e03834065a236-01','b8ee27bcd1cae43a-01','a761ca71e0b3ddcf-01','de4e12af7f28f599-02']);
const fail=(status,code)=>{throw Object.assign(new Error(code),{status,code});};
async function readBoundedJson(response,limit=1024*1024){
 const reader=response.body.getReader(),parts=[];let length=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit){await reader.cancel();fail(502,'SCRIPTURE_RESPONSE_TOO_LARGE');}parts.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
export async function brokerScripture(request,env,device,{fetcher=globalThis.fetch.bind(globalThis),sha256}={}){
 if(!env.SCRIPTURE_API_KEY||env.SCRIPTURE_VAULT_ID!==device.vault_id)fail(503,'SCRIPTURE_NOT_CONNECTED');
 const url=new URL(request.url),day=new Date().toISOString().slice(0,10),month=day.slice(0,7);
 if(url.pathname==='/api/scripture/chapter'&&request.method==='GET'){
  const bible=url.searchParams.get('bible'),chapter=url.searchParams.get('chapter');
  if(!BIBLES.has(bible)||!(/^[A-Z0-9]{3,8}\.[1-9]\d{0,2}$/).test(chapter||''))fail(400,'INVALID_SCRIPTURE_REFERENCE');
  const budget=await env.DB.prepare('INSERT INTO scripture_budget(vault_id,month,used) VALUES(?,?,1) ON CONFLICT(vault_id,month) DO UPDATE SET used=used+1 WHERE used<1000 RETURNING used').bind(device.vault_id,month).first();
  if(!budget)fail(429,'SCRIPTURE_MONTHLY_LIMIT');
  const upstream=new URL(`https://rest.api.bible/v1/bibles/${encodeURIComponent(bible)}/chapters/${encodeURIComponent(chapter)}`);
  for(const [key,value]of Object.entries({'content-type':'json','include-notes':'true','include-titles':'true','include-chapter-numbers':'false','include-verse-numbers':'true','include-verse-spans':'true','fums-version':'3'}))upstream.searchParams.set(key,value);
  let response;
  try{response=await fetcher(upstream,{headers:{'api-key':env.SCRIPTURE_API_KEY,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(8000)});}catch{fail(502,'SCRIPTURE_PROVIDER_CONNECTION');}
  if(!response.ok)fail(response.status===429?429:502,'SCRIPTURE_PROVIDER_UNAVAILABLE');
  let data;try{data=await readBoundedJson(response);}catch(error){if(error.status)throw error;fail(502,'SCRIPTURE_RESPONSE_INVALID');}
  if(!data.data||typeof data.data.copyright!=='string'||typeof data.meta?.fumsToken!=='string'||data.meta.fumsToken.length>8192)fail(502,'SCRIPTURE_RESPONSE_INVALID');
  return {data:data.data,meta:{fumsToken:data.meta.fumsToken},fetchedAt:Date.now()};
 }
 if(url.pathname==='/api/scripture/view'&&request.method==='POST'){
  if(Number(request.headers.get('Content-Length'))>12000)fail(413,'PAYLOAD_TOO_LARGE');
  const report=await readBoundedJson(new Response(request.body),12000);
  if(typeof report.token!=='string'||report.token.length>8192||!(/^[a-f0-9-]{36}$/).test(report.sessionId||'')||!(/^[a-f0-9-]{36}$/).test(report.id||''))fail(400,'INVALID_SCRIPTURE_VIEW');
  const prior=await env.DB.prepare('SELECT delivered FROM scripture_views WHERE vault_id=? AND device_id=? AND id=?').bind(device.vault_id,device.id,report.id).first();
  if(prior?.delivered)return {ok:true};
  const upstream=new URL('https://fums.api.bible/f3');upstream.searchParams.set('t',report.token);upstream.searchParams.set('dId',await sha256(device.id));upstream.searchParams.set('sId',report.sessionId);
  const response=await fetcher(upstream,{redirect:'manual',signal:AbortSignal.timeout(8000)});
  if(!response.ok)fail(502,'SCRIPTURE_VIEW_PENDING');
  await env.DB.prepare('INSERT INTO scripture_views VALUES(?,?,?,1,?) ON CONFLICT(vault_id,device_id,id) DO UPDATE SET delivered=1').bind(device.vault_id,device.id,report.id,Date.now()).run();
  return {ok:true};
 }
 fail(404,'NOT_FOUND');
}
