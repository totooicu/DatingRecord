// 持久化：整库导出 → 单个 Uint8Array → 整块写 IndexedDB。
//
// 这是本项目最容易踩坑的一处：任何写操作都会重传全库，
// 所以附件二进制必须放在 IndexedDB 自己的 store（见 db/blob.ts），
// 而不是塞进 SQLite。

import { getDbInstance } from './state';
import { idbPut } from './idb';
import { getEncStatus, saveEncrypted } from './encStore';

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

/** 立即落盘（关闭页面、撤销换库、清空数据等场景用，避免 debounce 未触发导致丢数据） */
export function flushPersist(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  // 强制写：撤销是把整个库实例换回旧快照，中间没有任何 run()，
  // dirty 还是凉的——不强制的话换回来的状态根本不会进 IndexedDB。
  void persist(true);
}

export async function persist(force = false): Promise<void> {
  const db = getDbInstance();
  if (!db) return;
  // force 跳过 dirty 判断（见 flushPersist）；普通路径仍然是「没脏就不重传」
  if (!force && !dirty) return;
  dirty = false;
  const bytes = new Uint8Array(db.export());
  // 加密开启时写密文，绝不顺带留一份明文——那等于没加密
  if (getEncStatus() === 'open') {
    await saveEncrypted(bytes);
    return;
  }
  await idbPut(bytes);
}
