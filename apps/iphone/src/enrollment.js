function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('bex-phone-enrollment', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('settings');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
export async function enrollment(value = undefined) {
  const database = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = database.transaction('settings', value === undefined ? 'readonly' : 'readwrite');
      const store = tx.objectStore('settings'), request = value === undefined ? store.get('wrapped') : store.put(value, 'wrapped');
      let result;
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result); tx.onabort = () => reject(tx.error); tx.onerror = () => reject(tx.error);
    });
  } finally { database.close(); }
}
