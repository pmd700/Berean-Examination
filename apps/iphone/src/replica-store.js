export class IndexedDbReplicaStore {
  static async open(name, identity) {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('meta');
        const operations = db.createObjectStore('operations', { keyPath: 'id' });
        operations.createIndex('record', 'key'); operations.createIndex('pending', 'pending');
      };
      request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result);
      request.onblocked = () => reject(new Error('Close the older BEX tab before updating storage.'));
    });
    const store = new IndexedDbReplicaStore(database);
    await new Promise((resolve, reject) => {
      const tx = database.transaction('meta', 'readwrite'), meta = tx.objectStore('meta');
      const request = meta.get('state');
      request.onsuccess = () => {
        if (!request.result) meta.put({ identity, version: 0, sequence: 0, counter: 0, cursor: 0 }, 'state');
        else if (JSON.stringify(request.result.identity) !== JSON.stringify(identity)) tx.abort();
      };
      tx.oncomplete = resolve; tx.onabort = () => reject(tx.error || new Error('Pair this browser as a new device.')); tx.onerror = () => reject(tx.error);
    });
    database.onversionchange = () => database.close();
    return store;
  }
  constructor(database) { this.database = database; }
  read(store, query) {
    return new Promise((resolve, reject) => {
      const tx = this.database.transaction(store), request = query(tx.objectStore(store));
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  }
  meta() { return this.read('meta', store => store.get('state')); }
  record(key) { return this.read('operations', store => store.index('record').getAll(key)); }
  all() { return this.read('operations', store => store.getAll()); }
  pendingCount() { return this.read('operations',store=>store.index('pending').count(1)); }
  pending(limit = 16) { return this.read('operations', store => store.index('pending').getAll(1, limit)); }
  commit(version, changes) {
    return new Promise((resolve, reject) => {
      const tx = this.database.transaction(['meta', 'operations'], 'readwrite');
      const meta = tx.objectStore('meta'), operations = tx.objectStore('operations');
      let committed = false;
      const request = meta.get('state');
      request.onsuccess = () => {
        const state = request.result;
        if (state.version !== version) return;
        for (const row of changes.rows || []) {
          const prior = operations.get(row.id);
          prior.onsuccess = () => { if (!prior.result) operations.add(row); };
        }
        for (const id of changes.ack || []) {
          const prior = operations.get(id);
          prior.onsuccess = () => { if (prior.result) operations.put({ ...prior.result, pending: 0 }); };
        }
        for (const field of ['sequence', 'counter', 'cursor', 'recoveryImports']) if (changes[field] !== undefined) state[field] = changes[field];
        state.version++; meta.put(state, 'state'); committed = true;
      };
      tx.oncomplete = () => resolve(committed);
      tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Local save failed. Keep your edit and retry.'));
    });
  }
  close() { this.database.close(); }
}
