// 属性变更历史的查询。写入在 values.ts 的 setAttribute 里（timeVarying 字段才记）。
import { queryAll } from '../../db';

export interface AttrHistoryRow {
  key: string;
  valueJson: string;
  changedAt: string;
  reason: string | null;
}

/** 属性历史（只有 timeVarying 字段才会记录）。按 changed_at 升序。 */
export function listAttrHistory(personId: string, key?: string): AttrHistoryRow[] {
  const cols = 'attr_key AS key, value_json AS valueJson, changed_at AS changedAt, reason AS reason';
  const sql = key
    ? `SELECT ${cols} FROM person_attr_history WHERE person_id = ? AND attr_key = ? ORDER BY changed_at`
    : `SELECT ${cols} FROM person_attr_history WHERE person_id = ? ORDER BY changed_at`;
  return queryAll<AttrHistoryRow>(sql, key ? [personId, key] : [personId]).map((r) => ({
    ...r,
    reason: r.reason ?? null,
  }));
}
