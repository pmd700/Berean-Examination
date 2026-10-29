'use strict';

// A development renderer can update before its Electron main process does.
// Prepare its local-only font asset without shipping Apple data in the build.
const fs = require('node:fs/promises');
const path = require('node:path');
const { readNativeEmojiFont } = require('../desktop/emoji.cjs');

async function prepareNativeEmojiCache(cacheFolder = path.resolve(__dirname, '../node_modules/.cache/bex-native-emoji')) {
  if (process.platform !== 'darwin') return null;
  await readNativeEmojiFont(cacheFolder);
  const source = (await fs.readdir(cacheFolder)).find(name => /^apple-\d+-\d+-\d+\.ttf$/.test(name));
  if (!source) throw new Error('The local Apple compatibility font is unavailable.');
  const target = path.join(cacheFolder, 'compatible.ttf');
  const temporary = `${target}.${process.pid}.partial`;
  try {
    await fs.link(path.join(cacheFolder, source), temporary);
    await fs.rename(temporary, target);
  } finally { await fs.rm(temporary, { force: true }); }
  return target;
}

if (require.main === module) prepareNativeEmojiCache()
  .then(result => console.log(result ? 'Local Apple emoji cache prepared.' : 'Native Apple cache is only needed on macOS.'))
  .catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { prepareNativeEmojiCache };
