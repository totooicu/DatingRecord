// 属性值读写与变更历史。
// 随时间变化的字段（timeVarying）会自动留一条历史，便于回看趋势。

import { queryAll, run, transact, appendOplog, getDeviceId } from '../../db';
import { newId } from '../../id';
import { hlcNow } from '../../time';
import { FIRST_ORDER_KEY } from '../../order';
import { getPerson } from './read';
import { getDef } from './attrs';

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

export function listAttrHistory(personId: string, key?: string): { key: string; valueJson: string; changedAt: string }[] {
  const sql = key
    ? 'SELECT attr_key AS key, value_json AS valueJson, changed_at AS changedAt FROM person_attr_history WHERE person_id = ? AND attr_key = ? ORDER BY changed_at'
    : 'SELECT attr_key AS key, value_json AS valueJson, changed_at AS changedAt FROM person_attr_history WHERE person_id = ? ORDER BY changed_at';
  const params = key ? [personId, key] : [personId];
  return queryAll<{ key: string; valueJson: string; changedAt: string }>(sql, params);
}

export { FIRST_ORDER_KEY };
