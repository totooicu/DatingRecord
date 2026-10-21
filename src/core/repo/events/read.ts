// 事件读取与统计

import { queryAll, queryOne } from '../../db';
import type { DREvent } from '../../types';
import { eventFromRow, participantsOf, type EventRow } from './rows';

export interface EventFilter {
  personId?: string;
  collectionId?: string; // 含所有嵌套层级
  tag?: string;
  keyword?: string;
  kind?: string;
  fromTs?: number;
  toTs?: number;
  minRating?: number;
  includeDeleted?: boolean;
}

export function listEvents(filter: EventFilter = {}): DREvent[] {
  const where: string[] = [];
  const params: unknown[] = [];

  if (!filter.includeDeleted) where.push('e.deleted_at IS NULL');
  if (filter.personId) {
    where.push('EXISTS (SELECT 1 FROM event_participants p WHERE p.event_id = e.id AND p.person_id = ?)');
    params.push(filter.personId);
  }
  if (filter.collectionId) {
    // 闭包表：一次 JOIN 拿到所有嵌套层级下的事件
    where.push(`EXISTS (
      SELECT 1 FROM collection_members m
      JOIN collection_closure cl ON cl.descendant_id = m.collection_id
      WHERE cl.ancestor_id = ? AND m.member_type = 'event' AND m.member_id = e.id AND m.deleted_at IS NULL
    )`);
    params.push(filter.collectionId);
  }
  if (filter.tag) {
    where.push('e.tags_json LIKE ?');
    params.push(`%"${filter.tag}"%`);
  }
  if (filter.keyword) {
    where.push('(e.title LIKE ? OR e.content LIKE ? OR e.tags_json LIKE ?)');
    const kw = `%${filter.keyword}%`;
    params.push(kw, kw, kw);
  }
  if (filter.kind) {
    where.push('e.kind = ?');
    params.push(filter.kind);
  }
  if (filter.fromTs !== undefined) {
    where.push('(e.start_ts IS NULL OR e.start_ts >= ?)');
    params.push(filter.fromTs);
  }
  if (filter.toTs !== undefined) {
    where.push('(e.start_ts IS NULL OR e.start_ts <= ?)');
    params.push(filter.toTs);
  }
  if (filter.minRating !== undefined) {
    where.push("json_extract(e.metrics_json, '$.rating') >= ?");
    params.push(filter.minRating);
  }

  const sql = `SELECT * FROM events e
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY COALESCE(e.start_ts, 9223372036854775807) DESC, e.created_at DESC`;

  return queryAll<EventRow>(sql, params).map((r) => eventFromRow(r, participantsOf(r.id)));
}

export function getEvent(id: string): DREvent | null {
  const row = queryOne<EventRow>('SELECT * FROM events WHERE id = ? AND deleted_at IS NULL', [id]);
  return row ? eventFromRow(row, participantsOf(id)) : null;
}

export function listDeletedEvents(): DREvent[] {
  return queryAll<EventRow>('SELECT * FROM events WHERE deleted_at IS NOT NULL ORDER BY updated_at DESC').map((r) =>
    eventFromRow(r, participantsOf(r.id)),
  );
}

/**
 * 全局统计。
 *
 * personCount 只数「活跃」的人（和人物列表里能看到的条数一致），
 * archivedPersonCount 数所有不在列表里的记录（手动归档 + 合并后留下的墓碑），
 * 与设置页「归档的人物」列出的条目数严格相等——曾经归档数漏掉了合并墓碑，
 * 于是出现「列表里 4 个人、概览说 5」这种对不上的困惑。
 */
export function globalStats(): {
  eventCount: number;
  personCount: number;
  archivedPersonCount: number;
  totalCost: number;
  avgRating: number | null;
} {
  const e = queryOne<{ c: number | null; cost: number | null; rating: number | null }>(
    `SELECT COUNT(*) AS c,
            COALESCE(SUM(json_extract(metrics_json,'$.cost')),0) AS cost,
            AVG(json_extract(metrics_json,'$.rating')) AS rating
     FROM events WHERE deleted_at IS NULL`,
  );
  const p = queryOne<{ c: number | null; a: number | null }>(
    `SELECT COALESCE(SUM(CASE WHEN deleted_at IS NULL AND status = 'active' THEN 1 ELSE 0 END), 0) AS c,
            COALESCE(SUM(CASE WHEN deleted_at IS NOT NULL OR status <> 'active' THEN 1 ELSE 0 END), 0) AS a
     FROM persons`,
  );
  return {
    eventCount: e?.c ?? 0,
    personCount: p?.c ?? 0,
    archivedPersonCount: Number(p?.a ?? 0),
    totalCost: e?.cost ?? 0,
    avgRating: e?.rating ?? null,
  };
}
