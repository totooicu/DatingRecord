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

/**
 * 落盘之后的观察者（已经写成功才通知）。
 *
 * 跨设备操作里，服务端要把它自己的每一次本地写入推给客户端；
 * 挂在 persist 上就不用去 44 个写入口逐个补一遍广播。
 */
type PersistObserver = (bytes: Uint8Array) => void;
const observers = new Set<PersistObserver>();

export function onPersisted(fn: PersistObserver): () => void {
  observers.add(fn);
  return () => observers.delete(fn);
}

function notifyPersisted(bytes: Uint8Array): void {
  observers.forEach((fn) => {
    try {
      fn(bytes);
    } catch {
      /* 观察者失败不能影响落盘 */
    }
  });
}

export function markDirty(): void {
  noteUserWrite();
  dirty = true;
  if (saveTimer !== null) return;
  // 不用 window.setTimeout：CLI 里没有 window，而 Node 的全局 setTimeout 两边通用
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persist();
  }, 500);
}

// ---------- 「本机有没有新东西要传」的判据 ----------
//
// 自动同步服务要知道两件事：有没有写过、最后一次写是什么时候。
// 麻烦在于**同步引擎自己也写库**（把云端改动合并进来、写 baseline 和 last_at），
// 这些写入不能算「本机有新东西」——否则自动同步自己喂自己，一趟接一趟打坚果云。
// 所以记两个数：
//   userWrites  业务写入次数（同步引擎自己写的那些不计）
//   syncedWrites 最近一趟同步**拍快照那一刻**的 userWrites
// 差值 > 0 就意味着「快照之后本机又写过」，该传了。对齐点取**拍快照那一刻**而不是
// 这趟结束那一刻：传输途中用户可能又改了东西，那一笔必须仍然算没传，
// 否则定时没开的话，这次编辑会一直躺到下一次写入为止。
//
// 计数点放在 markDirty 而不是 persist：persist 是 500ms 防抖后的物理写，
// 一趟可能合并很多次逻辑写入，逻辑层面才符合「有变化」。

let userWrites = 0;
let syncedWrites = 0;
let lastWriteAt = 0;
/** > 0 表示当前这段写入是同步引擎自己干的，不计入 pending */
let syncDepth = 0;

/**
 * 把同步引擎自己的写入包起来：里面的 markDirty 不会让本机显得「又有新东西」。
 * fn 必须是同步的——await 期间 depth 已经减回去了，跨 await 的写入照样会被计入。
 */
export function syncWrite<T>(fn: () => T): T {
  syncDepth += 1;
  try {
    return fn();
  } finally {
    syncDepth -= 1;
  }
}

/** 此刻的写入序号：同步引擎在拍快照时取一个，成功后再拿它来对齐 */
export function currentWrites(): number {
  return userWrites;
}

/**
 * 「序号 <= upTo 的写入都已经在云端了」。
 *
 * 只在同步**成功**时调用，且 upTo 必须是拍快照那一刻取的值：
 * 传输途中用户又写的那一笔仍然算 pending，下一拍接着传；
 * 失败就一次都不对齐，改动触发会自己重试这一趟。
 */
export function markSynced(upTo: number = userWrites): void {
  syncedWrites = Math.min(Math.max(upTo, syncedWrites), userWrites);
}

/** 快照之后本机又写了多少次（0 = 和云端一致，不用再传） */
export function pendingLocalWrites(): number {
  return Math.max(0, userWrites - syncedWrites);
}

/** 最后一次业务写入的时间（毫秒时间戳）；从没写过返回 0 */
export function lastUserWriteAt(): number {
  return lastWriteAt;
}

function noteUserWrite(): void {
  if (syncDepth > 0) return;
  userWrites += 1;
  lastWriteAt = Date.now();
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
    notifyPersisted(bytes);
    return;
  }
  if (sink) {
    await sink(bytes);
    notifyPersisted(bytes);
    return;
  }
  await idbPut(bytes);
  notifyPersisted(bytes);
}
