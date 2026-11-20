import { cacheFile, fileBlob } from '../../../shared/sync/files.js';
import { setMediaSourceResolver } from '../../../src/lib/mediaSource.js';
const urls = new Map();
export function installMediaResolver(session) {
  setMediaSourceResolver(async source => {
    if (!source?.startsWith('bex-media:')) return source;
    session.replica.assertUnlocked();
    if (urls.has(source)) return urls.get(source);
    const record = (await session.replica.records()).records.find(record => record.record.kind === 'VaultFile' && record.status === 'current' && record.versions[0].payload.url === source);
    if (!record) throw new Error('This image has not synchronized yet.');
    const manifest = record.versions[0].payload;
    await cacheFile(manifest, session.blobs, session.relay);
    session.replica.assertUnlocked();
    const blob = await fileBlob(manifest, session.blobs, session.replica.key, session.identity,()=>session.replica.assertUnlocked());
    session.replica.assertUnlocked();
    if (urls.has(source)) return urls.get(source);
    const url = URL.createObjectURL(blob); urls.set(source, url); return url;
  });
}
export function clearMedia() { for (const url of urls.values()) URL.revokeObjectURL(url); urls.clear(); setMediaSourceResolver(null); }
export async function downloadVaultFiles(session, onProgress) {
  const records = (await session.replica.records()).records.filter(record => record.record.kind === 'VaultFile' && record.status === 'current');
  let completed = 0;
  session.downloadedManifests ||= new Set();
  for (const record of records) { session.replica.assertUnlocked();const revision=record.versions[0].id;if(session.downloadedManifests.has(revision)){completed++;continue;} await cacheFile(record.versions[0].payload, session.blobs, session.relay, chunks => onProgress?.({ completed, total: records.length, chunks })); session.downloadedManifests.add(revision);onProgress?.({ completed: ++completed, total: records.length }); }
  return records.length;
}
