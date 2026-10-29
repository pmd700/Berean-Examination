'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { buildAppleEmojiFont } = require('../desktop/emoji/font.cjs');
const { CHANNEL, registerEmojiHandlers } = require('../desktop/emoji.cjs');

function handler(options = {}) {
  let registered;
  registerEmojiHandlers({
    appUrl: 'http://127.0.0.1:5555', cacheFolder: '/unused-test-cache', platform: 'darwin',
    ipcMain: { removeHandler: (name) => assert.equal(name, CHANNEL), handle: (_name, fn) => { registered = fn; } },
    ...options,
  });
  return registered;
}
const sender = (url = 'http://127.0.0.1:5555/Study') => {
  const frame = { url, parent: null };
  return { senderFrame: frame, sender: { mainFrame: frame } };
};

test('native font IPC rejects other origins and subframes before loading anything', async () => {
  let loads = 0;
  const get = handler({ loadFont: async () => { loads += 1; return Buffer.from('test'); } });
  for (const event of [sender('https://untrusted.test'), sender('http://127.0.0.1:5556'), {},
    { senderFrame: { url: 'http://127.0.0.1:5555', parent: {} } }]) {
    assert.deepEqual(await get(event), { ok: false, bytes: null });
  }
  assert.equal(loads, 0);
});

test('concurrent trusted requests share one font build and return isolated bytes', async () => {
  let loads = 0;
  const get = handler({ loadFont: async () => { loads += 1; return Buffer.from([1, 2, 3]); } });
  const [first, second] = await Promise.all([get(sender()), get(sender())]);
  assert.equal(loads, 1);
  assert.deepEqual(first.bytes, Uint8Array.of(1, 2, 3));
  first.bytes[0] = 9;
  assert.equal(second.bytes[0], 1);
});

test('font helper failures allow retry and do not expose system paths or details', async () => {
  let loads = 0;
  const get = handler({ loadFont: async () => {
    if (++loads === 1) throw new Error('private OS path');
    return Buffer.from([1]);
  } });
  assert.deepEqual(await get(sender()), { ok: false, bytes: null });
  assert.equal((await get(sender())).ok, true);
  assert.equal(loads, 2);
});

test('Windows/Linux retain their existing emoji style without reading Apple fonts', async () => {
  const get = handler({ platform: 'win32', loadFont: () => assert.fail('Apple font should not be loaded') });
  assert.deepEqual(await get(sender()), { ok: true, bytes: null });
});

test('converter refuses malformed font input', () => {
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(32), Buffer.from('not a font')]) {
    assert.throws(() => buildAppleEmojiFont(bytes, [], []));
  }
});

test('native adapter produces a valid checksum and ordered shaping lookups', { skip: process.platform !== 'darwin' }, () => {
  // Public sample strings and this machine's installed font; no Apple bytes in fixtures.
  const font = buildAppleEmojiFont(fs.readFileSync('/System/Library/Fonts/Apple Color Emoji.ttc'),
    ['😀', '👩🏽‍💻', '🫱🏻‍🫲🏿'], [[2096], [1441], [3833, 3843]]);
  let sum = 0;
  for (let offset = 0; offset < font.length; offset += 4) sum = (sum + font.readUInt32BE(offset)) >>> 0;
  assert.equal(sum, 0xb1b0afba);
  const tables = new Map();
  for (let index = 0; index < font.readUInt16BE(4); index += 1) {
    const offset = 12 + index * 16;
    tables.set(font.toString('ascii', offset, offset + 4), font.readUInt32BE(offset + 8));
  }
  for (const tag of ['CBDT', 'CBLC', 'GSUB', 'name', 'head', 'cmap']) assert.ok(tables.has(tag), tag);
  assert.equal(tables.has('sbix'), false);
  assert.equal(tables.has('morx'), false);
  const gsub = tables.get('GSUB');
  const lookups = gsub + font.readUInt16BE(gsub + 8);
  assert.equal(font.readUInt16BE(lookups), 2);
  assert.equal(font.readUInt16BE(lookups + font.readUInt16BE(lookups + 2)), 7, 'Ligatures must precede expansion.');
  assert.equal(font.readUInt16BE(lookups + font.readUInt16BE(lookups + 4)), 2);
});
