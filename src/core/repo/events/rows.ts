// 行 ↔ 对象映射：事件与其参与者

import { queryAll } from '../../db';
import type { DREvent, EventMetrics, Participant, Place, RelatedEvent } from '../../types';
import type { TimeSpec } from '../../time';

export interface EventRow {
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
  view_mode?: string;
  device_id: string;
  rev: number;
  hlc: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  is_private: number;
}

export function safeParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function eventFromRow(r: EventRow, participants: Participant[]): DREvent {
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
    viewMode: r.view_mode === 'chat' ? 'chat' : 'doc',
    deviceId: r.device_id,
    rev: r.rev,
    hlc: r.hlc,
    deletedAt: r.deleted_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    isPrivate: !!r.is_private,
  };
}

export function participantsOf(eventId: string): Participant[] {
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
