// 属性定义 行 ↔ 对象

import type { Row } from './types';
import type { AttributeDef } from '../../types';
import { getDeviceId } from '../../db';
import { hlcNow } from '../../time';

export function rowToDef(r: Row): AttributeDef {
  return {
    key: r.key,
    label: r.label,
    type: r.type,
    group: r.group_name ?? '',
    options: JSON.parse(r.options_json ?? '[]'),
    unit: r.unit ?? undefined,
    max: r.max_value ?? undefined,
    required: !!r.required,
    sensitive: !!r.sensitive,
    timeVarying: !!r.time_varying,
    archived: !!r.archived,
    orderKey: r.order_key ?? 'V',
    hlc: r.hlc ?? '',
  };
}

export function defToRow(d: AttributeDef): Row {
  return {
    key: d.key,
    label: d.label,
    type: d.type,
    group_name: d.group ?? '',
    options_json: JSON.stringify(d.options ?? []),
    unit: d.unit ?? null,
    max_value: d.max ?? null,
    required: d.required ? 1 : 0,
    sensitive: d.sensitive ? 1 : 0,
    time_varying: d.timeVarying ? 1 : 0,
    archived: d.archived ? 1 : 0,
    order_key: d.orderKey ?? 'V',
    device_id: getDeviceId(),
    rev: 1,
    hlc: d.hlc ?? hlcNow(getDeviceId()),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
