export interface RecentSave {
  id: string;
  name: string;
  opened: number;
  data: ArrayBuffer;
}

async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('digiatlas-recent-saves', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('saves', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function recentSaves(): Promise<RecentSave[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('saves').objectStore('saves').getAll();
      request.onsuccess = () =>
        resolve((request.result as RecentSave[]).sort((a, b) => b.opened - a.opened).slice(0, 3));
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function rememberSave(name: string, data: ArrayBuffer): Promise<void> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  const id = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  const previous = await recentSaves();
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('saves', 'readwrite');
      const store = tx.objectStore('saves');
      store.put({ id, name, data, opened: Date.now() });
      for (const save of previous.filter((s) => s.id !== id).slice(2)) store.delete(save.id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
