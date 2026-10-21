// 导入导出：.drp.json 单文件交换格式（纯文本、可 diff、可 git 管理）
// 设计要点：
//   1. 导出完整快照（含已归档、含墓碑），保证是真正的备份
//   2. 导入按 hlc 比较，本地更新的数据不会被旧备份覆盖
//   3. 替换模式前强制自动备份

import { queryAll, queryOne, run, transact, getDb, getDeviceId, getMeta, setMeta, persist } from './db';
import { newId } from './id';
import { hlcCompare, hlcNow, hlcReceive } from './time';
import { ensureClosure } from './repo/collections';
import { getBlob, putBlob, clearBlobs, blobToBase64, base64ToBlob } from './db/blob';
import { SCHEMA_VERSION, type Attachment, type AttributeDef, type Collection, type DREvent, type LibraryFile, type Member, type Person } from './types';

// ---------------- 导出 ----------------

/**
 * 附件导出：库里只有元数据，二进制在 IndexedDB，这里临时转成 base64。
 * 所以包含附件的备份会明显变大——这也是导出默认可以关掉它的原因。
 */
async function exportAttachments(): Promise<Attachment[]> {
  const rows = queryAll<Row>('SELECT * FROM attachments');
  const out: Attachment[] = [];
  for (const r of rows) {
    const meta = rowToAttachment(r);
    const blob = await getBlob(r.id);
    out.push({ ...meta, data: blob ? await blobToBase64(blob) : '' });
  }
  return out;
}

export async function buildLibrary(opts: { includeAttachments?: boolean } = {}): Promise<LibraryFile> {
  const defs = queryAll<Record<string, never>>('SELECT * FROM attribute_defs').map(rowToDef);
  const persons = queryAll<Record<string, never>>('SELECT * FROM persons').map(rowToPerson);
  const events = queryAll<Record<string, never>>('SELECT * FROM events').map(rowToEvent);
  const collections = queryAll<Record<string, never>>('SELECT * FROM collections').map(rowToCollection);
  const members = queryAll<Record<string, never>>('SELECT * FROM collection_members').map(rowToMember);
  const attachments = opts.includeAttachments ? await exportAttachments() : [];

  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      id: getMeta('library_id') ?? newId('lib'),
      name: getMeta('library_name') ?? '我的记录',
      exportedAt: new Date().toISOString(),
      app: 'DatingRecord/0.1.0',
      deviceId: getDeviceId(),
    },
    attributeDefs: defs,
    persons,
    attrHistory: queryAll<Row>('SELECT * FROM person_attr_history').map((r) => ({
      id: r.id,
      personId: r.person_id,
      key: r.attr_key,
      valueJson: r.value_json,
      changedAt: r.changed_at,
      byEventId: r.by_event_id ?? null,
      reason: r.reason ?? undefined,
    })),
    events,
    collections,
    members,
    attachments,
  };
}

export async function exportToFile(opts: { includeAttachments?: boolean } = {}): Promise<string> {
  const lib = await buildLibrary(opts);
  const text = JSON.stringify(lib, null, 2);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dating-record-${stamp}.drp.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return a.download;
}

// ---------------- 导入 ----------------

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

  const counts: Record<string, number> = { defs: 0, persons: 0, events: 0, collections: 0, members: 0, attachments: 0 };
  const importedAttachments: Attachment[] = [];
  let skipped = 0;
  let backupName: string | undefined;

  if (mode === 'replace') {
    // 危险操作：替换前自动导出一份备份
    backupName = await exportToFile({ includeAttachments: true });
  }

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
    for (const a of lib.attachments ?? []) {
      run('INSERT OR IGNORE INTO attachments (id, sha256, mime, name, data, size, taken_at, created_at) VALUES (?,?,?,?,?,?,?,?)', [
        a.id,
        a.sha256 ?? '',
        a.mime ?? '',
        a.name ?? '',
        // data 只作为交换格式存在，运行期二进制在 IndexedDB，库里留空
        '',
        a.size ?? 0,
        a.takenAt ?? null,
        a.createdAt ?? new Date().toISOString(),
      ]);
      importedAttachments.push(a);
    }
  });

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

/** 清空全部数据（用于「重置」） */
export async function clearAllData(): Promise<void> {
  // 附件二进制在 IndexedDB，不在这些表里，必须单独清
  await clearBlobs();
  transact(() => {
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
      'attachments',
    ]) {
      run(`DELETE FROM ${t}`);
    }
  });
}

export function dbSizeBytes(): number {
  const bytes = getDb().export();
  return bytes.length;
}

// ---------------- 行 <-> 对象 ----------------

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

function rowToDef(r: Row): AttributeDef {
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

function defToRow(d: AttributeDef): Row {
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

function rowToPerson(r: Row): Person {
  return {
    id: r.id,
    displayName: r.display_name,
    aliases: JSON.parse(r.aliases_json ?? '[]'),
    kind: r.kind ?? 'person',
    status: r.status ?? 'active',
    avatar: r.avatar ?? null,
    tags: JSON.parse(r.tags_json ?? '[]'),
    attrs: JSON.parse(r.attrs_json ?? '{}'),
    notes: r.notes ?? '',
    deviceId: r.device_id ?? '',
    rev: r.rev ?? 1,
    hlc: r.hlc ?? '',
    deletedAt: r.deleted_at ?? null,
    createdAt: r.created_at ?? '',
    updatedAt: r.updated_at ?? '',
  };
}

function personToRow(p: Person): Row {
  return {
    id: p.id,
    display_name: p.displayName,
    aliases_json: JSON.stringify(p.aliases ?? []),
    kind: p.kind ?? 'person',
    status: p.status ?? 'active',
    avatar: p.avatar ?? null,
    tags_json: JSON.stringify(p.tags ?? []),
    attrs_json: JSON.stringify(p.attrs ?? {}),
    notes: p.notes ?? '',
    device_id: p.deviceId || getDeviceId(),
    rev: p.rev ?? 1,
    hlc: p.hlc || hlcNow(getDeviceId()),
    deleted_at: p.deletedAt ?? null,
    created_at: p.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function rowToEvent(r: Row): DREvent {
  const pts = queryAll<Row>('SELECT person_id, role, note, per_person_json FROM event_participants WHERE event_id = ?', [
    r.id,
  ]);
  return {
    id: r.id,
    title: r.title,
    kind: r.kind ?? 'note',
    time: JSON.parse(r.time_json ?? '{"kind":"unknown"}'),
    startTs: r.start_ts ?? null,
    endTs: r.end_ts ?? null,
    place: JSON.parse(r.place_json ?? '{}'),
    participants: pts.map((p) => ({
      personId: p.person_id,
      role: p.role ?? 'primary',
      note: p.note || undefined,
      perPerson: JSON.parse(p.per_person_json ?? '{}'),
    })),
    content: r.content ?? '',
    media: JSON.parse(r.media_json ?? '[]'),
    tags: JSON.parse(r.tags_json ?? '[]'),
    metrics: JSON.parse(r.metrics_json ?? '{}'),
    relatedEvents: JSON.parse(r.related_json ?? '[]'),
    primaryCollectionId: r.primary_collection_id ?? null,
    deviceId: r.device_id ?? '',
    rev: r.rev ?? 1,
    hlc: r.hlc ?? '',
    deletedAt: r.deleted_at ?? null,
    createdAt: r.created_at ?? '',
    updatedAt: r.updated_at ?? '',
  };
}

function eventToRow(e: DREvent): Row {
  return {
    id: e.id,
    title: e.title,
    kind: e.kind ?? 'note',
    start_ts: e.startTs ?? null,
    end_ts: e.endTs ?? null,
    time_json: JSON.stringify(e.time ?? { kind: 'unknown' }),
    place_json: JSON.stringify(e.place ?? {}),
    content: e.content ?? '',
    tags_json: JSON.stringify(e.tags ?? []),
    metrics_json: JSON.stringify(e.metrics ?? {}),
    media_json: JSON.stringify(e.media ?? []),
    related_json: JSON.stringify(e.relatedEvents ?? []),
    primary_collection_id: e.primaryCollectionId ?? null,
    device_id: e.deviceId || getDeviceId(),
    rev: e.rev ?? 1,
    hlc: e.hlc || hlcNow(getDeviceId()),
    deleted_at: e.deletedAt ?? null,
    created_at: e.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function rowToCollection(r: Row): Collection {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind ?? 'arc',
    parentId: r.parent_id ?? null,
    orderKey: r.order_key ?? 'V',
    description: r.description ?? '',
    cover: r.cover ?? null,
    status: r.status ?? 'ongoing',
    rule: r.rule_json ? JSON.parse(r.rule_json) : null,
    isRoot: !!r.is_root,
    timeRangeAuto: !!r.time_range_auto,
    timeRangeStart: r.time_range_start ?? null,
    timeRangeEnd: r.time_range_end ?? null,
    deviceId: r.device_id ?? '',
    rev: r.rev ?? 1,
    hlc: r.hlc ?? '',
    deletedAt: r.deleted_at ?? null,
    createdAt: r.created_at ?? '',
    updatedAt: r.updated_at ?? '',
  };
}

function collectionToRow(c: Collection): Row {
  return {
    id: c.id,
    name: c.name,
    kind: c.kind ?? 'arc',
    parent_id: c.parentId ?? null,
    order_key: c.orderKey ?? 'V',
    description: c.description ?? '',
    cover: c.cover ?? null,
    status: c.status ?? 'ongoing',
    rule_json: c.rule ? JSON.stringify(c.rule) : null,
    is_root: c.isRoot ? 1 : 0,
    time_range_auto: c.timeRangeAuto ? 1 : 0,
    time_range_start: c.timeRangeStart ?? null,
    time_range_end: c.timeRangeEnd ?? null,
    device_id: c.deviceId || getDeviceId(),
    rev: c.rev ?? 1,
    hlc: c.hlc || hlcNow(getDeviceId()),
    deleted_at: c.deletedAt ?? null,
    created_at: c.createdAt || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function rowToMember(r: Row): Member {
  return {
    collectionId: r.collection_id,
    memberType: r.member_type,
    memberId: r.member_id,
    orderKey: r.order_key ?? 'V',
    note: r.note ?? '',
    hlc: r.hlc ?? '',
    deletedAt: r.deleted_at ?? null,
  };
}

function rowToAttachment(r: Row): Attachment {
  return {
    id: r.id,
    sha256: r.sha256 ?? '',
    mime: r.mime ?? '',
    name: r.name ?? '',
    data: r.data ?? '',
    size: r.size ?? 0,
    takenAt: r.taken_at ?? null,
    createdAt: r.created_at ?? '',
  };
}
