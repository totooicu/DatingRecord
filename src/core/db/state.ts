// SQL 引擎与数据库实例的存放处。
//
// 为什么要单独一个文件：查询、持久化、初始化都要访问同一个实例，
// 如果各自持有模块级变量，就会形成 db ↔ query ↔ persist 的循环引用。
// 这里只存状态、不含逻辑，谁都可以单向依赖它。

import type { Database, SqlJsStatic } from 'sql.js';

let SQL: SqlJsStatic | null = null;
let db: Database | null = null;

export function getSql(): SqlJsStatic | null {
  return SQL;
}

export function setSql(s: SqlJsStatic): void {
  SQL = s;
}

export function getDbInstance(): Database | null {
  return db;
}

export function setDbInstance(d: Database | null): void {
  db = d;
}

/** 取实例，未初始化时抛出——早失败比拿到 undefined 再报错好定位 */
export function getDb(): Database {
  if (!db) throw new Error('数据库尚未初始化，请先调用 initDb()');
  return db;
}
