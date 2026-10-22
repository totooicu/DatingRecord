// 导入：按 hlc 比较合并，本地更新的数据不会被旧备份覆盖

import {
  queryOne,
  run,
  transact,
  getDeviceId,
  persist,
  setMeta,
  noteUndoStep,
  suspendUndo,
  resumeUndo,
} from '../db';
import { newId } from '../id';
import { hlcCompare, hlcNow, hlcReceive } from '../time';
import { putBlob, base64ToBlob } from '../db/blob';
import { ensureClosure } from '../repo/collections';
import { SCHEMA_VERSION, type Attachment, type LibraryFile } from '../types';
import { defToRow, personToRow, eventToRow, collectionToRow, templateToRow, aiModelToRow } from './mappers';
import { exportToFile } from './export';

export interface ImportResult {
  mode: 'merge' | 'replace';
  counts: Record<string, number>;
  skipped: number;
  backupName?: string;
}

/**
 * 按 hlc 合并写入。
 * pk 支持联合主键（如 collection_members 的 collection_id + member_type + member_id），
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
  const sql = `INSERT OR REPLACE INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  run(sql, keys.map((k) => cols[k]));
  return true;
}

export async function importLibrary(
  raw: string,
  mode: 'merge' | 'replace',
): Promise<ImportResult> {
  const lib = JSON.parse(raw) as LibraryFile;
  if (!lib || typeof lib !== 'object' || !Array.isArray(lib.persons)) {
    throw new Error('文件格式不正确：不是有效的 .drp.json');
  }
  const version = Number(lib.schemaVersion ?? 1);
  if (version > SCHEMA_VERSION) {
    throw new Error(`文件版本 ${version} 高于当前支持的 ${SCHEMA_VERSION}，请升级软件`);
  }

  const counts: Record<string, number> = { defs: 0, persons: 0, events: 0, collections: 0, members: 0, attachments: 0, templates: 0, aiModels: 0 };
  const importedAttachments: Attachment[] = [];
  let skipped = 0;
  let backupName: string | undefined;

  if (mode === 'replace') {
    // 危险操作：替换前自动导出一份备份
    backupName = await exportToFile({ includeAttachments: true });
  }

  // 整次导入只记一步撤销：中间几百次 upsert 不该占满撤销栈
  noteUndoStep(mode === 'replace' ? '替换导入' : '合并导入');
  suspendUndo();
  try {
  transact(() => {
    if (mode === 'replace') {
      for (const t of [
        'oplog',
        'collection_members',
        'collection_closure',
        'collections',
        'event_participants',
        'events',
        'person_attr_history',
        'persons',
        'attribute_defs',
        // 之前的清空列表漏了 attachments，替换导入会留下上一份库的附件
        'attachments',
        'ai_models',
      ]) {
        run(`DELETE FROM ${t}`);
      }
    }

    for (const d of lib.attributeDefs ?? []) {
      const ok = upsertByHlc('attribute_defs', 'key', d.key, d.hlc ?? null, defToRow(d));
      ok ? counts.defs++ : skipped++;
      hlcReceive(d.hlc ?? '');
    }
    for (const p of lib.persons ?? []) {
      const ok = upsertByHlc('persons', 'id', p.id, p.hlc, personToRow(p));
      ok ? counts.persons++ : skipped++;
      hlcReceive(p.hlc);
    }
    for (const e of lib.events ?? []) {
      const ok = upsertByHlc('events', 'id', e.id, e.hlc, eventToRow(e));
      if (ok) {
        counts.events++;
        run('DELETE FROM event_participants WHERE event_id = ?', [e.id]);
        for (const pt of e.participants ?? []) {
          run(
            'INSERT OR REPLACE INTO event_participants (event_id, person_id, role, note, per_person_json) VALUES (?,?,?,?,?)',
            [e.id, pt.personId, pt.role ?? 'primary', pt.note ?? '', JSON.stringify(pt.perPerson ?? {})],
          );
        }
      } else {
        skipped++;
      }
      hlcReceive(e.hlc);
    }
    for (const h of lib.attrHistory ?? []) {
      run(
        'INSERT OR IGNORE INTO person_attr_history (id, person_id, attr_key, value_json, changed_at, by_event_id, reason) VALUES (?,?,?,?,?,?,?)',
        [h.id || newId('att'), h.personId, h.key, h.valueJson, h.changedAt, h.byEventId ?? null, h.reason ?? null],
      );
    }
    for (const c of lib.collections ?? []) {
      const ok = upsertByHlc('collections', 'id', c.id, c.hlc, collectionToRow(c));
      ok ? counts.collections++ : skipped++;
      hlcReceive(c.hlc);
    }
    for (const m of lib.members ?? []) {
      // 联合主键：(collection_id, member_type, member_id)
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
      ok ? counts.members++ : skipped++;
    }
    for (const t of lib.templates ?? []) {
      const ok = upsertByHlc(
        'attribute_templates',
        'id',
        t.id,
        t.hlc ?? null,
        templateToRow(t),
      );
      ok ? counts.templates++ : skipped++;
    }
    for (const m of lib.aiModels ?? []) {
      const ok = upsertByHlc('ai_models', 'id', m.id, m.hlc ?? null, aiModelToRow(m));
      ok ? counts.aiModels++ : skipped++;
    }
    for (const a of lib.attachments ?? []) {
      run('INSERT OR IGNORE INTO attachments (id, stored_id, sha256, mime, name, data, size, taken_at, created_at, hash_shared, is_private) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [
        a.id,
        // 老备份没有 storedId：用 id 顶上，语义等同「老的引用名」
        a.storedId || a.id,
        a.sha256 ?? '',
        a.mime ?? '',
        a.name ?? '',
        // data 只作为交换格式存在，运行期二进制在 IndexedDB，库里留空
        '',
        a.size ?? 0,
        a.takenAt ?? null,
        a.createdAt ?? new Date().toISOString(),
        a.hashShared ? 1 : 0,
        a.isPrivate ? 1 : 0,
      ]);
      importedAttachments.push(a);
    }
  });
  } finally {
    resumeUndo();
  }

  // 二进制在事务外写：IndexedDB 是异步的，塞进 SQL 事务会破坏原子性边界
  for (const a of importedAttachments) {
    if (a.data) await putBlob(a.id, base64ToBlob(a.data));
    counts.attachments++;
  }

  ensureClosure();
  setMeta('last_import_at', new Date().toISOString());
  await persist();
  return { mode, counts, skipped, backupName };
}

