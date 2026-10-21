// 附件二进制读写（IndexedDB blobs store）。
//
// 为什么不放 SQLite：persist() 是「db.export() 整库 → 单个 Uint8Array → 整块写回」，
// 任何一次编辑都会重传全库。几 MB 的图片塞进去，每次打字都要多传几 MB。
// 所以库里只留元数据，二进制单独放这里。

import { BLOB_STORE, openIdb } from './index';

function tx(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<unknown> {
  return openIdb().then(
    (d) =>
      new Promise((resolve, reject) => {
        const t = d.transaction(BLOB_STORE, mode);
        const req = run(t.objectStore(BLOB_STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function putBlob(id: string, blob: Blob): Promise<void> {
  await tx('readwrite', (s) => s.put(blob, id));
}

export async function getBlob(id: string): Promise<Blob | null> {
  const r = (await tx('readonly', (s) => s.get(id))) as Blob | undefined;
  return r ?? null;
}

export async function delBlob(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

/** 清空全部附件二进制（重置数据时用） */
export async function clearBlobs(): Promise<void> {
  await tx('readwrite', (s) => s.clear());
}

// ---------------- objectURL ----------------

/**
 * 附件 id → objectURL 的进程内缓存。
 * 正文渲染会反复用到同一个附件（列表里多处引用），重复 createObjectURL 会泄漏。
 */
const urlCache = new Map<string, string>();

export async function objectUrlFor(id: string): Promise<string | null> {
  const hit = urlCache.get(id);
  if (hit) return hit;
  const blob = await getBlob(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(id, url);
  return url;
}

export function forgetUrl(id: string): void {
  const url = urlCache.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(id);
  }
}

// ---------------- 与 JSON 备份互转 ----------------

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      // 结果形如 data:image/png;base64,xxxx —— 与既有 Attachment.data 格式一致
      resolve(String(fr.result));
    };
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

export function base64ToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',');
  const mime = /data:([^;]+)/.exec(head ?? '')?.[1] ?? 'application/octet-stream';
  try {
    const bin = atob(body ?? '');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch {
    return new Blob([], { type: mime });
  }
}
