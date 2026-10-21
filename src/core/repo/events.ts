// 事件仓储：时间模型、参与者、度量、检索

import { queryAll, queryOne, run, transact, appendOplog, getDeviceId } from '../db';
import { newId } from '../id';
import { hlcNow, toTs, type TimeSpec } from '../time';
import type { DREvent, EventMetrics, Participant, Place, RelatedEvent } from '../types';

export const EVENT_KINDS: { value: string; label: string }[] = [
  { value: 'date', label: '约会' },
  { value: 'meal', label: '吃饭' },
  { value: 'movie', label: '看电影' },
  { value: 'trip', label: '出行' },
  { value: 'call', label: '通话' },
  { value: 'chat', label: '聊天' },
  { value: 'gift', label: '礼物' },
  { value: 'conflict', label: '矛盾' },
  { value: 'milestone', label: '里程碑' },
  { value: 'note', label: '备忘' },
];

interface EventRow {
  id: string;
  title: string;
  kind: string;
  start_ts: number | null;
  end_ts: number | null;
  time_json: string;
  place_json: string;
  content: string;
  tags_json: string;
  metrics_json: string;
  media_json: string;
  related_json: string;
  primary_collection_id: string | null;
  device_id: string;
  rev: number;
  hlc: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

function safeParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function eventFromRow(r: EventRow, participants: Participant[]): DREvent {
  return {
    id: r.id,
    title: r.title,
    kind: r.kind,
    time: safeParse<TimeSpec>(r.time_json, { kind: 'unknown' }),
    startTs: r.start_ts,
    endTs: r.end_ts,
    place: safeParse<Place>(r.place_json, {}),
    participants,
    content: r.content,
    media: safeParse<string[]>(r.media_json, []),
    tags: safeParse<string[]>(r.tags_json, []),
    metrics: safeParse<EventMetrics>(r.metrics_json, {}),
    relatedEvents: safeParse<RelatedEvent[]>(r.related_json, []),
    primaryCollectionId: r.primary_collection_id,
    deviceId: r.device_id,
    rev: r.rev,
    hlc: r.hlc,
    deletedAt: r.deleted_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function participantsOf(eventId: string): Participant[] {
  return queryAll<{ person_id: string; role: string; note: string; per_person_json: string }>(
    'SELECT person_id, role, note, per_person_json FROM event_participants WHERE event_id = ?',
    [eventId],
  ).map((r) => ({
    personId: r.person_id,
    role: r.role as Participant['role'],
    note: r.note || undefined,
    perPerson: safeParse<Record<string, unknown>>(r.per_person_json, {}),
  }));
}

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

export interface EventInput {
  title: string;
  kind: string;
  time: TimeSpec;
  place?: Place;
  participants?: Participant[];
  content?: string;
  tags?: string[];
  metrics?: EventMetrics;
  media?: string[];
  primaryCollectionId?: string | null;
}

export function createEvent(input: EventInput): DREvent {
  const id = newId('e');
  const now = new Date().toISOString();
  const hlc = hlcNow(getDeviceId());
  const startTs = toTs(input.time.start);
  const endTs = toTs(input.time.end ?? null);

  transact(() => {
    run(
      `INSERT INTO events
       (id,title,kind,start_ts,end_ts,time_json,place_json,content,tags_json,metrics_json,media_json,
        related_json,primary_collection_id,device_id,rev,hlc,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        input.title,
        input.kind ?? 'note',
        startTs,
        endTs,
        JSON.stringify(input.time),
        JSON.stringify(input.place ?? {}),
        input.content ?? '',
        JSON.stringify(input.tags ?? []),
        JSON.stringify(input.metrics ?? {}),
        JSON.stringify(input.media ?? []),
        '[]',
        input.primaryCollectionId ?? null,
        getDeviceId(),
        1,
        hlc,
        now,
        now,
      ],
    );
    for (const p of input.participants ?? []) {
      run(
        'INSERT OR REPLACE INTO event_participants (event_id, person_id, role, note, per_person_json) VALUES (?,?,?,?,?)',
        [id, p.personId, p.role ?? 'primary', p.note ?? '', JSON.stringify(p.perPerson ?? {})],
      );
    }
    appendOplog('event', id, 'insert', { title: input.title });
  });
  return getEvent(id)!;
}

export function updateEvent(id: string, input: Partial<EventInput>): void {
  const now = new Date().toISOString();
  const hlc = hlcNow(getDeviceId());
  transact(() => {
    const e = getEvent(id);
    if (!e) return;
    const time = input.time ?? e.time;
    run(
      `UPDATE events SET title=?, kind=?, start_ts=?, end_ts=?, time_json=?, place_json=?, content=?,
       tags_json=?, metrics_json=?, media_json=?, primary_collection_id=?, rev=rev+1, hlc=?, updated_at=?
       WHERE id=?`,
      [
        input.title ?? e.title,
        input.kind ?? e.kind,
        toTs(time.start),
        toTs(time.end ?? null),
        JSON.stringify(time),
        JSON.stringify(input.place ?? e.place),
        input.content ?? e.content,
        JSON.stringify(input.tags ?? e.tags),
        JSON.stringify(input.metrics ?? e.metrics),
        JSON.stringify(input.media ?? e.media),
        input.primaryCollectionId ?? e.primaryCollectionId,
        hlc,
        now,
        id,
      ],
    );
    if (input.participants) {
      run('DELETE FROM event_participants WHERE event_id = ?', [id]);
      for (const p of input.participants) {
        run(
          'INSERT OR REPLACE INTO event_participants (event_id, person_id, role, note, per_person_json) VALUES (?,?,?,?,?)',
          [id, p.personId, p.role ?? 'primary', p.note ?? '', JSON.stringify(p.perPerson ?? {})],
        );
      }
    }
    appendOplog('event', id, 'update', { title: input.title });
  });
}

/** 软删除：进回收站，可恢复 */
export function deleteEvent(id: string): void {
  const now = new Date().toISOString();
  transact(() => {
    run('UPDATE events SET deleted_at = ?, rev = rev + 1, hlc = ?, updated_at = ? WHERE id = ?', [
      now,
      hlcNow(getDeviceId()),
      now,
      id,
    ]);
    appendOplog('event', id, 'delete', { id });
  });
}

export function restoreEvent(id: string): void {
  transact(() => {
    run('UPDATE events SET deleted_at = NULL, rev = rev + 1, hlc = ?, updated_at = ? WHERE id = ?', [
      hlcNow(getDeviceId()),
      new Date().toISOString(),
      id,
    ]);
    appendOplog('event', id, 'update', { restored: true });
  });
}

export function purgeEvent(id: string): void {
  transact(() => {
    run('DELETE FROM events WHERE id = ?', [id]);
    run('DELETE FROM event_participants WHERE event_id = ?', [id]);
    run('DELETE FROM collection_members WHERE member_type = ? AND member_id = ?', ['event', id]);
    appendOplog('event', id, 'delete', { id, hard: true });
  });
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
