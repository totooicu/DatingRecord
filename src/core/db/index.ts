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

/**
 * 初始化数据库。
 *
 * `onProgress` 用于把阶段进度透给首屏加载态——WASM 有近 700KB，
 * 弱网下这一步可能要几十秒，没有反馈用户会以为页面挂了。
 */
export async function initDb(onProgress?: (msg: string) => void): Promise<Database> {
  const existing = getDbInstance();
  if (existing) return existing;
  const report = (m: string) => onProgress?.(m);

  // 用 BASE_URL 拼接，保证部署到子路径（如 GitHub Pages 的 /DatingRecord/）时也能取到
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;

  report('正在加载数据库引擎…');
  let sql = getSql();
  if (!sql) {
    sql = await initSqlJs({ locateFile: () => `${base}sql-wasm.wasm` });
    setSql(sql);
  }

  report('正在读取本地数据…');
  const bytes = await readPlaintextBytes();
  const db = bytes ? new sql.Database(bytes) : new sql.Database();
  db.run('PRAGMA foreign_keys = ON');
  // 先登记实例：migrate 内部要用 queryOne，那时 getDb() 必须已经可用
  setDbInstance(db);

  report('正在准备数据表…');
  migrate(db);

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
