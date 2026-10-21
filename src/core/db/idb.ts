// IndexedDB：主库二进制与附件二进制的落盘

export const IDB_NAME = 'dating-record';
/** 主库二进制（整库导出） */
export const IDB_STORE = 'files';
export const IDB_KEY = 'main.sqlite';
/** 附件二进制：单独一个 store，key 是附件 id。
 *  绝不把文件塞进 SQLite —— persist() 每次都会 db.export() 重传整库。 */
export const BLOB_STORE = 'blobs';
/** 加密后的整库（启用本地库加密后，主库存的就是它而不是 main.sqlite） */
export const ENC_KEY = 'main.enc';
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

/** 加密记录的读写删。存结构化对象，不是二进制 */
export async function idbGetEnc(): Promise<unknown> {
  try {
    const d = await openIdb();
    return await new Promise<unknown>((resolve, reject) => {
      const tx = d.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(ENC_KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function idbPutEnc(record: object): Promise<void> {
  const d = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(record, ENC_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbDelete(key: string): Promise<void> {
  const d = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
