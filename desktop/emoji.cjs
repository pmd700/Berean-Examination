'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { buildAppleEmojiFont } = require('./emoji/font.cjs');
const sequences = require('./emoji/sequences.json');
const execute = promisify(execFile);
const CHANNEL = 'emoji:get-native-font';
const SYSTEM_FONT = '/System/Library/Fonts/Apple Color Emoji.ttc';
const CACHE_VERSION = 2;

async function readNativeEmojiFont(cacheFolder) {
  const stat = await fs.stat(SYSTEM_FONT);
  const filename = `apple-${CACHE_VERSION}-${stat.size}-${Math.trunc(stat.mtimeMs)}.ttf`;
  await fs.mkdir(cacheFolder, { recursive: true, mode: 0o700 });
  if ((await fs.lstat(cacheFolder)).isSymbolicLink()) throw new Error('Invalid emoji cache.');
  const target = path.join(cacheFolder, filename);
  try {
    const cached = await fs.lstat(target);
    if (!cached.isFile() || cached.isSymbolicLink() || cached.size < 1024 || cached.size > 64 * 1024 * 1024) throw new Error('Invalid emoji cache.');
    return await fs.readFile(target);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const { stdout } = await execute('/usr/bin/osascript', [
    '-l', 'JavaScript', path.join(__dirname, 'emoji/shape.js'), path.join(__dirname, 'emoji/sequences.json'),
  ], { timeout: 20000, maxBuffer: 1024 * 1024, encoding: 'utf8' });
  const font = buildAppleEmojiFont(await fs.readFile(SYSTEM_FONT), sequences, JSON.parse(stdout));
  const temporary = `${target}.${process.pid}.partial`;
  try {
    await fs.writeFile(temporary, font, { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, target);
  } finally { await fs.rm(temporary, { force: true }); }
  // Keep one derived cache, outside the owner's vault and backup history.
  for (const entry of await fs.readdir(cacheFolder, { withFileTypes: true })) {
    if (entry.isFile() && /^apple-\d+-\d+-\d+\.ttf$/.test(entry.name) && entry.name !== filename) {
      await fs.unlink(path.join(cacheFolder, entry.name));
    }
  }
  return font;
}

function registerEmojiHandlers({ appUrl, ipcMain, cacheFolder, platform = process.platform, loadFont = readNativeEmojiFont }) {
  const origin = new URL(appUrl).origin;
  let pending;
  ipcMain.removeHandler(CHANNEL);
  ipcMain.handle(CHANNEL, async (event) => {
    try {
      const frame = event?.senderFrame;
      if (!frame || frame !== event.sender?.mainFrame || frame.parent
        || new URL(frame.url).origin !== origin) throw new Error('Untrusted emoji request.');
      if (platform !== 'darwin') return { ok: true, bytes: null };
      if (!pending) pending = loadFont(cacheFolder).catch((error) => { pending = null; throw error; });
      return { ok: true, bytes: Uint8Array.from(await pending) };
    } catch {
      // A usable bundled fallback stays available; never return OS file paths.
      return { ok: false, bytes: null };
    }
  });
}

module.exports = { CHANNEL, readNativeEmojiFont, registerEmojiHandlers };
