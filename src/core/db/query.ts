// SQL 查询辅助：所有数据访问最终都走这里

import { getDb } from './state';
import { markDirty } from './persist';

export function queryAll<T>(sql: string, params: unknown[] = []): T[] {
  const d = getDb();
  const stmt = d.prepare(sql);
  try {
    stmt.bind(params as never[]);
    const rows: T[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as T);
    return rows;
  } finally {
    stmt.free();
  }
}

export function queryOne<T>(sql: string, params: unknown[] = []): T | null {
  const rows = queryAll<T>(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

export function run(sql: string, params: unknown[] = []): void {
  getDb().run(sql, params as never[]);
}

/** 写事务：业务变更 + oplog 原子提交 */
export function transact<T>(fn: () => T): T {
  const d = getDb();
  d.run('BEGIN');
  try {
    const result = fn();
    d.run('COMMIT');
    markDirty();
    return result;
  } catch (err) {
    try {
      d.run('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
}

export { getDb };
