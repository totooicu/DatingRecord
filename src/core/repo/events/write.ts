// 事件写入：新建 / 更新 / 软删除 / 恢复 / 彻底删除

import { run, transact, appendOplog, getDeviceId, queryOne } from '../../db';
import { newId } from '../../id';
import { hlcNow, toTs } from '../../time';
import type { DREvent, EventMetrics, Participant, Place, RelatedEvent } from '../../types';
import type { TimeSpec } from '../../time';
import { getEvent } from './read';
import { normalizeRelated, stripRefsTo } from './related';
import { sweepEventFiles } from '../fileGc';

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
  relatedEvents?: RelatedEvent[];
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
        JSON.stringify(normalizeRelated(input.relatedEvents, id)),
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
       tags_json=?, metrics_json=?, media_json=?, related_json=?, primary_collection_id=?, rev=rev+1, hlc=?, updated_at=?
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
        JSON.stringify(normalizeRelated(input.relatedEvents ?? e.relatedEvents, id)),
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

/** 标记 / 取消隐私（隐私模式下的隐藏开关）。单独一个函数，避免污染 updateEvent 的字段清单 */
export function setEventPrivate(id: string, on: boolean): void {
  const now = new Date().toISOString();
  // 值没变就别写：新建表单收尾时会无条件调用一次（让「新建」和「改隐私」两件事
  // 互不纠缠），若照样 appendOplog，刚建好的事件会多出一条 update，
  // 提示条从「新建事件」变成「修改事件」，撤销还得按两次
  const cur = queryOne<{ is_private: number | null }>('SELECT is_private FROM events WHERE id = ?', [id]);
  if (!cur || Number(cur.is_private ?? 0) === (on ? 1 : 0)) return;
  transact(() => {
    run('UPDATE events SET is_private = ?, rev = rev + 1, hlc = ?, updated_at = ? WHERE id = ?', [
      on ? 1 : 0,
      hlcNow(getDeviceId()),
      now,
      id,
    ]);
    appendOplog('event', id, 'update', { isPrivate: on });
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
    // 先读正文/媒体：行一删就无从知道它用过哪些附件
    const row = queryOne<{ content: string; media_json: string }>(
      'SELECT content, media_json FROM events WHERE id = ?',
      [id],
    );
    run('DELETE FROM events WHERE id = ?', [id]);
    run('DELETE FROM event_participants WHERE event_id = ?', [id]);
    run('DELETE FROM collection_members WHERE member_type = ? AND member_id = ?', ['event', id]);
    stripRefsTo(id); // 别的事件 related_json 里可能指着它
    appendOplog('event', id, 'delete', { id, hard: true });
    // 附件回收放在最后：此刻「还有没有别的主」才是准的（F-E05）
    if (row) sweepEventFiles(row.content, row.media_json);
  });
}
