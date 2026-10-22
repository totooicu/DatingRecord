// 事件集与成员 行 ↔ 对象

import type { Row } from './types';
import type { Collection, Member } from '../../types';
import { getDeviceId } from '../../db';
import { hlcNow } from '../../time';

export function rowToCollection(r: Row): Collection {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind ?? 'arc',
    parentId: r.parent_id ?? null,
    orderKey: r.order_key ?? 'V',
    description: r.description ?? '',
    cover: r.cover ?? null,
    status: r.status ?? 'ongoing',
    rule: r.rule_json ? JSON.parse(r.rule_json) : null,
    isRoot: !!r.is_root,
    timeRangeAuto: !!r.time_range_auto,
    timeRangeStart: r.time_range_start ?? null,
    timeRangeEnd: r.time_range_end ?? null,
    deviceId: r.device_id ?? '',
    rev: r.rev ?? 1,
    hlc: r.hlc ?? '',
    deletedAt: r.deleted_at ?? null,
    createdAt: r.created_at ?? '',
    updatedAt: r.updated_at ?? '',
    isPrivate: !!r.is_private,
  };
}

export function collectionToRow(c: Collection): Row {
  return {
    id: c.id,
    name: c.name,
    kind: c.kind ?? 'arc',
    parent_id: c.parentId ?? null,
    order_key: c.orderKey ?? 'V',
    description: c.description ?? '',
    cover: c.cover ?? null,
    status: c.status ?? 'ongoing',
    rule_json: c.rule ? JSON.stringify(c.rule) : null,
    is_root: c.isRoot ? 1 : 0,
    time_range_auto: c.timeRangeAuto ? 1 : 0,
    time_range_start: c.timeRangeStart ?? null,
    time_range_end: c.timeRangeEnd ?? null,
    device_id: c.deviceId || getDeviceId(),
    rev: c.rev ?? 1,
    hlc: c.hlc || hlcNow(getDeviceId()),
    deleted_at: c.deletedAt ?? null,
    created_at: c.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    is_private: c.isPrivate ? 1 : 0,
  };
}

export function rowToMember(r: Row): Member {
  return {
    collectionId: r.collection_id,
    memberType: r.member_type,
    memberId: r.member_id,
    orderKey: r.order_key ?? 'V',
    note: r.note ?? '',
    hlc: r.hlc ?? '',
    deletedAt: r.deleted_at ?? null,
  };
}
