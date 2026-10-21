// 属性值读写。随时间变化的字段（timeVarying）会自动留一条历史，查询在 history.ts。

import { queryAll, run, transact, appendOplog, getDeviceId } from '../../db';
import { newId } from '../../id';
import { hlcNow } from '../../time';
import { FIRST_ORDER_KEY } from '../../order';
import { getPerson } from './read';
import { getDef } from './attrs';
import type { AttributeDef, AttributeType } from '../../types';

// ---------------- 属性值 ----------------

/**
 * 设置单个属性值。
 * - 空值不写入（保持 JSON 干净）
 * - timeVarying 字段自动记录历史
 */
export function setAttribute(
  personId: string,
  key: string,
  value: unknown,
  meta?: { note?: string; byEventId?: string },
): void {
  const p = getPerson(personId);
  if (!p) return;
  const def = getDef(key);
  const now = new Date().toISOString();
  const hlc = hlcNow(getDeviceId());

  transact(() => {
    const attrs = { ...p.attrs };
    const prev = attrs[key];
    // 注意：false / 0 是合法值，不能当空值处理，否则开关字段无法存「否」
    const isEmpty =
      value === null ||
      value === undefined ||
      value === '' ||
      (Array.isArray(value) && value.length === 0);

    if (isEmpty) {
      delete attrs[key];
    } else {
      attrs[key] = {
        v: value,
        ...(def?.unit ? { unit: def.unit } : {}),
        ...(meta?.note ? { note: meta.note } : {}),
        updatedAt: hlc,
      };
    }

    // timeVarying → 记录历史
    if (def?.timeVarying && JSON.stringify(prev?.v ?? null) !== JSON.stringify(isEmpty ? null : value)) {
      run(
        `INSERT INTO person_attr_history (id, person_id, attr_key, value_json, changed_at, by_event_id, reason)
         VALUES (?,?,?,?,?,?,?)`,
        [newId('att'), personId, key, JSON.stringify(isEmpty ? null : value), now, meta?.byEventId ?? null, meta?.note ?? null],
      );
    }

    run('UPDATE persons SET attrs_json = ?, rev = rev + 1, hlc = ?, updated_at = ? WHERE id = ?', [
      JSON.stringify(attrs),
      hlc,
      now,
      personId,
    ]);
    appendOplog('person', personId, 'update', { attr: key });
  });
}

// ---------------- 改类型时的值转换 ----------------

function asText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join('、');
  return JSON.stringify(v);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

interface DateParts {
  y: number;
  m: number;
  d: number;
  hh?: number;
  mm?: number;
}

/**
 * 只认明确写成日期的字符串，避免 new Date('42') 这类宽松解析把数字当成年份。
 * 4 位年 + 分隔符（或年月日 / 8 位紧凑格式）。
 */
function dateParts(s: string): DateParts | null {
  let p: DateParts | null = null;
  const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/);
  if (m) {
    p = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]), hh: m[4] ? Number(m[4]) : undefined, mm: m[5] ? Number(m[5]) : undefined };
  } else {
    const cn = s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日/);
    const compact = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (cn) p = { y: Number(cn[1]), m: Number(cn[2]), d: Number(cn[3]) };
    else if (compact) p = { y: Number(compact[1]), m: Number(compact[2]), d: Number(compact[3]) };
  }
  if (!p) return null;
  if (p.m < 1 || p.m > 12 || p.d < 1 || p.d > 31) return null;
  if (p.hh !== undefined && (p.hh > 23 || p.mm === undefined || p.mm > 59)) return null;
  return p;
}

/**
 * 把旧值尽量转成新类型的值；转不了返回 undefined（该条值会被清空）。
 * 规则刻意保守：宁可少一条，也不要留一个类型对不上的值让界面崩掉。
 */
function coerceValue(value: unknown, type: AttributeType, def: { max?: number }): unknown {
  switch (type) {
    case 'number':
    case 'money': {
      const n = typeof value === 'number' ? value : Number(asText(value).replace(/[^\d.\-]/g, ''));
      return Number.isFinite(n) ? n : undefined;
    }
    case 'rating': {
      const n = Number(asText(value).replace(/[^\d.]/g, ''));
      if (!Number.isFinite(n)) return undefined;
      const max = def.max ?? 5;
      return Math.min(Math.max(1, Math.round(n)), max);
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      const s = asText(value).toLowerCase();
      if (['true', '是', '1', 'yes', 'y', 'on', '有'].includes(s)) return true;
      if (['false', '否', '0', 'no', 'n', 'off', '无'].includes(s)) return false;
      return undefined;
    }
    case 'date': {
      const p = dateParts(asText(value));
      return p ? `${p.y}-${pad2(p.m)}-${pad2(p.d)}` : undefined;
    }
    case 'datetime': {
      const p = dateParts(asText(value));
      return p ? `${p.y}-${pad2(p.m)}-${pad2(p.d)}T${pad2(p.hh ?? 0)}:${pad2(p.mm ?? 0)}` : undefined;
    }
    case 'enumMulti':
    case 'tag': {
      const arr = Array.isArray(value) ? value : asText(value).split(/[、,，]/);
      const out = arr.map(asText).filter(Boolean);
      return out.length ? out : undefined;
    }
    case 'geo': {
      if (!value || typeof value !== 'object') return undefined;
      const g = value as { lat?: unknown; lng?: unknown };
      const lat = Number(g.lat);
      const lng = Number(g.lng);
      return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined;
    }
    case 'social': {
      if (value && typeof value === 'object') {
        const s = value as { platform?: unknown; handle?: unknown };
        const platform = asText(s.platform);
        const handle = asText(s.handle);
        return platform || handle ? { platform, handle } : undefined;
      }
      const handle = asText(value);
      return handle ? { platform: '', handle } : undefined;
    }
    case 'json': {
      if (typeof value === 'string') {
        try {
          return JSON.parse(value) as unknown;
        } catch {
          return value;
        }
      }
      return value;
    }
    default: {
      // text / longtext / phone / email / url / address / color / media / relation / enum
      const s = asText(value);
      return s ? s : undefined;
    }
  }
}

/** 有多少人的档案里填了这个属性（改类型前给用户一个明确数字） */
export function countAttrValues(key: string): number {
  const rows = queryAll<{ attrs_json: string }>('SELECT attrs_json FROM persons');
  let n = 0;
  for (const r of rows) {
    try {
      const attrs = JSON.parse(r.attrs_json || '{}') as Record<string, unknown>;
      if (attrs && key in attrs) n++;
    } catch {
      /* 坏 JSON 跳过，不影响其他记录 */
    }
  }
  return n;
}

export interface RetuneResult {
  total: number;
  kept: number;
  dropped: number;
}

/**
 * 改了属性类型后，把所有人档案里的旧值按新类型重写一遍。
 *
 * 历史值不在这里处理：person_attr_history 记的是「当时填过什么」，
 * 属于审计信息，保持原样。
 */
export function retuneAttrValues(key: string, def: AttributeDef): RetuneResult {
  const rows = queryAll<{ id: string; attrs_json: string }>('SELECT id, attrs_json FROM persons');
  const now = new Date().toISOString();
  const hlc = hlcNow(getDeviceId());
  const out: RetuneResult = { total: 0, kept: 0, dropped: 0 };
  const changed: { id: string; attrs: Record<string, unknown>; kept: boolean }[] = [];

  for (const r of rows) {
    let attrs: Record<string, { v?: unknown; [k: string]: unknown }>;
    try {
      attrs = JSON.parse(r.attrs_json || '{}');
    } catch {
      continue;
    }
    if (!attrs || !(key in attrs)) continue;
    out.total++;
    const prev = attrs[key] ?? {};
    const v = coerceValue(prev.v, def.type, def);
    if (v === undefined) {
      delete attrs[key];
      out.dropped++;
      changed.push({ id: r.id, attrs, kept: false });
    } else {
      const next: Record<string, unknown> = { ...prev, v, updatedAt: hlc };
      // 单位只对数字/金额有意义，换到别的类型时清掉，避免展示成「文本 cm」
      if (def.type === 'number' || def.type === 'money') {
        if (def.unit) next.unit = def.unit;
        else delete next.unit;
      } else {
        delete next.unit;
      }
      attrs[key] = next;
      out.kept++;
      changed.push({ id: r.id, attrs, kept: true });
    }
  }

  if (changed.length) {
    transact(() => {
      for (const c of changed) {
        run('UPDATE persons SET attrs_json = ?, rev = rev + 1, hlc = ?, updated_at = ? WHERE id = ?', [
          JSON.stringify(c.attrs),
          hlc,
          now,
          c.id,
        ]);
        appendOplog('person', c.id, 'update', { attr: key, retyped: true, kept: c.kept });
      }
    });
  }

  return out;
}

export { FIRST_ORDER_KEY };
