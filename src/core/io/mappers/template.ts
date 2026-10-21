// 属性模板的导入出行映射（.drp.json ↔ attribute_templates 行）

import { getDeviceId } from '../../db';
import { hlcNow } from '../../time';
import type { AttrTemplate } from '../../types';
import type { Row } from './types';

export function rowToTemplate(r: Row): AttrTemplate {
  let keys: string[] = [];
  try {
    const v = JSON.parse(String(r.keys_json ?? '[]'));
    if (Array.isArray(v)) keys = v.filter((k): k is string => typeof k === 'string');
  } catch {
    /* 坏 JSON 按空模板 */
  }
  return {
    id: r.id as string,
    name: r.name as string,
    keys,
    createdAt: r.created_at as string,
    hlc: (r.hlc as string) ?? undefined,
  };
}

export function templateToRow(t: AttrTemplate): Record<string, unknown> {
  return {
    id: t.id,
    name: t.name,
    keys_json: JSON.stringify(t.keys ?? []),
    device_id: getDeviceId(),
    rev: 1,
    hlc: t.hlc ?? hlcNow(getDeviceId()),
    deleted_at: null,
    created_at: t.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
