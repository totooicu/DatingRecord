// 快照 diff：对比「动手前」快照和「当前库」，找出这轮到底新增/修改/删除了谁。
//
// 为什么不用 ops 列表：ops 记的是工具调用过程（调了几次 list、几次 get），
// 人要看的是结果——到底加了谁、改了谁、删了谁。直接对比两张表最准。

import { getDbInstance, getSql } from '../db/state';
import { getSnapStore } from './store';

export interface SnapDiffItem {
  kind: 'person' | 'event' | 'collection';
  id: string;
  name: string;
  /** 删除/修改时存删前内容，事后核对不用先恢复 */
  before?: {
    content?: string;
    timeLabel?: string;
    placeName?: string;
  };
}

export interface SnapDiff {
  created: SnapDiffItem[];
  updated: SnapDiffItem[];
  deleted: SnapDiffItem[];
}

interface Row {
  id: string;
  display_name?: string;
  title?: string;
  name?: string;
  content?: string;
  place_json?: string;
  start_ts?: number | null;
  deleted_at?: string | null;
  rev?: number;
  updated_at?: string;
}

interface SqlLike {
  exec: (sql: string) => Array<{ columns: string[]; values: unknown[][] }>;
}

function readTable(db: SqlLike, table: string): Map<string, Row> {
  const res = db.exec(`SELECT id, display_name, title, name, content, place_json, start_ts, deleted_at, rev, updated_at FROM ${table}`);
  const cols = res[0]?.columns ?? [];
  const rows = res[0]?.values ?? [];
  const map = new Map<string, Row>();
  for (const r of rows) {
    const obj: Record<string, unknown> = {};
    cols.forEach((c, i) => { obj[c] = r[i]; });
    map.set(String(obj.id), obj as unknown as Row);
  }
  return map;
}

function itemName(kind: string, row: Row): string {
  if (kind === 'person') return row.display_name ?? row.id;
  if (kind === 'event') return row.title ?? '(无标题)';
  return row.name ?? row.id;
}

function eventBefore(row: Row): SnapDiffItem['before'] {
  const out: SnapDiffItem['before'] = {};
  if (row.content) out.content = String(row.content);
  if (row.start_ts) {
    try {
      out.timeLabel = new Date(Number(row.start_ts)).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { /* ignore */ }
  }
  if (row.place_json) {
    try {
      const p = JSON.parse(String(row.place_json));
      if (p?.name) out.placeName = String(p.name);
    } catch { /* ignore */ }
  }
  return out;
}

/** 对比快照和当前库，返回增删改分组。快照读不到时返回空。 */
export async function diffSnapshot(snapId: string): Promise<SnapDiff | null> {
  const sql = getSql();
  const cur = getDbInstance();
  if (!sql || !cur) return null;

  const store = getSnapStore();
  const bytes = await store.get(snapId);
  if (!bytes) return null;

  let snap: { exec: SqlLike['exec']; close: () => void } | null = null;
  try {
    snap = new (sql.Database as new (b: Uint8Array) => { exec: SqlLike['exec']; close: () => void })(bytes);
    const result: SnapDiff = { created: [], updated: [], deleted: [] };

    const tables: Array<[string, 'person' | 'event' | 'collection']> = [
      ['persons', 'person'],
      ['events', 'event'],
      ['collections', 'collection'],
    ];

    for (const [table, kind] of tables) {
      const before = readTable(snap as unknown as SqlLike, table);
      const after = readTable(cur as unknown as SqlLike, table);

      for (const [id, curRow] of after) {
        const oldRow = before.get(id);
        const curDeleted = !!curRow.deleted_at;
        const wasDeleted = !!oldRow?.deleted_at;
        const name = itemName(kind, curRow);

        if (!oldRow) {
          if (!curDeleted) {
            result.created.push({ kind, id, name });
          }
        } else if (!wasDeleted && curDeleted) {
          result.deleted.push({ kind, id, name, before: kind === 'event' ? eventBefore(oldRow) : {} });
        } else if (!wasDeleted && !curDeleted) {
          if (Number(oldRow.rev ?? 0) !== Number(curRow.rev ?? 0) || String(oldRow.updated_at ?? '') !== String(curRow.updated_at ?? '')) {
            result.updated.push({ kind, id, name });
          }
        }
      }
    }
    return result;
  } catch {
    return null;
  } finally {
    snap?.close();
  }
}

/** 用户拒绝的单条改动：逐条 revert */
export interface RejectItem {
  kind: 'person' | 'event' | 'collection';
  id: string;
  action: 'created' | 'updated' | 'deleted';
}

/**
 * 对用户勾选为「拒绝」的条目逐条回退：
 * - created：这个对象是 AI 新建的，直接从当前库删掉
 * - updated：从快照读出旧值，覆盖当前库这一行
 * - deleted：从快照读出被删的行，INSERT OR REPLACE 恢复
 */
export async function revertDiffItems(snapId: string, rejects: RejectItem[]): Promise<void> {
  const cur = getDbInstance();
  if (!cur) throw new Error('数据库未初始化');
  const sql = getSql();
  if (!sql) throw new Error('sql.js 未加载');
  const store = getSnapStore();
  const bytes = await store.get(snapId);
  if (!bytes) throw new Error('快照不存在');

  const snap = new (sql.Database as new (b: Uint8Array) => {
    exec: (q: string) => Array<{ columns: string[]; values: unknown[][] }>;
    close: () => void;
  })(bytes);

  try {
    for (const r of rejects) {
      const table = r.kind === 'person' ? 'persons' : r.kind === 'event' ? 'events' : 'collections';
      if (r.action === 'created') {
        // 新建的：直接删
        cur.run(`DELETE FROM ${table} WHERE id = ?`, [r.id]);
      } else {
        // updated / deleted：用快照行覆盖
        const res = snap.exec(`SELECT * FROM ${table} WHERE id = '${r.id.replace(/'/g, "''")}'`);
        const cols = res[0]?.columns ?? [];
        const vals = res[0]?.values?.[0];
        if (!vals || !cols.length) continue;
        const colList = cols.join(', ');
        const placeholders = cols.map(() => '?').join(', ');
        cur.run(`INSERT OR REPLACE INTO ${table} (${colList}) VALUES (${placeholders})`, vals as unknown as (string | number | null)[]);
      }
    }
  } finally {
    snap.close();
  }
}
