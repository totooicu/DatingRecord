// meta 表：库级键值（schema 版本、库名、最后打开时间等）

import { queryOne } from './query';
import { getDb } from './state';
import { markDirty } from './persist';

export function setMeta(key: string, value: string): void {
  getDb().run('INSERT OR REPLACE INTO meta (key, value) VALUES (?,?)', [key, value]);
  markDirty();
}

export function getMeta(key: string): string | null {
  const row = queryOne<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
  return row ? row.value : null;
}
