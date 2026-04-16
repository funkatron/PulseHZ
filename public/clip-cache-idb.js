/**
 * IndexedDB persistence for user clip/audio blobs (not for same-origin demo re-fetch).
 * @module clip-cache-idb
 */

export const CLIP_IDB_NAME = "pulsehz-clip-cache-v1";
export const CLIP_IDB_VER = 1;

/**
 * @returns {Promise<IDBDatabase>}
 */
export function openPulsehzClipIdb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(CLIP_IDB_NAME, CLIP_IDB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("blobs")) {
        db.createObjectStore("blobs");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
  });
}

/**
 * @param {string} key
 * @returns {Promise<Blob | File | null>}
 */
export async function idbGetClipBlob(key) {
  if (!window.indexedDB) {
    return null;
  }
  try {
    const db = await openPulsehzClipIdb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("blobs", "readonly");
      const r = tx.objectStore("blobs").get(key);
      r.onsuccess = () => {
        db.close();
        resolve(r.result ?? null);
      };
      r.onerror = () => reject(r.error);
    });
  } catch {
    return null;
  }
}

/**
 * @param {object} state App state with `layers` and `audio`.
 * @param {number} maxLayers
 */
export async function persistClipBlobsToIdb(state, maxLayers) {
  if (!window.indexedDB) {
    return;
  }
  try {
    const db = await openPulsehzClipIdb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("blobs", "readwrite");
      const store = tx.objectStore("blobs");
      for (let i = 0; i < maxLayers; i += 1) {
        const id = i + 1;
        const layer = state.layers[i];
        const key = `layer-${id}`;
        if (!layer.file || layer.clipPersist?.kind === "demo") {
          store.delete(key);
        } else {
          store.put(layer.file, key);
        }
      }
      if (state.audio.file) {
        store.put(state.audio.file, "audio");
      } else {
        store.delete("audio");
      }
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
    });
  } catch (e) {
    console.warn("PulseHZ: IndexedDB clip save failed", e);
  }
}
