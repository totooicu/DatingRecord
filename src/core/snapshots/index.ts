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

export interface SnapMeta {
  id: string;
  /** 谁建的：manual（用户手点）/ ai（AI 动手前自动）/ cli */
  source: 'manual' | 'ai' | 'cli' | 'auto';
  /** 建快照时库里有几条主要记录，给人一个「这里面有多少东西」的量感 */
  persons: number;
  events: number;
  bytes: number;
  createdAt: string;
  /** 备注，例如「AI：把林小满的生日改成了 1999-01-01」 */
  note?: string;
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
