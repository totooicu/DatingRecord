// 系统类工具：统计、只读 SQL、操作日志、库信息。
//
// system.sql 是给 AI 的「任意查询」口子：只读（SELECT/WITH/EXPLAIN），
// 且一次只允许一条语句。它能回答工具集没覆盖到的临时问题，
// 又不会变成绕过全部约束的写入口。

import type { ToolDef } from './types';
import { queryAll, getMeta, setMeta, getDeviceId } from '../db';
import { SCHEMA_SQL } from '../db/schema';
import { SCHEMA_VERSION } from '../types';
import { globalStats } from '../repo/events';
import { listPersons } from '../repo/persons';
import { dbSizeBytes } from '../io/maintenance';
import { getTree } from '../repo/collections';

/** 只放行单条只读语句 */
function assertReadOnly(sql: string): string {
  const s = sql.trim().replace(/;+\s*$/, '');
  if (!s) throw new Error('SQL 不能为空');
  if (s.includes(';')) throw new Error('只允许一条语句');
  const head = s.split(/\s+/)[0]?.toUpperCase() ?? '';
  if (!['SELECT', 'WITH', 'EXPLAIN'].includes(head)) {
    throw new Error('只允许 SELECT / WITH / EXPLAIN 查询');
  }
  if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|PRAGMA|REPLACE|VACUUM)\b/i.test(s)) {
    throw new Error('检测到写操作关键字，已拒绝');
  }
  return s;
}

export const SYSTEM_TOOLS: ToolDef[] = [
  {
    name: 'system.stats',
    group: 'system',
    title: '库概览',
    desc: '全局统计：事件数、人物数、归档数、总花费、平均评分、库体积',
    mutating: false,
    params: [],
    run: () => ({
      ...globalStats(),
      dbBytes: dbSizeBytes(),
      deviceId: getDeviceId(),
      schemaVersion: SCHEMA_VERSION,
    }),
  },
  {
    name: 'system.sql',
    group: 'system',
    title: '只读 SQL 查询',
    desc:
      '执行一条 SELECT 查询（sqlite 语法）。表结构见 system.schema。' +
      '注意 persons/events/collections 等都有 deleted_at（软删除）与 hlc（同步时钟）列；' +
      '聊天消息在 event_messages，人物属性是 persons.attrs_json 里的 JSON。',
    mutating: false,
    params: [
      { name: 'sql', type: 'string', desc: '单条 SELECT / WITH / EXPLAIN 语句', required: true },
      { name: 'limit', type: 'number', desc: '最多返回多少行，默认 100', required: false, default: 100 },
    ],
    run: (a) => {
      const sql = assertReadOnly(a.sql as string);
      const limit = Math.min(Math.max(Number(a.limit ?? 100), 1), 1000);
      const rows = queryAll<Record<string, unknown>>(sql);
      return { count: rows.length, truncated: rows.length > limit, rows: rows.slice(0, limit) };
    },
  },
  {
    name: 'system.schema',
    group: 'system',
    title: '数据库表结构',
    desc: '完整建表 SQL，写 system.sql 之前先看这个',
    mutating: false,
    params: [],
    run: () => ({ schema: SCHEMA_SQL }),
  },
  {
    name: 'system.recentOps',
    group: 'system',
    title: '最近的操作记录',
    desc: 'oplog 里最近的写入（谁在什么时候建了/改了/删了什么），用于回顾 AI 或自己刚做过什么',
    mutating: false,
    params: [{ name: 'limit', type: 'number', desc: '返回多少条，默认 30', required: false, default: 30 }],
    run: (a) => {
      const limit = Math.min(Math.max(Number(a.limit ?? 30), 1), 200);
      return queryAll<Record<string, unknown>>(
        'SELECT seq, entity, entity_id, op, payload, device_id, created_at FROM oplog ORDER BY seq DESC LIMIT ?',
        [limit],
      );
    },
  },
  {
    name: 'system.meta',
    group: 'system',
    title: '读 / 写库元信息',
    desc: 'meta 表（schema_version、library_id、library_name、last_opened_at…）的读写',
    mutating: false,
    params: [
      { name: 'key', type: 'string', desc: 'meta 键，省略则返回全部', required: false },
    ],
    run: (a) => {
      const key = a.key as string | undefined;
      if (key) {
        const v = getMeta(key);
        if (v === null) throw new Error(`meta 键不存在：${key}`);
        return { key, value: v };
      }
      return queryAll<{ key: string; value: string }>('SELECT key, value FROM meta ORDER BY key');
    },
  },
  {
    name: 'system.setMeta',
    group: 'system',
    title: '写库元信息',
    desc: '改 meta 表里的一个键（如 library_name）',
    mutating: true,
    params: [
      { name: 'key', type: 'string', desc: 'meta 键', required: true },
      { name: 'value', type: 'string', desc: '新值', required: true },
    ],
    run: (a) => {
      setMeta(a.key as string, a.value as string);
      return { key: a.key, value: getMeta(a.key as string) };
    },
  },
  {
    name: 'system.overview',
    group: 'system',
    title: '全库速览',
    desc:
      '一屏看完整个库：统计 + 事件集树 + 人物名单（id/姓名）。' +
      '刚接手一个库、不知道有什么内容时先调这个',
    mutating: false,
    params: [],
    run: () => {
      const tree = getTree();
      const walk = (n: NonNullable<typeof tree>, d = 0, out: string[] = []): string[] => {
        out.push(`${'  '.repeat(d)}${n.name}（${n.totalEventCount} 个事件）`);
        for (const c of n.children) walk(c, d + 1, out);
        return out;
      };
      return {
        stats: globalStats(),
        dbBytes: dbSizeBytes(),
        collections: tree ? walk(tree) : [],
        persons: listPersons({ includeArchived: true }).map((p) => `${p.displayName} [${p.id}]${p.status === 'archived' ? '（归档）' : ''}`),
      };
    },
  },
];
