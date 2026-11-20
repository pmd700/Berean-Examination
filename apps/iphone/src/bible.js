import { hexDigest } from '../../../shared/sync/relay-client';
const editions=new Map();let catalog;
export async function bibleCatalog(){if(!catalog){const response=await fetch('/bibles/catalog.json');if(!response.ok)throw new Error('Bible downloads are not installed yet.');catalog=await response.json();}return catalog.translations;}
export async function readPhoneChapter(version,book,chapter){
 const edition=(await bibleCatalog()).find(entry=>entry.code===version);if(!edition)throw new Error('This exact edition requires its online provider. It has not been replaced with another translation.');
 if(!editions.has(version)){const response=await fetch(`/bibles/${version}.json?v=${edition.sha256}`);if(!response.ok)throw new Error('This Bible has not finished downloading for offline use.');const bytes=new Uint8Array(await response.arrayBuffer());if(await hexDigest(bytes)!==edition.sha256)throw new Error('Bible integrity verification failed.');editions.set(version,JSON.parse(new TextDecoder().decode(bytes)));}
 const text=editions.get(version).chapters[`${book}\0${chapter}`];if(!text)throw new Error('This chapter is not included in the selected edition.');return {text,notice:edition.notice};
}
export function clearPhoneBibles(){editions.clear();}

export async function downloadPhoneBibles(progress=()=>{}) { const editions=await bibleCatalog();let completed=0;for(const edition of editions){const url=`/bibles/${edition.code}.json?v=${edition.sha256}`,cached=await caches.match(url);if(!cached){const response=await fetch(url);if(!response.ok)throw new Error('Offline Bible download is incomplete. Your study remains saved.');const bytes=new Uint8Array(await response.arrayBuffer());if(await hexDigest(bytes)!==edition.sha256)throw new Error('Offline Bible integrity failed.');}progress({completed:++completed,total:editions.length});} }
