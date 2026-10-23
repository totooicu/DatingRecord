// SQL 查询辅助：所有数据访问最终都走这里

import { getDb } from './state';
import { markDirty } from './persist';
import { beginStep, labelTopFromOplog } from './undo';

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

/**
 * 执行一条写语句。
 *
 * 必须顺手 markDirty()：持久化是「整库 export → 写 IndexedDB」，
 * 而 dirty 标记原先只在 transact() 里置位——于是走裸 run() 的写路径
 * （消息的插入 / 修改 / 移动、软删……）改完只在内存里，一刷新就没了。
 * 这个不变量应该压在最低那层，不能指望每个调用点都记得包一层 transact。
 */
export function run(sql: string, params: unknown[] = []): void {
  getDb().run(sql, params as never[]);
  markDirty();
}

/** 写事务：业务变更 + oplog 原子提交；顺带给撤销栈记一步 */
export function transact<T>(fn: () => T): T {
  const d = getDb();
  beginStep();
  d.run('BEGIN');
  try {
    const result = fn();
    d.run('COMMIT');
    markDirty();
    labelTopFromOplog();
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
