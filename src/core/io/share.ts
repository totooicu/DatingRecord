// 事件集分享：打包 / 解析 / 预览 / 导入。
//
// 和整库导入最大的区别在于**人物**：整库导入是「把这份数据原样接进来」，
// 分享导入是「把别人的一段故事接到我的人物上」——同一个人在我这儿可能
// 早就有记录，再来一份就是两个人了。所以导入前必须先决定每个人怎么落位：
//
//   用户显式关联 → 用指定的本地人物
//   同名         → 自动关联到本地同名人物（预览时已预选，可改）
//   都没有       → 原样导入，等于在本库新建这个人物
//
// 其余部分（事件 / 集合 / 成员 / 消息 / 附件）走整库导入的同一条 hlc 合并，
// 重复导入同一份分享不会产生第二份副本。

import { getDeviceId, queryAll } from '../db';
import { getBlob, blobToBase64 } from '../db/blob';
import { extractFileRefs } from '../markdown';
import { getRoot, descendantIdsOf, getCollection } from '../repo/collections';
import { getEvent } from '../repo/events';
import { listMessages } from '../repo/chat';
import { listPersons } from '../repo/persons';
import {
  SCHEMA_VERSION,
  type Attachment,
  type Collection,
  type DREvent,
  type LibraryFile,
  type Person,
  type ShareFile,
} from '../types';
import { rowToAttachment, rowToMember, type Row } from './mappers';
import { importLibrary, type ImportResult } from './import';

/** 选择器里的「不关联，直接新建」——不能是这个值以外的任何真实人物 id */
export const NEW_PERSON = '__new__';

const APP = 'DatingRecord/0.1.0';

/** 收集一批文本里引用到的全部附件引用名 */
function refsOf(texts: (string | null | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    for (const id of extractFileRefs(t)) out.add(id);
  }
  return out;
}

/**
 * 打包一个事件集。
 *
 * 成员关系是从 collection_members 里按集合筛出来的，而不是逐个事件反查——
 * 同一个事件挂在多个子集合下的情况，反查会漏掉一部分挂接关系。
 */
export async function buildShare(
  collectionId: string,
  opts: { includeAttachments?: boolean } = {},
): Promise<ShareFile> {
  const root = getCollection(collectionId);
  if (!root) throw new Error('事件集不存在或已删除');

  const colIds = [...descendantIdsOf([collectionId])];
  const collections = colIds
    .map((id) => getCollection(id))
    .filter((c): c is Collection => !!c);

  const marks = colIds.map(() => '?').join(',');
  const members = queryAll<Row>(
    `SELECT * FROM collection_members WHERE collection_id IN (${marks}) AND deleted_at IS NULL`,
    colIds,
  ).map(rowToMember);

  const eventIds = [
    ...new Set(members.filter((m) => m.memberType === 'event').map((m) => m.memberId)),
  ];
  const events = eventIds
    .map((id) => getEvent(id))
    .filter((e): e is DREvent => !!e);
  const messages = events.flatMap((e) => listMessages(e.id));

  const personIds = new Set<string>();
  for (const e of events) for (const p of e.participants) personIds.add(p.personId);
  for (const m of messages) if (m.personId) personIds.add(m.personId);
  // 事件集本身也可能是智能集合，规则里指定了人物
  for (const c of collections) if (c.rule?.personId) personIds.add(c.rule.personId);
  const persons = listPersons({ includeArchived: true }).filter((p) => personIds.has(p.id));

  const refs = refsOf([
    ...events.map((e) => e.content),
    ...messages.map((m) => m.body),
    ...persons.flatMap((p) => [p.notes, p.avatar]),
    ...collections.map((c) => c.description),
  ]);

  const attachments: Attachment[] = [];
  if (opts.includeAttachments !== false && refs.size > 0) {
    for (const r of queryAll<Row>('SELECT * FROM attachments')) {
      const a = rowToAttachment(r);
      if (!refs.has(a.id) && !(a.storedId && refs.has(a.storedId))) continue;
      const blob = await getBlob(a.id);
      attachments.push({ ...a, data: blob ? await blobToBase64(blob) : '' });
    }
  }

  return {
    format: 'dr-share',
    version: 1,
    exportedAt: new Date().toISOString(),
    app: APP,
    rootId: root.id,
    collections,
    members,
    events,
    persons,
    messages,
    attachments,
    missingAttachments: refs.size - attachments.length,
  };
}

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || '事件集';
}

/** 生成并下载分享文件，返回下载用的文件名 */
export async function exportShareFile(
  collectionId: string,
  opts: { includeAttachments?: boolean } = {},
): Promise<string> {
  const share = await buildShare(collectionId, opts);
  const root = share.collections.find((c) => c.id === share.rootId);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const name = `分享-${safeName(root?.name ?? '事件集')}-${stamp}.drshare.json`;
  const blob = new Blob([JSON.stringify(share, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

export function parseShare(text: string): ShareFile {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    throw new Error('文件不是合法 JSON');
  }
  const s = o as Partial<ShareFile>;
  if (s?.format !== 'dr-share') {
    throw new Error('这不是事件集分享文件（应是 .drshare.json）');
  }
  if (!Array.isArray(s.collections) || !Array.isArray(s.events) || !s.rootId) {
    throw new Error('分享文件缺少必要内容');
  }
  return s as ShareFile;
}

/** 预览里的一行人物：分享里的人、他出现的次数、建议关联的本地人物 */
export interface SharePersonRow {
  person: Person;
  eventCount: number;
  /** 同名自动匹配到的本地人物；null = 库里没有同名，导入时会新建 */
  suggestedId: string | null;
}

export interface SharePlan {
  share: ShareFile;
  rootName: string;
  collectionCount: number;
  eventCount: number;
  persons: SharePersonRow[];
  missingAttachments: number;
}

const nameKey = (s: string) => s.trim().toLowerCase();

/**
 * 生成预览用的计划。同名人物在这里就自动关联好（suggestedId），
 * 界面把它预选上，用户只需要扫一眼有没有认错人。
 */
export function planShare(share: ShareFile): SharePlan {
  const local = listPersons({ includeArchived: true });
  const byName = new Map<string, Person>();
  for (const p of local) {
    const k = nameKey(p.displayName);
    if (!byName.has(k)) byName.set(k, p);
    for (const al of p.aliases ?? []) {
      const ak = nameKey(al);
      if (!byName.has(ak)) byName.set(ak, p);
    }
  }

  const counts = new Map<string, number>();
  for (const e of share.events) {
    for (const p of e.participants) counts.set(p.personId, (counts.get(p.personId) ?? 0) + 1);
  }
  for (const m of share.messages ?? []) {
    if (m.personId) counts.set(m.personId, (counts.get(m.personId) ?? 0) + 1);
  }

  const root = share.collections.find((c) => c.id === share.rootId);
  return {
    share,
    rootName: root?.name ?? '事件集',
    collectionCount: share.collections.length,
    eventCount: share.events.length,
    persons: share.persons.map((person) => ({
      person,
      eventCount: counts.get(person.id) ?? 0,
      suggestedId: byName.get(nameKey(person.displayName))?.id ?? null,
    })),
    missingAttachments: share.missingAttachments ?? 0,
  };
}

/**
 * 落库。
 *
 * 集合的挂接点：分享里层级完整的子集合保持原样，顶层那个（以及任何父集合
 * 没被一起分享的孤儿）挂到 `parentId`。分享文件可能来自别人的库，
 * 那个 parentId 在我这儿多半不存在。
 */
export async function applyShare(
  share: ShareFile,
  opts: { personMap: Record<string, string>; parentId?: string | null },
): Promise<ImportResult> {
  const local = listPersons({ includeArchived: true });
  const byName = new Map<string, Person>();
  for (const p of local) {
    const k = nameKey(p.displayName);
    if (!byName.has(k)) byName.set(k, p);
  }

  // 每个人最终落到哪个 id
  const map = new Map<string, string>();
  const toImport: Person[] = [];
  for (const p of share.persons ?? []) {
    const chosen = opts.personMap[p.id];
    if (chosen && chosen !== NEW_PERSON) {
      map.set(p.id, chosen);
      continue;
    }
    if (!chosen) {
      const same = byName.get(nameKey(p.displayName));
      if (same) {
        map.set(p.id, same.id);
        continue;
      }
    }
    // 没有关联也没有同名：整份人物原样进来，等于在本库新建
    toImport.push(p);
    map.set(p.id, p.id);
  }

  const events = (share.events ?? []).map((e) => ({
    ...e,
    participants: (e.participants ?? []).map((pt) => ({
      ...pt,
      personId: map.get(pt.personId) ?? pt.personId,
    })),
  }));
  const messages = (share.messages ?? []).map((m) => ({
    ...m,
    personId: m.personId ? map.get(m.personId) ?? m.personId : null,
  }));

  const colIds = new Set((share.collections ?? []).map((c) => c.id));
  const target = opts.parentId ?? getRoot()?.id ?? null;
  const collections = (share.collections ?? []).map((c) => ({
    ...c,
    // 分享里的根到了本库就不是根了，留着 isRoot 会多出一棵并列的树
    isRoot: false,
    parentId: c.parentId && colIds.has(c.parentId) ? c.parentId : target,
  }));

  const lib: LibraryFile = {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      id: 'share',
      name: '事件集分享',
      exportedAt: share.exportedAt ?? new Date().toISOString(),
      app: APP,
      deviceId: getDeviceId(),
    },
    attributeDefs: [],
    persons: toImport,
    attrHistory: [],
    events,
    collections,
    members: share.members ?? [],
    attachments: share.attachments ?? [],
    templates: [],
    aiModels: [],
    messages,
  };
  return importLibrary(JSON.stringify(lib), 'merge');
}
