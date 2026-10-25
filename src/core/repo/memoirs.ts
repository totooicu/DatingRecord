// 回忆录仓储：事件集下的一本（或多本）回顾。
//
// 读的时候才把页面事件取出来：pages_json 里只有事件 id 与编辑决策，
// 所以事件改名、改地点、删掉，回忆录都会立刻反映出来（删掉的页显示为缺失）。

import { queryAll, queryOne, run, transact, appendOplog, getDeviceId } from '../db';
import { newId } from '../id';
import { hlcNow } from '../time';
import { rowToMemoir, memoirToRow } from '../io/mappers';
import type { Row } from '../io/mappers';
import { getCollection, isSmart, listSmartEvents } from './collections';
import { descendantEventIds } from './collections';
import { getEvent } from './events';
import { getFile, fileByStoredId } from './files';
import { extractFileRefs } from '../markdown';
import type { DREvent, Memoir, MemoirPage, MemoirScope } from '../types';

// ---------------- 读 ----------------

export function listMemoirs(collectionId: string): Memoir[] {
  return queryAll<Row>(
    'SELECT * FROM memoirs WHERE collection_id = ? AND deleted_at IS NULL ORDER BY created_at DESC',
    [collectionId],
  ).map(rowToMemoir);
}

export function getMemoir(id: string): Memoir | null {
  const r = queryOne<Row>('SELECT * FROM memoirs WHERE id = ?', [id]);
  const m = r ? rowToMemoir(r) : null;
  return m && !m.deletedAt ? m : null;
}

/**
 * 回忆录页面按顺序解析成事件。
 * 事件不存在 / 已删除时给 null，UI 显示「原事件已删除」而不是整页消失。
 */
export function memoirPages(m: Memoir): { page: MemoirPage; event: DREvent | null }[] {
  return m.pages.filter((p) => !p.hidden).map((page) => ({ page, event: getEvent(page.eventId) }));
}

/** 事件集里可被收进回忆录的事件（含子集；智能集合按规则现算） */
export function collectionEventOptions(collectionId: string): DREvent[] {
  const c = getCollection(collectionId);
  if (!c) return [];
  const ids = isSmart(c) ? listSmartEvents(c).map((e) => e.id) : descendantEventIds(collectionId);
  const seen = new Set<string>();
  const out: DREvent[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const e = getEvent(id);
    if (e) out.push(e);
  }
  return out.sort(byTime);
}

// ---------------- 写 ----------------

export function createMemoir(input: {
  collectionId: string;
  title: string;
  subtitle?: string;
  scope: MemoirScope;
  events: DREvent[];
  source?: 'manual' | 'ai';
  aiModel?: string | null;
}): Memoir {
  const id = newId('mem');
  const now = new Date().toISOString();
  const pages: MemoirPage[] = input.events.map((e) => ({
    id: newId('mem'),
    eventId: e.id,
  }));
  const m: Memoir = {
    id,
    collectionId: input.collectionId,
    title: input.title.trim() || '未命名回忆',
    subtitle: input.subtitle?.trim() ?? '',
    coverFileId: null,
    playlistId: null,
    scope: input.scope,
    pages,
    source: input.source ?? 'manual',
    aiModel: input.aiModel ?? null,
    deviceId: getDeviceId(),
    rev: 1,
    hlc: hlcNow(getDeviceId()),
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  transact(() => {
    writeRow(m);
    appendOplog('memoir', id, 'insert', { title: m.title, collectionId: m.collectionId });
  });
  return m;
}

/** 只改「编辑决策」；事件内容永远不落进回忆录 */
export function updateMemoir(
  id: string,
  patch: Partial<
    Pick<Memoir, 'title' | 'subtitle' | 'coverFileId' | 'playlistId' | 'scope' | 'pages' | 'source' | 'aiModel'>
  >,
): void {
  const cur = getMemoir(id);
  if (!cur) return;
  const next: Memoir = {
    ...cur,
    ...patch,
    rev: cur.rev + 1,
    hlc: hlcNow(getDeviceId()),
    updatedAt: new Date().toISOString(),
  };
  transact(() => {
    writeRow(next);
    appendOplog('memoir', id, 'update', { title: next.title });
  });
}

export function deleteMemoir(id: string): void {
  const now = new Date().toISOString();
  transact(() => {
    run('UPDATE memoirs SET deleted_at = ?, rev = rev + 1, hlc = ?, updated_at = ? WHERE id = ?', [
      now,
      hlcNow(getDeviceId()),
      now,
      id,
    ]);
    appendOplog('memoir', id, 'delete');
  });
}

// ---------------- 重新扫描 ----------------

export interface ScanResult {
  added: DREvent[];
  removed: DREvent[];
}

/**
 * 对比「按当前集合 + 时间范围算出来的事件」与冻结快照。
 * 只报告差异，不写入——加不加由用户决定。
 */
export function scanMemoir(m: Memoir): ScanResult {
  const all = collectionEventOptions(m.collectionId);
  const inRange = all.filter((e) => inScopeTime(e, m.scope));
  const frozen = new Set(m.scope.eventIds);
  const current = new Set(inRange.map((e) => e.id));
  return {
    added: inRange.filter((e) => !frozen.has(e.id)),
    removed: all.filter((e) => frozen.has(e.id) && !current.has(e.id)),
  };
}

/** 把扫描到的新事件并入快照与页面（追加在末尾，保持用户已排好的顺序） */
export function applyScan(m: Memoir, added: DREvent[]): Memoir {
  if (!added.length) return m;
  const pages = [
    ...m.pages,
    ...added.filter((e) => !m.pages.some((p) => p.eventId === e.id)).map((e) => ({ id: newId('mem'), eventId: e.id })),
  ];
  const scope: MemoirScope = {
    ...m.scope,
    eventIds: [...m.scope.eventIds, ...added.map((e) => e.id)],
    frozenAt: new Date().toISOString(),
  };
  updateMemoir(m.id, { pages, scope });
  return { ...m, pages, scope };
}

// ---------------- 图片 ----------------

/** 事件里能当配图的附件 id：正文 file: 引用 + media（两处都认） */
export function eventImageIds(e: DREvent): string[] {
  const out: string[] = [];
  const push = (f: { id: string; mime: string } | null | undefined) => {
    if (f && f.mime.startsWith('image/') && !out.includes(f.id)) out.push(f.id);
  };
  for (const key of extractFileRefs(e.content)) push(fileByStoredId(key) ?? getFile(key));
  for (const m of e.media) push(getFile(m) ?? fileByStoredId(m));
  return out;
}

/** 回忆录封面：自己选的 → 第一张能用的页图 */
export function memoirCoverId(m: Memoir): string | null {
  if (m.coverFileId) return m.coverFileId;
  for (const p of m.pages) {
    if (p.hidden) continue;
    if (p.coverFileId) return p.coverFileId;
    const e = getEvent(p.eventId);
    if (!e) continue;
    const img = eventImageIds(e)[0];
    if (img) return img;
  }
  return null;
}

// ---------------- 内部 ----------------

function writeRow(m: Memoir): void {
  const row = memoirToRow(m);
  const keys = Object.keys(row);
  run(
    `INSERT OR REPLACE INTO memoirs (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
    keys.map((k) => row[k] as never),
  );
}

function byTime(a: DREvent, b: DREvent): number {
  const at = a.startTs ?? Number.MAX_SAFE_INTEGER;
  const bt = b.startTs ?? Number.MAX_SAFE_INTEGER;
  if (at !== bt) return at - bt;
  return a.createdAt.localeCompare(b.createdAt);
}

/** 时间范围按事件 start_ts 判断（模糊时间也用估算值参与，和排序口径一致） */
export function inScopeTime(e: DREvent, scope: Pick<MemoirScope, 'from' | 'to'>): boolean {
  if (!scope.from && !scope.to) return true;
  const ts = e.startTs;
  if (ts == null) return true; // 没有时间的条目不该被时间范围误删
  if (scope.from) {
    const from = Date.parse(`${scope.from}T00:00:00`);
    if (Number.isFinite(from) && ts < from) return false;
  }
  if (scope.to) {
    const to = Date.parse(`${scope.to}T23:59:59.999`);
    if (Number.isFinite(to) && ts > to) return false;
  }
  return true;
}
