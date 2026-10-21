// 人物读取：列表、归档列表、单条、统计。
// 「活跃 / 归档 / 已合并」三种状态在这里区分，别处不要各自写 WHERE。

import { queryAll, queryOne, run, transact, appendOplog, getDeviceId } from '../../db';
import { hlcNow } from '../../time';
import type { Person } from '../../types';
import { personFromRow, type PersonRow } from './rows';

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

export function listPersons(opts: { includeArchived?: boolean; keyword?: string } = {}): PersonWithStats[] {
  const where: string[] = ['p.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (!opts.includeArchived) where.push("p.status = 'active'");
  if (opts.keyword) {
    where.push('(p.display_name LIKE ? OR p.aliases_json LIKE ? OR p.tags_json LIKE ?)');
    const kw = `%${opts.keyword}%`;
    params.push(kw, kw, kw);
  }
  const rows = queryAll<PersonRow>(
    `SELECT * FROM persons p WHERE ${where.join(' AND ')} ORDER BY p.display_name`,
    params,
  );
  return rows.map((r) => ({ ...personFromRow(r), stats: statsOf(r.id) }));
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
     WHERE p.deleted_at IS NOT NULL OR p.status <> 'active'
     ORDER BY p.updated_at DESC`,
  );
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
      stats: statsOf(r.id),
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

export function statsOf(personId: string): PersonStats {
  const row = queryOne<{ c: number | null; last: number | null; cost: number | null; rating: number | null }>(
    `SELECT COUNT(e.id) AS c,
            MAX(e.start_ts) AS last,
            COALESCE(SUM(json_extract(e.metrics_json, '$.cost')), 0) AS cost,
            AVG(json_extract(e.metrics_json, '$.rating')) AS rating
     FROM events e
     JOIN event_participants p ON p.event_id = e.id
     WHERE p.person_id = ? AND e.deleted_at IS NULL`,
    [personId],
  );
  return {
    eventCount: row?.c ?? 0,
    lastMeetTs: row?.last ?? null,
    totalCost: row?.cost ?? 0,
    avgRating: row?.rating ?? null,
  };
}
