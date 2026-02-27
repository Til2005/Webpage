const DB_NAME = 'txn_db';
const STORE_NAME = 'media';
const DB_VERSION = 1;

let db: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (db) return Promise.resolve(db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = (e.target as IDBOpenDBRequest).result;
      if (!d.objectStoreNames.contains(STORE_NAME)) {
        d.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => { db = (e.target as IDBOpenDBRequest).result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

export async function saveMedia(id: string, blob: Blob): Promise<void> {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ id, blob });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadMediaBlob(id: string): Promise<Blob | null> {
  const d = await openDB();
  const result: { id: string; blob: Blob } | undefined = await new Promise((resolve, reject) => {
    const tx = d.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result as { id: string; blob: Blob } | undefined);
    req.onerror = () => reject(req.error);
  });
  return result?.blob ?? null;
}

export async function loadMediaAsDataUrl(id: string): Promise<string | null> {
  const d = await openDB();
  const blob: Blob | undefined = await new Promise((resolve, reject) => {
    const tx = d.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve((req.result as { id: string; blob: Blob } | undefined)?.blob);
    req.onerror = () => reject(req.error);
  });
  if (!blob) return null;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

export async function cleanupUnusedMedia(usedIds: Set<string>): Promise<void> {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAllKeys();
    req.onsuccess = () => {
      (req.result as string[])
        .filter(k => !usedIds.has(k))
        .forEach(k => store.delete(k));
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}
