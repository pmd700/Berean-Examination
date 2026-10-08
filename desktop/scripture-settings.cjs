'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Installation credentials stay outside library exports. Future API requests
// will read the secret in the main process, never send it back to the renderer.
class ScriptureSettings {
  constructor({ filePath, safeStorage }) {
    this.filePath = filePath;
    this.safeStorage = safeStorage;
    this.encryptionAvailable = false;
  }

  status() {
    try {
      const record = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (record.version !== 1 || typeof record.encryptedKey !== 'string' || !record.encryptedKey) {
        throw new Error('Invalid credential record');
      }
      return { configured: true };
    } catch (error) {
      if (error.code === 'ENOENT') return { configured: false };
      throw new Error('BEX could not read scripture setup. Paste your API key again to replace it.');
    }
  }

  save(value) {
    const key = typeof value === 'string' ? value.trim() : '';
    if (!key || key.length > 512 || !/^[\x21-\x7e]+$/.test(key)) {
      throw new Error('Paste an API key without spaces, then press Enter.');
    }
    if (!this.encryptionAvailable) {
      this.encryptionAvailable = Boolean(this.safeStorage?.isEncryptionAvailable())
        && this.safeStorage?.getSelectedStorageBackend?.() !== 'basic_text';
    }
    if (!this.encryptionAvailable) {
      throw new Error('Protected system storage is unavailable. Your API key was not saved.');
    }
    let encrypted;
    try {
      encrypted = this.safeStorage.encryptString(key);
    } catch {
      this.encryptionAvailable = false;
      throw new Error('BEX could not protect your API key. Try again.');
    }
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, encryptedKey: encrypted.toString('base64') }), {
        flag: 'wx', mode: 0o600,
      });
      fs.renameSync(temporary, this.filePath);
    } catch {
      throw new Error('BEX could not save your API key. Try again.');
    } finally {
      fs.rmSync(temporary, { force: true });
    }
    return { configured: true };
  }

  clear() {
    fs.rmSync(this.filePath, { force: true });
    return { configured: false };
  }
}

module.exports = { ScriptureSettings };
