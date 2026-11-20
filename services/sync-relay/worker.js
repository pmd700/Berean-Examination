import { brokerScripture } from './scripture.js';
const utf8 = new TextEncoder();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const fail = (status, code) => { throw Object.assign(new Error(code), { status, code }); };
export async function sha256(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', typeof value === 'string' ? utf8.encode(value) : value))].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
async function bounded(request, limit) {
  if (Number(request.headers.get('Content-Length')) > limit) fail(413, 'PAYLOAD_TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  let length = 0; const chunks = [];
  try { while (true) { const { value, done } = await reader.read(); if (done) break; length += value.byteLength; if (length > limit) { await reader.cancel(); fail(413, 'PAYLOAD_TOO_LARGE'); } chunks.push(value); } } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
const json = async (request, limit = 20000) => { try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bounded(request, limit))); } catch (error) { if (error.status) throw error; fail(400, 'INVALID_JSON'); } };
function response(body, status = 200) { return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }); }
function token(request) { const value = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9+/=_-]{40,100})$/)?.[1]; if (!value) fail(401, 'UNAUTHORIZED'); return value; }
async function auth(request, env) {
  const device = await env.DB.prepare('SELECT devices.*, libraries.epoch FROM devices JOIN libraries ON libraries.id=devices.vault_id WHERE token_hash=? AND revoked=0').bind(await sha256(token(request))).first();
  if (!device) fail(401, 'UNAUTHORIZED'); return device;
}
function descriptorValid(value) { return value && Array.isArray(value.chunks) && value.chunks.length > 0 && value.chunks.length <= 96 && value.chunks.every(hash => typeof hash === 'string' && digestPattern.test(hash)) && Number.isSafeInteger(value.bytes) && value.bytes > 0 && value.bytes <= 48 * 1024 * 1024 && digestPattern.test(value.digest); }
function shard(env, hash) { const shards = [env.BLOBS0, env.BLOBS1, env.BLOBS2, env.BLOBS3]; if (shards.some(Boolean) && !shards.every(Boolean)) fail(503, 'STORAGE_CONFIGURATION_INCOMPLETE'); return shards.every(Boolean) ? shards[parseInt(hash.slice(0, 8), 16) % 4] : env.DB; }
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.headers.has('Origin') && request.headers.get('Origin') !== url.origin) fail(403, 'ORIGIN_REJECTED');
      if (url.pathname === '/api/health' && request.method === 'GET') return response({ service: 'bex-sync', protocol: 1 });
      if (url.pathname === '/api/libraries' && request.method === 'POST') {
        if (!env.BOOTSTRAP_SECRET || await sha256(token(request)) !== await sha256(env.BOOTSTRAP_SECRET)) fail(401, 'UNAUTHORIZED');
        const data = await json(request);
        if (![data.vaultId, data.epoch, data.deviceId].every(id => uuid.test(id)) || !digestPattern.test(data.tokenHash) || !Number.isSafeInteger(data.slot) || data.slot < 1 || data.slot > 2097151) fail(400, 'INVALID_IDENTITY');
        await env.DB.batch([
          env.DB.prepare('INSERT INTO libraries VALUES(?,?,?)').bind(data.vaultId, data.epoch, Date.now()),
          env.DB.prepare('INSERT INTO devices(vault_id,id,token_hash,role,slot) VALUES(?,?,?,?,?)').bind(data.vaultId, data.deviceId, data.tokenHash, 'owner', data.slot),
        ]);
        return response({ ok: true }, 201);
      }
      if (url.pathname === '/api/pair/consume' && request.method === 'POST') {
        const data = await json(request);
        if (typeof data.ticket !== 'string' || !uuid.test(data.ticket)) fail(400, 'INVALID_TICKET');
        const proof = await sha256(token(request));
        const invite = await env.DB.prepare('UPDATE invitations SET consumed=1 WHERE ticket=? AND proof_hash=? AND consumed=0 AND expires>? RETURNING bundle').bind(data.ticket, proof, Date.now()).first();
        if (!invite) fail(401, 'PAIRING_EXPIRED'); return response({ bundle: JSON.parse(invite.bundle) });
      }
      if (!url.pathname.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(request) : response({ error: 'NOT_FOUND' }, 404);
      const device = await auth(request, env);
      if(url.pathname.startsWith('/api/scripture/'))return response(await brokerScripture(request,env,device,{sha256}));
      if(url.pathname==='/api/receipts'&&request.method==='POST'){
        const data=await json(request,6000),envelope=data.envelope;
        if(envelope?.format!==1||typeof envelope.iv!=='string'||typeof envelope.ciphertext!=='string'||Object.keys(envelope).sort().join(',')!=='ciphertext,format,iv')fail(400,'INVALID_RECEIPT');
        await env.DB.prepare('INSERT INTO receipts VALUES(?,?,?,?) ON CONFLICT(vault_id,device_id) DO UPDATE SET envelope=excluded.envelope,updated_at=excluded.updated_at').bind(device.vault_id,device.id,JSON.stringify(envelope),Date.now()).run();return response({ok:true});
      }
      if(url.pathname==='/api/receipts'&&request.method==='GET'){
        if(device.role!=='owner')fail(403,'OWNER_REQUIRED');
        const rows=(await env.DB.prepare('SELECT device_id,envelope,updated_at FROM receipts WHERE vault_id=?').bind(device.vault_id).all()).results;
        return response({receipts:rows.map(row=>({deviceId:row.device_id,envelope:JSON.parse(row.envelope),updatedAt:row.updated_at}))});
      }
      if (url.pathname === '/api/status') {
        const count = await env.DB.prepare('SELECT COUNT(*) AS count, COALESCE(MAX(cursor),0) AS cursor FROM operations WHERE vault_id=?').bind(device.vault_id).first();
        return response({ ...count, vaultId: device.vault_id, epoch: device.epoch, slot: device.slot, deviceId: device.id });
      }
      if(url.pathname==='/api/capacity'&&request.method==='GET'){
        const shards=[env.BLOBS0,env.BLOBS1,env.BLOBS2,env.BLOBS3];if(shards.some(Boolean)&&!shards.every(Boolean))fail(503,'STORAGE_CONFIGURATION_INCOMPLETE');
        const stores=[env.DB,...(shards.every(Boolean)?shards:[])],capacity=[];
        for(const store of stores){const row=await store.prepare('SELECT bytes FROM capacity WHERE id=1').first();capacity.push({used:Number(row?.bytes||0),limit:400000000});}
        return response({stores:capacity,used:capacity.reduce((sum,row)=>sum+row.used,0),limit:capacity.length*400000000,billingUpgradeEnabled:false});
      }
      if (url.pathname === '/api/devices' && request.method === 'GET') {
        if (device.role !== 'owner') fail(403, 'OWNER_REQUIRED');
        return response({ devices: (await env.DB.prepare('SELECT id,slot,revoked FROM devices WHERE vault_id=?').bind(device.vault_id).all()).results });
      }
      if (url.pathname === '/api/devices/revoke' && request.method === 'POST') {
        if (device.role !== 'owner') fail(403, 'OWNER_REQUIRED');
        const data = await json(request);
        if (!uuid.test(data.deviceId) || data.deviceId === device.id) fail(400, 'INVALID_DEVICE');
        await env.DB.prepare('UPDATE devices SET revoked=1 WHERE vault_id=? AND id=?').bind(device.vault_id, data.deviceId).run();
        await env.DB.prepare('UPDATE invitations SET consumed=1 WHERE vault_id=?').bind(device.vault_id).run();
        return response({ ok: true });
      }
      if (url.pathname === '/api/pair' && request.method === 'POST') {
        if (device.role !== 'owner') fail(403, 'OWNER_REQUIRED');
        const data = await json(request);
        if (!uuid.test(data.ticket) || !uuid.test(data.deviceId) || !digestPattern.test(data.proofHash) || !digestPattern.test(data.tokenHash) || !Number.isSafeInteger(data.slot) || data.slot < 1 || data.slot > 2097151 || JSON.stringify(data.bundle).length > 10000) fail(400, 'INVALID_PAIRING');
        await env.DB.batch([
          env.DB.prepare('INSERT INTO devices(vault_id,id,token_hash,role,slot) VALUES(?,?,?,?,?)').bind(device.vault_id, data.deviceId, data.tokenHash, 'device', data.slot),
          env.DB.prepare('INSERT INTO invitations VALUES(?,?,?,?,?,0)').bind(data.ticket, device.vault_id, data.proofHash, JSON.stringify(data.bundle), Date.now() + 600000),
        ]);
        return response({ ok: true, expiresIn: 600 }, 201);
      }
      const blob = url.pathname.match(/^\/api\/blobs\/([a-f0-9]{64})$/);
      if (blob) {
        const hash = blob[1], db = shard(env, hash);
        if (request.method === 'PUT') {
          const bytes = await bounded(request, 512 * 1024);
          if (!bytes.length || await sha256(bytes) !== hash) fail(400, 'CHUNK_DIGEST_MISMATCH');
          await db.prepare('INSERT OR IGNORE INTO blobs VALUES(?,?,?)').bind(device.vault_id, hash, bytes.buffer).run();
          return response({ ok: true });
        }
        if (request.method === 'GET') {
          const row = await db.prepare('SELECT bytes FROM blobs WHERE vault_id=? AND hash=?').bind(device.vault_id, hash).first();
          if (!row) fail(404, 'CHUNK_NOT_FOUND');
          return new Response(new Uint8Array(row.bytes), { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
        }
      }
      if (url.pathname === '/api/operations' && request.method === 'POST') {
        const data = await json(request);
        if (typeof data.id !== 'string' || !data.id.startsWith(device.id + ':') || !/^[1-9]\d*$/.test(data.id.slice(device.id.length + 1)) || !Number.isSafeInteger(Number(data.id.slice(device.id.length + 1))) || !descriptorValid(data.descriptor)) fail(400, 'INVALID_OPERATION');
        const descriptor = JSON.stringify(data.descriptor), digest = await sha256(descriptor);
        const prior = await env.DB.prepare('SELECT digest FROM operations WHERE vault_id=? AND id=?').bind(device.vault_id, data.id).first();
        if (prior && prior.digest !== digest) fail(409, 'OPERATION_REPLAY_MISMATCH');
        if (!prior) await env.DB.prepare('INSERT INTO operations(vault_id,id,digest,descriptor) VALUES(?,?,?,?) ON CONFLICT(vault_id,id) DO UPDATE SET digest=CASE WHEN digest=excluded.digest THEN digest ELSE NULL END').bind(device.vault_id, data.id, digest, descriptor).run();
        return response({ ok: true, id: data.id });
      }
      if (url.pathname === '/api/operations' && request.method === 'GET') {
        const cursor = Number(url.searchParams.get('cursor') || 0);
        if (!Number.isSafeInteger(cursor) || cursor < 0) fail(400, 'INVALID_CURSOR');
        const result = await env.DB.prepare('SELECT cursor,id,descriptor FROM operations WHERE vault_id=? AND cursor>? ORDER BY cursor LIMIT 16').bind(device.vault_id, cursor).all();
        return response({ operations: result.results.map(row => ({ id: row.id, descriptor: JSON.parse(row.descriptor) })), cursor: result.results.at(-1)?.cursor ?? cursor, hasMore: result.results.length === 16 });
      }
      return response({ error: 'NOT_FOUND' }, 404);
    } catch (error) {
      if(!error.status)console.error(JSON.stringify({event:'bex_relay_failure',area:url.pathname.startsWith('/api/scripture/')?'scripture':'sync',type:error.name||'Error'}));
      const code = error.status ? error.code : String(error.message).includes('BEX_CAPACITY') ? 'CAPACITY_REACHED' : 'SERVICE_UNAVAILABLE';
      return response({ error: code }, error.status || (code === 'CAPACITY_REACHED' ? 507 : 503));
    }
  },
};
