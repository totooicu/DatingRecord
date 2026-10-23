// 合并远端快照的行级逻辑。
//
// 和 import.ts 一样按 hlc 比较：本地更新的数据不被旧数据覆盖。
// 拆成独立文件是为了让 engine（双向同步）和 import（整库导入）共用同一套规则，
// 而不是复制两份「谁更新」的判断——两份判断迟早会有一份出错。
import { queryOne, run, getDeviceId } from '../db';
import { newId } from '../id';
import { hlcReceive, hlcCompare, hlcNow } from '../time';
import type { LibraryFile } from '../types';
import { defToRow, personToRow, eventToRow, collectionToRow, templateToRow, aiModelToRow, messageToRow } from '../io/mappers';

export interface MergeCounts {
  defs: number;
  persons: number;
  events: number;
  collections: number;
  members: number;
  attachments: number;
  templates: number;
  aiModels: number;
  history: number;
  messages: number;
  skipped: number;
}

function emptyCounts(): MergeCounts {
  return { defs: 0, persons: 0, events: 0, collections: 0, members: 0, attachments: 0, templates: 0, aiModels: 0, history: 0, messages: 0, skipped: 0 };
}

/**
 * 按 hlc 合并一行。
 * pk 支持联合主键（collection_members 是 collection_id + member_type + member_id），
 * 否则同一事件在多个集合下的成员关系会互相覆盖。
 */
function upsertByHlc(
  table: string,
  pk: string | string[],
  id: string | Record<string, unknown>,
  hlc: string | null,
  cols: Record<string, unknown>,
): boolean {
  const pkCols = Array.isArray(pk) ? pk : [pk];
  const idMap = typeof id === 'string' ? null : id;
  const pkValues = pkCols.map((c) => (idMap ? idMap[c] : id));
  const where = pkCols.map((c) => `${c} = ?`).join(' AND ');
  const existing = queryOne<{ hlc: string | null }>(`SELECT hlc FROM ${table} WHERE ${where}`, pkValues);
  if (existing?.hlc && hlc && hlcCompare(existing.hlc, hlc) >= 0) return false; // 本地更新或相同 → 跳过

  const keys = Object.keys(cols);
  run(
    `INSERT OR REPLACE INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
    keys.map((k) => cols[k]),
  );
  return true;
}

/**
 * 把一份远端快照合并进本地库。
 * 调用方负责包 transact()——这里只用裸 run()，sql.js 的事务不可重入。
 * 附件只写元数据行，二进制由调用方另行拉取。
 */
export function mergeRows(lib: LibraryFile, counts: MergeCounts = emptyCounts()): MergeCounts {
  for (const d of lib.attributeDefs ?? []) {
    upsertByHlc('attribute_defs', 'key', d.key, d.hlc ?? null, defToRow(d)) ? counts.defs++ : counts.skipped++;
    hlcReceive(d.hlc ?? '');
  }
  for (const p of lib.persons ?? []) {
    upsertByHlc('persons', 'id', p.id, p.hlc, personToRow(p)) ? counts.persons++ : counts.skipped++;
    hlcReceive(p.hlc);
  }
  for (const e of lib.events ?? []) {
    const ok = upsertByHlc('events', 'id', e.id, e.hlc, eventToRow(e));
    if (ok) {
      counts.events++;
      // 参与者随事件整体替换：它是事件的从属数据，单独比较 hlc 没有意义
      run('DELETE FROM event_participants WHERE event_id = ?', [e.id]);
      for (const pt of e.participants ?? []) {
        run(
          'INSERT OR REPLACE INTO event_participants (event_id, person_id, role, note, per_person_json) VALUES (?,?,?,?,?)',
          [e.id, pt.personId, pt.role ?? 'primary', pt.note ?? '', JSON.stringify(pt.perPerson ?? {})],
        );
      }
    } else {
      counts.skipped++;
    }
    hlcReceive(e.hlc);
  }
  // 聊天消息逐条合并：一端加了一句、另一端改了另一句，两边都留下
  for (const m of lib.messages ?? []) {
    upsertByHlc('event_messages', 'id', m.id, m.hlc ?? null, messageToRow(m))
      ? counts.messages++
      : counts.skipped++;
    hlcReceive(m.hlc ?? '');
  }
  for (const h of lib.attrHistory ?? []) {
    run(
      'INSERT OR IGNORE INTO person_attr_history (id, person_id, attr_key, value_json, changed_at, by_event_id, reason) VALUES (?,?,?,?,?,?,?)',
      [h.id || newId('att'), h.personId, h.key, h.valueJson, h.changedAt, h.byEventId ?? null, h.reason ?? null],
    );
    counts.history++;
  }
  for (const c of lib.collections ?? []) {
    upsertByHlc('collections', 'id', c.id, c.hlc, collectionToRow(c)) ? counts.collections++ : counts.skipped++;
    hlcReceive(c.hlc);
  }
  for (const m of lib.members ?? []) {
    const ok = upsertByHlc(
      'collection_members',
      ['collection_id', 'member_type', 'member_id'],
      { collection_id: m.collectionId, member_type: m.memberType, member_id: m.memberId },
      m.hlc ?? null,
      {
        collection_id: m.collectionId,
        member_type: m.memberType,
        member_id: m.memberId,
        order_key: m.orderKey,
        note: m.note ?? '',
        device_id: getDeviceId(),
        hlc: m.hlc ?? hlcNow(getDeviceId()),
        deleted_at: m.deletedAt ?? null,
      },
    );
    ok ? counts.members++ : counts.skipped++;
  }
  for (const t of lib.templates ?? []) {
    upsertByHlc('attribute_templates', 'id', t.id, t.hlc ?? null, templateToRow(t))
      ? counts.templates++
      : counts.skipped++;
  }
  for (const m of lib.aiModels ?? []) {
    // 别名唯一：本地已被别的 id 占了这个别名就跳过，避免合并出两个「便宜好用的」
    const taken = queryOne<{ id: string }>(
      'SELECT id FROM ai_models WHERE alias = ? AND deleted_at IS NULL',
      [m.alias],
    );
    if (taken && taken.id !== m.id) {
      counts.skipped++;
      continue;
    }
    upsertByHlc('ai_models', 'id', m.id, m.hlc ?? null, aiModelToRow(m))
      ? counts.aiModels++
      : counts.skipped++;
  }
  for (const a of lib.attachments ?? []) {
    // 附件没有 hlc：它一旦写入就只改 name / is_private，用 INSERT OR IGNORE 保住本地行
    const exists = queryOne<{ id: string }>('SELECT id FROM attachments WHERE id = ?', [a.id]);
    if (exists) {
      counts.skipped++;
      continue;
    }
    run(
      'INSERT OR IGNORE INTO attachments (id, stored_id, sha256, mime, name, data, size, taken_at, created_at, hash_shared, is_private, source_url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [
        a.id,
        // 老备份没有 storedId：用 id 顶上，语义等同「老的引用名」
        a.storedId || a.id,
        a.sha256 ?? '',
        a.mime ?? '',
        a.name ?? '',
        // 运行期二进制在 IndexedDB，库里留空
        '',
        a.size ?? 0,
        a.takenAt ?? null,
        a.createdAt ?? new Date().toISOString(),
        a.hashShared ? 1 : 0,
        a.isPrivate ? 1 : 0,
        a.sourceUrl ?? null,
      ],
    );
    counts.attachments++;
  }
  return counts;
}

export { emptyCounts };
export type { LibraryFile };
