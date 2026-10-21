// 事件关联（F-E08）：关系类型字典 + 悬空引用清理
//
// 关联是「单向往」的：A.relatedEvents 里记着 {type, targetId: B}，
// B 自己不知道。展示反向关联（「谁引用了我」）时扫全表得到，
// 因此 purge 一个事件必须把别人 related_json 里指向它的条目摘掉。

import { run, queryAll } from '../../db';
import type { RelatedEvent } from '../../types';

export const RELATION_TYPES: RelatedEvent['type'][] = ['followedBy', 'causedBy', 'sameDay'];

export const RELATION_LABELS: Record<RelatedEvent['type'], string> = {
  followedBy: '后续',
  causedBy: '起因',
  sameDay: '同日',
};

/** 同一目标只保留一条；自己不能关联自己 */
export function normalizeRelated(list: RelatedEvent[] | undefined, selfId?: string): RelatedEvent[] {
  const seen = new Set<string>();
  const out: RelatedEvent[] = [];
  for (const r of list ?? []) {
    if (!r || !RELATION_TYPES.includes(r.type) || !r.targetId) continue;
    if (selfId && r.targetId === selfId) continue;
    if (seen.has(r.targetId)) continue;
    seen.add(r.targetId);
    out.push({ type: r.type, targetId: r.targetId });
  }
  return out;
}

/**
 * 彻底删除事件后，把其他事件 related_json 里指向它的引用摘干净。
 * related_json 是 JSON 文本列，只能读出来改完写回；个人库的事件量级
 * 全表扫描完全够用，且只在 purge（彻底删除）这条少有人走的路上发生。
 */
export function stripRefsTo(targetId: string): void {
  const rows = queryAll<{ id: string; related_json: string }>(
    "SELECT id, related_json FROM events WHERE related_json LIKE ?",
    [`%${targetId}%`],
  );
  for (const r of rows) {
    let list: RelatedEvent[] = [];
    try {
      list = JSON.parse(r.related_json) as RelatedEvent[];
    } catch {
      continue;
    }
    const kept = list.filter((x) => x?.targetId !== targetId);
    if (kept.length === list.length) continue;
    run('UPDATE events SET related_json = ? WHERE id = ?', [JSON.stringify(kept), r.id]);
  }
}

/** 反向关联：全库有哪些事件的 relatedEvents 指向我 */
export function incomingRefs(selfId: string, all: { id: string; title: string; relatedEvents: RelatedEvent[] }[]): {
  eventId: string;
  title: string;
  type: RelatedEvent['type'];
}[] {
  const out: { eventId: string; title: string; type: RelatedEvent['type'] }[] = [];
  for (const e of all) {
    if (e.id === selfId) continue;
    for (const r of e.relatedEvents) {
      if (r.targetId === selfId) out.push({ eventId: e.id, title: e.title, type: r.type });
    }
  }
  return out;
}
