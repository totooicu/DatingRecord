// 人物 行 ↔ 对象（含属性变更历史）

import type { Row } from './types';
import type { Person } from '../../types';
import { getDeviceId } from '../../db';
import { hlcNow } from '../../time';

export function rowToPerson(r: Row): Person {
  return {
    id: r.id,
    displayName: r.display_name,
    aliases: JSON.parse(r.aliases_json ?? '[]'),
    kind: r.kind ?? 'person',
    status: r.status ?? 'active',
    avatar: r.avatar ?? null,
    tags: JSON.parse(r.tags_json ?? '[]'),
    attrs: JSON.parse(r.attrs_json ?? '{}'),
    notes: r.notes ?? '',
    deviceId: r.device_id ?? '',
    rev: r.rev ?? 1,
    hlc: r.hlc ?? '',
    deletedAt: r.deleted_at ?? null,
    createdAt: r.created_at ?? '',
    updatedAt: r.updated_at ?? '',
    isPrivate: !!r.is_private,
  };
}

export function personToRow(p: Person): Row {
  return {
    id: p.id,
    display_name: p.displayName,
    aliases_json: JSON.stringify(p.aliases ?? []),
    kind: p.kind ?? 'person',
    status: p.status ?? 'active',
    avatar: p.avatar ?? null,
    tags_json: JSON.stringify(p.tags ?? []),
    attrs_json: JSON.stringify(p.attrs ?? {}),
    notes: p.notes ?? '',
    device_id: p.deviceId || getDeviceId(),
    rev: p.rev ?? 1,
    hlc: p.hlc || hlcNow(getDeviceId()),
    deleted_at: p.deletedAt ?? null,
    created_at: p.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    is_private: p.isPrivate ? 1 : 0,
  };
}
