const READ_OFFLINE_STATE_SCRIPT = `(() => {
  const databaseName = 'uinventario-offline';
  return (async () => {
    const databases = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : [];
    if (databases.length && !databases.some((database) => database.name === databaseName)) {
      return { offlineSchemaVersion: 0, pendingOperations: 0 };
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onerror = () => reject(request.error || new Error('INDEXEDDB_OPEN_FAILED'));
      request.onupgradeneeded = () => {
        request.transaction.abort();
        resolve({ offlineSchemaVersion: 0, pendingOperations: 0 });
      };
      request.onsuccess = () => {
        const database = request.result;
        const offlineSchemaVersion = database.version;
        if (!database.objectStoreNames.contains('outbox')) {
          database.close();
          resolve({ offlineSchemaVersion, pendingOperations: 0 });
          return;
        }
        const count = database.transaction('outbox').objectStore('outbox').count();
        count.onerror = () => {
          database.close();
          reject(count.error || new Error('INDEXEDDB_COUNT_FAILED'));
        };
        count.onsuccess = () => {
          database.close();
          resolve({ offlineSchemaVersion, pendingOperations: count.result });
        };
      };
    });
  })();
})()`;

export async function readOfflineUpdateState(webContents) {
  const state = await webContents.executeJavaScript(READ_OFFLINE_STATE_SCRIPT, true);
  if (!state || !Number.isSafeInteger(state.offlineSchemaVersion) || !Number.isSafeInteger(state.pendingOperations)) {
    throw new Error('El renderer devolvió un estado offline inválido.');
  }
  return state;
}
