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
import { getEvent, listEvents } from '../repo/events';
import { listMessages } from '../repo/chat';
import { listPersons } from '../repo/persons';
import { createCollection } from '../repo/collections';
import { addMember } from '../repo/collections';
import {
  SCHEMA_VERSION,
  type Attachment,
  type Collection,
  type DREvent,
  type LibraryFile,
  type Person,
  type ShareFile,
  type ShareLevel,
} from '../types';
import { rowToAttachment, rowToMember, type Row } from './mappers';
import { importLibrary, type ImportResult } from './import';

/** 选择器里的「不关联，直接新建」——不能是这个值以外的任何真实人物 id */
export const NEW_PERSON = '__new__';

const APP = 'DatingRecord/0.1.0';

/** 分享程度：默认原样，和 v1 文件的行为一致 */
export interface ShareOptions {
  level?: ShareLevel;
  /** 自选等级要带走的属性 key；其它等级忽略 */
  attrKeys?: string[];
  includeAttachments?: boolean;
}

/**
 * 化名池：刻意挑不带性别暗示、也不像真名的两个字。
 * 用完就退化成「人物 A / 人物 B」，不循环复用，避免两个人在同一份分享里重名。
 */
const ALIAS_POOL = [
  '阿青', '阿岚', '阿禾', '阿川', '阿舟', '阿南', '阿原', '阿望', '阿迟', '阿屿',
  '阿霁', '阿棠', '阿栖', '阿苓', '阿榆', '阿陉', '阿疋', '阿晏', '阿瑄', '阿珩',
];

/** 一份分享里的人物 id → 化名，保证同一个人从头到尾只有一个代号 */
function aliasBook(ids: string[]): Map<string, string> {
  const book = new Map<string, string>();
  [...ids].sort().forEach((id, i) => {
    book.set(id, ALIAS_POOL[i] ?? `人物 ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? i : ''}`);
  });
  return book;
}

/**
 * 按等级裁一个人的资料。
 *
 * 只有「原样」整份保留；「去私」放过非隐私人物、把隐私人物降为化名；
 * 「只名」「化名」「自选」一律剥掉属性与备注——差别只在名字本身。
 */
function maskPerson(
  p: Person,
  level: ShareLevel,
  attrKeys: string[],
  alias: string | undefined,
): Person {
  if (level === 'full') return p;
  if (level === 'noPrivate' && !p.isPrivate) return p;

  const bare: Person = {
    ...p,
    aliases: [],
    tags: [],
    notes: '',
    avatar: null,
    icon: null,
    attrs: {},
  };
  if (level === 'custom') {
    const attrs: Person['attrs'] = {};
    for (const k of attrKeys) if (k in p.attrs) attrs[k] = p.attrs[k];
    return { ...bare, attrs };
  }
  if (level === 'alias' || (level === 'noPrivate' && p.isPrivate)) {
    return { ...bare, displayName: alias ?? p.displayName };
  }
  return bare;
}

/** 非「原样」等级下，标了隐私的事件整条不带走 */
function visibleEvents(events: DREvent[], level: ShareLevel): DREvent[] {
  return level === 'full' ? events : events.filter((e) => !e.isPrivate);
}

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
  opts: ShareOptions = {},
): Promise<ShareFile> {
  const level: ShareLevel = opts.level ?? 'full';
  const attrKeys = opts.attrKeys ?? [];
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
  const events = visibleEvents(
    eventIds.map((id) => getEvent(id)).filter((e): e is DREvent => !!e),
    level,
  );
  const messages = events.flatMap((e) => listMessages(e.id));

  const personIds = new Set<string>();
  for (const e of events) for (const p of e.participants) personIds.add(p.personId);
  for (const m of messages) if (m.personId) personIds.add(m.personId);
  // 事件集本身也可能是智能集合，规则里指定了人物
  for (const c of collections) if (c.rule?.personId) personIds.add(c.rule.personId);
  const rawPersons = listPersons({ includeArchived: true }).filter((p) => personIds.has(p.id));
  const book = aliasBook(rawPersons.map((p) => p.id));
  const persons = rawPersons.map((p) => maskPerson(p, level, attrKeys, book.get(p.id)));

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
    version: 2,
    scope: 'collection',
    level,
    attrKeys: level === 'custom' ? attrKeys : [],
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

/**
 * 打包一个人：他参与过的全部事件 + 这些事件里出现的人物。
 *
 * 刻意不带事件集结构——分享的是「这个人身上的事」，落到对方哪个集合里由他导入时决定。
 */
export async function buildPersonShare(personId: string, opts: ShareOptions = {}): Promise<ShareFile> {
  const level: ShareLevel = opts.level ?? 'full';
  const attrKeys = opts.attrKeys ?? [];
  const person = listPersons({ includeArchived: true }).find((p) => p.id === personId);
  if (!person) throw new Error('人物不存在或已删除');

  const events = visibleEvents(listEvents({ personId }), level);
  const messages = events.flatMap((e) => listMessages(e.id));

  const personIds = new Set<string>([person.id]);
  for (const e of events) for (const p of e.participants) personIds.add(p.personId);
  for (const m of messages) if (m.personId) personIds.add(m.personId);

  const rawPersons = listPersons({ includeArchived: true }).filter((p) => personIds.has(p.id));
  const book = aliasBook(rawPersons.map((p) => p.id));
  const persons = rawPersons.map((p) => maskPerson(p, level, attrKeys, book.get(p.id)));

  const refs = refsOf([
    ...events.map((e) => e.content),
    ...messages.map((m) => m.body),
    ...persons.flatMap((p) => [p.notes, p.avatar]),
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
    version: 2,
    scope: 'person',
    level,
    attrKeys: level === 'custom' ? attrKeys : [],
    sourceName: person.displayName,
    exportedAt: new Date().toISOString(),
    app: APP,
    rootId: '',
    collections: [],
    members: [],
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

/** 把分享对象落成文件（浏览器触发下载），返回文件名 */
async function downloadShare(share: ShareFile, label: string): Promise<string> {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const name = `分享-${safeName(label)}-${stamp}.drshare.json`;
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

/** 生成并下载事件集分享文件，返回下载用的文件名 */
export async function exportShareFile(collectionId: string, opts: ShareOptions = {}): Promise<string> {
  const share = await buildShare(collectionId, opts);
  const root = share.collections.find((c) => c.id === share.rootId);
  return downloadShare(share, root?.name ?? '事件集');
}

/** 生成并下载人物分享文件，返回下载用的文件名 */
export async function exportPersonShareFile(personId: string, opts: ShareOptions = {}): Promise<string> {
  const share = await buildPersonShare(personId, opts);
  return downloadShare(share, `人物-${share.sourceName ?? '分享'}`);
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
  if (!Array.isArray(s.collections) || !Array.isArray(s.events)) {
    throw new Error('分享文件缺少必要内容');
  }
  // v1 只有事件集分享，且没有等级概念
  const share = s as ShareFile;
  if (share.scope !== 'person' && !share.rootId) {
    throw new Error('分享文件缺少必要内容');
  }
  return share;
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
    rootName:
      share.scope === 'person'
        ? (share.sourceName ?? '人物') + '的分享'
        : root?.name ?? '事件集',
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
export type ShareLanding =
  /** 新建：事件集分享保持原有层级，挂到 parentId；人物分享则新建一个集合装事件 */
  | { mode: 'new'; parentId?: string | null; name?: string }
  /** 合并：不新建集合，把带来事件直接挂到已有的这个事件集里 */
  | { mode: 'merge'; collectionId: string };

export async function applyShare(
  share: ShareFile,
  opts: { personMap: Record<string, string>; landing: ShareLanding },
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

  const landing = opts.landing;
  const merging = landing.mode === 'merge';
  const colIds = new Set((share.collections ?? []).map((c) => c.id));
  const target = landing.mode === 'new' ? landing.parentId ?? getRoot()?.id ?? null : null;
  // 合并模式下不重建结构：所有事件直接挂到目标事件集，集合与成员关系都不导入
  const collections = merging
    ? []
    : (share.collections ?? []).map((c) => ({
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
    members: merging ? [] : share.members ?? [],
    attachments: share.attachments ?? [],
    templates: [],
    aiModels: [],
    messages,
  };
  const result = await importLibrary(JSON.stringify(lib), 'merge');

  // 事件落下之后再把「挂到哪个集合」补齐：
  //   merge → 挂到目标集合；new + 人物分享（本来就没有集合）→ 建一个新集合装进去
  const eventIds = events.map((e) => e.id);
  if (eventIds.length) {
    let destId: string | null = merging ? landing.collectionId : null;
    if (!destId && !collections.length) {
      const name =
        (landing.mode === 'new' && landing.name?.trim()) ||
        `${share.sourceName ?? '分享'}的事件`;
      destId = createCollection({ name, parentId: target }).id;
      result.counts.collections += 1;
    }
    if (destId) {
      for (const id of eventIds) addMember(destId, 'event', id);
      result.counts.members += eventIds.length;
    }
  }
  return result;
}
