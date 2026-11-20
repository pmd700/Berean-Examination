import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceWorkerSource } from '../../tools/build-iphone-sw.mjs';
import vm from 'node:vm';
const script = serviceWorkerSource(['/index.html','/assets/shell.js'],'test-proof');
function environment(redirected) {
  const handlers = new Map(), deleted = [], state = { skipped: 0, claimed: 0 };
  const cached = new Response('<html>BEX</html>', { headers: { 'Content-Type': 'text/html' } });
  Object.defineProperty(cached, 'redirected', { value: redirected });
  const cache = { async match() { return cached.clone ? Object.defineProperty(cached.clone(), 'redirected', { value: redirected }) : cached; }, async addAll() {} };
  const self = { location: new URL('https://bex.example'), addEventListener: (name, handler) => handlers.set(name, handler), skipWaiting: async () => { state.skipped++; }, clients: { async matchAll(){return [{}];}, async claim() { state.claimed++; } } };
  vm.runInNewContext(script, { self, caches: { async keys() { return ['bex-shell-broken','bex-private-files']; }, async open() { return cache; }, async delete(name) { deleted.push(name); } }, Response, URL, fetch: () => { throw new Error('Unexpected network request'); } });
  return { handlers, deleted, state };
}
test('Safari navigation receives a fresh response without a redirected response flag', async () => {
  const { handlers } = environment(true); let response;
  handlers.get('fetch')({ request: { method: 'GET', mode: 'navigate', url: 'https://bex.example/' }, respondWith(value) { response = value; } });
  const result = await response;
  assert.equal(result.redirected, false); assert.equal(await result.text(), '<html>BEX</html>');
});
test('repair update activates automatically only for the broken shell cache', async () => {
  for (const broken of [true, false]) {
    const { handlers, state, deleted } = environment(broken); let promise;
    handlers.get('install')({ waitUntil(value) { promise = value; } }); await promise;
    assert.equal(state.skipped, broken ? 1 : 0);
    handlers.get('activate')({ waitUntil(value) { promise = value; } }); await promise;
    assert.deepEqual(deleted, ['bex-shell-broken']);
  }
});
test('the offline worker never handles authenticated API requests', () => {
  const { handlers } = environment(false); let handled = false;
  handlers.get('fetch')({ request: { method: 'GET', mode: 'cors', url: 'https://bex.example/api/operations' }, respondWith() { handled = true; } });
  assert.equal(handled, false);
});
