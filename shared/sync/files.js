import { sha256 } from '@noble/hashes/sha2.js';
import { assertVaultRelativePath } from './catalog.js';
import { sealBytes, openBytes, fromBase64, toBase64 } from './crypto.js';
import { hexDigest } from './relay-client.js';
export const FILE_CHUNK_BYTES = 256 * 1024;
const purpose = (identity, digest, index) => `bex:sync:file:1:${identity.vaultId}:${identity.epoch}:${digest}:${index}`;
export async function encodeFileChunk(key, bytes, identity, digest, index) {
  const envelope = await sealBytes(key, bytes, purpose(identity, digest, index));
  const iv = fromBase64(envelope.iv), cipher = fromBase64(envelope.ciphertext);
  const packed = new Uint8Array(13 + cipher.length); packed[0] = 1; packed.set(iv, 1); packed.set(cipher, 13);
  return { hash: await hexDigest(packed), bytes: packed };
}
export async function decodeFileChunk(key, bytes, identity, digest, index) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 29 || bytes.length > FILE_CHUNK_BYTES + 29 || bytes[0] !== 1) throw new TypeError('Invalid encrypted file chunk.');
  return openBytes(key, { format: 1, iv: toBase64(bytes.subarray(1, 13)), ciphertext: toBase64(bytes.subarray(13)) }, purpose(identity, digest, index));
}
export function validateFileManifest(value) {
  if (!value || value.version !== 1 || !Number.isSafeInteger(value.size) || value.size < 0 || value.size > 2 * 1024 ** 3 || !/^[a-f0-9]{64}$/.test(value.digest) || !Array.isArray(value.chunks) || value.chunks.length !== Math.ceil(value.size / FILE_CHUNK_BYTES) || value.chunks.some(hash => !/^[a-f0-9]{64}$/.test(hash))) throw new TypeError('Invalid file manifest.');
  assertVaultRelativePath(value.path); return value;
}
export async function cacheFile(manifest, store, relay, progress = () => {}) {
  validateFileManifest(manifest);
  let completed=0;
  // Four bounded ciphertext requests keep high-latency phone connections busy
  // without buffering a whole attachment or flooding IndexedDB transactions.
  for(let offset=0;offset<manifest.chunks.length;offset+=4){
    await Promise.all(manifest.chunks.slice(offset,offset+4).map(async hash=>{
      if(!(store.has?await store.has(hash):await store.get(hash))){
        const bytes=await relay.request(`/api/blobs/${hash}`,{binary:true});
        if(bytes.length>FILE_CHUNK_BYTES+29||await hexDigest(bytes)!==hash)throw new Error('An encrypted file failed its integrity check.');
        await store.put(hash,bytes);
      }
      progress({completed:++completed,total:manifest.chunks.length});
    }));
  }

}
export async function fileBlob(manifest, store, key, identity, assertUnlocked = () => {}) {
  validateFileManifest(manifest); const chunks = []; let size = 0;
  for (const [index, hash] of manifest.chunks.entries()) {
    assertUnlocked();
    const bytes = await store.get(hash);
    if (!bytes || await hexDigest(bytes) !== hash) throw new Error('This file is not fully available offline yet.');
    const plain = await decodeFileChunk(key, bytes, identity, manifest.digest, index);
    assertUnlocked();
    chunks.push(plain); size += plain.length;
  }
  if (size !== manifest.size) throw new Error('The file is incomplete.');
  const blob = new Blob(chunks, { type: manifest.mimeType || 'application/octet-stream' });
  // Individual chunks are authenticated and bind the content digest/index.
  // A full digest is additionally checked by streaming native adapters before
  // a desktop file is installed or an encrypted manifest is first published.
  return blob;
}

// Upload file bytes before making their manifest visible. The acknowledgement
// is durable so a suspended phone resumes without uploading completed chunks.
export async function pushFileOperation(row, replica, store, relay, progress = () => {}) {
  const { identity } = await replica.store.meta();
  const op = await replica.decode(row, identity);
  if (op.record.kind !== 'VaultFile' || op.action !== 'put') return;
  const manifest = validateFileManifest(op.payload);
  for (const [index, hash] of manifest.chunks.entries()) {
    replica.assertUnlocked();
    if (!(await store.uploaded(hash))) {
      const bytes = await store.get(hash);
      if (!bytes || await hexDigest(bytes) !== hash) throw new Error('Pending file bytes are unavailable. The file remains queued.');
      await relay.request(`/api/blobs/${hash}`, { method: 'PUT', binary: true, body: bytes });
      await store.markUploaded(hash);
    }
    progress({ completed: index + 1, total: manifest.chunks.length });
  }
}

export async function importFile(file, session) {
  if (!file || file.size > 2 * 1024 ** 3) throw new Error('Choose a file no larger than 2 GB.');
  const extension = (file.name?.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'bin';
  const kind = file.type?.startsWith('image/') ? 'image' : file.type === 'application/pdf' ? 'pdf' : file.type?.startsWith('audio/') ? 'audio' : file.type?.startsWith('video/') ? 'video' : 'file';
  const category = { image: 'Images', pdf: 'Documents', audio: 'Audio', video: 'Video', file: 'Files' }[kind];
  const name = `file-${crypto.randomUUID()}.${extension}`, path = `Media/${category}/${name}`;
  const hasher=sha256.create();
  let digest;
  try {
    for(let offset=0;offset<file.size;offset+=FILE_CHUNK_BYTES){session.replica.assertUnlocked();hasher.update(new Uint8Array(await file.slice(offset,offset+FILE_CHUNK_BYTES).arrayBuffer()));}
    digest=Array.from(hasher.digest(),byte=>byte.toString(16).padStart(2,'0')).join('');
  } finally { hasher.destroy(); }
  const chunks=[], verification=sha256.create();
  for (let offset = 0, index = 0; offset < file.size; offset += FILE_CHUNK_BYTES, index++) {
    session.replica.assertUnlocked();
    const bytes=new Uint8Array(await file.slice(offset,offset+FILE_CHUNK_BYTES).arrayBuffer());verification.update(bytes);
    const chunk = await encodeFileChunk(session.replica.key, bytes, session.identity, digest, index);
    await session.blobs.put(chunk.hash, chunk.bytes); chunks.push(chunk.hash);
  }
  if(Array.from(verification.digest(),byte=>byte.toString(16).padStart(2,'0')).join('')!==digest)throw new Error('The selected file changed during import. It was not published.');
  const manifest = { version: 1, path, digest, size: file.size, chunks, mimeType: file.type || 'application/octet-stream', name: file.name || 'File', url: `bex-media://library/${name}`, kind };
  await session.replica.change({ kind: 'VaultFile', id: path }, manifest);
  session.changed();
  return manifest;
}
