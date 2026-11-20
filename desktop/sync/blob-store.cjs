'use strict';
const fs = require('node:fs');
const path = require('node:path');
class FileBlobStore {
  constructor(directory) { this.directory = directory; fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); }
  target(hash) { if (!/^[a-f0-9]{64}$/.test(hash)) throw new TypeError('Invalid chunk address.'); return path.join(this.directory, hash); }
  has(hash) { return fs.existsSync(this.target(hash)); }
  get(hash) { try { return new Uint8Array(fs.readFileSync(this.target(hash))); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
  put(hash, bytes) {
    const target = this.target(hash);
    if (fs.existsSync(target)) return;
    const pending = target + '.partial';
    fs.writeFileSync(pending, bytes, { mode: 0o600 });
    const fd = fs.openSync(pending, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(pending, target);
  }
  uploaded(hash) { return fs.existsSync(this.target(hash) + '.uploaded'); }
  markUploaded(hash) { fs.writeFileSync(this.target(hash) + '.uploaded', '', { mode: 0o600 }); }
  close() {}
}
module.exports = { FileBlobStore };
