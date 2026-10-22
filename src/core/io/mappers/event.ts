// 事件 行 ↔ 对象

import type { Row } from './types';
import type { DREvent } from '../../types';
import { queryAll, getDeviceId } from '../../db';
import { hlcNow } from '../../time';

export function rowToEvent(r: Row): DREvent {
  const pts = queryAll<Row>('SELECT person_id, role, note, per_person_json FROM event_participants WHERE event_id = ?', [
    r.id,
  ]);
  return {
    id: r.id,
    title: r.title,
    kind: r.kind ?? 'note',
    time: JSON.parse(r.time_json ?? '{"kind":"unknown"}'),
    startTs: r.start_ts ?? null,
    endTs: r.end_ts ?? null,
    place: JSON.parse(r.place_json ?? '{}'),
    participants: pts.map((p) => ({
      personId: p.person_id,
      role: p.role ?? 'primary',
      note: p.note || undefined,
      perPerson: JSON.parse(p.per_person_json ?? '{}'),
    })),
    content: r.content ?? '',
    media: JSON.parse(r.media_json ?? '[]'),
    tags: JSON.parse(r.tags_json ?? '[]'),
    metrics: JSON.parse(r.metrics_json ?? '{}'),
    relatedEvents: JSON.parse(r.related_json ?? '[]'),
    primaryCollectionId: r.primary_collection_id ?? null,
    deviceId: r.device_id ?? '',
    rev: r.rev ?? 1,
    hlc: r.hlc ?? '',
    deletedAt: r.deleted_at ?? null,
    createdAt: r.created_at ?? '',
    updatedAt: r.updated_at ?? '',
    isPrivate: !!r.is_private,
  };
}

export function eventToRow(e: DREvent): Row {
  return {
    id: e.id,
    title: e.title,
    kind: e.kind ?? 'note',
    start_ts: e.startTs ?? null,
    end_ts: e.endTs ?? null,
    time_json: JSON.stringify(e.time ?? { kind: 'unknown' }),
    place_json: JSON.stringify(e.place ?? {}),
    content: e.content ?? '',
    tags_json: JSON.stringify(e.tags ?? []),
    metrics_json: JSON.stringify(e.metrics ?? {}),
    media_json: JSON.stringify(e.media ?? []),
    related_json: JSON.stringify(e.relatedEvents ?? []),
    primary_collection_id: e.primaryCollectionId ?? null,
    device_id: e.deviceId || getDeviceId(),
    rev: e.rev ?? 1,
    hlc: e.hlc || hlcNow(getDeviceId()),
    deleted_at: e.deletedAt ?? null,
    created_at: e.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    is_private: e.isPrivate ? 1 : 0,
  };
}
