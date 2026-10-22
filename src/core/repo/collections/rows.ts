// 行 ↔ 对象映射（事件集）

import type { Collection, CollectionKind } from '../../types';

export interface CollectionRow {
  id: string;
  name: string;
  kind: string;
  parent_id: string | null;
  order_key: string;
  description: string;
  cover: string | null;
  status: string;
  rule_json: string | null;
  is_root: number;
  time_range_auto: number;
  time_range_start: string | null;
  time_range_end: string | null;
  device_id: string;
  rev: number;
  hlc: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  is_private: number;
}

export function collectionFromRow(r: CollectionRow): Collection {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind as CollectionKind,
    parentId: r.parent_id,
    orderKey: r.order_key,
    description: r.description,
    cover: r.cover,
    status: r.status as Collection['status'],
    rule: r.rule_json ? JSON.parse(r.rule_json) : null,
    isRoot: !!r.is_root,
    timeRangeAuto: !!r.time_range_auto,
    timeRangeStart: r.time_range_start,
    timeRangeEnd: r.time_range_end,
    deviceId: r.device_id,
    rev: r.rev,
    hlc: r.hlc,
    deletedAt: r.deleted_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    isPrivate: !!r.is_private,
  };
}
