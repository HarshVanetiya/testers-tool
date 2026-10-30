// IndexedDB store for screenshots. Screenshots are large data: URLs, so they live
// here instead of chrome.storage.local. The key of a step screenshot is the step id.

const DB_NAME = 'testtrail';
const DB_VERSION = 1;
const STORE = 'screenshots';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('recordingId', 'recordingId', { unique: false });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function done(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    Promise.resolve(fn(store)).then((r) => (result = r), reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export function putShot(id, recordingId, dataUrl) {
  return tx('readwrite', (store) => {
    store.put({ id, recordingId, dataUrl, size: dataUrl.length, createdAt: Date.now() });
  });
}

export async function getShot(id) {
  const row = await tx('readonly', (store) => done(store.get(id)));
  return row?.dataUrl || null;
}

/** Map of id -> dataUrl for every screenshot of a recording. */
export async function getShotsForRecording(recordingId) {
  const rows = await tx('readonly', (store) => done(store.index('recordingId').getAll(recordingId)));
  return new Map(rows.map((r) => [r.id, r.dataUrl]));
}

export function deleteShot(id) {
  return tx('readwrite', (store) => {
    store.delete(id);
  });
}

export async function deleteShotsForRecording(recordingId) {
  const keys = await tx('readonly', (store) => done(store.index('recordingId').getAllKeys(recordingId)));
  if (!keys.length) return;
  await tx('readwrite', (store) => keys.forEach((k) => store.delete(k)));
}

export function clearShots() {
  return tx('readwrite', (store) => {
    store.clear();
  });
}

export async function allShots() {
  return tx('readonly', (store) => done(store.getAll()));
}

export async function shotStats() {
  const rows = await allShots();
  return { count: rows.length, bytes: rows.reduce((n, r) => n + (r.size || 0), 0) };
}
