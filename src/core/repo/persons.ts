// 人物仓储：动态属性系统（属性定义 + 属性值 + 历史）

import { queryAll, queryOne, run, transact, appendOplog, getDeviceId } from '../db';
import { newId } from '../id';
import { hlcNow } from '../time';
import { orderKeyBetween, FIRST_ORDER_KEY } from '../order';
import type { AttributeDef, AttributeType, AttributeValue, Person } from '../types';

interface DefRow {
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

interface PersonRow {
  id: string;
  display_name: string;
  aliases_json: string;
  kind: string;
  status: string;
  avatar: string | null;
  tags_json: string;
  attrs_json: string;
  notes: string;
  device_id: string;
  rev: number;
  hlc: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

function safeParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function defFromRow(r: DefRow): AttributeDef {
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

function personFromRow(r: PersonRow): Person {
  return {
    id: r.id,
    displayName: r.display_name,
    aliases: safeParse<string[]>(r.aliases_json, []),
    kind: r.kind as Person['kind'],
    status: r.status as Person['status'],
    avatar: r.avatar,
    tags: safeParse<string[]>(r.tags_json, []),
    attrs: safeParse<Record<string, AttributeValue>>(r.attrs_json, {}),
    notes: r.notes,
    deviceId: r.device_id,
    rev: r.rev,
    hlc: r.hlc,
    deletedAt: r.deleted_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

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
      // 关键约束：type 不可改，key 不可改
      run(
        `UPDATE attribute_defs SET label=?, group_name=?, options_json=?, unit=?, max_value=?,
         required=?, sensitive=?, time_varying=?, archived=?, hlc=?, updated_at=? WHERE key=?`,
        [
          input.label ?? existing.label,
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

// ---------------- 人物 ----------------

export interface PersonStats {
  eventCount: number;
  lastMeetTs: number | null;
  totalCost: number;
  avgRating: number | null;
}

export interface PersonWithStats extends Person {
  stats: PersonStats;
}

export function listPersons(opts: { includeArchived?: boolean; keyword?: string } = {}): PersonWithStats[] {
  const where: string[] = ['p.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (!opts.includeArchived) where.push("p.status = 'active'");
  if (opts.keyword) {
    where.push('(p.display_name LIKE ? OR p.aliases_json LIKE ? OR p.tags_json LIKE ?)');
    const kw = `%${opts.keyword}%`;
    params.push(kw, kw, kw);
  }
  const rows = queryAll<PersonRow>(
    `SELECT * FROM persons p WHERE ${where.join(' AND ')} ORDER BY p.display_name`,
    params,
  );
  return rows.map((r) => ({ ...personFromRow(r), stats: statsOf(r.id) }));
}

export function getPerson(id: string): Person | null {
  const row = queryOne<PersonRow>('SELECT * FROM persons WHERE id = ? AND deleted_at IS NULL', [id]);
  return row ? personFromRow(row) : null;
}

export function statsOf(personId: string): PersonStats {
  const row = queryOne<{ c: number | null; last: number | null; cost: number | null; rating: number | null }>(
    `SELECT COUNT(e.id) AS c,
            MAX(e.start_ts) AS last,
            COALESCE(SUM(json_extract(e.metrics_json, '$.cost')), 0) AS cost,
            AVG(json_extract(e.metrics_json, '$.rating')) AS rating
     FROM events e
     JOIN event_participants p ON p.event_id = e.id
     WHERE p.person_id = ? AND e.deleted_at IS NULL`,
    [personId],
  );
  return {
    eventCount: row?.c ?? 0,
    lastMeetTs: row?.last ?? null,
    totalCost: row?.cost ?? 0,
    avgRating: row?.rating ?? null,
  };
}

export function createPerson(input: { displayName: string; tags?: string[]; attrs?: Record<string, AttributeValue> }): Person {
  const id = newId('p');
  const now = new Date().toISOString();
  const hlc = hlcNow(getDeviceId());
  transact(() => {
    run(
      `INSERT INTO persons
       (id,display_name,aliases_json,kind,status,tags_json,attrs_json,notes,device_id,rev,hlc,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        input.displayName,
        '[]',
        'person',
        'active',
        JSON.stringify(input.tags ?? []),
        JSON.stringify(input.attrs ?? {}),
        '',
        getDeviceId(),
        1,
        hlc,
        now,
        now,
      ],
    );
    appendOplog('person', id, 'insert', { displayName: input.displayName });
  });
  return getPerson(id)!;
}

export function updatePerson(
  id: string,
  patch: Partial<Pick<Person, 'displayName' | 'aliases' | 'tags' | 'notes' | 'status' | 'avatar' | 'kind'>>,
): void {
  const now = new Date().toISOString();
  const hlc = hlcNow(getDeviceId());
  transact(() => {
    const p = getPerson(id);
    if (!p) return;
    run(
      `UPDATE persons SET display_name=?, aliases_json=?, tags_json=?, notes=?, status=?, avatar=?, kind=?,
       rev=rev+1, hlc=?, updated_at=? WHERE id=?`,
      [
        patch.displayName ?? p.displayName,
        JSON.stringify(patch.aliases ?? p.aliases),
        JSON.stringify(patch.tags ?? p.tags),
        patch.notes ?? p.notes,
        patch.status ?? p.status,
        patch.avatar ?? p.avatar ?? null,
        patch.kind ?? p.kind,
        hlc,
        now,
        id,
      ],
    );
    appendOplog('person', id, 'update', patch);
  });
}

/** 软删除（墓碑）：不做物理删除，否则同步时会把数据推回来 */
export function deletePerson(id: string): void {
  const now = new Date().toISOString();
  transact(() => {
    run('UPDATE persons SET status = ?, rev = rev + 1, hlc = ?, updated_at = ? WHERE id = ?', [
      'archived',
      hlcNow(getDeviceId()),
      now,
      id,
    ]);
    appendOplog('person', id, 'delete', { id });
  });
}

export function hardDeletePerson(id: string): void {
  transact(() => {
    run('DELETE FROM persons WHERE id = ?', [id]);
    run('DELETE FROM event_participants WHERE person_id = ?', [id]);
    run('DELETE FROM person_attr_history WHERE person_id = ?', [id]);
    appendOplog('person', id, 'delete', { id, hard: true });
  });
}

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
