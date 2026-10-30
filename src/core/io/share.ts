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
//
// 打包口径（v3 起）：事件范围只来自**选中的事件集**（含子集，多选取并集）；
// **选中的人物只决定带走谁的资料**——没选中的人照样出现在事件里，
// 但只留姓名（或按等级化名），属性 / 备注 / 头像一概不带。

import { zip, unzip, strToU8, strFromU8 } from 'fflate';
import { getDeviceId, queryAll } from '../db';
import { getBlob, blobToBase64, base64ToBlob } from '../db/blob';
import { extractFileRefs } from '../markdown';
import { saveBytes } from './save';
import { getRoot, descendantIdsOf, getCollection, isSmart, listSmartEvents } from '../repo/collections';
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
import { isZipBytes } from './archive';

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

/** 打包范围：选中的事件集 + 进一步挑出的事件 + 「要带走资料」的人物 */
export interface ShareSelection {
  /** 事件集 id（含子集），至少一个 */
  collectionIds: string[];
  /**
   * 在这些事件集里再挑一层：只打包这些事件。
   * undefined = 事件集圈到的全部事件；[] = 一个事件都不带（只留事件集结构）。
   */
  eventIds?: string[];
  /**
   * 点名带走资料的人物 id。
   * undefined = 事件里出现的所有人按等级带资料；[] = 全部只留姓名。
   * 不在事件里的人物也会被附加进来（导入后是一个没有事件指向的人）。
   */
  personIds?: string[];
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

/** 按等级决定「名字还能不能露」：化名等级一律换代号，「去私」只对隐私人物换 */
function displayNameFor(p: Person, level: ShareLevel, alias: string | undefined): string {
  if (level === 'alias') return alias ?? p.displayName;
  if (level === 'noPrivate' && p.isPrivate) return alias ?? p.displayName;
  return p.displayName;
}

/** 抹掉一切资料，只留一个名字 */
function stripProfile(p: Person, name: string): Person {
  return { ...p, displayName: name, aliases: [], tags: [], notes: '', avatar: null, icon: null, attrs: {} };
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
  const bare = stripProfile(p, displayNameFor(p, level, alias));
  if (level === 'noPrivate' && !p.isPrivate) return p;
  if (level === 'custom') {
    const attrs: Person['attrs'] = {};
    for (const k of attrKeys) if (k in p.attrs) attrs[k] = p.attrs[k];
    return { ...bare, attrs };
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
 * 选中一批事件集后，它们圈住的事件。
 *
 * 成员关系从 collection_members 按集合筛，智能集合没有成员行，规则算出来的
 * 事件得单独并进来，否则「分享一个智能集合」会得到空文件。
 */
function eventIdsOf(collections: Collection[]): string[] {
  const ids = collections.map((c) => c.id);
  if (!ids.length) return [];
  const marks = ids.map(() => '?').join(',');
  const fromMembers = queryAll<{ member_id: string }>(
    `SELECT member_id FROM collection_members
      WHERE collection_id IN (${marks}) AND member_type = 'event' AND deleted_at IS NULL`,
    ids,
  ).map((r) => r.member_id);
  const fromSmart = collections.filter(isSmart).flatMap((c) => listSmartEvents(c).map((e) => e.id));
  return [...new Set([...fromMembers, ...fromSmart])];
}

/** 选中事件集圈住的事件（导出 / 预览 / 选人物都用这一份口径） */
export function eventsOfCollections(collectionIds: string[]): DREvent[] {
  if (!collectionIds.length) return [];
  const collections = [...descendantIdsOf(collectionIds)]
    .map((id) => getCollection(id))
    .filter((c): c is Collection => !!c);
  return eventIdsOf(collections)
    .map((id) => getEvent(id))
    .filter((e): e is DREvent => !!e);
}

/** 事件涉及的人物：参与者 + 聊天里出现的人 + 智能集合规则里指定的人 */
function personsOfEvents(events: DREvent[], collections: Collection[]): Person[] {
  const ids = new Set<string>();
  for (const e of events) for (const p of e.participants) ids.add(p.personId);
  for (const e of events) for (const m of listMessages(e.id)) if (m.personId) ids.add(m.personId);
  for (const c of collections) if (c.rule?.personId) ids.add(c.rule.personId);
  return listPersons({ includeArchived: true }).filter((p) => ids.has(p.id));
}

/**
 * 向导第二步用：选中这些事件集（可再按事件挑一层）之后，事件里出现了哪些人、各出现多少次。
 * 顺序按出现次数降序，常用的人排在前面。
 */
export function personsInCollections(
  collectionIds: string[],
  eventIds?: string[],
): { person: Person; eventCount: number }[] {
  let events = eventsOfCollections(collectionIds);
  if (eventIds) {
    const keep = new Set(eventIds);
    events = events.filter((e) => keep.has(e.id));
  }
  const counts = new Map<string, number>();
  for (const e of events) {
    for (const p of e.participants) counts.set(p.personId, (counts.get(p.personId) ?? 0) + 1);
  }
  const collections = [...descendantIdsOf(collectionIds)]
    .map((id) => getCollection(id))
    .filter((c): c is Collection => !!c);
  return personsOfEvents(events, collections)
    .map((person) => ({ person, eventCount: counts.get(person.id) ?? 0 }))
    .sort((a, b) => b.eventCount - a.eventCount || a.person.displayName.localeCompare(b.person.displayName));
}

/**
 * 打包选中的事件集。
 *
 * 成员关系是从 collection_members 里按集合筛出来的，而不是逐个事件反查——
 * 同一个事件挂在多个子集合下的情况，反查会漏掉一部分挂接关系。
 * 如果进一步按事件挑了，成员关系也只保留被挑中的那些，否则导入时
 * 会把没选的事件重新挂回集合里。
 */
export async function buildShare(sel: ShareSelection, opts: ShareOptions = {}): Promise<ShareFile> {
  const level: ShareLevel = opts.level ?? 'full';
  const attrKeys = opts.attrKeys ?? [];
  if (!sel.collectionIds.length) throw new Error('至少要选一个事件集');

  const colIds = [...descendantIdsOf(sel.collectionIds)];
  const collections = colIds
    .map((id) => getCollection(id))
    .filter((c): c is Collection => !!c);
  if (!collections.length) throw new Error('选中的事件集不存在或已删除');

  let pickedEventIds: Set<string> | null = null;
  if (sel.eventIds) pickedEventIds = new Set(sel.eventIds);
  const events = visibleEvents(
    eventIdsOf(collections)
      .filter((id) => !pickedEventIds || pickedEventIds.has(id))
      .map((id) => getEvent(id))
      .filter((e): e is DREvent => !!e),
    level,
  );
  const messages = events.flatMap((e) => listMessages(e.id));

  // 成员关系跟着事件一起裁：只保留真正带走的事件，集合成员照旧
  const keptEventIds = new Set(events.map((e) => e.id));
  const marks = colIds.map(() => '?').join(',');
  const members = queryAll<Row>(
    `SELECT * FROM collection_members WHERE collection_id IN (${marks}) AND deleted_at IS NULL`,
    colIds,
  )
    .map(rowToMember)
    .filter((m) => m.memberType !== 'event' || keptEventIds.has(m.memberId));

  // 事件涉及的人 + 用户额外点名的人（后者没有事件指向，但资料要一起带走）
  const byId = new Map<string, Person>();
  for (const p of personsOfEvents(events, collections)) byId.set(p.id, p);
  if (sel.personIds) {
    const all = listPersons({ includeArchived: true });
    for (const id of sel.personIds) {
      if (byId.has(id)) continue;
      const extra = all.find((p) => p.id === id);
      if (extra) byId.set(id, extra);
    }
  }
  const rawPersons = [...byId.values()];
  const picked =
    sel.personIds === undefined ? new Set(rawPersons.map((p) => p.id)) : new Set(sel.personIds);
  const book = aliasBook(rawPersons.map((p) => p.id));
  const persons = rawPersons.map((p) =>
    picked.has(p.id)
      ? maskPerson(p, level, attrKeys, book.get(p.id))
      : stripProfile(p, displayNameFor(p, level, book.get(p.id))),
  );

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

  const named = collections.find((c) => c.id === sel.collectionIds[0]);
  return {
    format: 'dr-share',
    version: 3,
    scope: 'collection',
    level,
    attrKeys: level === 'custom' ? attrKeys : [],
    sourceName: sel.collectionIds.length === 1 ? named?.name : `${sel.collectionIds.length} 个事件集`,
    exportedAt: new Date().toISOString(),
    app: APP,
    collectionIds: sel.collectionIds,
    pickedPersonIds: rawPersons.filter((p) => picked.has(p.id)).map((p) => p.id),
    rootId: sel.collectionIds[0] ?? '',
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
 * v2 口径，界面已不再使用（新流程从事件集出发）；保留给命令行与旧调用方。
 * 打包同样走 zip（buildShareArchive），不再产出单独的 JSON 文件。
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

// ---------------- 压缩包 ----------------

export const SHARE_ARCHIVE_FORMAT = 'drshare/3';

interface ShareManifest {
  format: typeof SHARE_ARCHIVE_FORMAT;
  exportedAt: string;
  app: string;
  level: ShareLevel;
  collectionIds: string[];
  /** id → 包内路径 */
  attachments: { id: string; path: string; name: string; mime: string }[];
}

/** 包内文件名优先用内容寻址的 storedId，缺失时退回 id */
function archivePathOf(a: Attachment): string {
  const name = (a.storedId || a.id).replace(/[^\w.-]+/g, '_');
  return `attachments/${name}`;
}

/**
 * 把一份分享打成 zip：
 *   share.json          结构化内容（附件只留元数据）
 *   attachments/<名字>  附件原文件
 *   manifest.json       格式、等级、附件清单
 *
 * JSON 单独放而不是拼进文件名，是为了导入时能一眼看出这是分享包，
 * 也方便以后加东西（比如缩略图）而不动主文件。
 */
export async function buildShareArchive(share: ShareFile): Promise<Uint8Array> {
  const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  const manifestAttachments: ShareManifest['attachments'] = [];
  const stripped: ShareFile = { ...share, attachments: [] };

  for (const a of share.attachments ?? []) {
    const path = archivePathOf(a);
    const blob = a.data ? base64ToBlob(a.data) : await getBlob(a.id);
    const bytes = blob ? new Uint8Array(await blob.arrayBuffer()) : null;
    if (!bytes) continue;
    files[path] = [bytes, { level: 0 }];
    manifestAttachments.push({ id: a.id, path, name: a.name, mime: a.mime });
    const { data: _data, ...meta } = a;
    stripped.attachments.push({ ...meta, data: '' });
  }

  const manifest: ShareManifest = {
    format: SHARE_ARCHIVE_FORMAT,
    exportedAt: share.exportedAt,
    app: share.app,
    level: share.level ?? 'full',
    collectionIds: share.collectionIds ?? (share.rootId ? [share.rootId] : []),
    attachments: manifestAttachments,
  };

  files['share.json'] = [strToU8(JSON.stringify(stripped)), { level: 6 }];
  files['manifest.json'] = [strToU8(JSON.stringify(manifest, null, 2)), { level: 6 }];

  return new Promise<Uint8Array>((resolve, reject) => {
    zip(files, (err, data) => (err ? reject(err) : resolve(data)));
  });
}

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || '分享';
}

/** TS 5.7 起 Uint8Array 的缓冲区可能是 SharedArrayBuffer，BlobPart 只收 ArrayBuffer；拷一份最稳 */
function toBlob(bytes: Uint8Array, type: string): Blob {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return new Blob([copy.buffer], { type });
}

/** 生成并下载分享压缩包，返回文件名 */
export async function exportShareArchive(sel: ShareSelection, opts: ShareOptions = {}): Promise<string> {
  const share = await buildShare(sel, opts);
  const bytes = await buildShareArchive(share);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const name = `分享-${safeName(share.sourceName ?? '事件集')}-${stamp}.drshare.zip`;
  // 走 saveBytes：壳里存进手机「下载」，浏览器里弹下载
  await saveBytes(bytes, name, 'application/zip');
  return name;
}

/** 解包分享 zip，把附件二进制转回 base64 填进 attachments[].data */
export async function shareTextFromArchive(bytes: Uint8Array): Promise<string> {
  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(bytes, (err, data) => (err ? reject(err) : resolve(data)));
  });
  const jsonBytes = entries['share.json'];
  if (!jsonBytes) throw new Error('压缩包里没有 share.json，不是有效的分享包');

  const share = JSON.parse(strFromU8(jsonBytes)) as ShareFile;
  let manifest: ShareManifest | null = null;
  const manBytes = entries['manifest.json'];
  if (manBytes) {
    try {
      manifest = JSON.parse(strFromU8(manBytes)) as ShareManifest;
    } catch {
      manifest = null;
    }
  }
  const pathById = new Map((manifest?.attachments ?? []).map((m) => [m.id, m.path]));
  for (const a of share.attachments ?? []) {
    if (a.data) continue;
    const path = pathById.get(a.id) ?? archivePathOf(a);
    const bin = entries[path];
    if (!bin) continue;
    a.data = await blobToBase64(toBlob(bin, a.mime || 'application/octet-stream'));
  }
  return JSON.stringify(share);
}

/** 从用户选的压缩包读出分享内容；旧的 .drshare.json 仍然认（只读，不产出） */
export async function readShareBytes(bytes: Uint8Array): Promise<ShareFile> {
  const text = isZipBytes(bytes) ? await shareTextFromArchive(bytes) : strFromU8(bytes);
  return parseShare(text);
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
    throw new Error('这不是分享文件（应是 .drshare.zip）');
  }
  if (!Array.isArray(s.collections) || !Array.isArray(s.events)) {
    throw new Error('分享文件缺少必要内容');
  }
  // v1 只有事件集分享，且没有等级概念
  const share = s as ShareFile;
  const multi = Array.isArray(share.collectionIds) && share.collectionIds.length > 0;
  if (share.scope !== 'person' && !share.rootId && !multi) {
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

  const roots = share.collectionIds?.length
    ? share.collections.filter((c) => share.collectionIds!.includes(c.id))
    : share.collections.filter((c) => c.id === share.rootId);
  return {
    share,
    rootName:
      share.scope === 'person'
        ? (share.sourceName ?? '人物') + '的分享'
        : roots.length === 1
          ? roots[0].name
          : `${roots.length} 个事件集`,
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
 * 集合的挂接点：分享里层级完整的子集合保持原样，顶层那些（以及任何父集合
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
