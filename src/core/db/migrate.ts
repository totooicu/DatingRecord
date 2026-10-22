// schema 迁移：v1 → v2（内容寻址）
//
// 为什么单独一个文件：建表语句只管「新库长什么样」，老库缺什么列得靠这里补。
// sql.js 的 ALTER TABLE 只支持加列，所以老库的 attachments 表逐列补，
// 补完再把存量行填上 stored_id —— 语义就是「老的引用名 = 老 id」。

import type { Database } from 'sql.js';
import { SCHEMA_VERSION } from '../types';
import { setMeta } from './meta';

function hasColumn(d: Database, table: string, col: string): boolean {
  const stmt = d.prepare(`PRAGMA table_info(${table})`);
  try {
    while (stmt.step()) {
      const row = stmt.getAsObject() as { name?: string };
      if (row.name === col) return true;
    }
    return false;
  } finally {
    stmt.free();
  }
}

/** 给 attachments 补 v2 的两列（新库在建表后也会走到这里，幂等） */
export function ensureAttachmentColumns(d: Database): void {
  if (!hasColumn(d, 'attachments', 'stored_id')) {
    d.run(`ALTER TABLE attachments ADD COLUMN stored_id TEXT NOT NULL DEFAULT ''`);
  }
  if (!hasColumn(d, 'attachments', 'hash_shared')) {
    d.run(`ALTER TABLE attachments ADD COLUMN hash_shared INTEGER NOT NULL DEFAULT 0`);
  }
  d.run(`CREATE INDEX IF NOT EXISTS idx_att_sha ON attachments(sha256)`);
  // stored_id 只建普通索引，不建 UNIQUE：碰撞时用户可以选择「合并」，
  // 合并后两条同 hash 的记录引用名会暂时相同，UNIQUE 会把这条路堵死。
  d.run(`CREATE INDEX IF NOT EXISTS idx_att_stored ON attachments(stored_id)`);
}

/** 存量行补 stored_id（沿用老 id 当引用名，老正文一个字都不用改） */
export function backfillStoredIds(d: Database): void {
  d.run(`UPDATE attachments SET stored_id = id WHERE stored_id IS NULL OR stored_id = ''`);
}

/**
 * 按 meta.schema_version 逐级升级。
 *
 * v1 → v2 只做结构升级，不合并任何文件：合并是用户可见的数据改动，
 * 必须由设置里的「文件迁移」手动触发（见 core/files/migrate.ts）。
 */
export function runMigrations(d: Database, current: number): string {
  let v = current;
  if (v < 2) {
    ensureAttachmentColumns(d);
    backfillStoredIds(d);
    v = 2;
    // 结构升级后所有老文件都还没算过 hash，标成 legacy：
    // 迁移页据此提示「N 个文件尚未计算 hash」
    setMeta('files_addressed', 'legacy');
  }
  if (v < 3) {
    // 属性模板（F-P04）：新表，幂等；新库在建表语句里已经有了
    d.run(`CREATE TABLE IF NOT EXISTS attribute_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      keys_json TEXT NOT NULL DEFAULT '[]',
      device_id TEXT, rev INTEGER NOT NULL DEFAULT 1, hlc TEXT, deleted_at TEXT,
      created_at TEXT, updated_at TEXT
    )`);
    v = 3;
  }
  if (v < 4) {
    // 隐私标记（v4）：四个实体各加一列；老库逐列补，幂等。
    // 隐私是「查看偏好」之外的数据属性，必须落库、随备份走，不能只存前端。
    for (const table of ['persons', 'collections', 'events', 'attachments']) {
      if (!hasColumn(d, table, 'is_private')) {
        d.run(`ALTER TABLE ${table} ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0`);
      }
    }
    v = 4;
  }
  if (v < 5) {
    // 事件集图标（v5）：icon_json 存 CollectionIcon。同一格表加列，老库幂等补。
    if (!hasColumn(d, 'collections', 'icon_json')) {
      d.run(`ALTER TABLE collections ADD COLUMN icon_json TEXT`);
    }
    v = 5;
  }
  if (v < 6) {
    // AI 模型（v6）：新表，幂等。凭据不放这里（见 meta ai.key.）
    d.run(`CREATE TABLE IF NOT EXISTS ai_models (
      id TEXT PRIMARY KEY,
      alias TEXT NOT NULL DEFAULT '',
      provider TEXT NOT NULL DEFAULT 'siliconflow',
      base_url TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      temperature REAL NOT NULL DEFAULT 0.7,
      max_tokens INTEGER NOT NULL DEFAULT 1024,
      is_default INTEGER NOT NULL DEFAULT 0,
      device_id TEXT, rev INTEGER NOT NULL DEFAULT 1, hlc TEXT, deleted_at TEXT,
      created_at TEXT, updated_at TEXT
    )`);
    d.run(`CREATE INDEX IF NOT EXISTS idx_ai_alias ON ai_models(alias)`);
    v = 6;
  }
  if (v !== SCHEMA_VERSION) v = SCHEMA_VERSION;
  setMeta('schema_version', String(v));
  return String(v);
}
