// 持久化：整库导出 → 单个 Uint8Array → 整块写存储。
//
// 这是本项目最容易踩坑的一处：任何写操作都会重传全库，
// 所以附件二进制必须放在独立的 blob store（见 db/blob.ts），
// 而不是塞进 SQLite。
//
// 「写到哪儿」是一个可换的后端：
//   · 浏览器 → IndexedDB（默认）
//   · CLI / 测试 → 本地文件（setPersistSink 注入）
// 抽出来是因为 Node 里没有 indexedDB，而核心逻辑（repo / tools / agent）
// 两边是同一套——不能为了 CLI 把整个 core 复制一份。

import { getDbInstance } from './state';
import { idbPut } from './idb';
import { getEncStatus, saveEncrypted } from './encStore';

/** 落盘后端：拿到整库字节，负责写到最终介质 */
export type PersistSink = (bytes: Uint8Array) => Promise<void> | void;

let sink: PersistSink | null = null;

/** 换成别的落盘介质；传 null 恢复默认（IndexedDB） */
export function setPersistSink(fn: PersistSink | null): void {
  sink = fn;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

export function markDirty(): void {
  dirty = true;
  if (saveTimer !== null) return;
  // 不用 window.setTimeout：CLI 里没有 window，而 Node 的全局 setTimeout 两边通用
  saveTimer = setTimeout(() => {
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
  // dirty 还是凉的——不强制的话换回来的状态根本不会进存储。
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
  if (sink) {
    await sink(bytes);
    return;
  }
  await idbPut(bytes);
}
