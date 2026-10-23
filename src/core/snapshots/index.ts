// 整库快照：AI / CLI 动手改数据之前的「后悔药」。
//
// 和撤销栈（undo.ts）的分工：
//   · 撤销栈在内存里，刷新即失效，管的是「刚才那一下点错了」；
//   · 快照落盘，管的是「AI 一顿操作之后整体不对，想回到它动手前」。
// 后者没法用撤销栈代替——AI 一轮可能触发十几次写，用户不可能连点十次撤销，
// 而且中途任何一次刷新都会把栈清空。
//
// 存储：整库 export() 的字节，放在独立后端（见 store.ts）。
// 元数据（谁建的、为什么建、多大）单独记，不混在字节里——恢复只要字节，
// 但列表要能给人看。

import { getDbInstance, getSql, setDbInstance } from '../db/state';
import { flushPersist } from '../db/persist';
import { bump } from '../../store';
import { newId } from '../id';
import { getSnapStore, type SnapBytes } from './store';
import type { CollectionIcon } from '../types';

export interface SnapMeta {
  id: string;
  /** 谁建的：manual（用户手点）/ ai（AI 动手前自动）/ cli / auto（恢复前留底） */
  source: 'manual' | 'ai' | 'cli' | 'auto';
  /** 建快照时库里有几条主要记录，给人一个「这里面有多少东西」的量感 */
  persons: number;
  events: number;
  bytes: number;
  createdAt: string;
  /** 备注，例如「AI：新建人物「林小满」、添加 2 条事件」 */
  note?: string;
  /** 这一轮到底动了什么（AI 轮次结束后回写）。给人看，也给人点开细看 */
  ops?: SnapOp[];
  /**
   * AI 改动的审核状态：pending = 改动已暂存、等用户点「执行」；
   * applied = 已执行完；没有 = 普通备份（手动 / CLI / 恢复前留底）。
   */
  review?: 'pending' | 'applied';
  /** 待执行时「改完之后」的整库字节存在哪个 id 下（执行 / 放弃后删掉） */
  afterId?: string;
  /** 这一轮新增、删除、改名的具体记录：成果卡上直接显示名字，点开看详情 */
  added?: SnapRecordRef[];
  deleted?: SnapRecordRef[];
  renamed?: SnapRecordRef[];
}

/** 这一轮新建 / 变动的对象，列表里直接展示成人名、事件名，点开就能跳过去 */
export type SnapTargetKind = 'person' | 'event' | 'collection';

export interface SnapTarget {
  kind: SnapTargetKind;
  id: string;
  /** 当时的名字（对象后来改名了，这里仍是那一轮做出来的名字） */
  name: string;
}

/** 审核用的记录引用：名字、头像/图标、可读的字段摘要都在这里，不依赖库里还在不在 */
export interface SnapRecordRef {
  kind: SnapTargetKind;
  id: string;
  name: string;
  /** 改名前的名字（只有 renamed 里有） */
  fromName?: string;
  avatar?: string | null;
  icon?: CollectionIcon | null;
  /** 详情弹窗里的字段行，如「时间：2026-10-01」「标签：旅行、生日」 */
  detail?: string[];
}

/** 一次具体操作。args 只留摘要，不存原文——快照元数据要能塞进 meta 表 */
export interface SnapOp {
  /** 工具名，如 person.create */
  tool: string;
  /** 人类可读的一句话，如「新建人物「林小满」」 */
  text: string;
  ok: boolean;
  /** 失败时的原因（截断） */
  err?: string;
  /** 这一条具体产出的对象：新建人物 / 事件 / 事件集时带上，供列表展示与点击跳转 */
  targets?: SnapTarget[];
  at: string;
}

/** 上限：快照是整库拷贝，囤多了比没有备份更糟（磁盘 silent 爆掉） */
const MAX_SNAPS = 20;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

const META_KEY = 'snapshots.meta';

function readMeta(): SnapMeta[] {
  const d = getDbInstance();
  if (!d) return [];
  const res = d.exec(`SELECT value FROM meta WHERE key = '${META_KEY}'`);
  const raw = res[0]?.values?.[0]?.[0];
  if (!raw) return [];
  try {
    const arr = JSON.parse(String(raw)) as SnapMeta[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeMeta(list: SnapMeta[]): void {
  const d = getDbInstance();
  if (!d) return;
  d.run(`INSERT INTO meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [META_KEY, JSON.stringify(list)]);
}

function counts(): { persons: number; events: number } {
  const d = getDbInstance();
  if (!d) return { persons: 0, events: 0 };
  const one = (sql: string) => {
    const r = d.exec(sql);
    return Number(r[0]?.values?.[0]?.[0] ?? 0);
  };
  return {
    persons: one('SELECT COUNT(*) FROM persons WHERE deleted_at IS NULL'),
    events: one('SELECT COUNT(*) FROM events WHERE deleted_at IS NULL'),
  };
}

/** 建一个快照。返回元数据；库未初始化时返回 null */
export async function createSnapshot(
  source: SnapMeta['source'] = 'manual',
  note?: string,
): Promise<SnapMeta | null> {
  const db = getDbInstance();
  if (!db) return null;
  const bytes = new Uint8Array(db.export());
  const id = newId('snap');
  const c = counts();
  const meta: SnapMeta = {
    id,
    source,
    persons: c.persons,
    events: c.events,
    bytes: bytes.length,
    createdAt: new Date().toISOString(),
    ...(note ? { note } : {}),
  };
  const store = getSnapStore();
  await store.put(id, bytes);
  const list = [meta, ...readMeta()];
  writeMeta(list);
  await prune(store, list);
  // 元数据写进内存库后必须显式落盘：快照的增删改不能指望后续某次 repo 写
  // 操作顺带把整库冲进 IndexedDB（手动快照、或删除后不再有写操作时就会漏掉），
  // 否则刷新回来元数据和字节对不上，出现「删了又回来」的幽灵快照。
  flushPersist();
  bump();
  return meta;
}

/** 全部快照，新的在前 */
export function listSnapshots(): SnapMeta[] {
  return readMeta();
}

/** 恢复：把库实例整体换回快照那份字节，然后立刻落盘 */
export async function restoreSnapshot(id: string): Promise<boolean> {
  const sql = getSql();
  const store = getSnapStore();
  const bytes = await store.get(id);
  if (!sql || !bytes) return false;

  // 恢复前先给当前状态留一个退路：万一路径选错了，还能再退回来
  const db = getDbInstance();
  if (db) {
    const cur = new Uint8Array(db.export());
    const bakId = newId('snap');
    await store.put(bakId, cur);
    const c = counts();
    writeMeta([
      {
        id: bakId,
        source: 'auto',
        persons: c.persons,
        events: c.events,
        bytes: cur.length,
        createdAt: new Date().toISOString(),
        note: '恢复快照前的自动留底',
      },
      ...readMeta(),
    ]);
  }

  const next = new sql.Database(bytes);
  next.run('PRAGMA foreign_keys = ON');
  db?.close();
  setDbInstance(next);
  flushPersist();
  bump();
  return true;
}

/** 删一个快照（元数据 + 字节一起） */
export async function deleteSnapshot(id: string): Promise<void> {
  await getSnapStore().del(id);
  writeMeta(readMeta().filter((s) => s.id !== id));
  flushPersist();
  bump();
}

/**
 * 回写快照的操作记录。
 *
 * 快照是在动手**之前**拍的，那时还不知道这一轮要干什么，所以摘要只能等
 * 轮次结束后补。AI 干完活调这个函数，把「到底改了什么」写进元数据。
 * 只改元数据，不动字节——字节是恢复用的，必须保持原样。
 */
export function patchSnapshotOps(
  id: string,
  ops: SnapOp[],
  note?: string,
): SnapMeta | null {
  const list = readMeta();
  const i = list.findIndex((s) => s.id === id);
  if (i < 0) return null;
  const next: SnapMeta = {
    ...list[i],
    ...(ops.length ? { ops } : {}),
    ...(note ? { note } : {}),
  };
  list[i] = next;
  writeMeta(list);
  flushPersist();
  bump();
  return next;
}

// ---------------- AI 改动：先暂存，等用户点「执行」 ----------------
//
// 为什么用「前后两份整库字节」而不是逐条记 SQL：写入口有几十个，
// 一轮工具调用又可能改多张表；整库 export() 本来就是一次 memcpy，
// 拍一份「之后」的字节最省事，也能一键放弃。
//
// 流程：AI 本轮动手前已有 before 快照 → 轮次结束导出 after →
// 对比出新增 / 删除 / 改名 → 把 after 存到 afterId → 立刻把库切回 before。
// 用户点「执行」才把 after 换回来；点「放弃」就删掉两份，库始终没变过。

type RawRow = Record<string, unknown>;

function rowsOf(db: import('sql.js').Database, table: string): Map<string, RawRow> {
  const out = new Map<string, RawRow>();
  const set = db.exec(`SELECT * FROM ${table}`)[0];
  if (!set) return out;
  const idAt = set.columns.indexOf('id');
  for (const values of set.values) {
    const row: RawRow = {};
    set.columns.forEach((c, i) => {
      row[c] = values[i];
    });
    const id = String(values[idAt] ?? '');
    if (id) out.set(id, row);
  }
  return out;
}

const TABLE_OF: Record<SnapTargetKind, string> = {
  person: 'persons',
  event: 'events',
  collection: 'collections',
};

const NAME_COL: Record<SnapTargetKind, string> = {
  person: 'display_name',
  event: 'title',
  collection: 'name',
};

const UPDATE_COL: Record<SnapTargetKind, string> = {
  person: 'display_name',
  event: 'title',
  collection: 'name',
};

function isActive(kind: SnapTargetKind, row: RawRow | undefined): boolean {
  if (!row) return false;
  if (row.deleted_at !== null && row.deleted_at !== undefined) return false;
  // 人物的「删除」是归档（status=archived），不再改 deleted_at
  if (kind === 'person' && row.status === 'archived') return false;
  return true;
}

function nameOf(kind: SnapTargetKind, row: RawRow): string {
  const v = row[NAME_COL[kind]];
  return typeof v === 'string' && v.trim() ? v.trim() : '（未命名）';
}

function jsonArray(v: unknown): string[] {
  if (typeof v !== 'string' || !v) return [];
  try {
    const arr = JSON.parse(v) as unknown;
    return Array.isArray(arr) ? arr.map((x) => String(x)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function jsonObject(v: unknown): Record<string, unknown> {
  if (typeof v !== 'string' || !v) return {};
  try {
    const o = JSON.parse(v) as unknown;
    return o && typeof o === 'object' ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function tsText(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '';
  const d = new Date(n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function clip(text: string, max = 80): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 一条记录给人看的摘要：详情弹窗里直接列这些行，不再回库查 */
function detailOf(kind: SnapTargetKind, row: RawRow): string[] {
  const out: string[] = [];
  if (kind === 'person') {
    const aliases = jsonArray(row.aliases_json);
    if (aliases.length) out.push(`别名：${aliases.join('、')}`);
    const tags = jsonArray(row.tags_json);
    if (tags.length) out.push(`标签：${tags.join('、')}`);
    if (row.kind === 'group') out.push('类型：群体');
    const notes = typeof row.notes === 'string' ? row.notes.trim() : '';
    if (notes) out.push(`备注：${clip(notes, 100)}`);
  } else if (kind === 'event') {
    const t = tsText(row.start_ts);
    if (t) out.push(`时间：${t}`);
    if (typeof row.kind === 'string' && row.kind) out.push(`类型：${row.kind}`);
    const place = jsonObject(row.place_json);
    if (typeof place.name === 'string' && place.name) out.push(`地点：${place.name}`);
    const content = typeof row.content === 'string' ? row.content.trim() : '';
    if (content) out.push(`正文：${clip(content, 100)}`);
  } else {
    if (typeof row.kind === 'string' && row.kind) out.push(`类型：${row.kind}`);
    if (typeof row.status === 'string' && row.status) out.push(`状态：${row.status}`);
    const desc = typeof row.description === 'string' ? row.description.trim() : '';
    if (desc) out.push(`描述：${clip(desc, 100)}`);
  }
  return out;
}

function refOf(kind: SnapTargetKind, row: RawRow): SnapRecordRef {
  const base: SnapRecordRef = { kind, id: String(row.id), name: nameOf(kind, row) };
  if (kind === 'person') {
    base.avatar = typeof row.avatar === 'string' ? row.avatar : null;
    const icon = jsonObject(row.icon_json);
    base.icon = Object.keys(icon).length ? (icon as unknown as CollectionIcon) : null;
  } else if (kind === 'collection') {
    const icon = jsonObject(row.icon_json);
    base.icon = Object.keys(icon).length ? (icon as unknown as CollectionIcon) : null;
  }
  const detail = detailOf(kind, row);
  if (detail.length) base.detail = detail;
  return base;
}

interface SnapDiff {
  added: SnapRecordRef[];
  deleted: SnapRecordRef[];
  renamed: SnapRecordRef[];
}

function diffSnapshots(before: import('sql.js').Database, after: import('sql.js').Database): SnapDiff {
  const added: SnapRecordRef[] = [];
  const deleted: SnapRecordRef[] = [];
  const renamed: SnapRecordRef[] = [];
  for (const kind of ['person', 'event', 'collection'] as SnapTargetKind[]) {
    const table = TABLE_OF[kind];
    const a = rowsOf(before, table);
    const b = rowsOf(after, table);
    for (const [id, row] of b) {
      const prev = a.get(id);
      const was = isActive(kind, prev);
      const now = isActive(kind, row);
      if (now && !was) added.push(refOf(kind, row));
      else if (now && was && prev && nameOf(kind, prev) !== nameOf(kind, row)) {
        const ref = refOf(kind, row);
        ref.fromName = nameOf(kind, prev);
        renamed.push(ref);
      }
    }
    for (const [id, row] of a) {
      if (!isActive(kind, row)) continue;
      if (!b.has(id) || !isActive(kind, b.get(id))) deleted.push(refOf(kind, row));
    }
  }
  const byName = (x: SnapRecordRef, y: SnapRecordRef) => x.name.localeCompare(y.name, 'zh');
  return { added: added.sort(byName), deleted: deleted.sort(byName), renamed: renamed.sort(byName) };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * 把这一轮的写操作暂存起来：导出 after，算出新增/删除/改名，
 * 然后立刻把库切回动手前。返回的是更新后的成果元数据。
 */
export async function stageAiTurn(id: string, ops: SnapOp[], note: string): Promise<SnapMeta | null> {
  const db = getDbInstance();
  const sql = getSql();
  if (!db || !sql) return null;
  const store = getSnapStore();
  const beforeBytes = await store.get(id);
  if (!beforeBytes) return null;
  const afterBytes = new Uint8Array(db.export());
  // 全是失败的工具调用时库没变，不必生成一张空成果
  if (sameBytes(beforeBytes, afterBytes)) return null;

  const beforeDb = new sql.Database(beforeBytes);
  const afterDb = new sql.Database(afterBytes);
  let diff: SnapDiff;
  try {
    diff = diffSnapshots(beforeDb, afterDb);
  } finally {
    beforeDb.close();
    afterDb.close();
  }

  const afterId = newId('pend');
  await store.put(afterId, afterBytes);

  // 元数据要趁「改之后」的库还在时读：快照字节是写元数据之前导出的，
  // 切回 before 之后那份库里还没有这条快照，readMeta 会找不到它。
  const list = readMeta();
  const i = list.findIndex((s) => s.id === id);
  if (i < 0) {
    await store.del(afterId);
    return null;
  }

  // 先换回动手前的库，再写元数据：这样随后的 flushPersist 落盘的是「没改过」的状态
  const next = new sql.Database(beforeBytes);
  next.run('PRAGMA foreign_keys = ON');
  db.close();
  setDbInstance(next);

  const staged: SnapMeta = {
    ...list[i],
    note,
    ops,
    review: 'pending',
    afterId,
    ...diff,
  };
  list[i] = staged;
  writeMeta(list);
  flushPersist();
  bump();
  return staged;
}

/** 执行暂存的改动：把 after 换回当前库 */
export async function applyPendingSnapshot(id: string): Promise<boolean> {
  const sql = getSql();
  const meta = readMeta().find((s) => s.id === id);
  if (!sql || !meta || meta.review !== 'pending' || !meta.afterId) return false;
  const bytes = await getSnapStore().get(meta.afterId);
  if (!bytes) return false;
  const next = new sql.Database(bytes);
  next.run('PRAGMA foreign_keys = ON');
  const db = getDbInstance();
  setDbInstance(next);
  db?.close();
  await getSnapStore().del(meta.afterId);

  const list = readMeta();
  const i = list.findIndex((s) => s.id === id);
  if (i >= 0) {
    const applied: SnapMeta = { ...list[i], review: 'applied' };
    delete applied.afterId;
    list[i] = applied;
    writeMeta(list);
  }
  flushPersist();
  bump();
  return true;
}

/** 放弃暂存的改动：库本来就没变，删掉两份字节和这条成果即可 */
export async function discardPendingSnapshot(id: string): Promise<void> {
  const meta = readMeta().find((s) => s.id === id);
  if (meta?.afterId) await getSnapStore().del(meta.afterId);
  await deleteSnapshot(id);
}

/** 待执行时改一条新增记录的名字（只改暂存的那份 after 字节） */
export async function renamePendingRecord(
  snapId: string,
  kind: SnapTargetKind,
  recordId: string,
  name: string,
): Promise<SnapMeta | null> {
  const sql = getSql();
  const meta = readMeta().find((s) => s.id === snapId);
  const clean = name.trim();
  if (!sql || !meta || meta.review !== 'pending' || !meta.afterId || !clean) return null;
  const store = getSnapStore();
  const bytes = await store.get(meta.afterId);
  if (!bytes) return null;
  const db = new sql.Database(bytes);
  try {
    db.run(`UPDATE ${TABLE_OF[kind]} SET ${UPDATE_COL[kind]} = ? WHERE id = ?`, [clean, recordId]);
    await store.put(meta.afterId, new Uint8Array(db.export()));
  } finally {
    db.close();
  }
  const patch = (list: SnapRecordRef[] | undefined) =>
    list?.map((r) => (r.kind === kind && r.id === recordId ? { ...r, name: clean } : r));
  const list = readMeta();
  const i = list.findIndex((s) => s.id === snapId);
  if (i < 0) return null;
  const next: SnapMeta = {
    ...list[i],
    ...(list[i].added ? { added: patch(list[i].added) } : {}),
    ...(list[i].deleted ? { deleted: patch(list[i].deleted) } : {}),
    ...(list[i].renamed ? { renamed: patch(list[i].renamed) } : {}),
  };
  list[i] = next;
  writeMeta(list);
  flushPersist();
  bump();
  return next;
}

/** 本轮失败 / 没拿到回复：把库退回动手前，并删掉这份没用的快照 */
export async function revertAiTurn(id: string): Promise<boolean> {
  const sql = getSql();
  if (!sql) return false;
  const bytes = await getSnapStore().get(id);
  if (!bytes) return false;
  const next = new sql.Database(bytes);
  next.run('PRAGMA foreign_keys = ON');
  const db = getDbInstance();
  setDbInstance(next);
  db?.close();
  await deleteSnapshot(id);
  return true;
}

/** 有没有还没执行 / 放弃的成果 */
export function hasPendingSnapshot(): boolean {
  return readMeta().some((s) => s.review === 'pending');
}

/** 超量就扔最旧的。保留最新的 MAX_SNAPS 个，且总字节不超上限 */async function prune(store: SnapBytes, list: SnapMeta[]): Promise<void> {
  let keep = list.slice(0, MAX_SNAPS);
  let total = keep.reduce((s, x) => s + x.bytes, 0);
  while (keep.length > 1 && total > MAX_TOTAL_BYTES) {
    const dropped = keep.pop()!;
    total -= dropped.bytes;
    await store.del(dropped.id);
  }
  if (keep.length !== list.length) writeMeta(keep);
}

/** 人类可读的体积 */
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 人类可读的时间 */
export function fmtSnapTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 把一次工具调用翻译成人话。
 *
 * 目标是「扫一眼就知道 AI 干了什么」，所以挑每个工具最有信息量的那个参数：
 * 建人物报名字、记事件报标题、改东西报改的是谁。拿不到有用参数就退到工具名。
 */
export function describeOp(tool: string, args: Record<string, unknown>, ok: boolean): string {
  if (!ok) return `${tool} 失败`;
  const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  // 取第一个有内容的字符串参数，兜底用
  const firstStr = (): string => {
    for (const v of Object.values(args)) {
      const t = s(v);
      if (t) return t.length > 24 ? `${t.slice(0, 24)}…` : t;
    }
    return '';
  };

  const name = s(args.name) || s(args.displayName) || s(args.title);
  const id = s(args.personId) || s(args.eventId) || s(args.collectionId) || s(args.id);

  if (tool === 'person.create') return name ? `新建人物「${name}」` : '新建人物';
  if (tool === 'person.update') return '修改人物资料';
  if (tool === 'person.setAttr') return `设置属性 ${s(args.key) || ''}`.trim();
  if (tool === 'person.archive' || tool === 'person.restore') return id ? `${tool === 'person.archive' ? '归档' : '恢复'}人物 ${id}` : (tool === 'person.archive' ? '归档人物' : '恢复人物');
  if (tool === 'person.merge') return '合并重复人物';
  if (tool === 'person.applyTemplate') return `套用模板 ${s(args.templateId) || ''}`.trim();
  if (tool === 'person.hardDelete') return '彻底删除人物';

  if (tool === 'event.create') return name ? `记事件「${name}」` : '记一条事件';
  if (tool === 'event.update') return '修改事件';
  if (tool === 'event.delete' || tool === 'event.purge') return tool === 'event.purge' ? '彻底删除事件' : '删除事件';
  if (tool === 'event.restore') return '恢复事件';
  if (tool === 'event.setPrivate') return args.on ? '标记事件为隐私' : '取消事件隐私标记';

  if (tool === 'chat.append') return '追加一条聊天记录';
  if (tool === 'chat.update') return '修改聊天记录';
  if (tool === 'chat.delete') return '删除聊天记录';
  if (tool === 'chat.move') return '移动聊天记录';

  if (tool === 'collection.create') return name ? `新建事件集「${name}」` : '新建事件集';
  if (tool === 'collection.update') return '修改事件集';
  if (tool === 'collection.addMember') return '往事件集里加事件';
  if (tool === 'collection.removeMember') return '从事件集移出事件';
  if (tool === 'collection.move') return '移动事件集';
  if (tool === 'collection.delete') return '删除事件集';
  if (tool === 'collection.restore') return '恢复事件集';
  if (tool === 'collection.setPrivate') return args.on ? '标记事件集为隐私' : '取消事件集隐私标记';

  if (tool === 'file.rename') return name ? `文件改名为「${name}」` : '重命名文件';
  if (tool === 'file.delete') return '删除文件';
  if (tool === 'file.setPrivate') return args.on ? '标记文件为隐私' : '取消文件隐私标记';
  if (tool === 'file.transferRefs') return '转移文件引用';

  if (tool === 'io.exportLibrary') return '导出库';
  if (tool === 'io.importLibrary') return '导入库';
  if (tool === 'io.shareBuild' || tool === 'io.shareApply') return tool === 'io.shareBuild' ? '生成分享包' : '导入分享包';

  if (tool === 'system.setMeta') return `设置 ${s(args.key) || '元数据'}`;
  if (tool === 'system.sql') return '执行 SQL';

  // 读操作不该出现在写快照里，但万一有，也别报错
  const fb = firstStr();
  return fb ? `${tool}（${fb}）` : tool;
}

/** 快照列表里那行标题：一轮操作的概括。只写不读，读操作不进快照 */
export function summarizeOps(ops: SnapOp[]): string {
  if (!ops.length) return '';
  const done = ops.filter((o) => o.ok);
  const failed = ops.length - done.length;
  // 同一句话合并计数：「新建人物「A」「B」」比罗列三行更好扫
  const parts: string[] = [];
  const seen = new Map<string, number>();
  for (const o of done) {
    seen.set(o.text, (seen.get(o.text) ?? 0) + 1);
  }
  let shown = 0;
  for (const [text, cnt] of seen) {
    if (shown >= 3) break;
    parts.push(cnt > 1 ? `${text} ×${cnt}` : text);
    shown += 1;
  }
  const rest = done.length - [...seen.values()].slice(0, 3).reduce((a, b) => a + b, 0);
  if (rest > 0) parts.push(`等 ${rest} 项`);
  let out = parts.join('、');
  if (failed > 0) out += `（${failed} 项失败）`;
  return out;
}
