// 整库快照的编解码：把整个 SQLite 库变成一根 base64 字符串，以及反过来。
//
// 从 router.ts 分出来：这两个方向的函数只跟数据库实例打交道，
// 跟「消息是谁发的、走哪条链路」无关。放在这里之后，换库那条危险路径
// （换实例 → 清撤销栈 → 关旧库 → bump）也只有这一个文件知道。

import type { Database } from 'sql.js';
import { getDbInstance, resetUndo } from '../db';
import { getSql, setDbInstance } from '../db/state';
import { bump } from '../../store';

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export function exportDb(): string {
  const db = getDbInstance();
  if (!db) throw new Error('数据库尚未初始化');
  return toBase64(new Uint8Array(db.export()));
}

/**
 * 用对端发来的整库字节替换本地库。
 *
 * 顺序不能改：先建新实例并开外键 → 换全局实例 → 清撤销栈（栈里存的是旧库的整库字节，
 * 换完再撤销会把旧库盖回来）→ 关掉旧实例 → 最后才 bump 让界面重查。
 */
export function replaceDb(b64: string): void {
  const sql = getSql();
  if (!sql) throw new Error('数据库引擎尚未就绪');
  const bytes = fromBase64(b64);
  const next: Database = new sql.Database(bytes);
  next.run('PRAGMA foreign_keys = ON');
  const old = getDbInstance();
  setDbInstance(next);
  // 撤销栈保存的是旧实例的整库字节，换库后必须清掉
  resetUndo();
  old?.close();
  bump();
}
