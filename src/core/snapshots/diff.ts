// 快照 diff：对比「动手前」快照和「当前库」，找出这轮到底新增/修改/删除了谁。
//
// 为什么不用 ops 列表：ops 记的是工具调用过程（调了几次 list、几次 get），
// 人要看的是结果——到底加了谁、改了谁、删了谁。直接对比两张表最准。

import { getDbInstance, getSql } from '../db/state';
import { getSnapStore } from './store';
import { deletePerson } from '../repo/persons/write';
import { deleteEvent } from '../repo/events/write';
import { deleteCollection } from '../repo/collections/write';

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
  /** 给人看的几行摘要（标签、时间、正文开头……），点开详情直接列出来 */
  detail?: string[];
}

export interface SnapDiff {
  created: SnapDiffItem[];
  updated: SnapDiffItem[];
  deleted: SnapDiffItem[];
  /** 这一轮里动过、但最终又回到原样的对象（建了又删、删了又建）：净变化为零 */
  reverted: SnapDiffItem[];
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
  /** 人物状态：active / archived / merged（事件与事件集表没有这一列） */
  status?: string;
  tags_json?: string;
  notes?: string;
  description?: string;
}

function clipText(v: unknown, max = 100): string {
  const text = String(v ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 从行里挑几行给人看的信息，存进 diff，详情弹窗不用回库查 */
function detailLines(kind: 'person' | 'event' | 'collection', row: Row): string[] {
  const out: string[] = [];
  if (kind === 'person') {
    try {
      const tags = JSON.parse(String(row.tags_json ?? '[]')) as unknown;
      if (Array.isArray(tags) && tags.length) out.push(`标签：${tags.map(String).join('、')}`);
    } catch { /* ignore */ }
    const notes = clipText(row.notes);
    if (notes) out.push(`备注：${notes}`);
  } else if (kind === 'event') {
    if (row.start_ts) {
      try {
        out.push(`时间：${new Date(Number(row.start_ts)).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`);
      } catch { /* ignore */ }
    }
    try {
      const p = row.place_json ? JSON.parse(String(row.place_json)) : null;
      if (p?.name) out.push(`地点：${String(p.name)}`);
    } catch { /* ignore */ }
    const content = clipText(row.content);
    if (content) out.push(`正文：${content}`);
  } else {
    const desc = clipText(row.description);
    if (desc) out.push(`描述：${desc}`);
  }
  return out;
}

interface SqlLike {
  exec: (sql: string) => Array<{ columns: string[]; values: unknown[][] }>;
}

/**
 * 读整张表。
 *
 * 必须是 `SELECT *`：三张主表的列并不齐（events 没有 name、collections 没有 title/content），
 * 写死列名会让 SQLite 直接报错「no such column」，diff 静默变成空——
 * 表现就是成果详情里增删改三组全都不显示。列按实际返回的 columns 取，缺了就当没值。
 */
function readTable(db: SqlLike, table: string): Map<string, Row> {
  const res = db.exec(`SELECT * FROM ${table}`);
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

/** 每次写入都会变的字段，不参与「内容有没有变」的判断 */
const VOLATILE = new Set(['rev', 'updated_at', 'hlc', 'deleted_at']);

/**
 * 一行内容的指纹：除掉易变字段后按列排序序列化。
 * 比只比 rev 更可靠——有些改动（改属性、改标签）未必同步 bump rev。
 */
function signature(row: Row): string {
  const rec = row as unknown as Record<string, unknown>;
  const keys = Object.keys(rec)
    .filter((k) => !VOLATILE.has(k))
    .sort();
  return JSON.stringify(keys.map((k) => rec[k] ?? null));
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

/**
 * 这个对象在用户眼里还算「在吗」。
 *
 * 除了软删（deleted_at），人物归档 / 被合并也会从人物列表里消失——
 * 对用户来说和删掉没区别，得算进「删除」，否则「删了 P2」会显示在「修改」里。
 */
function isGone(kind: 'person' | 'event' | 'collection', row: Row | undefined): boolean {
  if (!row) return false;
  if (!!row.deleted_at) return true;
  if (kind === 'person') {
    const st = String(row.status ?? '');
    return st === 'archived' || st === 'merged';
  }
  return false;
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
    const result: SnapDiff = { created: [], updated: [], deleted: [], reverted: [] };

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
        const curDeleted = isGone(kind, curRow);
        const wasDeleted = isGone(kind, oldRow);
        const name = itemName(kind, curRow);

        if (!oldRow) {
          // 快照里没有：这一轮新建的。建完又删掉的净变化为零，单独归到 reverted，
          // 免得用户在「新增」里点一个已经不存在的对象
          if (curDeleted) result.reverted.push({ kind, id, name });
          else result.created.push({ kind, id, name, detail: detailLines(kind, curRow) });
        } else if (!wasDeleted && curDeleted) {
          result.deleted.push({ kind, id, name, before: kind === 'event' ? eventBefore(oldRow) : {}, detail: detailLines(kind, oldRow) });
        } else if (!wasDeleted && !curDeleted) {
          if (signature(oldRow) !== signature(curRow)) {
            result.updated.push({ kind, id, name, detail: detailLines(kind, curRow) });
          }
        } else if (wasDeleted && !curDeleted) {
          // 快照里是删掉的、现在又有了：等于重新出现，按新增算
          result.created.push({ kind, id, name, detail: detailLines(kind, curRow) });
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
        // 新建的：走仓库层的软删，不直接 DELETE——
        // 本项目的删除一律软删（见架构文档 §11），直接物理删会绕过 oplog 与回收站，
        // 用户想反悔也找不回来。
        if (r.kind === 'person') deletePerson(r.id);
        else if (r.kind === 'event') deleteEvent(r.id);
        else deleteCollection(r.id);
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
