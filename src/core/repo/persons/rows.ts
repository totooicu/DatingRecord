// 行 ↔ 对象映射：SQL 结果集转成领域对象的唯一地方。
// 字段改名只需要改这里。

import type { AttributeDef, AttributeType, AttributeValue, Person } from '../../types';

export interface DefRow {
  key: string;
  label: string;
  type: string;
  group_name: string;
  options_json: string;
  unit: string | null;
  max_value: number | null;
  required: number;
  sensitive: number;
  time_varying: number;
  archived: number;
  order_key: string;
  hlc: string;
}

export interface PersonRow {
  id: string;
  display_name: string;
  aliases_json: string;
  kind: string;
  status: string;
  avatar: string | null;
  icon_json: string | null;
  tags_json: string;
  attrs_json: string;
  notes: string;
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

export function defFromRow(r: DefRow): AttributeDef {
  return {
    key: r.key,
    label: r.label,
    type: r.type as AttributeType,
    group: r.group_name,
    options: safeParse<string[]>(r.options_json, []),
    unit: r.unit ?? undefined,
    max: r.max_value ?? undefined,
    required: !!r.required,
    sensitive: !!r.sensitive,
    timeVarying: !!r.time_varying,
    archived: !!r.archived,
    orderKey: r.order_key,
    hlc: r.hlc,
  };
}

export function personFromRow(r: PersonRow): Person {
  return {
    id: r.id,
    displayName: r.display_name,
    aliases: safeParse<string[]>(r.aliases_json, []),
    kind: r.kind as Person['kind'],
    status: r.status as Person['status'],
    avatar: r.avatar,
    icon: safeParse<Person['icon']>(r.icon_json ?? 'null', null),
    tags: safeParse<string[]>(r.tags_json, []),
    attrs: safeParse<Record<string, AttributeValue>>(r.attrs_json, {}),
    notes: r.notes,
    deviceId: r.device_id,
    rev: r.rev,
    hlc: r.hlc,
    deletedAt: r.deleted_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    isPrivate: !!r.is_private,
  };
}
