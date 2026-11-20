import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.resolve('apps/iphone/dist');
async function scan(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'sw.js') continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await scan(absolute)); else result.push('/' + path.relative(root, absolute).split(path.sep).join('/'));
  }
  return result;
}
export function serviceWorkerSource(urls,version) { return `const CACHE='bex-shell-${version}', URLS=${JSON.stringify(urls)};
async function brokenCaches(){const broken=[];for(const name of await caches.keys()){if(name===CACHE||!name.startsWith('bex-shell-'))continue;const page=await(await caches.open(name)).match('/index.html');if(page?.redirected)broken.push(name);}return broken;}
async function unpairedSetup(){if(typeof indexedDB==='undefined')return false;return new Promise(resolve=>{const request=indexedDB.open('bex-phone-enrollment',1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('settings'))request.result.createObjectStore('settings');};request.onerror=()=>resolve(false);request.onblocked=()=>resolve(false);request.onsuccess=()=>{const db=request.result;if(!db.objectStoreNames.contains('settings')){db.close();resolve(false);return;}const tx=db.transaction('settings','readonly'),get=tx.objectStore('settings').get('wrapped');get.onsuccess=()=>resolve(!get.result);get.onerror=()=>resolve(false);tx.oncomplete=()=>db.close();};});}
self.addEventListener('install',event=>event.waitUntil((async()=>{await(await caches.open(CACHE)).addAll(URLS);if((await brokenCaches()).length||await unpairedSetup())await self.skipWaiting();})()));
self.addEventListener('message',event=>{if(event.data==='ACTIVATE_SAVED_UPDATE')self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil((async()=>{const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});for(const name of await caches.keys())if(name!==CACHE&&name.startsWith('bex-shell-')&&(clients.length<=1||(await brokenCaches()).includes(name)))await caches.delete(name);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;if(event.request.mode==='navigate'){event.respondWith(caches.open(CACHE).then(cache=>cache.match('/index.html')).then(cached=>cached?new Response(cached.body,{status:cached.status,statusText:cached.statusText,headers:cached.headers}):fetch(event.request)));return;}if(URLS.includes(url.pathname))event.respondWith(caches.open(CACHE).then(cache=>cache.match(event.request)).then(cached=>cached||fetch(event.request)));else if(url.pathname.startsWith('/bibles/')||url.pathname.startsWith('/licenses/'))event.respondWith((async()=>{const cache=await caches.open(CACHE),cached=await cache.match(event.request);if(cached)return cached;const result=await fetch(event.request);if(result.ok&&!result.redirected)await cache.put(event.request,result.clone());return result;})());else if(url.pathname.startsWith('/assets/'))event.respondWith((async()=>{for(const name of await caches.keys()){if(!name.startsWith('bex-shell-'))continue;const cached=await(await caches.open(name)).match(event.request);if(cached)return cached;}return fetch(event.request);})());});\n`; }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
const urls = (await scan(root)).sort();
const hash = createHash('sha256').update('safari-navigation-recovery-v4-setup-repair'); for (const url of urls) hash.update(url).update(await readFile(path.join(root, url.slice(1))));
const version = hash.digest('hex').slice(0, 16);
const source = serviceWorkerSource(urls.filter(url=>!url.startsWith('/licenses/')&&(!url.startsWith('/bibles/')||url==='/bibles/catalog.json')),version);
await writeFile(path.join(root, 'sw.js'), source);
console.log(`Offline shell ${version}: ${urls.length} public assets; no API or private data caching.`);

}
