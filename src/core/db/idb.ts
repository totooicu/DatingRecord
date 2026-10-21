// IndexedDB：主库二进制与附件二进制的落盘

export const IDB_NAME = 'dating-record';
/** 主库二进制（整库导出） */
export const IDB_STORE = 'files';
export const IDB_KEY = 'main.sqlite';
/** 附件二进制：单独一个 store，key 是附件 id。
 *  绝不把文件塞进 SQLite —— persist() 每次都会 db.export() 重传整库。 */
export const BLOB_STORE = 'blobs';
/** v1 只有 files；v2 起新增 blobs（附件二进制） */
const IDB_VERSION = 2;

export function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(IDB_STORE)) d.createObjectStore(IDB_STORE);
      if (!d.objectStoreNames.contains(BLOB_STORE)) d.createObjectStore(BLOB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet(): Promise<Uint8Array | null> {
  try {
    const d = await openIdb();
    return await new Promise<Uint8Array | null>((resolve, reject) => {
      const tx = d.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve((req.result as Uint8Array) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function idbPut(data: Uint8Array): Promise<void> {
  const d = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(data, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
