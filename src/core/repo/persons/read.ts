// 人物读取：列表、归档列表、单条、统计。
// 「活跃 / 归档 / 已合并」三种状态在这里区分，别处不要各自写 WHERE。

import { queryAll, queryOne, run, transact, appendOplog, getDeviceId } from '../../db';
import { hlcNow } from '../../time';
import type { Person } from '../../types';
import { personFromRow, type PersonRow } from './rows';
import { isPrivacyMode } from '../../../privacy';

// ---------------- 人物 ----------------

export interface PersonStats {
  eventCount: number;
  lastMeetTs: number | null;
  totalCost: number;
  avgRating: number | null;
}

export interface PersonWithStats extends Person {
  stats: PersonStats;
}

export function listPersons(
  opts: { includeArchived?: boolean; keyword?: string; /** QQ 式分组筛选；给空串 = 只要未分组的人 */ group?: string } = {},
): PersonWithStats[] {
  const where: string[] = ['p.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (!opts.includeArchived) where.push("p.status = 'active'");
  if (isPrivacyMode()) where.push('p.is_private = 0');
  if (opts.group !== undefined) {
    where.push('p.group_name = ?');
    params.push(opts.group.trim());
  }
  if (opts.keyword) {
    where.push('(p.display_name LIKE ? OR p.aliases_json LIKE ? OR p.tags_json LIKE ?)');
    const kw = `%${opts.keyword}%`;
    params.push(kw, kw, kw);
  }
  const rows = queryAll<PersonRow>(
    `SELECT * FROM persons p WHERE ${where.join(' AND ')} ORDER BY p.display_name`,
    params,
  );
  // 一次性把所有人的统计算出来，避免逐人各跑一条 JOIN（万级数据下上千次 SQL）
  const statsMap = bulkStats();
  return rows.map((r) => ({ ...personFromRow(r), stats: statsMap.get(r.id) ?? EMPTY_STATS }));
}

/**
 * 「填过的组名」——不另建一张组表，直接从人物里 DISTINCT 出来。
 *
 * 所以组名天然是「用过才有」的：改完最后一个人的分组，那个组名就自动消失，
 * 不会留下一堆没人认领的空组。归档的人也算数（不然误归档会把组名抹掉），
 * 合并产生的墓碑不算。
 */
export function listGroupNames(): { name: string; count: number }[] {
  const rows = queryAll<{ name: string; c: number }>(
    `SELECT group_name AS name, COUNT(*) AS c FROM persons
     WHERE deleted_at IS NULL AND group_name <> '' ${isPrivacyMode() ? 'AND is_private = 0' : ''}
     GROUP BY group_name`,
    [],
  );
  // 人多在前、一样多按名字排；中文排序交给 localeCompare，SQLite 自己没有像样的 zh collation
  return rows
    .map((r) => ({ name: r.name, count: r.c }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
}

/**
 * 「不在人物列表里的记录」——库概览那个「+N 归档」指的就是它们。
 *
 * 两类来源，语义不同，但同样必须可见、可处理：
 *   - archived：手动点「归档」，只是 status 变了，数据完好，可原样恢复。
 *   - merged：合并重复人物时被并入的那条，写的是墓碑（deleted_at 非空），
 *     事件关联已经转到保留者名下。留着是为了同步时不把数据推回来，
 *     所以它只能被彻底清理，不该再恢复（恢复出来是个空壳）。
 */
export interface ArchivedPerson extends PersonWithStats {
  reason: 'archived' | 'merged';
  /** 被并进了谁（reason='merged' 时有值） */
  mergedIntoName: string | null;
}

export function listArchivedPersons(): ArchivedPerson[] {
  const rows = queryAll<PersonRow>(
    `SELECT * FROM persons p
     WHERE (p.deleted_at IS NOT NULL OR p.status <> 'active')
       ${isPrivacyMode() ? "AND p.is_private = 0" : ''}
     ORDER BY p.updated_at DESC`,
  );
  // 一次性把所有人的统计算出来（含已归档/合并的，统计口径与 statsOf 一致）
  const statsMap = bulkStats();
  return rows.map((r) => {
    const person = personFromRow(r);
    // 合并目标记在 oplog 里（mergePersons 写的 { id, mergedInto }），
    // 不去动 persons 表结构，省一次 schema 迁移。
    // 注意：别名不能用 to —— 它是 SQLite 关键字，会让整条 SQL 报错
    const log = queryOne<{ merged_into: string | null }>(
      `SELECT json_extract(payload, '$.mergedInto') AS merged_into FROM oplog
       WHERE entity = 'person' AND entity_id = ? AND op = 'delete'
       ORDER BY seq DESC LIMIT 1`,
      [r.id],
    );
    const target = log?.merged_into
      ? queryOne<{ display_name: string }>('SELECT display_name FROM persons WHERE id = ?', [log.merged_into])
      : null;
    const mergedIntoName = target?.display_name ?? null;
    return {
      ...person,
      stats: statsMap.get(r.id) ?? EMPTY_STATS,
      reason: r.deleted_at ? 'merged' : 'archived',
      mergedIntoName,
    };
  });
}

/** 恢复归档：重新出现在人物列表里（合并产生的墓碑不该走这里，UI 已不给入口） */
export function unarchivePerson(id: string): void {
  const now = new Date().toISOString();
  transact(() => {
    run(
      `UPDATE persons SET status = 'active', deleted_at = NULL, rev = rev + 1, hlc = ?, updated_at = ? WHERE id = ?`,
      [hlcNow(getDeviceId()), now, id],
    );
    appendOplog('person', id, 'update', { status: 'active' });
  });
}

export function getPerson(id: string): Person | null {
  const row = queryOne<PersonRow>('SELECT * FROM persons WHERE id = ? AND deleted_at IS NULL', [id]);
  return row ? personFromRow(row) : null;
}

const EMPTY_STATS: PersonStats = { eventCount: 0, lastMeetTs: null, totalCost: 0, avgRating: null };

export function statsOf(personId: string): PersonStats {
  const row = queryOne<{ c: number | null; last: number | null; cost: number | null; rating: number | null }>(
    `SELECT COUNT(e.id) AS c,
            MAX(e.start_ts) AS last,
            COALESCE(SUM(json_extract(e.metrics_json, '$.cost')), 0) AS cost,
            AVG(json_extract(e.metrics_json, '$.rating')) AS rating
     FROM events e
     JOIN event_participants p ON p.event_id = e.id
     WHERE p.person_id = ? AND e.deleted_at IS NULL
       ${isPrivacyMode() ? 'AND e.is_private = 0' : ''}`,
    [personId],
  );
  return {
    eventCount: row?.c ?? 0,
    lastMeetTs: row?.last ?? null,
    totalCost: row?.cost ?? 0,
    avgRating: row?.rating ?? null,
  };
}

/**
 * 一次性把**所有人**的统计算出来（GROUP BY person_id），取代逐人各跑一条 JOIN。
 *
 * 万级事件 + 上千人物时，listPersons 原来的「每人一条 statsOf」就是上千次 SQL，
 * 人物页要好几秒。改成一条聚合查询后，无论多少人都是常数级开销。
 */
export function bulkStats(): Map<string, PersonStats> {
  const rows = queryAll<{ pid: string; c: number | null; last: number | null; cost: number | null; rating: number | null }>(
    `SELECT p.person_id AS pid,
            COUNT(e.id) AS c,
            MAX(e.start_ts) AS last,
            COALESCE(SUM(json_extract(e.metrics_json, '$.cost')), 0) AS cost,
            AVG(json_extract(e.metrics_json, '$.rating')) AS rating
     FROM event_participants p
     JOIN events e ON e.id = p.event_id AND e.deleted_at IS NULL
       ${isPrivacyMode() ? "AND e.is_private = 0" : ''}
     GROUP BY p.person_id`,
    [],
  );
  const map = new Map<string, PersonStats>();
  for (const r of rows) {
    map.set(r.pid, {
      eventCount: r.c ?? 0,
      lastMeetTs: r.last ?? null,
      totalCost: r.cost ?? 0,
      avgRating: r.rating ?? null,
    });
  }
  return map;
}
