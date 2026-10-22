// 数据层入口。
//
// 原来是一个 450 行的 db.ts：建表语句、IndexedDB 读写、查询辅助、
// oplog、持久化、设备 ID 全挤在一起。现在按职责拆开，
// 这里只保留初始化 / 迁移 / 重置，并把公共 API 原样转出——
// 外部 import '../core/db' 的写法不需要改。

import initSqlJs, { type Database } from 'sql.js';
import { SCHEMA_SQL } from './schema';
import { IDB_STORE, IDB_KEY, openIdb } from './idb';
import { getDbInstance, getSql, setDbInstance, setSql } from './state';
import { queryOne } from './query';
import { dropEncContent, readPlaintextBytes, resealAfterReset } from './encStore';
import { setMeta } from './meta';
import { flushPersist } from './persist';
import { seedDefaults } from './seed';
import { ensureAttachmentColumns, runMigrations } from './migrate';

/** 启动进度回调。`ratio` 为 null 表示这一阶段无法量化（UI 走不确定态） */
export type BootProgress = (msg: string, ratio: number | null) => void;

/**
 * 启动各阶段在总进度里占的权重。
 *
 * WASM 占大头（约 700KB），所以给它一半以上；读盘和建表是本地动作，
 * 通常几百毫秒，但大库解密 / 老设备迁移也会慢，留足但不喧宾夺主。
 */
const P_WASM = 0.55;
const P_OPEN = 0.25;

/**
 * 自己把 WASM 拉下来，顺带拿到字节级进度。
 *
 * sql.js 内部用 fetch + arrayBuffer，一次拿完才知道有多大，中途没有任何反馈——
 * 弱网下就是「转圈十秒，毫无变化」。这里改成读流，边下边报进度，
 * 再把字节交给 `wasmBinary`，sql.js 就不会重复下载第二次。
 * 拿不到进度（无 Content-Length、或环境不支持流式读取）也不失败，只是报 null。
 */
async function fetchWasm(
  url: string,
  onRatio: (ratio: number | null) => void,
): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) return null;

    // 没有流就读整块，进度只能给个「完了」——总比报错强
    if (!res.body) {
      const buf = await res.arrayBuffer();
      onRatio(1);
      return buf;
    }

    const declared = Number(res.headers.get('content-length') ?? '');
    // 服务端可能压缩传输：Content-Length 是压缩后的长度，解压后的字节会超过它，
    // 所以下面统一 clamp，别让进度条冲过 100%
    const total = Number.isFinite(declared) && declared > 0 ? declared : 0;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      if (total) onRatio(Math.min(0.98, got / total));
    }
    onRatio(1);

    const out = new Uint8Array(got);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    // sql.js 的 wasmBinary 类型收 ArrayBuffer；out 是整块新建的，buffer 即全部字节
    return out.buffer;
  } catch {
    return null;
  }
}

/**
 * 初始化数据库。
 *
 * `onProgress` 用于把阶段进度透给首屏加载态——WASM 有近 700KB，
 * 弱网下这一步可能要几十秒，没有反馈用户会以为页面挂了。
 */
export async function initDb(onProgress?: BootProgress): Promise<Database> {
  const existing = getDbInstance();
  if (existing) {
    onProgress?.('就绪', 1);
    return existing;
  }
  const report = (m: string, r: number | null) => onProgress?.(m, r);

  // 用 BASE_URL 拼接，保证部署到子路径（如 GitHub Pages 的 /DatingRecord/）时也能取到
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;

  let sql = getSql();
  if (!sql) {
    report('正在下载数据库引擎…', 0);
    const wasmUrl = `${base}sql-wasm.wasm`;
    const binary = await fetchWasm(wasmUrl, (r) => {
      // 下载阶段映射到总进度的前 P_WASM
      report('正在下载数据库引擎…', r === null ? null : r * P_WASM);
    });
    // 拿不到字节（或被拦截）就退回让 sql.js 自己取，功能不受影响，只是没有下载进度
    report(binary ? '正在启动数据库引擎…' : '正在加载数据库引擎…', binary ? P_WASM : null);
    sql = await initSqlJs({
      locateFile: () => wasmUrl,
      ...(binary ? { wasmBinary: binary } : {}),
    });
    setSql(sql);
  }

  report('正在读取本地数据…', P_WASM + P_OPEN * 0.35);
  const bytes = await readPlaintextBytes();
  const db = bytes ? new sql.Database(bytes) : new sql.Database();
  db.run('PRAGMA foreign_keys = ON');
  // 先登记实例：migrate 内部要用 queryOne，那时 getDb() 必须已经可用
  setDbInstance(db);

  report('正在准备数据表…', P_WASM + P_OPEN);
  migrate(db);
  report('就绪', 1);

  // 页面隐藏/关闭前尽力落盘，减少丢数据的窗口
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushPersist);
  }
  return db;
}

/** 迁移链：按 schemaVersion 逐级升级（结构升级见 db/migrate.ts） */
function migrate(d: Database): void {
  d.run(SCHEMA_SQL);
  ensureAttachmentColumns(d);
  const row = queryOne<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['schema_version']);
  const current = row ? Number(row.value) : 0;

  if (current < 1) {
    seedDefaults(d);
    setMeta('schema_version', '1');
  }
  runMigrations(d, Math.max(current, 1));
  setMeta('last_opened_at', new Date().toISOString());
}

/** 彻底清空本地数据（危险操作，UI 需二次确认） */
export async function resetAll(): Promise<void> {
  const d = getDbInstance();
  if (d) {
    d.close();
    setDbInstance(null);
  }
  try {
    const idb = await openIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
  // 加密开着的话，盘上密文立刻删（否则 initDb 会把旧数据解出来，清空白做），
  // 但主密钥留在内存里，等空库建好再原样封回去
  await dropEncContent();
  await initDb();
  await resealAfterReset();
}

export { getDb, getDbInstance } from './state';
export { queryAll, queryOne, run, transact } from './query';
export { appendOplog } from './oplog';
export {
  undo,
  redo,
  bulkAction,
  noteUndoStep,
  suspendUndo,
  resumeUndo,
} from './undo';
export {
  subscribeUndo,
  getUndoState,
  type UndoState,
  type UndoStepInfo,
  type UndoOp,
} from './undoStore';
export { getDeviceId } from './device';
export {
  probeEnc,
  getEncStatus,
  getEncRecord,
  unlockEnc,
  enableEnc,
  disableEnc,
  changeEncPassphrase,
  resetEncPassphraseWithRecovery,
  readPlaintextBytes,
  dropEncContent,
  resealAfterReset,
  type EncStatus,
} from './encStore';
export { getMeta, setMeta } from './meta';
export { markDirty, flushPersist, persist } from './persist';
export { openIdb, BLOB_STORE } from './idb';
export { SCHEMA_SQL } from './schema';
export { runMigrations, ensureAttachmentColumns } from './migrate';
