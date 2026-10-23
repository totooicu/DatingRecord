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
import type { SnapDiff, SnapDiffItem } from './diff';

export type { SnapDiff, SnapDiffItem };

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
  /** 对比快照和当前库得出的增删改分组（AI 轮次结束后回写） */
  diff?: SnapDiff;
  /**
   * AI 改动的审核状态：pending = 改动已暂存、等用户点「执行」；
   * applied = 已执行完；没有 = 普通备份（手动 / CLI / 恢复前留底）。
   */
  review?: 'pending' | 'applied';
  /** 待执行时「改完之后」的整库字节存在哪个 id 下（执行 / 放弃后删掉） */
  afterId?: string;
}

/** 这一轮新建 / 变动的对象，列表里直接展示成人名、事件名，点开就能跳过去 */
export type SnapTargetKind = 'person' | 'event' | 'collection';

export interface SnapTarget {
  kind: SnapTargetKind;
  id: string;
  /** 当时的名字（对象后来改名了，这里仍是那一轮做出来的名字） */
  name: string;
  /** 删除/归档类操作在删前把对象关键内容存这里——对象已软删，事后点开看详情不查库 */
  snapshot?: {
    content?: string;
    timeLabel?: string;
    personNames?: string[];
    placeName?: string;
  };
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

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * 把这一轮的写操作暂存起来：导出 after，然后立刻把库切回动手前。
 *
 * 做法是「整库两份字节」：before 就是快照本身，after 另存一份。
 * 比对新增 / 删除 / 改名由 agent 轮次结束时算好的 diff 提供，
 * 所以这里只负责暂存与回退，不重复扫表。
 */
export async function stageAiTurn(
  id: string,
  ops: SnapOp[],
  note: string,
): Promise<SnapMeta | null> {
  const db = getDbInstance();
  const sql = getSql();
  if (!db || !sql) return null;
  const store = getSnapStore();
  const beforeBytes = await store.get(id);
  if (!beforeBytes) return null;
  const afterBytes = new Uint8Array(db.export());
  // 全是失败的工具调用时库没变，不必生成一张空成果
  if (sameBytes(beforeBytes, afterBytes)) return null;

  // 元数据要趁「改之后」的库还在时读：快照字节是写元数据之前导出的，
  // 切回 before 之后那份库里还没有这条快照，readMeta 会找不到它。
  const list = readMeta();
  const i = list.findIndex((s) => s.id === id);
  if (i < 0) return null;

  const afterId = newId('pend');
  await store.put(afterId, afterBytes);

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
    if (kind === 'person') db.run('UPDATE persons SET display_name = ? WHERE id = ?', [clean, recordId]);
    else if (kind === 'event') db.run('UPDATE events SET title = ? WHERE id = ?', [clean, recordId]);
    else db.run('UPDATE collections SET name = ? WHERE id = ?', [clean, recordId]);
    await store.put(meta.afterId, new Uint8Array(db.export()));
  } finally {
    db.close();
  }

  const list = readMeta();
  const i = list.findIndex((s) => s.id === snapId);
  if (i < 0) return null;
  const diff = list[i].diff;
  const next: SnapMeta = {
    ...list[i],
    ...(diff
      ? {
          diff: {
            ...diff,
            created: diff.created.map((r) =>
              r.kind === kind && r.id === recordId ? { ...r, name: clean } : r,
            ),
            updated: diff.updated.map((r) =>
              r.kind === kind && r.id === recordId ? { ...r, name: clean } : r,
            ),
            deleted: diff.deleted.map((r) =>
              r.kind === kind && r.id === recordId ? { ...r, name: clean } : r,
            ),
          },
        }
      : {}),
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

/** 回写 diff 结果（增删改分组） */
export function patchSnapshotDiff(id: string, diff: SnapDiff): SnapMeta | null {
  const list = readMeta();
  const i = list.findIndex((s) => s.id === id);
  if (i < 0) return null;
  const next: SnapMeta = { ...list[i], diff };
  list[i] = next;
  writeMeta(list);
  flushPersist();
  bump();
  return next;
}

/** 超量就扔最旧的。保留最新的 MAX_SNAPS 个，且总字节不超上限 */
async function prune(store: SnapBytes, list: SnapMeta[]): Promise<void> {
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
export function describeOp(
  tool: string,
  args: Record<string, unknown>,
  ok: boolean,
  data?: unknown,
): string {
  if (!ok) return `${tool} 失败`;
  const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  // 工具返回的结果行（删除类工具现在会把被删对象的名字带回来）
  const row = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
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
  if (tool === 'person.archive' || tool === 'person.restore') {
    const nm = s(row?.displayName);
    const verb = tool === 'person.archive' ? '归档人物' : '恢复人物';
    return nm ? `${verb}「${nm}」` : (id ? `${verb} ${id}` : verb);
  }
  if (tool === 'person.merge') return '合并重复人物';
  if (tool === 'person.applyTemplate') return `套用模板 ${s(args.templateId) || ''}`.trim();
  if (tool === 'person.hardDelete') {
    const nm = s(row?.displayName);
    return nm ? `彻底删除人物「${nm}」` : '彻底删除人物';
  }

  if (tool === 'event.create') return name ? `记事件「${name}」` : '记一条事件';
  if (tool === 'event.update') return '修改事件';
  if (tool === 'event.delete' || tool === 'event.purge') {
    const nm = s(row?.title);
    const verb = tool === 'event.purge' ? '彻底删除事件' : '删除事件';
    return nm ? `${verb}「${nm}」` : verb;
  }
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
  if (tool === 'collection.delete') {
    const nm = s(row?.name);
    return nm ? `删除事件集「${nm}」` : '删除事件集';
  }
  if (tool === 'collection.restore') return '恢复事件集';
  if (tool === 'collection.setPrivate') return args.on ? '标记事件集为隐私' : '取消事件集隐私标记';

  if (tool === 'file.rename') return name ? `文件改名为「${name}」` : '重命名文件';
  if (tool === 'file.delete') {
    const nm = s(row?.name);
    return nm ? `删除附件「${nm}」` : '删除文件';
  }
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
