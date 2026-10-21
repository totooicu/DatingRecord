// 持久化：整库导出 → 单个 Uint8Array → 整块写 IndexedDB。
//
// 这是本项目最容易踩坑的一处：任何写操作都会重传全库，
// 所以附件二进制必须放在 IndexedDB 自己的 store（见 db/blob.ts），
// 而不是塞进 SQLite。

import { getDbInstance } from './state';
import { idbPut } from './idb';

let saveTimer: number | null = null;
let dirty = false;

export function markDirty(): void {
  dirty = true;
  if (saveTimer !== null) return;
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void persist();
  }, 500);
}

/** 立即落盘（关闭页面、清空数据等场景用，避免 debounce 未触发导致丢数据） */
export function flushPersist(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  void persist();
}

export async function persist(): Promise<void> {
  const db = getDbInstance();
  if (!db || !dirty) return;
  dirty = false;
  const bytes = db.export();
  await idbPut(new Uint8Array(bytes));
}
