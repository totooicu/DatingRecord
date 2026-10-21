// 集合成员：事件与子集合的挂接、移动、展开查询

import { queryAll, run, transact, appendOplog, getDeviceId } from '../../db';
import { hlcNow } from '../../time';
import { orderKeyBetween } from '../../order';
import type { Collection } from '../../types';
import { getCollection } from './read';
import { isSmart } from './smart';

// ---------------- 成员 ----------------

export interface MemberItem {
  memberType: 'event' | 'collection';
  memberId: string;
  orderKey: string;
  note: string;
}

export function listMembers(collectionId: string): MemberItem[] {
  return queryAll<{ member_type: string; member_id: string; order_key: string; note: string }>(
    'SELECT member_type, member_id, order_key, note FROM collection_members WHERE collection_id = ? AND deleted_at IS NULL ORDER BY order_key',
    [collectionId],
  ).map((r) => ({
    memberType: r.member_type as MemberItem['memberType'],
    memberId: r.member_id,
    orderKey: r.order_key,
    note: r.note,
  }));
}

export function addMember(collectionId: string, memberType: 'event' | 'collection', memberId: string): void {
  // 智能集合的成员是规则算出来的，手动挂进去下一秒就会被求值结果覆盖，没意义
  const col = getCollection(collectionId);
  if (col && isSmart(col)) return;
  const members = listMembers(collectionId);
  if (members.some((m) => m.memberType === memberType && m.memberId === memberId)) return;
  const lastKey = members.length ? members[members.length - 1].orderKey : null;
  transact(() => {
    run(
      `INSERT OR REPLACE INTO collection_members (collection_id, member_type, member_id, order_key, note, device_id, hlc)
       VALUES (?,?,?,?,?,?,?)`,
      [collectionId, memberType, memberId, orderKeyBetween(lastKey, null), '', getDeviceId(), hlcNow(getDeviceId())],
    );
    appendOplog('collection_member', `${collectionId}:${memberId}`, 'insert', { collectionId, memberType, memberId });
  });
}

/** 移除成员：只删关联，绝不删事件本身 */
export function removeMember(collectionId: string, memberType: 'event' | 'collection', memberId: string): void {
  transact(() => {
    run('UPDATE collection_members SET deleted_at = ? WHERE collection_id = ? AND member_type = ? AND member_id = ?', [
      new Date().toISOString(),
      collectionId,
      memberType,
      memberId,
    ]);
    appendOplog('collection_member', `${collectionId}:${memberId}`, 'delete', { collectionId, memberType, memberId });
  });
}

/** 把成员移动到指定下标（用 fractional index 生成新键，只改这一行） */
export function moveMemberTo(
  collectionId: string,
  memberType: 'event' | 'collection',
  memberId: string,
  targetIndex: number,
): void {
  const members = listMembers(collectionId);
  const idx = members.findIndex((m) => m.memberType === memberType && m.memberId === memberId);
  if (idx < 0) return;
  const rest = members.filter((_, i) => i !== idx);
  const clamped = Math.max(0, Math.min(targetIndex, rest.length));
  const before = clamped > 0 ? rest[clamped - 1].orderKey : null;
  const after = clamped < rest.length ? rest[clamped].orderKey : null;
  const newKey = orderKeyBetween(before, after);
  transact(() => {
    run(
      'UPDATE collection_members SET order_key = ? WHERE collection_id = ? AND member_type = ? AND member_id = ?',
      [newKey, collectionId, memberType, memberId],
    );
    appendOplog('collection_member', `${collectionId}:${memberId}`, 'update', { orderKey: newKey });
  });
}

/** 某事件所属的所有集合（用于详情页展示与「加入集合」） */
export function collectionsOfEvent(eventId: string): Collection[] {
  return queryAll<{ collection_id: string }>(
    "SELECT collection_id FROM collection_members WHERE member_type = 'event' AND member_id = ? AND deleted_at IS NULL",
    [eventId],
  )
    .map((r) => getCollection(r.collection_id))
    .filter((c): c is Collection => !!c);
}

/** 集合（含所有嵌套层级）下的事件 ID */
export function descendantEventIds(collectionId: string): string[] {
  return queryAll<{ member_id: string }>(
    `SELECT DISTINCT m.member_id FROM collection_members m
     JOIN collection_closure cl ON cl.descendant_id = m.collection_id
     WHERE cl.ancestor_id = ? AND m.member_type = 'event' AND m.deleted_at IS NULL`,
    [collectionId],
  ).map((r) => r.member_id);
}
