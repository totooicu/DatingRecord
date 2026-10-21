// 属性模板（F-P04）：一组 def key 的有序集合。
//
// 「应用到人物」是合并语义：模板里已有值的字段不动，只给缺的字段播种默认值。
// 播种不走 setAttribute——那是逐字段写历史（timeVarying 会每条都留痕），
// 套模板只是摆盘子，不该在「属性变化」里刷出一屏空记录。

import { queryAll, queryOne, run, transact, appendOplog, getDeviceId } from '../../db';
import { newId } from '../../id';
import { hlcNow } from '../../time';
import { listDefs } from './attrs';
import { getPerson } from './read';
import type { AttributeDef, AttributeType, AttrTemplate } from '../../types';

interface TemplateRow {
  id: string;
  name: string;
  keys_json: string;
  created_at: string;
}

function fromRow(r: TemplateRow): AttrTemplate {
  let keys: string[] = [];
  try {
    const v = JSON.parse(r.keys_json);
    if (Array.isArray(v)) keys = v.filter((k): k is string => typeof k === 'string');
  } catch {
    /* 坏数据按空模板算，比整个页面崩掉好 */
  }
  return { id: r.id, name: r.name, keys, createdAt: r.created_at };
}

export function listTemplates(): AttrTemplate[] {
  return queryAll<TemplateRow>(
    'SELECT id, name, keys_json, created_at FROM attribute_templates WHERE deleted_at IS NULL ORDER BY created_at ASC',
  ).map(fromRow);
}

export function getTemplate(id: string): AttrTemplate | null {
  const r = queryOne<TemplateRow>(
    'SELECT id, name, keys_json, created_at FROM attribute_templates WHERE id = ? AND deleted_at IS NULL',
    [id],
  );
  return r ? fromRow(r) : null;
}

/** 只留字典里真存在的 key，去重且保持给定顺序 */
export function sanitizeKeys(keys: string[]): string[] {
  const known = new Set(listDefs(true).map((d) => d.key));
  const out: string[] = [];
  for (const k of keys) {
    if (known.has(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

export function createTemplate(name: string, keys: string[]): AttrTemplate {
  const id = newId('tpl');
  const now = new Date().toISOString();
  const clean = sanitizeKeys(keys);
  transact(() => {
    run(
      'INSERT INTO attribute_templates (id, name, keys_json, device_id, rev, hlc, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
      [id, name.trim() || '未命名模板', JSON.stringify(clean), getDeviceId(), 1, hlcNow(getDeviceId()), now, now],
    );
    appendOplog('template', id, 'insert', { title: name, keys: clean.length });
  });
  return getTemplate(id)!;
}

export function renameTemplate(id: string, name: string): void {
  transact(() => {
    run('UPDATE attribute_templates SET name = ?, rev = rev + 1, hlc = ?, updated_at = ? WHERE id = ?', [
      name.trim() || '未命名模板',
      hlcNow(getDeviceId()),
      new Date().toISOString(),
      id,
    ]);
    appendOplog('template', id, 'update', { title: name });
  });
}

/** 软删除：和别处一套语义，回收/彻底删的按钮先不做，模板删错重来成本低 */
export function deleteTemplate(id: string): void {
  transact(() => {
    run('UPDATE attribute_templates SET deleted_at = ?, rev = rev + 1, hlc = ?, updated_at = ? WHERE id = ?', [
      new Date().toISOString(),
      hlcNow(getDeviceId()),
      new Date().toISOString(),
      id,
    ]);
    appendOplog('template', id, 'delete', { id });
  });
}

/** 各类型的「空盘子」值。注意 false / 0 / [] 都是合法值，不能当没填 */
function seedValue(def: AttributeDef): unknown {
  switch (def.type as AttributeType) {
    case 'boolean':
      return false;
    case 'number':
    case 'money':
    case 'rating':
      return 0;
    case 'enumMulti':
    case 'tag':
      return [];
    default:
      return '';
  }
}

/**
 * 套用模板：已有值的字段一律不碰，只补缺失的。
 * 返回补了几个字段。直接改 attrs_json——一次 UPDATE、一次 rev，
 * 且不产生任何属性历史。
 */
export function applyTemplate(templateId: string, personId: string): number {
  const tpl = getTemplate(templateId);
  const p = getPerson(personId);
  if (!tpl || !p) return 0;
  const defs = new Map(listDefs(true).map((d) => [d.key, d]));
  const now = new Date().toISOString();
  let added = 0;
  transact(() => {
    const attrs = { ...p.attrs };
    for (const key of tpl.keys) {
      if (attrs[key]) continue; // 合并语义：只补缺的
      const def = defs.get(key);
      if (!def) continue; // 字典里被删了的 key 直接跳过
      attrs[key] = { v: seedValue(def), updatedAt: hlcNow(getDeviceId()) };
      added++;
    }
    if (!added) return;
    run('UPDATE persons SET attrs_json = ?, rev = rev + 1, hlc = ?, updated_at = ? WHERE id = ?', [
      JSON.stringify(attrs),
      hlcNow(getDeviceId()),
      now,
      personId,
    ]);
    appendOplog('person', personId, 'update', { template: tpl.name, added });
  });
  return added;
}

/** 从当前人物已填的字段存一个模板（按字典分组顺序排） */
export function saveAsTemplate(personId: string, name: string): AttrTemplate | null {
  const p = getPerson(personId);
  if (!p) return null;
  const order = listDefs(true).map((d) => d.key);
  const keys = Object.keys(p.attrs).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return createTemplate(name, keys);
}
