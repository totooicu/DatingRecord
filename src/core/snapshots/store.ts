// 快照存储后端。
//
// 和 persist.ts 一个思路：「字节写到哪儿」是可换的：
//   · 浏览器 → IndexedDB 里单独的 snaps store（不和附件二进制混放）
//   · CLI    → 由 CLI 注入一个文件版后端（见 src/cli/snapStore.ts），
//              这里不 import node:fs，免得浏览器包里混进 Node 模块
//
// 为什么不把快照塞进 SQLite 自己的一张表：快照的意义是「库被改坏了还能回去」，
// 而它要保护的正是这张表所在的整个文件。放一起等于把备份和原件锁在同一个
// 保险柜里——真要恢复时反而取不出来。

import { SNAP_STORE, SNAP_PREFIX, openIdb } from '../db/idb';

export interface SnapBytes {
  get(id: string): Promise<Uint8Array | null>;
  put(id: string, bytes: Uint8Array): Promise<void>;
  del(id: string): Promise<void>;
}

/** 浏览器：IndexedDB 的 snaps store */
export function idbSnapStore(): SnapBytes {
  return {
    async get(id) {
      try {
        const d = await openIdb();
        return await new Promise<Uint8Array | null>((resolve, reject) => {
          const req = d.transaction(SNAP_STORE, 'readonly').objectStore(SNAP_STORE).get(SNAP_PREFIX + id);
          req.onsuccess = () => resolve((req.result as Uint8Array) ?? null);
          req.onerror = () => reject(req.error);
        });
      } catch {
        return null;
      }
    },
    async put(id, bytes) {
      const d = await openIdb();
      await new Promise<void>((resolve, reject) => {
        const tx = d.transaction(SNAP_STORE, 'readwrite');
        tx.objectStore(SNAP_STORE).put(bytes, SNAP_PREFIX + id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
    async del(id) {
      const d = await openIdb();
      await new Promise<void>((resolve, reject) => {
        const tx = d.transaction(SNAP_STORE, 'readwrite');
        tx.objectStore(SNAP_STORE).delete(SNAP_PREFIX + id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
  };
}

let store: SnapBytes | null = null;

/** 换存储后端；不调则默认用 IndexedDB（浏览器） */
export function setSnapStore(s: SnapBytes | null): void {
  store = s;
}

export function getSnapStore(): SnapBytes {
  if (!store) store = idbSnapStore();
  return store;
}
