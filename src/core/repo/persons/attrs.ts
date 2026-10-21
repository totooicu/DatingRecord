// 属性字典（动态字段定义）的增删改查。
// 定义永不物理删除，只归档——否则历史属性值会失去含义。

import { queryAll, queryOne, run, transact, appendOplog, getDeviceId } from '../../db';
import { hlcNow } from '../../time';
import { orderKeyBetween } from '../../order';
import type { AttributeDef, AttributeType } from '../../types';
import { defFromRow, type DefRow } from './rows';

// ---------------- 属性定义 ----------------

export function listDefs(includeArchived = false): AttributeDef[] {
  const sql = includeArchived
    ? 'SELECT * FROM attribute_defs ORDER BY order_key'
    : 'SELECT * FROM attribute_defs WHERE archived = 0 ORDER BY order_key';
  return queryAll<DefRow>(sql).map(defFromRow);
}

export function getDef(key: string): AttributeDef | null {
  const row = queryOne<DefRow>('SELECT * FROM attribute_defs WHERE key = ?', [key]);
  return row ? defFromRow(row) : null;
}

export function upsertDef(input: Partial<AttributeDef> & { key: string; label: string; type: AttributeType }): void {
  const existing = getDef(input.key);
  const now = new Date().toISOString();
  const hlc = hlcNow(getDeviceId());

  transact(() => {
    if (existing) {
      // 关键约束：key 不可改；type 可以改，调用方负责先按新类型转换已有值
      run(
        `UPDATE attribute_defs SET label=?, type=?, group_name=?, options_json=?, unit=?, max_value=?,
         required=?, sensitive=?, time_varying=?, archived=?, hlc=?, updated_at=? WHERE key=?`,
        [
          input.label ?? existing.label,
          input.type ?? existing.type,
          input.group ?? existing.group,
          JSON.stringify(input.options ?? existing.options ?? []),
          input.unit ?? existing.unit ?? null,
          input.max ?? existing.max ?? null,
          (input.required ?? existing.required) ? 1 : 0,
          (input.sensitive ?? existing.sensitive) ? 1 : 0,
          (input.timeVarying ?? existing.timeVarying) ? 1 : 0,
          (input.archived ?? existing.archived) ? 1 : 0,
          hlc,
          now,
          input.key,
        ],
      );
      appendOplog('attribute_def', input.key, 'update', input);
    } else {
      const last = queryOne<{ order_key: string }>(
        'SELECT order_key FROM attribute_defs ORDER BY order_key DESC LIMIT 1',
      );
      run(
        `INSERT INTO attribute_defs
         (key,label,type,group_name,options_json,unit,max_value,required,sensitive,time_varying,
          archived,order_key,device_id,rev,hlc,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,1,?,?,?)`,
        [
          input.key,
          input.label,
          input.type,
          input.group ?? '自定义',
          JSON.stringify(input.options ?? []),
          input.unit ?? null,
          input.max ?? null,
          input.required ? 1 : 0,
          input.sensitive ? 1 : 0,
          input.timeVarying ? 1 : 0,
          orderKeyBetween(last?.order_key ?? null, null),
          getDeviceId(),
          hlc,
          now,
          now,
        ],
      );
      appendOplog('attribute_def', input.key, 'insert', input);
    }
  });
}

/** 从归档恢复：定义与历史值一直都还在 */
export function restoreDef(key: string): void {
  const now = new Date().toISOString();
  transact(() => {
    run('UPDATE attribute_defs SET archived = 0, hlc = ?, updated_at = ? WHERE key = ?', [
      hlcNow(getDeviceId()),
      now,
      key,
    ]);
    appendOplog('attribute_def', key, 'update', { archived: false });
  });
}

/** 归档（软删除）：历史值全部保留，永不物理删除定义 */
export function archiveDef(key: string): void {
  const now = new Date().toISOString();
  transact(() => {
    run('UPDATE attribute_defs SET archived = 1, hlc = ?, updated_at = ? WHERE key = ?', [
      hlcNow(getDeviceId()),
      now,
      key,
    ]);
    appendOplog('attribute_def', key, 'delete', { key });
  });
}
