export class BrowserBlobStore {
  static async open(vaultId) {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(`bex-file-cache-${vaultId}`, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('chunks');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    return new BrowserBlobStore(database);
  }
  constructor(database) { this.database = database; }
  async keys(prefix) { return (await this.operation('readonly',store=>store.getAllKeys())).filter(key=>typeof key==='string'&&key.startsWith(prefix)); }
  async delete(key) { return this.operation('readwrite',store=>store.delete(key)); }
  async has(hash) { return Boolean(await this.operation('readonly',store=>store.count(hash))); }
  async get(hash) { return this.operation('readonly', store => store.get(hash)); }
  async put(hash, bytes) { return this.operation('readwrite', store => store.put(bytes, hash)); }
  async uploaded(hash) { return Boolean(await this.get(`uploaded:${hash}`)); }
  async markUploaded(hash) { return this.put(`uploaded:${hash}`, true); }
  operation(mode, callback) {
    return new Promise((resolve, reject) => {
      const tx = this.database.transaction('chunks', mode), request = callback(tx.objectStore('chunks')); let value;
      request.onsuccess = () => { value = request.result; };
      tx.oncomplete = () => resolve(value); tx.onabort = () => reject(tx.error || new Error('File storage is full. Existing files and pending changes were kept.')); tx.onerror = () => reject(tx.error);
    });
  }
  close() { this.database.close(); }
}
